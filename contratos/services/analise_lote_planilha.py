import datetime
import io
import os
import re
import zipfile
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional
from xml.etree import ElementTree as ET

from django.contrib.auth.models import User
from django.db import models, transaction
from django.db.models import Prefetch, Q
from django.urls import reverse
from django.utils import timezone

from contratos.models import (
    AnaliseProcesso,
    Carteira,
    Contrato,
    OpcaoResposta,
    Parte,
    ProcessoJudicial,
    ProcessoJudicialNumeroCnj,
    QuestaoAnalise,
    StatusProcessual,
    TipoAnaliseObjetiva,
)
from contratos.services.passivas_planilha import (
    PassivasPlanilhaError,
    SHEET_NS,
    extract_table,
    format_cnj,
    load_csv_records_from_bytes,
    load_xlsx_sheet_rows_from_bytes,
    normalize_cnj_digits,
    normalize_cpf,
    normalize_header,
    parse_decimal,
    split_contract_numbers,
)


class AnaliseLotePlanilhaError(PassivasPlanilhaError):
    pass


@dataclass
class AnaliseLoteRow:
    row_id: str
    uf: str
    parte_contraria: str
    cpf: str
    cnj: str
    cnj_digits: str
    contratos: List[str]
    tipo_acao: str
    valor_causa: Optional[Decimal]
    classe_processual: str
    habilitacao: str
    julgamento: str
    procedencia: str
    transitado: str
    data_transito: str
    fase_recursal: str
    cumprimento_sentenca: str
    observacoes: str
    raw: Dict[str, Any]


@dataclass
class AnaliseLotePreviewItem:
    row_id: str
    checked: bool
    selectable: bool
    match_status: str
    match_label: str
    uf: str
    cpf: str
    cnj: str
    parte_contraria: str
    process_id: Optional[int]
    process_admin_url: str
    existing_card: bool
    action_label: str
    existing_card_summary: str
    summary: Dict[str, Any]
    import_status: str = "ready"
    import_status_label: str = "Pronta para importar"
    import_status_detail: str = ""


@dataclass
class AnaliseLotePreviewResult:
    rows: int = 0
    matched_rows: int = 0
    existing_cards: int = 0
    new_cards: int = 0
    conflict_rows: int = 0
    missing_rows: int = 0
    ufs: List[str] = field(default_factory=list)
    items: List[AnaliseLotePreviewItem] = field(default_factory=list)


@dataclass
class AnaliseLoteImportResult:
    created_cards: int = 0
    updated_cards: int = 0
    created_cnjs: int = 0
    updated_cnjs: int = 0
    updated_processos: int = 0
    skipped_rows: int = 0
    matched_rows: int = 0
    errors: List[str] = field(default_factory=list)
    row_results: List[Dict[str, str]] = field(default_factory=list)


