import datetime
import csv
import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional, Tuple

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q

from contratos.models import (
    AnaliseProcesso,
    Carteira,
    Contrato,
    Etiqueta,
    Parte,
    ProcessoJudicial,
    ProcessoJudicialNumeroCnj,
    QuestaoAnalise,
    TipoAnaliseObjetiva,
)


REL_NS_OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


class PassivasPlanilhaError(Exception):
    pass


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_header(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    text = _strip_accents(text).upper()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_cpf(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def normalize_cnj_digits(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[:20]


def format_cnj(value: Any) -> str:
    digits = normalize_cnj_digits(value)
    if len(digits) != 20:
        return ""
    p1 = digits[:7]
    p2 = digits[7:9]
    p3 = digits[9:13]
    p4 = digits[13:14]
    p5 = digits[14:16]
    p6 = digits[16:20]
    return f"{p1}-{p2}.{p3}.{p4}.{p5}.{p6}"


def normalize_yes_no(value: Any) -> str:
    if value is None:
        return ""
    raw = str(value).strip()
    if not raw:
        return ""
    up = normalize_header(raw)
    up = up.replace("N0", "NAO").replace("NÃ0", "NAO")
    if up in {"SIM", "S"}:
        return "SIM"
    if up in {"NAO", "NÃO", "N"}:
        return "NÃO"
    return str(value).strip()


def parse_decimal(value: Any) -> Optional[Decimal]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    cleaned = re.sub(r"[^\d,.\-]", "", raw)
    if cleaned.count(",") and cleaned.count("."):
        cleaned = cleaned.replace(".", "").replace(",", ".")
    else:
        cleaned = cleaned.replace(",", ".")
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def parse_excel_date(value: Any) -> Optional[datetime.date]:
    if value is None:
        return None
    if isinstance(value, datetime.date) and not isinstance(value, datetime.datetime):
        return value
    raw = str(value).strip()
    if not raw:
        return None

    try:
        as_float = float(raw)
        if as_float > 20000:
            base = datetime.date(1899, 12, 30)
            return base + datetime.timedelta(days=int(as_float))
    except ValueError:
        pass

    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def split_contract_numbers(value: Any) -> List[str]:
    if value is None:
        return []
    raw = str(value).strip()
    if not raw:
        return []
    parts = re.split(r"[,\n;/]+", raw)
    out: List[str] = []
    for part in parts:
        item = part.strip()
        if not item:
            continue
        out.append(item)
    return list(dict.fromkeys(out))


@dataclass
class PassivasRow:
    uf: str
    cnj: str
    cnj_digits: str
    parte_contraria: str
    cpf: str
    consignado: str
    status_processo_passivo: str
    procedencia: str
    julgamento: str
    sucumbencias: str
    transitado: str
    data_transito: Optional[datetime.date]
    tipo_acao: str
    observacoes: str
    fase_recursal: str
    cumprimento_sentenca: str
    habilitacao: str
    prioridade: str
    valor_causa: Optional[Decimal]
    responsavel: str
    raw: Dict[str, Any]


def load_xlsx_sheet_rows_from_bytes(file_bytes: bytes, sheet_name_prefix: str) -> Tuple[List[str], List[Dict[str, Any]]]:
    from xml.etree import ElementTree as ET

    def col_to_idx(col: str) -> int:
        n = 0
        for ch in col:
            n = n * 26 + (ord(ch) - 64)
        return n

    with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
        shared: List[str] = []
        try:
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{{{SHEET_NS}}}si"):
                texts = []
                for t in si.findall(f".//{{{SHEET_NS}}}t"):
                    texts.append(t.text or "")
                shared.append("".join(texts))
        except KeyError:
            shared = []

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = []
        for sh in wb.findall(f".//{{{SHEET_NS}}}sheets/{{{SHEET_NS}}}sheet"):
            rid = sh.attrib.get(f"{{{REL_NS_OFFICE}}}id")
            sheets.append((sh.attrib.get("name") or "", rid))

        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {}
        for rel in rels.findall(f"{{{REL_NS_PKG}}}Relationship"):
            rid_to_target[rel.attrib["Id"]] = rel.attrib["Target"]

        target_rid = None
        for name, rid in sheets:
            if normalize_header(name).startswith(normalize_header(sheet_name_prefix)):
                target_rid = rid
                break
        if not target_rid:
            raise PassivasPlanilhaError(f"Aba '{sheet_name_prefix}' não encontrada. Abas: {[n for n, _ in sheets]}")

        target = rid_to_target.get(target_rid)
        if not target:
            raise PassivasPlanilhaError("Não foi possível resolver a planilha (rels).")

        sheet_path = "xl/" + target
        root = ET.fromstring(z.read(sheet_path))
        rows: List[Dict[str, Any]] = []
        cols_seen = set()

        for row in root.findall(f".//{{{SHEET_NS}}}sheetData/{{{SHEET_NS}}}row"):
            record: Dict[str, Any] = {}
            for c in row.findall(f"{{{SHEET_NS}}}c"):
                ref = c.attrib.get("r", "")
                m = re.match(r"([A-Z]+)(\d+)", ref)
                if not m:
                    continue
                col = m.group(1)
                t = c.attrib.get("t")
                v = c.find(f"{{{SHEET_NS}}}v")
                if v is None or v.text is None:
                    value = ""
                else:
                    raw = v.text
                    if t == "s":
                        try:
                            value = shared[int(raw)]
                        except Exception:
                            value = raw
                    else:
                        value = raw
                record[col] = value
                cols_seen.add(col)
            if record:
                rows.append(record)

        cols = sorted(cols_seen, key=col_to_idx)
        return cols, rows


def _decode_csv_bytes(file_bytes: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return file_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise PassivasPlanilhaError("Não foi possível decodificar o CSV. Use UTF-8 ou Latin-1.")


def load_csv_records_from_bytes(file_bytes: bytes) -> List[Dict[str, Any]]:
    text = _decode_csv_bytes(file_bytes)
    sample = text[:4096]
    delimiter = ";"
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,|\t,")
        delimiter = dialect.delimiter or ";"
    except Exception:
        delimiter = ";" if sample.count(";") >= sample.count(",") else ","

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = [list(r) for r in reader if any(str(cell or "").strip() for cell in r)]
    if not rows:
        return []

    header_idx = None
    for idx, row in enumerate(rows[:30]):
        values = " | ".join(str(v or "").strip() for v in row)
        if "PROCESSO CNJ" in normalize_header(values):
            header_idx = idx
            break
    if header_idx is None:
        header_idx = 0

    headers = [str(h or "").strip() for h in rows[header_idx]]
    if not any(normalize_header(h) == "PROCESSO CNJ" for h in headers):
        raise PassivasPlanilhaError("Não encontrei o cabeçalho 'PROCESSO CNJ' no CSV.")

    records: List[Dict[str, Any]] = []
    for row in rows[header_idx + 1 :]:
        if not any(str(v or "").strip() for v in row):
            continue
        rec: Dict[str, Any] = {}
        for idx, header in enumerate(headers):
            if not header:
                continue
            rec[header] = row[idx] if idx < len(row) else ""
        records.append(rec)
    return records


def extract_table(rows: List[Dict[str, Any]], cols: List[str]) -> Tuple[List[str], List[Dict[str, Any]]]:
    header_row_idx = None
    for idx, row in enumerate(rows[:30]):
        values = " | ".join(str(row.get(c, "")).strip() for c in cols)
        if "PROCESSO CNJ" in normalize_header(values):
            header_row_idx = idx
            break
    if header_row_idx is None:
        raise PassivasPlanilhaError("Não encontrei a linha de cabeçalho (com 'PROCESSO CNJ').")

    header_row = rows[header_row_idx]
    headers_by_col: Dict[str, str] = {}
    for c in cols:
        h = str(header_row.get(c, "")).strip()
        if h:
            headers_by_col[c] = h

    header_cols = [c for c in cols if c in headers_by_col]
    header_names = [headers_by_col[c] for c in header_cols]

    out_rows: List[Dict[str, Any]] = []
    for row in rows[header_row_idx + 1 :]:
        rec: Dict[str, Any] = {}
        any_val = False
        for c, name in zip(header_cols, header_names):
            val = row.get(c, "")
            if val is None:
                val = ""
            if str(val).strip():
                any_val = True
            rec[name] = val
        if any_val:
            out_rows.append(rec)

    return header_names, out_rows


def parse_passivas_row(rec: Dict[str, Any]) -> Optional[PassivasRow]:
    uf = str(rec.get("UF", "")).strip().upper()
    cnj_raw = rec.get("PROCESSO CNJ", "")
    cnj = format_cnj(cnj_raw)
    cnj_digits = normalize_cnj_digits(cnj_raw)
    cpf = normalize_cpf(rec.get("CPF", ""))
    parte_contraria = str(rec.get("PARTE CONTRÁRIA", "") or rec.get("PARTE CONTRARIA", "")).strip()

    if not cpf and not cnj_digits:
        return None

    consignado = normalize_yes_no(rec.get("CONSIGNADO", ""))
    status_proc = str(rec.get("STATUS DO PROCESSO PASSIVO", "")).strip()
    procedencia = str(rec.get("PROCEDÊNCIA", "")).strip()
    julgamento = str(rec.get("JULGAMENTO", "")).strip()
    sucumbencias = str(rec.get("SUCUMBÊNCIAS", "")).strip()
    transitado = normalize_yes_no(rec.get("TRANSITADO", ""))
    data_transito = parse_excel_date(rec.get("DATA DE TRÂNSITO", ""))
    tipo_acao = str(rec.get("TIPO DE AÇÃO", "")).strip()
    observacoes = str(rec.get("OBSERVAÇÕES", "")).strip()
    fase_recursal = str(rec.get("FASE RECURSAL", "")).strip()
    cumprimento = str(rec.get("CUMPRIMENTO DE SENTENÇA", "")).strip()
    habilitacao = str(rec.get("HABILITAÇÃO", "")).strip()
    prioridade = str(rec.get("PRIORIDADE", "")).strip()
    valor_causa = parse_decimal(rec.get("VALOR DA CAUSA", ""))
    responsavel = str(rec.get("RESPONSÁVEL", "")).strip()

    return PassivasRow(
        uf=uf,
        cnj=cnj,
        cnj_digits=cnj_digits,
        parte_contraria=parte_contraria,
        cpf=cpf,
        consignado=consignado,
        status_processo_passivo=status_proc,
        procedencia=procedencia,
        julgamento=julgamento,
        sucumbencias=sucumbencias,
        transitado=transitado,
        data_transito=data_transito,
        tipo_acao=tipo_acao,
        observacoes=observacoes,
        fase_recursal=fase_recursal,
        cumprimento_sentenca=cumprimento,
        habilitacao=habilitacao,
        prioridade=prioridade,
        valor_causa=valor_causa,
        responsavel=responsavel,
        raw=rec,
    )


def _build_rows_from_records(
    records: List[Dict[str, Any]],
    *,
    uf_filter: str = "",
    limit: int = 0,
) -> List[PassivasRow]:
    parsed: List[PassivasRow] = []
    for rec in records:
        row = parse_passivas_row(rec)
        if not row:
            continue
        if uf_filter and (row.uf or "").upper() != uf_filter.upper():
            continue
        parsed.append(row)
    if limit:
        parsed = parsed[: int(limit)]
    return parsed


def build_passivas_rows_from_xlsx_bytes(
    file_bytes: bytes,
    *,
    sheet_prefix: str = "E - PASSIVAS",
    uf_filter: str = "",
    limit: int = 0,
) -> List[PassivasRow]:
    cols, raw_rows = load_xlsx_sheet_rows_from_bytes(file_bytes, sheet_prefix)
    _, records = extract_table(raw_rows, cols)
    return _build_rows_from_records(records, uf_filter=uf_filter, limit=limit)


def build_passivas_rows_from_file_bytes(
    file_bytes: bytes,
    *,
    upload_name: str,
    sheet_prefix: str = "E - PASSIVAS",
    uf_filter: str = "",
    limit: int = 0,
) -> List[PassivasRow]:
    lower_name = (upload_name or "").lower().strip()
    if lower_name.endswith(".csv"):
        records = load_csv_records_from_bytes(file_bytes)
        return _build_rows_from_records(records, uf_filter=uf_filter, limit=limit)
    return build_passivas_rows_from_xlsx_bytes(
        file_bytes,
        sheet_prefix=sheet_prefix,
        uf_filter=uf_filter,
        limit=limit,
    )


def _question_key_map(tipo_analise: TipoAnaliseObjetiva) -> Dict[str, Optional[str]]:
    questions = list(QuestaoAnalise.objects.filter(tipo_analise=tipo_analise, ativo=True))
    question_by_text = {normalize_header(q.texto_pergunta): q for q in questions if q.texto_pergunta}

    def qkey(header: str) -> Optional[str]:
        q = question_by_text.get(normalize_header(header))
        return q.chave if q else None

    return {
        "CONSIGNADO": qkey("Consignado"),
        "STATUS DO PROCESSO PASSIVO": qkey("Status do Processo Passivo"),
        "PROCEDÊNCIA": qkey("Procedência"),
        "JULGAMENTO": qkey("Julgamento"),
        "SUCUMBÊNCIAS": qkey("Sucumbências"),
        "TRANSITADO": qkey("Transitado"),
        "DATA DE TRÂNSITO": qkey("Data do Transito"),
        "TIPO DE AÇÃO": qkey("Tipo de Ação"),
        "FASE RECURSAL": qkey("Fase Recursal"),
        "CUMPRIMENTO DE SENTENÇA": qkey("Cumprimento de Sentença"),
        "HABILITAÇÃO": qkey("Habilitação"),
    }


@dataclass
class PassivasImportResult:
    created_cadastros: int = 0
    updated_cadastros: int = 0
    created_cnjs: int = 0
    updated_cnjs: int = 0
    created_cards: int = 0
    updated_cards: int = 0
    reused_priority_tags: int = 0
    standardized_priority_tags: int = 0
    skipped_rows: int = 0
    errors: List[str] = None

    def __post_init__(self):
        if self.errors is None:
            self.errors = []


@transaction.atomic
def import_passivas_rows(
    rows: Iterable[PassivasRow],
    *,
    carteira: Carteira,
    tipo_analise: TipoAnaliseObjetiva,
    dry_run: bool = False,
    user: Optional[User] = None,
) -> PassivasImportResult:
    result = PassivasImportResult()
    rows_list = list(rows)
    if not rows_list:
        return result

    mapped_keys = _question_key_map(tipo_analise)

    tipo_snapshot = {
        "id": tipo_analise.id,
        "nome": tipo_analise.nome,
        "slug": tipo_analise.slug,
        "hashtag": tipo_analise.hashtag,
        "versao": tipo_analise.versao,
    }

    by_cpf: Dict[str, List[PassivasRow]] = {}
    priority_tags_cache: Dict[str, Etiqueta] = {}
    reused_priority_tag_ids: set[int] = set()
    standardized_priority_tag_ids: set[int] = set()
    priority_default_bg = "#f5c242"
    priority_default_fg = "#3e2a00"

    def _get_priority_tag(priority_value: str) -> Optional[Etiqueta]:
        label = re.sub(r"\s+", " ", str(priority_value or "").strip()).upper()
        if not label:
            return None
        key = normalize_header(label)
        if not key:
            return None
        if key in priority_tags_cache:
            return priority_tags_cache[key]

        tag = Etiqueta.objects.filter(nome=label).first()
        created = False
        if not tag:
            tag = Etiqueta.objects.filter(nome__iexact=label).order_by("id").first()
        if not tag:
            try:
                tag = Etiqueta.objects.create(
                    nome=label,
                    cor_fundo=priority_default_bg,
                    cor_fonte=priority_default_fg,
                )
                created = True
            except IntegrityError:
                # Outro request pode ter criado ao mesmo tempo; reaproveita a existente.
                tag = Etiqueta.objects.filter(nome__iexact=label).order_by("id").first()
                if not tag:
                    raise

        if not created and tag and tag.id:
            reused_priority_tag_ids.add(tag.id)

        changed_fields: List[str] = []
        if tag.nome != label:
            tag.nome = label
            changed_fields.append("nome")
        if tag.cor_fundo != priority_default_bg:
            tag.cor_fundo = priority_default_bg
            changed_fields.append("cor_fundo")
        if tag.cor_fonte != priority_default_fg:
            tag.cor_fonte = priority_default_fg
            changed_fields.append("cor_fonte")
        if changed_fields:
            try:
                tag.save(update_fields=changed_fields)
            except IntegrityError:
                canonical = Etiqueta.objects.filter(nome=label).exclude(id=tag.id).first()
                if canonical:
                    tag = canonical
                else:
                    raise
                canonical_changes: List[str] = []
                if tag.cor_fundo != priority_default_bg:
                    tag.cor_fundo = priority_default_bg
                    canonical_changes.append("cor_fundo")
                if tag.cor_fonte != priority_default_fg:
                    tag.cor_fonte = priority_default_fg
                    canonical_changes.append("cor_fonte")
                if canonical_changes:
                    tag.save(update_fields=canonical_changes)
            if tag and tag.id:
                standardized_priority_tag_ids.add(tag.id)

        priority_tags_cache[key] = tag
        return tag

    for row in rows_list:
        if not row.cpf:
            result.skipped_rows += 1
            continue
        by_cpf.setdefault(row.cpf, []).append(row)

    for cpf, rows_for_cpf in by_cpf.items():
        cpf_regex = ''.join(f'{re.escape(char)}\\D*' for char in cpf)
        base_qs = (
            ProcessoJudicial.objects.filter(
                Q(partes_processuais__documento=cpf)
                | Q(partes_processuais__documento__iregex=rf'^{cpf_regex}$')
            )
            .distinct()
            .order_by("id")
        )
        processo = base_qs.filter(
            Q(carteira_id=carteira.id) | Q(carteiras_vinculadas__id=carteira.id)
        ).first()
        if not processo:
            processo = base_qs.first()
        created = False
        if not processo:
            processo = ProcessoJudicial.objects.create(
                cnj="",
                uf=rows_for_cpf[0].uf or "",
                carteira=carteira,
            )
            created = True
            result.created_cadastros += 1
        else:
            result.updated_cadastros += 1
            if not processo.carteira_id:
                processo.carteira = carteira
                processo.save(update_fields=["carteira"])

        if carteira and carteira.id:
            processo.carteiras_vinculadas.add(carteira)

        nome = rows_for_cpf[0].parte_contraria or ""
        if nome:
            parte = (
                Parte.objects.filter(processo=processo, documento=cpf)
                .order_by("id")
                .first()
            )
            if not parte:
                Parte.objects.create(
                    processo=processo,
                    tipo_polo="PASSIVO",
                    nome=nome,
                    tipo_pessoa="PF",
                    documento=cpf,
                )
            else:
                if parte.nome != nome and nome:
                    parte.nome = nome
                    parte.save(update_fields=["nome"])

        contract_numbers: List[str] = []
        for row in rows_for_cpf:
            contract_numbers.extend(split_contract_numbers(row.raw.get("TODOS CONTRATOS DESTE CPF")))
        contract_numbers = list(dict.fromkeys([c for c in contract_numbers if c]))
        for numero in contract_numbers:
            Contrato.objects.get_or_create(
                processo=processo,
                numero_contrato=str(numero).strip(),
            )

        analise, _ = AnaliseProcesso.objects.get_or_create(processo_judicial=processo)
        respostas = analise.respostas or {}
        saved_cards = respostas.get("saved_processos_vinculados")
        if not isinstance(saved_cards, list):
            saved_cards = []

        for row in rows_for_cpf:
            if not row.cnj_digits:
                continue
            cnj_formatted = row.cnj or format_cnj(row.cnj_digits)
            if not cnj_formatted:
                continue

            numero_obj, cnj_created = ProcessoJudicialNumeroCnj.objects.get_or_create(
                processo=processo,
                cnj=cnj_formatted,
                defaults={
                    "uf": row.uf or "",
                    "valor_causa": row.valor_causa,
                    "carteira": carteira,
                },
            )
            if cnj_created:
                result.created_cnjs += 1
            else:
                changed_fields: List[str] = []
                if row.uf and numero_obj.uf != row.uf:
                    numero_obj.uf = row.uf
                    changed_fields.append("uf")
                if row.valor_causa is not None and numero_obj.valor_causa != row.valor_causa:
                    numero_obj.valor_causa = row.valor_causa
                    changed_fields.append("valor_causa")
                if not numero_obj.carteira_id and carteira and carteira.id:
                    numero_obj.carteira = carteira
                    changed_fields.append("carteira")
                if changed_fields:
                    numero_obj.save(update_fields=changed_fields)
                    result.updated_cnjs += 1

            target_carteira_id = carteira.id if carteira and carteira.id else None
            existing_idx = None
            if target_carteira_id is not None:
                existing_idx = next(
                    (
                        idx
                        for idx, card in enumerate(saved_cards)
                        if isinstance(card, dict)
                        and normalize_cnj_digits(card.get("cnj")) == row.cnj_digits
                        and str(card.get("carteira_id") or "") == str(target_carteira_id)
                    ),
                    None,
                )
                if existing_idx is None:
                    existing_idx = next(
                        (
                            idx
                            for idx, card in enumerate(saved_cards)
                            if isinstance(card, dict)
                            and normalize_cnj_digits(card.get("cnj")) == row.cnj_digits
                            and not card.get("carteira_id")
                        ),
                        None,
                    )
            if existing_idx is None:
                existing_idx = next(
                    (
                        idx
                        for idx, card in enumerate(saved_cards)
                        if isinstance(card, dict)
                        and normalize_cnj_digits(card.get("cnj")) == row.cnj_digits
                        and (
                            target_carteira_id is None
                            or not card.get("carteira_id")
                        )
                    ),
                    None,
                )

            tipo_respostas: Dict[str, Any] = {}
            if mapped_keys["CONSIGNADO"] and row.consignado:
                tipo_respostas[mapped_keys["CONSIGNADO"]] = row.consignado
            if mapped_keys["STATUS DO PROCESSO PASSIVO"] and row.status_processo_passivo:
                tipo_respostas[mapped_keys["STATUS DO PROCESSO PASSIVO"]] = row.status_processo_passivo
            if mapped_keys["PROCEDÊNCIA"] and row.procedencia:
                tipo_respostas[mapped_keys["PROCEDÊNCIA"]] = row.procedencia
            if mapped_keys["JULGAMENTO"] and row.julgamento:
                tipo_respostas[mapped_keys["JULGAMENTO"]] = row.julgamento
            if mapped_keys["SUCUMBÊNCIAS"] and row.sucumbencias:
                tipo_respostas[mapped_keys["SUCUMBÊNCIAS"]] = row.sucumbencias
            if mapped_keys["TRANSITADO"] and row.transitado:
                tipo_respostas[mapped_keys["TRANSITADO"]] = row.transitado
            if mapped_keys["DATA DE TRÂNSITO"] and row.data_transito:
                tipo_respostas[mapped_keys["DATA DE TRÂNSITO"]] = row.data_transito.isoformat()
            if mapped_keys["TIPO DE AÇÃO"] and row.tipo_acao:
                tipo_respostas[mapped_keys["TIPO DE AÇÃO"]] = row.tipo_acao
            if mapped_keys["FASE RECURSAL"] and row.fase_recursal:
                tipo_respostas[mapped_keys["FASE RECURSAL"]] = row.fase_recursal
            if mapped_keys["CUMPRIMENTO DE SENTENÇA"] and row.cumprimento_sentenca:
                tipo_respostas[mapped_keys["CUMPRIMENTO DE SENTENÇA"]] = row.cumprimento_sentenca
            if mapped_keys["HABILITAÇÃO"] and row.habilitacao:
                tipo_respostas[mapped_keys["HABILITAÇÃO"]] = row.habilitacao

            base_card = {
                "cnj": cnj_formatted,
                "valor_causa": float(row.valor_causa) if row.valor_causa is not None else None,
                "contratos": [],
                "tipo_de_acao_respostas": tipo_respostas,
                "analysis_type": tipo_snapshot,
                "carteira_id": target_carteira_id,
                "carteira_nome": carteira.nome if carteira and carteira.nome else "",
                "supervisionado": False,
                "supervisor_status": "pendente",
                "awaiting_supervision_confirm": False,
                "barrado": {"ativo": False, "inicio": None, "retorno_em": None},
                "observacoes": row.observacoes or "",
            }

            if existing_idx is None:
                saved_cards.append(base_card)
                result.created_cards += 1
            else:
                existing = saved_cards[existing_idx] if existing_idx is not None else None
                if not isinstance(existing, dict):
                    saved_cards[existing_idx] = base_card
                    result.updated_cards += 1
                else:
                    existing.update({k: v for k, v in base_card.items() if v is not None and v != ""})
                    existing.setdefault("tipo_de_acao_respostas", {})
                    if isinstance(existing["tipo_de_acao_respostas"], dict):
                        existing["tipo_de_acao_respostas"].update(tipo_respostas)
                    else:
                        existing["tipo_de_acao_respostas"] = tipo_respostas
                    result.updated_cards += 1

            priority_tag = _get_priority_tag(row.prioridade)
            if priority_tag:
                processo.etiquetas.add(priority_tag)

        respostas["saved_processos_vinculados"] = saved_cards
        respostas.setdefault("processos_vinculados", [])

        responsavel = (rows_for_cpf[0].responsavel or "").strip()
        if responsavel:
            target_user = (
                User.objects.filter(username__iexact=responsavel).first()
                or User.objects.filter(first_name__iexact=responsavel).first()
            )
            if target_user and processo.delegado_para_id != target_user.id:
                processo.delegado_para = target_user
                processo.save(update_fields=["delegado_para"])

        analise.respostas = respostas
        analise.save()

        if created:
            processo.carteira = carteira
            processo.save(update_fields=["carteira"])

    if dry_run:
        transaction.set_rollback(True)

    result.reused_priority_tags = len(reused_priority_tag_ids)
    result.standardized_priority_tags = len(standardized_priority_tag_ids)

    return result


def validate_xlsx_upload(upload_name: str, file_bytes: bytes) -> None:
    lower_name = (upload_name or "").lower().strip()
    if not (lower_name.endswith(".xlsx") or lower_name.endswith(".csv")):
        raise ValidationError("Envie um arquivo .xlsx ou .csv")
    if not file_bytes:
        raise ValidationError("Arquivo vazio.")
    if len(file_bytes) > 15 * 1024 * 1024:
        raise ValidationError("Arquivo muito grande (limite: 15MB).")


def validate_planilha_upload(upload_name: str, file_bytes: bytes) -> None:
    validate_xlsx_upload(upload_name, file_bytes)