def _normalize_contract_token(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _parse_xlsx_rows(file_bytes: bytes, sheet_prefix: str = "") -> List[Dict[str, Any]]:
    prefix = (sheet_prefix or "").strip()
    if not prefix:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
            wb = ET.fromstring(z.read("xl/workbook.xml"))
            for sh in wb.findall(f".//{{{SHEET_NS}}}sheets/{{{SHEET_NS}}}sheet"):
                prefix = (sh.attrib.get("name") or "").strip()
                if prefix:
                    break
        if not prefix:
            raise AnaliseLotePlanilhaError("Não foi possível localizar uma aba válida na planilha enviada.")
    cols, raw_rows = load_xlsx_sheet_rows_from_bytes(file_bytes, prefix)
    _, records = extract_table(raw_rows, cols)
    return records


def parse_analise_lote_row(rec: Dict[str, Any], row_index: int) -> Optional[AnaliseLoteRow]:
    uf = str(rec.get("UF", "") or "").strip().upper()
    parte_contraria = str(
        rec.get("PARTE CONTRÁRIA", "") or rec.get("PARTE CONTRARIA", "") or ""
    ).strip()
    cpf = normalize_cpf(rec.get("CPF", ""))
    cnj_raw = rec.get("PROCESSO CNJ", "")
    cnj_digits = normalize_cnj_digits(cnj_raw)
    cnj = format_cnj(cnj_raw) or str(cnj_raw or "").strip()
    contratos = split_contract_numbers(
        rec.get("CONTRATO", "")
        or rec.get("CONTRATOS", "")
        or rec.get("TODOS CONTRATOS DESTE CPF", "")
    )
    tipo_acao = str(rec.get("TIPO DE AÇÃO", "") or rec.get("TIPO DE ACAO", "") or "").strip()
    valor_causa = parse_decimal(rec.get("VALOR DA CAUSA", ""))
    classe_processual = str(
        rec.get("CLASSE PROCESSUAL", "")
        or rec.get("CLASSE", "")
        or rec.get("STATUS", "")
        or ""
    ).strip()
    habilitacao = str(rec.get("HABILITAÇÃO", "") or rec.get("HABILITACAO", "") or "").strip()
    julgamento = str(rec.get("JULGAMENTO", "") or "").strip()
    procedencia = str(rec.get("PROCEDÊNCIA", "") or rec.get("PROCEDENCIA", "") or "").strip()
    transitado = str(rec.get("TRANSITADO", "") or "").strip()
    data_transito = str(
        rec.get("DATA DE TRÂNSITO", "") or rec.get("DATA DE TRANSITO", "") or ""
    ).strip()
    fase_recursal = str(rec.get("FASE RECURSAL", "") or "").strip()
    cumprimento_sentenca = str(
        rec.get("CUMPRIMENTO DE SENTENÇA", "") or rec.get("CUMPRIMENTO DE SENTENCA", "") or ""
    ).strip()
    observacoes = str(rec.get("OBSERVAÇÕES", "") or rec.get("OBSERVACOES", "") or "").strip()

    if not cnj_digits and not contratos and not cpf:
        return None

    return AnaliseLoteRow(
        row_id=str(row_index),
        uf=uf,
        parte_contraria=parte_contraria,
        cpf=cpf,
        cnj=cnj,
        cnj_digits=cnj_digits,
        contratos=contratos,
        tipo_acao=tipo_acao,
        valor_causa=valor_causa,
        classe_processual=classe_processual,
        habilitacao=habilitacao,
        julgamento=julgamento,
        procedencia=procedencia,
        transitado=transitado,
        data_transito=data_transito,
        fase_recursal=fase_recursal,
        cumprimento_sentenca=cumprimento_sentenca,
        observacoes=observacoes,
        raw=rec,
    )


def build_analise_lote_rows_from_file_bytes(
    file_bytes: bytes,
    *,
    upload_name: str,
    sheet_prefix: str = "",
    uf_filter: str = "",
    limit: int = 0,
) -> List[AnaliseLoteRow]:
    lower_name = (upload_name or "").lower().strip()
    if lower_name.endswith(".csv"):
        records = load_csv_records_from_bytes(file_bytes)
    else:
        records = _parse_xlsx_rows(file_bytes, sheet_prefix=sheet_prefix)

    rows: List[AnaliseLoteRow] = []
    for index, rec in enumerate(records):
        row = parse_analise_lote_row(rec, index)
        if not row:
            continue
        if uf_filter and row.uf and row.uf != str(uf_filter).strip().upper():
            continue
        rows.append(row)
    if limit:
        rows = rows[: int(limit)]
    return rows


def _normalize_text(value: Any) -> str:
    text = normalize_header(value)
    return text.replace("  ", " ").strip()


def _tipo_text(tipo_analise: TipoAnaliseObjetiva) -> str:
    return _normalize_text(
        f"{getattr(tipo_analise, 'slug', '')} {getattr(tipo_analise, 'nome', '')} {getattr(tipo_analise, 'hashtag', '')}"
    )


def _is_esteira3(tipo_analise: TipoAnaliseObjetiva) -> bool:
    text = _tipo_text(tipo_analise)
    return "ESTEIRA 3" in text or "ESTEIRA_3" in text or "E 3" in text or "#E 3" in text or "#E-3" in text


def _build_question_maps(tipo_analise: TipoAnaliseObjetiva) -> Dict[str, Any]:
    questions = list(
        QuestaoAnalise.objects.filter(tipo_analise=tipo_analise, ativo=True)
        .prefetch_related(
            Prefetch(
                "opcoes",
                queryset=OpcaoResposta.objects.filter(ativo=True).select_related("proxima_questao"),
            )
        )
        .order_by("ordem", "id")
    )
    by_text = {_normalize_text(q.texto_pergunta): q for q in questions if q.texto_pergunta}
    by_key = {q.chave: q for q in questions if q.chave}
    first_question = next((q for q in questions if q.is_primeira_questao), None)
    contract_question = next((q for q in questions if q.tipo_campo == "CONTRATOS_MONITORIA"), None)
    process_question = next((q for q in questions if q.tipo_campo == "PROCESSO_VINCULADO"), None)
    return {
        "questions": questions,
        "by_text": by_text,
        "by_key": by_key,
        "first_question": first_question,
        "contract_question": contract_question,
        "process_question": process_question,
    }


def _question_key_by_text(question_maps: Dict[str, Any], *candidates: str) -> Optional[str]:
    by_text = question_maps["by_text"]
    for candidate in candidates:
        normalized = _normalize_text(candidate)
        question = by_text.get(normalized)
        if question and question.chave:
            return question.chave
    return None


def _question_by_key(question_maps: Dict[str, Any], key: Optional[str]):
    if not key:
        return None
    return question_maps["by_key"].get(key)


def _coerce_option_value(question, raw_value: str) -> str:
    text = str(raw_value or "").strip()
    if not question or not text:
        return text
    normalized_target = _normalize_text(text)
    options = list(getattr(question, "opcoes", []).all()) if hasattr(question, "opcoes") else []
    exact = next(
        (
            opt.texto_resposta
            for opt in options
            if _normalize_text(opt.texto_resposta) == normalized_target
        ),
        None,
    )
    if exact:
        return exact
    partial = next(
        (
            opt.texto_resposta
            for opt in options
            if normalized_target and (
                normalized_target in _normalize_text(opt.texto_resposta)
                or _normalize_text(opt.texto_resposta) in normalized_target
            )
        ),
        None,
    )
    return partial or text


def _get_or_create_status(nome: str) -> Optional[StatusProcessual]:
    label = str(nome or "").strip()
    if not label:
        return None
    status = StatusProcessual.objects.filter(nome__iexact=label).order_by("id").first()
    if status:
        return status
    return StatusProcessual.objects.create(nome=label, ativo=True)


def _format_currency(value: Optional[Decimal]) -> str:
    if value is None:
        return "-"
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _resolve_user_label(user: Optional[User]) -> str:
    if not user:
        return "-"
    full_name = (user.get_full_name() or "").strip()
    if full_name:
        return full_name
    return user.username


def _extract_question_key(question_maps: Dict[str, Any], label: str, fallback_candidates: List[str]) -> Optional[str]:
    candidates = [label] + list(fallback_candidates)
    return _question_key_by_text(question_maps, *candidates)


def _normalize_habilitacao_semantic(value: str) -> str:
    normalized = _normalize_text(value)
    if not normalized:
        return ""
    if "REDISTRIBUIR" in normalized:
        return "REPROPOR"
    if "REPROPOR" in normalized:
        return "REPROPOR"
    if "REITERAR" in normalized:
        return "REITERAR"
    if "NAO HABILITAR" in normalized and "ONUS" in normalized:
        return "NAO_HABILITAR_ONUS"
    if "B6" in normalized and "HABILIT" in normalized:
        return "B6_HABILITADA"
    if "HABILITAR" in normalized:
        return "HABILITAR"
    return normalized


def _derive_primeira_resposta(row: AnaliseLoteRow) -> str:
    semantic = _normalize_habilitacao_semantic(row.habilitacao)
    if semantic in {"HABILITAR", "NAO_HABILITAR_ONUS", "B6_HABILITADA", "REITERAR"}:
        return "SIM - EM ANDAMENTO"
    return ""


def _build_row_question_responses(
    row: AnaliseLoteRow,
    tipo_analise: TipoAnaliseObjetiva,
    question_maps: Dict[str, Any],
    contract_refs: List[str],
) -> Dict[str, Any]:
    responses: Dict[str, Any] = {}
    first_question = question_maps.get("first_question")
    first_key = getattr(first_question, "chave", None)
    first_question_obj = first_question
    habilitacao_semantic = _normalize_habilitacao_semantic(row.habilitacao)

    primeira_resposta = _derive_primeira_resposta(row)
    if first_key and primeira_resposta:
        responses[first_key] = _coerce_option_value(first_question_obj, primeira_resposta)

    tipo_acao_key = _extract_question_key(
        question_maps,
        "TIPO DE AÇÃO",
        ["TIPO DE ACAO", "Classe Processual"],
    )
    tipo_acao_question = _question_by_key(question_maps, tipo_acao_key)
    tipo_acao_value = row.tipo_acao or row.classe_processual
    if tipo_acao_key and tipo_acao_value:
        responses[tipo_acao_key] = _coerce_option_value(tipo_acao_question, tipo_acao_value)

    habilitacao_key = _extract_question_key(
        question_maps,
        "HABILITAÇÃO",
        ["HABILITACAO", "HABILITAÇÃO E3", "HABILITACAO E3"],
    )
    habilitacao_question = _question_by_key(question_maps, habilitacao_key)
    habilitacao_value = row.habilitacao
    if habilitacao_semantic == "REPROPOR":
        habilitacao_value = "REPROPOR"
    if habilitacao_key and habilitacao_value:
        responses[habilitacao_key] = _coerce_option_value(habilitacao_question, habilitacao_value)

    julgamento_key = _extract_question_key(question_maps, "JULGAMENTO", [])
    julgamento_question = _question_by_key(question_maps, julgamento_key)
    julgamento_value = row.julgamento
    if not julgamento_value and _is_esteira3(tipo_analise) and julgamento_key:
        julgamento_value = "PENDENTE"
    if julgamento_key and julgamento_value:
        responses[julgamento_key] = _coerce_option_value(julgamento_question, julgamento_value)

    procedencia_key = _extract_question_key(question_maps, "PROCEDENCIA", ["PROCEDÊNCIA"])
    procedencia_question = _question_by_key(question_maps, procedencia_key)
    procedencia_value = row.procedencia
    if not procedencia_value and _is_esteira3(tipo_analise) and procedencia_key:
        procedencia_value = "PENDENTE"
    if procedencia_key and procedencia_value:
        responses[procedencia_key] = _coerce_option_value(procedencia_question, procedencia_value)

    transitado_key = _extract_question_key(question_maps, "TRANSITADO", [])
    transitado_question = _question_by_key(question_maps, transitado_key)
    if transitado_key and row.transitado:
        responses[transitado_key] = _coerce_option_value(transitado_question, row.transitado)

    data_transito_key = _extract_question_key(
        question_maps,
        "DATA DE TRANSITO",
        ["DATA DE TRÂNSITO"],
    )
    if data_transito_key and row.data_transito:
        responses[data_transito_key] = row.data_transito

    fase_recursal_key = _extract_question_key(question_maps, "FASE RECURSAL", [])
    fase_recursal_question = _question_by_key(question_maps, fase_recursal_key)
    if fase_recursal_key and row.fase_recursal:
        responses[fase_recursal_key] = _coerce_option_value(fase_recursal_question, row.fase_recursal)

    cumprimento_key = _extract_question_key(
        question_maps,
        "CUMPRIMENTO DE SENTENCA",
        ["CUMPRIMENTO DE SENTENÇA"],
    )
    cumprimento_question = _question_by_key(question_maps, cumprimento_key)
    if cumprimento_key and row.cumprimento_sentenca:
        responses[cumprimento_key] = _coerce_option_value(cumprimento_question, row.cumprimento_sentenca)

    contract_question = question_maps.get("contract_question")
    should_attach_monitoria_contracts = habilitacao_semantic == "REPROPOR"
    if should_attach_monitoria_contracts and contract_question and contract_question.chave and contract_refs:
        responses[contract_question.chave] = contract_refs[:]
    if should_attach_monitoria_contracts and contract_refs:
        responses["contratos_para_monitoria"] = contract_refs[:]

    return responses


def _build_summary_entries(
    row: AnaliseLoteRow,
    tipo_analise: TipoAnaliseObjetiva,
    responses: Dict[str, Any],
    question_maps: Dict[str, Any],
    contract_numbers: List[str],
) -> List[Dict[str, str]]:
    entries: List[Dict[str, str]] = []
    habilitacao_semantic = _normalize_habilitacao_semantic(row.habilitacao)

    def append_if(question_label: str, fallback_candidates: List[str] = None):
        key = _extract_question_key(question_maps, question_label, fallback_candidates or [])
        value = responses.get(key) if key else ""
        if value:
            entries.append({"label": question_label, "value": str(value)})

    append_if("JUDICIALIZADO PELA MASSA BCSUL", [])
    append_if("HABILITAÇÃO", ["HABILITACAO", "HABILITAÇÃO E3", "HABILITACAO E3"])
    append_if("TIPO DE AÇÃO", ["TIPO DE ACAO"])
    append_if("JULGAMENTO")
    append_if("PROCEDÊNCIA", ["PROCEDENCIA"])

    contract_question = question_maps.get("contract_question")
    if habilitacao_semantic == "REPROPOR" and contract_question and contract_numbers:
        entries.append(
            {
                "label": contract_question.texto_pergunta or "Contratos para a monitória",
                "value": ", ".join(contract_numbers),
            }
        )

    return entries


def _is_linked_to_carteira(processo: ProcessoJudicial, carteira: Carteira) -> bool:
    carteira_id = getattr(carteira, "id", None)
    if not carteira_id or not processo:
        return False
    if processo.carteira_id == carteira_id:
        return True
    if hasattr(processo, "_linked_carteira_ids"):
        return carteira_id in processo._linked_carteira_ids
    return processo.carteiras_vinculadas.filter(id=carteira_id).exists()


def _build_resolver_indexes(rows: Iterable[AnaliseLoteRow]):
    cnj_digits = {row.cnj_digits for row in rows if row.cnj_digits}
    cpfs = {row.cpf for row in rows if row.cpf}
    contract_numbers = set()
    contract_digits = set()
    for row in rows:
        for contract in row.contratos:
            if contract:
                contract_numbers.add(str(contract).strip())
                digits = _normalize_contract_token(contract)
                if digits:
                    contract_digits.add(digits)

    cnj_expr = models.Func(
        models.F("cnj"),
        models.Value(r"\D"),
        models.Value(""),
        models.Value("g"),
        function="regexp_replace",
    )
    doc_expr = models.Func(
        models.F("documento"),
        models.Value(r"\D"),
        models.Value(""),
        models.Value("g"),
        function="regexp_replace",
    )
    contrato_expr = models.Func(
        models.F("numero_contrato"),
        models.Value(r"\D"),
        models.Value(""),
        models.Value("g"),
        function="regexp_replace",
    )

    cnj_map: Dict[str, set[int]] = {}
    for obj in ProcessoJudicialNumeroCnj.objects.annotate(_cnj_digits=cnj_expr).filter(_cnj_digits__in=cnj_digits):
        cnj_map.setdefault(obj._cnj_digits, set()).add(obj.processo_id)
    for obj in ProcessoJudicial.objects.annotate(_cnj_digits=cnj_expr).filter(_cnj_digits__in=cnj_digits):
        cnj_map.setdefault(obj._cnj_digits, set()).add(obj.id)

    cpf_map: Dict[str, set[int]] = {}
    for parte in Parte.objects.annotate(_doc_digits=doc_expr).filter(_doc_digits__in=cpfs):
        cpf_map.setdefault(parte._doc_digits, set()).add(parte.processo_id)

    contract_map: Dict[str, set[int]] = {}
    for contrato in Contrato.objects.annotate(_num_digits=contrato_expr).filter(
        Q(numero_contrato__in=contract_numbers) | Q(_num_digits__in=contract_digits)
    ):
        exact = str(contrato.numero_contrato or "").strip()
        if exact:
            contract_map.setdefault(exact, set()).add(contrato.processo_id)
        digits = getattr(contrato, "_num_digits", "")
        if digits:
            contract_map.setdefault(digits, set()).add(contrato.processo_id)

    process_ids = set()
    for mapping in (cnj_map, cpf_map, contract_map):
        for values in mapping.values():
            process_ids.update(values)

    processos_qs = (
        ProcessoJudicial.objects.filter(id__in=process_ids)
        .select_related("analise_processo", "carteira", "delegado_para")
        .prefetch_related("carteiras_vinculadas", "numeros_cnj", "contratos", "partes_processuais")
    )
    processos = {proc.id: proc for proc in processos_qs}
    for proc in processos.values():
        proc._linked_carteira_ids = {c.id for c in proc.carteiras_vinculadas.all() if c and c.id}
    return {"cnj": cnj_map, "cpf": cpf_map, "contract": contract_map, "processes": processos}


def _resolve_process_for_row(
    row: AnaliseLoteRow,
    carteira: Carteira,
    indexes: Dict[str, Any],
) -> Dict[str, Any]:
    candidate_scores: Dict[int, int] = {}
    candidate_reasons: Dict[int, List[str]] = {}

    def add_candidates(process_ids: Iterable[int], score: int, reason: str) -> None:
        for process_id in process_ids:
            candidate_scores[process_id] = candidate_scores.get(process_id, 0) + score
            candidate_reasons.setdefault(process_id, []).append(reason)

    if row.cnj_digits:
        add_candidates(indexes["cnj"].get(row.cnj_digits, set()), 100, "CNJ")
    if row.cpf:
        add_candidates(indexes["cpf"].get(row.cpf, set()), 30, "CPF")
    for contract in row.contratos:
        token = str(contract).strip()
        if token:
            add_candidates(indexes["contract"].get(token, set()), 60, "Contrato")
        digits = _normalize_contract_token(token)
        if digits:
            add_candidates(indexes["contract"].get(digits, set()), 60, "Contrato")

    if not candidate_scores:
        return {"status": "missing", "label": "Sem cadastro correspondente", "process": None}

    for process_id in list(candidate_scores.keys()):
        processo = indexes["processes"].get(process_id)
        if processo and _is_linked_to_carteira(processo, carteira):
            candidate_scores[process_id] += 25

    sorted_candidates = sorted(candidate_scores.items(), key=lambda item: (-item[1], item[0]))
    best_score = sorted_candidates[0][1]
    best_ids = [process_id for process_id, score in sorted_candidates if score == best_score]
    if len(best_ids) != 1:
        return {"status": "conflict", "label": "Conflito de cadastro", "process": None}

    process_id = best_ids[0]
    processo = indexes["processes"].get(process_id)
    if not processo:
        return {"status": "missing", "label": "Cadastro não disponível", "process": None}
    return {
        "status": "matched",
        "label": "Cadastro encontrado",
        "process": processo,
        "reasons": candidate_reasons.get(process_id, []),
    }


def _get_contract_objects_for_row(processo: ProcessoJudicial, row: AnaliseLoteRow) -> List[Contrato]:
    process_contracts = list(processo.contratos.all())
    by_number = {str(c.numero_contrato or "").strip(): c for c in process_contracts if c.numero_contrato}
    by_digits = {
        _normalize_contract_token(c.numero_contrato): c
        for c in process_contracts
        if c.numero_contrato and _normalize_contract_token(c.numero_contrato)
    }
    found: List[Contrato] = []
    seen_ids = set()
    for raw_number in row.contratos:
        token = str(raw_number or "").strip()
        if not token:
            continue
        contract = by_number.get(token) or by_digits.get(_normalize_contract_token(token))
        if contract and contract.id not in seen_ids:
            found.append(contract)
            seen_ids.add(contract.id)
    return found


def _existing_card_index(cards: List[dict], row: AnaliseLoteRow, carteira: Carteira, tipo_analise: TipoAnaliseObjetiva) -> Optional[int]:
    target_carteira_id = str(getattr(carteira, "id", "") or "")
    target_tipo_id = str(getattr(tipo_analise, "id", "") or "")
    for idx, card in enumerate(cards):
        if not isinstance(card, dict):
            continue
        analysis_type = card.get("analysis_type") or {}
        card_tipo_id = str(analysis_type.get("id") or "")
        if target_tipo_id and card_tipo_id and card_tipo_id != target_tipo_id:
            continue
        card_carteira_id = str(card.get("carteira_id") or "")
        if target_carteira_id and card_carteira_id and card_carteira_id != target_carteira_id:
            continue
        if row.cnj_digits and normalize_cnj_digits(card.get("cnj")) == row.cnj_digits:
            return idx
    return None


def _ensure_numero_cnj(
    processo: ProcessoJudicial,
    row: AnaliseLoteRow,
    carteira: Carteira,
    classe_processual: Optional[StatusProcessual],
) -> Dict[str, int]:
    if not row.cnj_digits:
        return {"created": 0, "updated": 0}
    existing = next(
        (
            item
            for item in processo.numeros_cnj.all()
            if normalize_cnj_digits(getattr(item, "cnj", "")) == row.cnj_digits
        ),
        None,
    )
    if not existing:
        ProcessoJudicialNumeroCnj.objects.create(
            processo=processo,
            cnj=row.cnj or format_cnj(row.cnj_digits),
            uf=row.uf or processo.uf or "",
            valor_causa=row.valor_causa,
            status=classe_processual,
            carteira=carteira,
        )
        return {"created": 1, "updated": 0}

    changed_fields: List[str] = []
    if row.uf and existing.uf != row.uf:
        existing.uf = row.uf
        changed_fields.append("uf")
    if row.valor_causa is not None and existing.valor_causa != row.valor_causa:
        existing.valor_causa = row.valor_causa
        changed_fields.append("valor_causa")
    if classe_processual and existing.status_id != classe_processual.id:
        existing.status = classe_processual
        changed_fields.append("status")
    if carteira and existing.carteira_id != carteira.id:
        existing.carteira = carteira
        changed_fields.append("carteira")
    if changed_fields:
        existing.save(update_fields=changed_fields)
        return {"created": 0, "updated": 1}
    return {"created": 0, "updated": 0}


def _build_card_payload(
    *,
    processo: ProcessoJudicial,
    row: AnaliseLoteRow,
    carteira: Carteira,
    tipo_analise: TipoAnaliseObjetiva,
    analista: User,
    contract_refs: List[str],
    question_maps: Dict[str, Any],
) -> Dict[str, Any]:
    responses = _build_row_question_responses(row, tipo_analise, question_maps, contract_refs)
    now_iso = timezone.now().isoformat()
    contract_numbers = [
        str(contract.numero_contrato or "").strip()
        for contract in processo.contratos.filter(id__in=contract_refs)
        if str(contract.numero_contrato or "").strip()
    ] or [str(item).strip() for item in row.contratos if str(item).strip()]
    return {
        "cnj": row.cnj or format_cnj(row.cnj_digits) or "Não informado",
        "valor_causa": float(row.valor_causa) if row.valor_causa is not None else None,
        "contratos": contract_refs[:],
        "tipo_de_acao_respostas": responses,
        "analysis_type": {
            "id": tipo_analise.id,
            "nome": tipo_analise.nome,
            "slug": tipo_analise.slug,
            "hashtag": tipo_analise.hashtag,
            "versao": tipo_analise.versao,
        },
        "carteira_id": carteira.id if carteira else None,
        "carteira_nome": carteira.nome if carteira else "",
        "supervisionado": False,
        "supervisor_status": "pendente",
        "awaiting_supervision_confirm": False,
        "supervision_date": "",
        "barrado": {"ativo": False, "inicio": None, "retorno_em": None},
        "observacoes": row.observacoes or "",
        "analysis_author": _resolve_user_label(analista),
        "saved_at": now_iso,
        "updated_at": now_iso,
        "result_entries": _build_summary_entries(row, tipo_analise, responses, question_maps, contract_numbers),
        "general_card_snapshot": False,
    }


def _build_summary_preview(
    *,
    row: AnaliseLoteRow,
    processo: Optional[ProcessoJudicial],
    carteira: Carteira,
    tipo_analise: TipoAnaliseObjetiva,
    analista: User,
    question_maps: Dict[str, Any],
    contract_refs: List[str],
) -> Dict[str, Any]:
    responses = _build_row_question_responses(row, tipo_analise, question_maps, contract_refs)
    contract_numbers = (
        [str(c.numero_contrato) for c in _get_contract_objects_for_row(processo, row) if c.numero_contrato]
        if processo
        else []
    ) or row.contratos
    saldo_refs = _get_contract_objects_for_row(processo, row) if processo else []
    saldo_devedor = sum((c.valor_total_devido or Decimal("0")) for c in saldo_refs) if saldo_refs else None
    saldo_atualizado = (
        row.valor_causa
        if row.valor_causa is not None
        else sum((c.valor_causa or c.valor_total_devido or Decimal("0")) for c in saldo_refs) if saldo_refs else None
    )
    classe_display = row.classe_processual or row.tipo_acao or "-"
    return {
        "analyst_label": _resolve_user_label(analista),
        "date_label": timezone.localdate().strftime("%d/%m/%Y"),
        "cnj": row.cnj or format_cnj(row.cnj_digits) or "-",
        "hashtag": tipo_analise.hashtag or "",
        "tipo_nome": tipo_analise.nome or "",
        "carteira_nome": carteira.nome if carteira else "",
        "contract_numbers": contract_numbers,
        "saldo_devedor": _format_currency(saldo_devedor),
        "saldo_atualizado": _format_currency(saldo_atualizado),
        "valor_causa": _format_currency(row.valor_causa),
        "classe_processual": classe_display,
        "result_entries": _build_summary_entries(row, tipo_analise, responses, question_maps, contract_numbers),
    }


def build_analise_lote_preview(
    rows: Iterable[AnaliseLoteRow],
    *,
    carteira: Carteira,
    tipo_analise: TipoAnaliseObjetiva,
    analista: User,
    selected_row_ids: Optional[Iterable[str]] = None,
) -> AnaliseLotePreviewResult:
    rows_list = list(rows)
    preview = AnaliseLotePreviewResult(rows=len(rows_list))
    if not rows_list:
        return preview

    selected_ids = {str(value) for value in (selected_row_ids or [])}
    indexes = _build_resolver_indexes(rows_list)
    question_maps = _build_question_maps(tipo_analise)

    ufs = []
    for row in rows_list:
        if row.uf and row.uf not in ufs:
            ufs.append(row.uf)
        match = _resolve_process_for_row(row, carteira, indexes)
        processo = match.get("process")
        existing_card = False
        action_label = "Não importar"
        existing_card_summary = ""
        contract_refs = row.contratos[:]
        process_admin_url = reverse("admin:contratos_processojudicial_change", args=[processo.id]) if processo else ""

        if processo:
            resolved_contracts = _get_contract_objects_for_row(processo, row)
            contract_refs = [str(contract.id) for contract in resolved_contracts] or row.contratos[:]
            respostas = getattr(getattr(processo, "analise_processo", None), "respostas", {}) or {}
            saved_cards = respostas.get("saved_processos_vinculados")
            if not isinstance(saved_cards, list):
                saved_cards = []
            existing_idx = _existing_card_index(saved_cards, row, carteira, tipo_analise)
            existing_card = existing_idx is not None
            action_label = "Atualizar card" if existing_card else "Criar card"
            existing_card_summary = (
                "Card existente para este CNJ" if existing_card else "Nenhum card salvo deste tipo"
            )
            preview.matched_rows += 1
            if existing_card:
                preview.existing_cards += 1
            else:
                preview.new_cards += 1
        else:
            if match["status"] == "conflict":
                preview.conflict_rows += 1
            else:
                preview.missing_rows += 1

        selectable = match["status"] == "matched"
        checked = selectable and (str(row.row_id) in selected_ids if selected_ids else True)
        if not selectable:
            import_status = "blocked"
            import_status_label = "Não importável"
            import_status_detail = match["label"]
        elif checked:
            import_status = "ready"
            import_status_label = "Pronta para importar"
            import_status_detail = action_label
        else:
            import_status = "unselected"
            import_status_label = "Não selecionada"
            import_status_detail = action_label
        preview.items.append(
            AnaliseLotePreviewItem(
                row_id=row.row_id,
                checked=checked,
                selectable=selectable,
                match_status=match["status"],
                match_label=match["label"],
                uf=row.uf or "-",
                cpf=row.cpf or "-",
                cnj=row.cnj or format_cnj(row.cnj_digits) or "-",
                parte_contraria=row.parte_contraria or "-",
                process_id=getattr(processo, "id", None),
                process_admin_url=process_admin_url,
                existing_card=existing_card,
                action_label=action_label,
                existing_card_summary=existing_card_summary,
                summary=_build_summary_preview(
                    row=row,
                    processo=processo,
                    carteira=carteira,
                    tipo_analise=tipo_analise,
                    analista=analista,
                    question_maps=question_maps,
                    contract_refs=contract_refs,
                ),
                import_status=import_status,
                import_status_label=import_status_label,
                import_status_detail=import_status_detail,
            )
        )

    preview.ufs = sorted(ufs)
    return preview


def import_analise_lote_rows(
    rows: Iterable[AnaliseLoteRow],
    *,
    carteira: Carteira,
    tipo_analise: TipoAnaliseObjetiva,
    analista: User,
    acting_user: Optional[User] = None,
    selected_row_ids: Optional[Iterable[str]] = None,
) -> AnaliseLoteImportResult:
    rows_list = list(rows)
    result = AnaliseLoteImportResult()
    if not rows_list:
        return result

    selected_ids = {str(value) for value in (selected_row_ids or [])}
    if selected_ids:
        rows_list = [row for row in rows_list if str(row.row_id) in selected_ids]

    indexes = _build_resolver_indexes(rows_list)
    question_maps = _build_question_maps(tipo_analise)

    for row in rows_list:
        match = _resolve_process_for_row(row, carteira, indexes)
        processo = match.get("process")
        if not processo:
            result.skipped_rows += 1
            if match["status"] == "conflict":
                message = f"Linha {row.row_id}: conflito ao localizar cadastro para {row.cnj or row.cpf}."
                result.errors.append(message)
            else:
                message = f"Linha {row.row_id}: nenhum cadastro localizado para {row.cnj or row.cpf}."
                result.errors.append(message)
            result.row_results.append(
                {
                    "row_id": str(row.row_id),
                    "status": "failed",
                    "label": "Não importado",
                    "message": message,
                    "process_id": "",
                }
            )
            continue

        try:
            with transaction.atomic():
                result.matched_rows += 1
                contract_refs = []
                for raw_number in row.contratos:
                    token = str(raw_number or "").strip()
                    if not token:
                        continue
                    contrato = (
                        processo.contratos.filter(numero_contrato__iexact=token).order_by("id").first()
                        or processo.contratos.filter(numero_contrato__iregex=rf"^{re.escape(token)}$").order_by("id").first()
                    )
                    if not contrato:
                        contrato = Contrato.objects.create(processo=processo, numero_contrato=token)
                    contract_refs.append(str(contrato.id))

                classe_processual = _get_or_create_status(row.classe_processual)
                process_changed_fields: List[str] = []
                if row.uf and processo.uf != row.uf:
                    processo.uf = row.uf
                    process_changed_fields.append("uf")
                if row.valor_causa is not None and processo.valor_causa != row.valor_causa:
                    processo.valor_causa = row.valor_causa
                    process_changed_fields.append("valor_causa")
                if classe_processual and processo.status_id != classe_processual.id:
                    processo.status = classe_processual
                    process_changed_fields.append("status")
                if carteira and processo.carteira_id != carteira.id and not processo.carteira_id:
                    processo.carteira = carteira
                    process_changed_fields.append("carteira")
                if process_changed_fields:
                    processo.save(update_fields=process_changed_fields)
                    result.updated_processos += 1
                processo.carteiras_vinculadas.add(carteira)

                cnj_result = _ensure_numero_cnj(processo, row, carteira, classe_processual)
                result.created_cnjs += cnj_result["created"]
                result.updated_cnjs += cnj_result["updated"]

                analise, _ = AnaliseProcesso.objects.get_or_create(processo_judicial=processo)
                respostas = analise.respostas or {}
                saved_cards = respostas.get("saved_processos_vinculados")
                if not isinstance(saved_cards, list):
                    saved_cards = []

                card_payload = _build_card_payload(
                    processo=processo,
                    row=row,
                    carteira=carteira,
                    tipo_analise=tipo_analise,
                    analista=analista,
                    contract_refs=contract_refs,
                    question_maps=question_maps,
                )

                existing_idx = _existing_card_index(saved_cards, row, carteira, tipo_analise)
                if existing_idx is None:
                    saved_cards.append(card_payload)
                    result.created_cards += 1
                    row_status = "created"
                    row_label = "Card criado"
                else:
                    existing = saved_cards[existing_idx]
                    if not isinstance(existing, dict):
                        saved_cards[existing_idx] = card_payload
                    else:
                        existing.update(
                            {
                                key: value
                                for key, value in card_payload.items()
                                if value not in (None, "", [])
                            }
                        )
                        existing_responses = existing.get("tipo_de_acao_respostas")
                        if not isinstance(existing_responses, dict):
                            existing_responses = {}
                        existing_responses.update(card_payload["tipo_de_acao_respostas"])
                        existing["tipo_de_acao_respostas"] = existing_responses
                    result.updated_cards += 1
                    row_status = "updated"
                    row_label = "Card atualizado"

                respostas["saved_processos_vinculados"] = saved_cards
                respostas.setdefault("processos_vinculados", [])
                analise.respostas = respostas
                if acting_user:
                    analise.updated_by = acting_user
                    analise.save(update_fields=["respostas", "updated_by", "updated_at", "para_supervisionar"])
                else:
                    analise.save(update_fields=["respostas", "updated_at", "para_supervisionar"])
                result.row_results.append(
                    {
                        "row_id": str(row.row_id),
                        "status": row_status,
                        "label": row_label,
                        "message": f"{row_label} para o processo {row.cnj or processo.cnj or processo.id}.",
                        "process_id": str(getattr(processo, "id", "") or ""),
                    }
                )
        except Exception as exc:
            result.skipped_rows += 1
            result.matched_rows = max(0, result.matched_rows - 1)
            message = f"Linha {row.row_id}: falha ao salvar análise em lote ({exc})."
            result.errors.append(message)
            result.row_results.append(
                {
                    "row_id": str(row.row_id),
                    "status": "failed",
                    "label": "Não importado",
                    "message": message,
                    "process_id": str(getattr(processo, "id", "") or ""),
                }
            )

    return result
