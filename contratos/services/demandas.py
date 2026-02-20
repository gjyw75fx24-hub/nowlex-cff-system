import logging
import re
from collections import defaultdict
from decimal import Decimal
from typing import Dict, Iterable, List, Mapping, Optional, Tuple

from django.conf import settings
from django.db import connections, transaction
from django.db.models.expressions import RawSQL
from django.db.models import Q
from django.db.utils import OperationalError

from contratos.models import Carteira, Contrato, Etiqueta, Parte, ProcessoJudicial, ProcessoJudicialNumeroCnj

logger = logging.getLogger(__name__)


class DemandasImportError(Exception):
    """Erro geral para o fluxo de demandas."""


def _normalize_digits(value: Optional[str]) -> str:
    return re.sub(r'\D', '', str(value or ''))


def _determine_tipo_pessoa(documento: str) -> str:
    digits = _normalize_digits(documento)
    return 'PF' if len(digits) <= 11 else 'PJ'


def _format_cpf(cpf_value: str) -> str:
    digits = _normalize_digits(cpf_value)
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return cpf_value or ''


def _format_currency(value: Decimal) -> str:
    quantized = value.quantize(Decimal('0.01'))
    formatted = f"{quantized:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    return f"R$ {formatted}"


def _format_cep(value: Optional[str]) -> str:
    digits = re.sub(r'\D', '', str(value or ''))
    if len(digits) == 8:
        return f"{digits[:5]}-{digits[5:]}"
    return digits


def _uf_to_nome(uf_sigla: str) -> str:
    UFS = {
        'AC':'Acre', 'AL':'Alagoas', 'AP':'Amapá', 'AM':'Amazonas', 'BA':'Bahia', 'CE':'Ceará', 'DF':'Distrito Federal',
        'ES':'Espírito Santo', 'GO':'Goiás', 'MA':'Maranhão', 'MT':'Mato Grosso', 'MS':'Mato Grosso do Sul', 'MG':'Minas Gerais',
        'PA':'Pará', 'PB':'Paraíba', 'PR':'Paraná', 'PE':'Pernambuco', 'PI':'Piauí', 'RJ':'Rio de Janeiro', 'RN':'Rio Grande do Norte',
        'RS':'Rio Grande do Sul', 'RO':'Rondônia', 'RR':'Roraima', 'SC':'Santa Catarina', 'SP':'São Paulo', 'SE':'Sergipe', 'TO':'Tocantins'
    }
    return UFS.get(uf_sigla.upper(), '')


def _clean_street_name(street: Optional[str], number: Optional[str]) -> str:
    s = str(street or '').strip()
    n = str(number or '').strip()
    if not s:
        return ''
    if n:
        s = re.sub(r'\s*,\s*' + re.escape(n) + r'(\b.*)?$', '', s, flags=re.IGNORECASE)
        s = re.sub(r'\s+' + re.escape(n) + r'(\b.*)?$', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s*,\s*\d[\w\s\-\/]*$', '', s)
    s = re.sub(r'\s+\d[\w\-\/]*$', '', s)
    return s.strip()


def _montar_texto_endereco(parts: Mapping[str, str]) -> str:
    return (
        f"A: {parts.get('A', '')} - "
        f"B: {parts.get('B', '')} - "
        f"C: {parts.get('C', '')} - "
        f"D: {parts.get('D', '')} - "
        f"E: {parts.get('E', '')} - "
        f"F: {parts.get('F', '')} - "
        f"G: {parts.get('G', '')} - "
        f"H: {parts.get('H', '')}"
    )


def _build_telefone(row: Mapping[str, Optional[str]]) -> str:
    ddd = row.get('telefone_ddd') or ''
    numero = row.get('telefone_numero') or ''
    if ddd and numero:
        return f"({ddd.strip()}) {numero.strip()}"
    return numero or ddd


def _normalize_cnj_digits(value: Optional[str]) -> str:
    return re.sub(r'\D', '', str(value or ''))[:20]


def _normalize_cnj_lookup(value: Optional[str]) -> str:
    digits = re.sub(r'\D', '', str(value or ''))
    if not digits:
        return ''
    if len(digits) >= 20:
        return digits[:20]
    return digits.zfill(20)


def _format_cnj(value: Optional[str]) -> str:
    digits = _normalize_cnj_digits(value)
    if len(digits) != 20:
        return str(value or '').strip()
    return f"{digits[:7]}-{digits[7:9]}.{digits[9:13]}.{digits[13:14]}.{digits[14:16]}.{digits[16:20]}"


CNJ_UF_MAP = {
    '8.01': 'AC', '8.02': 'AL', '8.03': 'AP', '8.04': 'AM', '8.05': 'BA',
    '8.06': 'CE', '8.07': 'DF', '8.08': 'ES', '8.09': 'GO', '8.10': 'MA',
    '8.11': 'MT', '8.12': 'MS', '8.13': 'MG', '8.14': 'PA', '8.15': 'PB',
    '8.16': 'PR', '8.17': 'PE', '8.18': 'PI', '8.19': 'RJ', '8.20': 'RN',
    '8.21': 'RS', '8.22': 'RO', '8.23': 'RR', '8.24': 'SC', '8.25': 'SE',
    '8.26': 'SP', '8.27': 'TO',
}


def _extract_uf_from_cnj_like(value: Optional[str]) -> str:
    digits = _normalize_digits(value)
    if not digits:
        return ''
    cnj_base = ''
    if len(digits) >= 20:
        cnj_base = digits[:20]
    elif len(digits) in (18, 19):
        # Mantém aderência ao mapeamento usado no botão "Preencher UF":
        # completa à esquerda quando o CNJ vem sem zeros iniciais.
        cnj_base = digits.zfill(20)
    else:
        return ''
    j = cnj_base[13:14]
    tr = cnj_base[14:16]
    if not j or len(tr) != 2:
        return ''
    return CNJ_UF_MAP.get(f'{j}.{tr}', '')



class DemandasImportService:
    SOURCE_ALIAS = 'carteira'
    IDENTIFIER_SPLIT_RE = re.compile(r'[\s,;]+')
    LITIS_SIM_LABEL = "Litis sim"
    LITIS_SIM_BG = "#F2C94C"
    LITIS_SIM_FG = "#3D2B00"

    def __init__(self, db_alias: Optional[str] = None):
        self.db_alias = db_alias or self.SOURCE_ALIAS

    @property
    def has_carteira_connection(self) -> bool:
        return self.db_alias in settings.DATABASES

    def build_period_label(self, data_de, data_ate) -> str:
        return f"{data_de.strftime('%d/%m/%Y')} - {data_ate.strftime('%d/%m/%Y')}"

    def build_etiqueta_nome(self, carteira: Carteira, period_label: Optional[str]) -> str:
        nome_carteira = (carteira.nome or "Demandas").strip()
        if period_label:
            return f"{nome_carteira} · {period_label}"
        return nome_carteira

    def parse_batch_identifiers(self, identifiers: Optional[Iterable[str] | str]) -> Dict[str, object]:
        tokens: List[str] = []
        if isinstance(identifiers, str):
            tokens = [
                token.strip()
                for token in self.IDENTIFIER_SPLIT_RE.split(identifiers)
                if token and token.strip()
            ]
        elif identifiers:
            for item in identifiers:
                raw = str(item or '').strip()
                if not raw:
                    continue
                tokens.extend(
                    token.strip()
                    for token in self.IDENTIFIER_SPLIT_RE.split(raw)
                    if token and token.strip()
                )

        cpfs: List[str] = []
        cnjs: List[str] = []
        invalid_tokens: List[str] = []
        invalid_cnjs: List[str] = []
        invalid_cpfs: List[str] = []
        invalid_details: List[Dict[str, str]] = []
        input_uf_counts: Dict[str, int] = {}
        input_uf_total_count = 0
        valid_uf_counts: Dict[str, int] = {}
        valid_cnjs_by_uf: Dict[str, List[str]] = {}

        def add_input_uf_from_cnj(token_value: str) -> str:
            nonlocal input_uf_total_count
            guessed = _extract_uf_from_cnj_like(token_value)
            key = guessed or 'SEM_UF'
            input_uf_counts[key] = input_uf_counts.get(key, 0) + 1
            input_uf_total_count += 1
            return key

        def add_valid_cnj_by_uf(cnj_digits: str, uf_key: str):
            if not cnj_digits:
                return
            key = uf_key or 'SEM_UF'
            valid_uf_counts[key] = valid_uf_counts.get(key, 0) + 1
            bucket = valid_cnjs_by_uf.setdefault(key, [])
            if cnj_digits not in bucket:
                bucket.append(cnj_digits)

        for token in tokens:
            digits = _normalize_digits(token)
            if len(digits) == 11:
                cpfs.append(digits)
            elif len(digits) == 20:
                cnjs.append(digits)
                uf_key = add_input_uf_from_cnj(token)
                add_valid_cnj_by_uf(digits, uf_key)
            else:
                invalid_tokens.append(token)
                uf_guess = ''
                if not digits:
                    reason = "Sem dígitos numéricos."
                    kind = "indefinido"
                elif len(digits) < 11:
                    reason = f"CPF incompleto ({len(digits)} dígitos)."
                    kind = "cpf"
                elif len(digits) < 20:
                    reason = f"CNJ incompleto ({len(digits)} dígitos)."
                    kind = "cnj"
                else:
                    reason = f"CNJ com dígitos excedentes ({len(digits)} dígitos)."
                    kind = "cnj"
                if kind == "cnj":
                    invalid_cnjs.append(token)
                    if len(digits) >= 18:
                        uf_guess = add_input_uf_from_cnj(token)
                elif kind == "cpf":
                    invalid_cpfs.append(token)
                invalid_details.append({
                    "token": token,
                    "digits": digits,
                    "kind": kind,
                    "reason": reason,
                    "uf_guess": uf_guess,
                })

        cpfs = list(dict.fromkeys(cpfs))
        cnjs = list(dict.fromkeys(cnjs))
        invalid_cnjs = list(dict.fromkeys(invalid_cnjs))
        invalid_cpfs = list(dict.fromkeys(invalid_cpfs))
        input_uf_totals = [
            {"uf": uf, "total": total}
            for uf, total in sorted(
                input_uf_counts.items(),
                key=lambda item: (item[0] == 'SEM_UF', item[0]),
            )
        ]
        valid_uf_totals = [
            {"uf": uf, "total": total}
            for uf, total in sorted(
                valid_uf_counts.items(),
                key=lambda item: (item[0] == 'SEM_UF', item[0]),
            )
        ]
        return {
            "tokens": tokens,
            "cpfs": cpfs,
            "cnjs": cnjs,
            "invalid_tokens": invalid_tokens,
            "invalid_cnjs": invalid_cnjs,
            "invalid_cpfs": invalid_cpfs,
            "invalid_details": invalid_details,
            "total_tokens": len(tokens),
            "valid_tokens": len(cpfs) + len(cnjs),
            "valid_cpfs": len(cpfs),
            "valid_cnjs": len(cnjs),
            "input_uf_totals": input_uf_totals,
            "input_uf_total_count": input_uf_total_count,
            "valid_uf_totals": valid_uf_totals,
            "valid_cnjs_by_uf": valid_cnjs_by_uf,
        }

    def _build_preview_rows(self, grouped: Dict[str, List[Dict]]) -> Tuple[List[Dict[str, str]], Decimal]:
        rows: List[Dict[str, str]] = []
        total_aberto_sum = Decimal('0')
        for cpf, contracts in grouped.items():
            nome = next((c.get('cliente_nome') for c in contracts if c.get('cliente_nome')), 'Cliente sem nome')
            total_aberto = sum((c.get('valor_aberto') or Decimal('0')) for c in contracts)
            prescricao_dates = [c['data_prescricao'] for c in contracts if c.get('data_prescricao')]
            prescricao_text = prescricao_dates[0].strftime('%d/%m/%Y') if prescricao_dates else ''
            total_aberto_sum += total_aberto
            cpf_normalized = _normalize_digits(cpf)
            uf_endereco = ''
            for contract in contracts:
                uf_candidate = (contract.get('endereco_uf') or contract.get('uf') or '').strip().upper()
                if uf_candidate:
                    uf_endereco = uf_candidate
                    break
            rows.append({
                "cpf": _format_cpf(cpf),
                "cpf_raw": cpf_normalized,
                "nome": nome,
                "contratos": len(contracts),
                "total_aberto": _format_currency(total_aberto),
                "prescricao_ativadora": prescricao_text,
                "uf_endereco": uf_endereco,
            })
        return rows, total_aberto_sum

    def build_preview(self, data_de, data_ate) -> Tuple[List[Dict[str, str]], Decimal]:
        grouped = self._load_contracts_grouped_by_cpf(data_de, data_ate)
        return self._build_preview_rows(grouped)

    def build_preview_for_identifiers(
        self,
        identifiers: Optional[Iterable[str] | str],
    ) -> Tuple[List[Dict[str, str]], Decimal, Dict[str, object]]:
        parsed = self.parse_batch_identifiers(identifiers)
        cpfs = parsed["cpfs"]
        cnjs = parsed["cnjs"]
        parsed["matched_contracts"] = 0
        parsed["matched_cpfs"] = 0
        parsed["matched_cnjs"] = 0
        parsed["missing_cpfs"] = cpfs
        parsed["missing_cnjs"] = cnjs
        if not cpfs and not cnjs:
            parsed["found_cpfs"] = 0
            return [], Decimal('0'), parsed
        if not self.has_carteira_connection:
            raise DemandasImportError(
                f"Carteira configurada com a fonte '{self.db_alias}' não está disponível. "
                "Verifique a configuração em DATABASES."
            )
        try:
            contratos = self._fetch_contracts_by_cpf_or_cnj(cpfs, cnjs)
        except OperationalError as exc:
            logger.exception("Falha ao buscar contratos por CNJ/CPF na base da carteira")
            raise DemandasImportError("Não foi possível carregar os contratos da carteira.") from exc
        if not contratos:
            parsed["found_cpfs"] = 0
            return [], Decimal('0'), parsed

        contratos = self._hydrate_contracts_with_parcelas(contratos)
        parsed["matched_contracts"] = len(contratos)
        matched_cpfs = {
            _normalize_digits(item.get("cpf"))
            for item in contratos
            if _normalize_digits(item.get("cpf"))
        }
        matched_cnjs = {
            _normalize_cnj_digits(item.get("num_processo_jud"))
            for item in contratos
            if _normalize_cnj_digits(item.get("num_processo_jud"))
        }
        parsed["matched_cpfs"] = len(matched_cpfs)
        parsed["matched_cnjs"] = len(matched_cnjs)
        parsed["missing_cpfs"] = [cpf for cpf in cpfs if cpf not in matched_cpfs]
        parsed["missing_cnjs"] = [cnj for cnj in cnjs if cnj not in matched_cnjs]
        grouped = self._group_contracts_by_cpf(contratos)
        parsed["found_cpfs"] = len(grouped)
        rows, total = self._build_preview_rows(grouped)
        return rows, total, parsed

    def import_period(self, data_de, data_ate, etiqueta_nome: str, carteira: Optional[Carteira] = None) -> Dict[str, int]:
        grouped = self._load_contracts_grouped_by_cpf(data_de, data_ate)
        return self._apply_import(
            grouped,
            etiqueta_nome,
            carteira,
            apply_litis_sim_label=True,
        )

    def import_selected_cpfs(
        self,
        data_de,
        data_ate,
        selected_cpfs: List[str],
        etiqueta_nome: str,
        carteira: Optional[Carteira] = None,
    ) -> Dict[str, int]:
        if not selected_cpfs:
            return {"imported": 0, "skipped": 0}
        normalized_cpfs = [_normalize_digits(cpf) for cpf in selected_cpfs if _normalize_digits(cpf)]
        grouped = self._load_contracts_grouped_by_cpf(data_de, data_ate, normalized_cpfs)
        return self._apply_import(
            grouped,
            etiqueta_nome,
            carteira,
            apply_litis_sim_label=True,
        )

    def _apply_import(
        self,
        grouped: Dict[str, List[Dict]],
        etiqueta_nome: str,
        carteira: Optional[Carteira],
        *,
        link_only_existing: bool = False,
        apply_litis_sim_label: bool = False,
    ) -> Dict[str, int]:
        if not grouped:
            return {"imported": 0, "skipped": 0}

        etiqueta = Etiqueta.objects.get_or_create(
            nome=etiqueta_nome,
            defaults={"cor_fundo": "#b5b5b5", "cor_fonte": "#222222"}
        )[0]
        litis_sim_tag = None
        if apply_litis_sim_label:
            litis_sim_tag = Etiqueta.objects.get_or_create(
                nome=self.LITIS_SIM_LABEL,
                defaults={"cor_fundo": self.LITIS_SIM_BG, "cor_fonte": self.LITIS_SIM_FG},
            )[0]
        imported = 0
        skipped = 0
        for cpf, contracts in grouped.items():
            with transaction.atomic():
                processo = self._find_existing_processo(cpf, carteira)
                changed = False
                if processo:
                    if link_only_existing:
                        changed = self._ensure_carteira_link(processo, carteira)
                    else:
                        changed = self._upsert_existing_processo(processo, cpf, contracts, carteira)
                else:
                    processo = self._build_processo(cpf, contracts, carteira)
                    changed = True
                processo.etiquetas.add(etiqueta)
                if litis_sim_tag and self._contracts_have_cnj(contracts):
                    processo.etiquetas.add(litis_sim_tag)
                if changed:
                    imported += 1
                else:
                    skipped += 1
        return {"imported": imported, "skipped": skipped}

    def _contracts_have_cnj(self, contracts: List[Dict]) -> bool:
        for contract in contracts or []:
            raw_cnj = contract.get("num_processo_jud")
            if len(_normalize_digits(raw_cnj)) >= 18:
                return True
        return False

    def _find_existing_processo_by_cnj(self, cnj_digits: str) -> Optional[ProcessoJudicial]:
        cnj_digits = _normalize_cnj_lookup(cnj_digits)
        if not cnj_digits:
            return None

        processo = (
            ProcessoJudicial.objects
            .annotate(
                cnj_digits=RawSQL(
                    "RIGHT(LPAD(regexp_replace(COALESCE(\"contratos_processojudicial\".\"cnj\", ''), '\\D', '', 'g'), 20, '0'), 20)",
                    [],
                )
            )
            .filter(cnj_digits=cnj_digits)
            .order_by('id')
            .first()
        )
        if processo:
            return processo

        numero_entry = (
            ProcessoJudicialNumeroCnj.objects
            .annotate(
                cnj_digits=RawSQL(
                    "RIGHT(LPAD(regexp_replace(COALESCE(\"contratos_processojudicialnumerocnj\".\"cnj\", ''), '\\D', '', 'g'), 20, '0'), 20)",
                    [],
                )
            )
            .filter(cnj_digits=cnj_digits)
            .select_related('processo')
            .order_by('id')
            .first()
        )
        return numero_entry.processo if numero_entry else None

    def _ensure_numero_cnj_entry(
        self,
        processo: ProcessoJudicial,
        cnj_digits: str,
        carteira: Optional[Carteira] = None,
    ) -> bool:
        cnj_digits = _normalize_cnj_lookup(cnj_digits)
        if not processo or not processo.pk or not cnj_digits:
            return False

        formatted_cnj = _format_cnj(cnj_digits)
        uf = _extract_uf_from_cnj_like(cnj_digits)
        target = None
        for entry in processo.numeros_cnj.all():
            if _normalize_cnj_lookup(entry.cnj) == cnj_digits:
                target = entry
                break

        if not target:
            ProcessoJudicialNumeroCnj.objects.create(
                processo=processo,
                cnj=formatted_cnj,
                uf=uf,
                carteira=carteira if carteira and carteira.id else None,
                vara='',
                tribunal='',
            )
            return True

        update_fields = []
        if uf and not (target.uf or '').strip():
            target.uf = uf
            update_fields.append('uf')
        if carteira and carteira.id and not target.carteira_id:
            target.carteira = carteira
            update_fields.append('carteira')
        if update_fields:
            target.save(update_fields=update_fields)
            return True
        return False

    def _import_minimal_cnjs(
        self,
        cnjs: Iterable[str],
        carteira: Optional[Carteira] = None,
        etiqueta_nome: str = "",
    ) -> Dict[str, int]:
        unique_cnjs = []
        for cnj in cnjs:
            normalized = _normalize_cnj_lookup(cnj)
            if normalized:
                unique_cnjs.append(normalized)
        unique_cnjs = list(dict.fromkeys(unique_cnjs))

        result = {
            "imported": 0,
            "skipped": 0,
            "minimal_created": 0,
            "minimal_linked": 0,
        }
        if not unique_cnjs:
            return result

        etiqueta = None
        if etiqueta_nome:
            etiqueta = Etiqueta.objects.get_or_create(
                nome=etiqueta_nome,
                defaults={"cor_fundo": "#b5b5b5", "cor_fonte": "#222222"}
            )[0]

        for cnj_digits in unique_cnjs:
            formatted_cnj = _format_cnj(cnj_digits)
            uf = _extract_uf_from_cnj_like(cnj_digits)
            processo = self._find_existing_processo_by_cnj(cnj_digits)
            if processo:
                changed = False
                update_fields = []
                if not (processo.cnj or '').strip():
                    processo.cnj = formatted_cnj
                    update_fields.append('cnj')
                if uf and not (processo.uf or '').strip():
                    processo.uf = uf
                    update_fields.append('uf')
                if carteira and carteira.id and not processo.carteira_id:
                    processo.carteira = carteira
                    update_fields.append('carteira')
                if update_fields:
                    processo.save(update_fields=update_fields)
                    changed = True
                if self._ensure_carteira_link(processo, carteira):
                    changed = True
                if self._ensure_numero_cnj_entry(processo, cnj_digits, carteira):
                    changed = True
                if changed:
                    if etiqueta:
                        processo.etiquetas.add(etiqueta)
                    result["imported"] += 1
                    result["minimal_linked"] += 1
                else:
                    result["skipped"] += 1
                continue

            processo = ProcessoJudicial.objects.create(
                cnj=formatted_cnj,
                uf=uf,
                carteira=carteira if carteira and carteira.id else None,
            )
            self._ensure_carteira_link(processo, carteira)
            self._ensure_numero_cnj_entry(processo, cnj_digits, carteira)
            if etiqueta:
                processo.etiquetas.add(etiqueta)
            result["imported"] += 1
            result["minimal_created"] += 1

        return result

    def _find_existing_processo(self, cpf: str, carteira: Optional[Carteira]) -> Optional[ProcessoJudicial]:
        cpf_digits = _normalize_digits(cpf)
        if not cpf_digits:
            return None

        cpf_regex = ''.join(f'{re.escape(char)}\\D*' for char in cpf_digits)
        base_qs = (
            ProcessoJudicial.objects.filter(
                Q(partes_processuais__documento=cpf_digits)
                | Q(partes_processuais__documento__iregex=rf'^{cpf_regex}$')
            )
            .distinct()
            .order_by('id')
        )
        if carteira and carteira.id:
            preferred = base_qs.filter(
                Q(carteira_id=carteira.id) | Q(carteiras_vinculadas__id=carteira.id)
            ).first()
            if preferred:
                return preferred
        return base_qs.first()

    def _ensure_carteira_link(self, processo: ProcessoJudicial, carteira: Optional[Carteira]) -> bool:
        if not carteira or not carteira.id:
            return False
        changed = False
        if not processo.carteira_id:
            processo.carteira = carteira
            processo.save(update_fields=['carteira'])
            changed = True
        already_linked = processo.carteiras_vinculadas.filter(id=carteira.id).exists()
        if not already_linked:
            processo.carteiras_vinculadas.add(carteira)
            changed = True
        return changed

    def _upsert_passivo_parte(self, processo: ProcessoJudicial, cpf: str, contracts: List[Dict]) -> bool:
        cpf_digits = _normalize_digits(cpf)
        if not cpf_digits:
            return False
        changed = False
        nome = contracts[0].get('cliente_nome') or 'Cliente sem nome'
        tipo_pessoa = contracts[0].get('contato_tipo_pessoa', 'PF')
        endereco = contracts[0].get('endereco', '')
        cpf_regex = ''.join(f'{re.escape(char)}\\D*' for char in cpf_digits)
        parte = (
            processo.partes_processuais.filter(tipo_polo='PASSIVO')
            .filter(Q(documento=cpf_digits) | Q(documento__iregex=rf'^{cpf_regex}$'))
            .order_by('id')
            .first()
        )
        if not parte:
            Parte.objects.create(
                processo=processo,
                tipo_polo='PASSIVO',
                nome=nome,
                tipo_pessoa=tipo_pessoa,
                documento=cpf_digits,
                endereco=endereco,
            )
            changed = True
        else:
            update_fields = []
            if parte.documento != cpf_digits:
                parte.documento = cpf_digits
                update_fields.append('documento')
            if nome and parte.nome != nome:
                parte.nome = nome
                update_fields.append('nome')
            if tipo_pessoa and parte.tipo_pessoa != tipo_pessoa:
                parte.tipo_pessoa = tipo_pessoa
                update_fields.append('tipo_pessoa')
            if endereco and parte.endereco != endereco:
                parte.endereco = endereco
                update_fields.append('endereco')
            if update_fields:
                parte.save(update_fields=update_fields)
                changed = True

        if not processo.partes_processuais.filter(tipo_polo='ATIVO').exists():
            Parte.objects.create(
                processo=processo,
                tipo_polo='ATIVO',
                nome='',
                tipo_pessoa='PJ',
                documento='',
            )
            changed = True
        return changed

    def _upsert_contratos(self, processo: ProcessoJudicial, contracts: List[Dict]) -> bool:
        changed = False
        existing = {
            (str(c.numero_contrato or '').strip()): c
            for c in processo.contratos.all()
            if str(c.numero_contrato or '').strip()
        }
        for contract in contracts:
            numero_contrato = str(contract.get('contrato') or '').strip()
            source_id = contract.get('id')
            contract_key = numero_contrato or (f"source:{source_id}" if source_id else None)
            valor = contract.get('valor_aberto')
            parcelas = contract.get('parcelas_aberto')
            prescricao = contract.get('data_prescricao')
            if contract_key and contract_key in existing:
                contrato_obj = existing[contract_key]
                update_fields = []
                if contrato_obj.valor_total_devido != valor:
                    contrato_obj.valor_total_devido = valor
                    update_fields.append('valor_total_devido')
                if contrato_obj.valor_causa != valor:
                    contrato_obj.valor_causa = valor
                    update_fields.append('valor_causa')
                if contrato_obj.parcelas_em_aberto != parcelas:
                    contrato_obj.parcelas_em_aberto = parcelas
                    update_fields.append('parcelas_em_aberto')
                if contrato_obj.data_prescricao != prescricao:
                    contrato_obj.data_prescricao = prescricao
                    update_fields.append('data_prescricao')
                if update_fields:
                    contrato_obj.save(update_fields=update_fields)
                    changed = True
                continue

            created_contrato = Contrato.objects.create(
                processo=processo,
                numero_contrato=numero_contrato or None,
                valor_total_devido=valor,
                valor_causa=valor,
                parcelas_em_aberto=parcelas,
                data_prescricao=prescricao,
            )
            if contract_key:
                existing[contract_key] = created_contrato
            changed = True
        return changed

    def _upsert_numeros_cnj(
        self,
        processo: ProcessoJudicial,
        contracts: List[Dict],
        carteira: Optional[Carteira],
    ) -> bool:
        changed = False
        if not contracts:
            return changed
        existing = {
            _normalize_cnj_digits(item.cnj) or (item.cnj or '').strip().upper(): item
            for item in processo.numeros_cnj.all()
        }
        for contract in contracts:
            raw_cnj = (contract.get('num_processo_jud') or '').strip()
            if not raw_cnj:
                continue
            cnj_for_store = _format_cnj(raw_cnj)
            key = _normalize_cnj_digits(cnj_for_store) or cnj_for_store.upper()
            if not key:
                continue
            numero_obj = existing.get(key)
            if not numero_obj:
                numero_obj = ProcessoJudicialNumeroCnj.objects.create(
                    processo=processo,
                    cnj=cnj_for_store,
                    uf=(contract.get('uf') or contract.get('endereco_uf') or '').strip().upper(),
                    valor_causa=contract.get('valor_aberto') or None,
                    carteira=carteira if carteira and carteira.id else None,
                    vara=contract.get('loja_nome') or '',
                    tribunal='',
                )
                existing[key] = numero_obj
                changed = True
                continue

            update_fields = []
            if carteira and carteira.id and not numero_obj.carteira_id:
                numero_obj.carteira = carteira
                update_fields.append('carteira')
            uf = (contract.get('uf') or contract.get('endereco_uf') or '').strip().upper()
            if uf and numero_obj.uf != uf:
                numero_obj.uf = uf
                update_fields.append('uf')
            valor = contract.get('valor_aberto') or None
            if valor is not None and numero_obj.valor_causa != valor:
                numero_obj.valor_causa = valor
                update_fields.append('valor_causa')
            loja_nome = contract.get('loja_nome') or ''
            if loja_nome and numero_obj.vara != loja_nome:
                numero_obj.vara = loja_nome
                update_fields.append('vara')
            if update_fields:
                numero_obj.save(update_fields=update_fields)
                changed = True
        return changed

    def _sync_soma_contratos(self, processo: ProcessoJudicial) -> bool:
        total = sum(
            (c.valor_total_devido or c.valor_causa or Decimal('0'))
            for c in processo.contratos.all()
        )
        update_fields = []
        if processo.soma_contratos != total:
            processo.soma_contratos = total
            update_fields.append('soma_contratos')
        if total and processo.valor_causa != total:
            processo.valor_causa = total
            update_fields.append('valor_causa')
        if update_fields:
            processo.save(update_fields=update_fields)
            return True
        return False

    def _upsert_existing_processo(
        self,
        processo: ProcessoJudicial,
        cpf: str,
        contracts: List[Dict],
        carteira: Optional[Carteira],
    ) -> bool:
        changed = False
        if self._ensure_carteira_link(processo, carteira):
            changed = True
        if self._upsert_passivo_parte(processo, cpf, contracts):
            changed = True
        if self._upsert_contratos(processo, contracts):
            changed = True
        if self._upsert_numeros_cnj(processo, contracts, carteira):
            changed = True
        if self._sync_soma_contratos(processo):
            changed = True
        return changed

    def _load_contracts_grouped_by_cpf(
        self,
        data_de,
        data_ate,
        cpfs_override: Optional[Iterable[str]] = None,
    ) -> Dict[str, List[Dict]]:
        if not self.has_carteira_connection:
            raise DemandasImportError(
                f"Carteira configurada com a fonte '{self.db_alias}' não está disponível. "
                "Verifique a configuração em DATABASES."
            )

        try:
            if cpfs_override is None:
                cpfs = self._fetch_cpfs_for_period(data_de, data_ate)
            else:
                cpfs = [
                    cpf.strip()
                    for cpf in cpfs_override
                    if cpf and cpf.strip()
                ]
        except OperationalError as exc:
            logger.exception("Falha ao buscar CPFs na base da carteira")
            raise DemandasImportError("Não foi possível conectar ao banco da carteira.") from exc

        if not cpfs:
            return {}

        try:
            contratos = self._fetch_contracts(cpfs, data_de, data_ate)
        except OperationalError as exc:
            logger.exception("Falha ao buscar contratos na base da carteira")
            raise DemandasImportError("Não foi possível carregar os contratos da carteira.") from exc

        contrato_ids = [c["id"] for c in contratos]
        parcelas_map = self._fetch_parcelas_em_aberto(contrato_ids)

        grouped = defaultdict(list)
        for row in contratos:
            row["parcelas_aberto"] = parcelas_map.get(row["id"], {}).get("parcelas", 0)
            row["valor_parcelas_aberto"] = parcelas_map.get(row["id"], {}).get("valor", Decimal('0'))
            grouped[row["cpf"]].append(row)
        return grouped

    def _fetch_cpfs_for_period(self, data_de, data_ate) -> List[str]:
        sql = """
            SELECT DISTINCT cpf_cgc
            FROM b6_erp_contratos
            WHERE data_prescricao BETWEEN %s AND %s
              AND cpf_cgc IS NOT NULL
        """
        with connections[self.db_alias].cursor() as cursor:
            cursor.execute(sql, [data_de, data_ate])
            results = [row[0].strip() for row in cursor.fetchall() if row[0]]
        return results

    def _fetch_contracts(self, cpfs: Iterable[str], data_de, data_ate) -> List[Dict]:
        sql = """
            SELECT
                c.id,
                c.contrato,
                c.cpf_cgc,
                COALESCE(c.valor_aberto, 0) as valor_aberto,
                c.data_prescricao,
                COALESCE(c.uf, '') as uf,
                COALESCE(c.loja_nome, c.loja, '') as loja_nome,
                COALESCE(c.num_processo_jud, '') as num_processo_jud,
                COALESCE(cl.nome, '') as cliente_nome,
                cl.endereco_rua,
                cl.endereco_numero,
                cl.endereco_complemento,
                cl.endereco_bairro,
                cl.endereco_cidade,
                cl.endereco_uf,
                cl.endereco_cep,
                cl.telefone_ddd,
                cl.telefone_numero
            FROM b6_erp_contratos c
            LEFT JOIN b6_erp_clientes cl ON cl.cpf_cgc = c.cpf_cgc
            WHERE c.cpf_cgc = ANY(%s)
              AND c.data_prescricao BETWEEN %s AND %s
            ORDER BY c.cpf_cgc, c.data_prescricao
        """
        with connections[self.db_alias].cursor() as cursor:
            cursor.execute(sql, [list(cpfs), data_de, data_ate])
            rows = cursor.fetchall()
            column_names = [desc[0] for desc in cursor.description]
        return self._map_contract_rows(rows, column_names)

    def _fetch_contracts_by_cpf(self, cpfs: Iterable[str]) -> List[Dict]:
        sql = """
            SELECT
                c.id,
                c.contrato,
                c.cpf_cgc,
                COALESCE(c.valor_aberto, 0) as valor_aberto,
                c.data_prescricao,
                COALESCE(c.uf, '') as uf,
                COALESCE(c.loja_nome, c.loja, '') as loja_nome,
                COALESCE(c.num_processo_jud, '') as num_processo_jud,
                COALESCE(cl.nome, '') as cliente_nome,
                cl.endereco_rua,
                cl.endereco_numero,
                cl.endereco_complemento,
                cl.endereco_bairro,
                cl.endereco_cidade,
                cl.endereco_uf,
                cl.endereco_cep,
                cl.telefone_ddd,
                cl.telefone_numero
            FROM b6_erp_contratos c
            LEFT JOIN b6_erp_clientes cl ON cl.cpf_cgc = c.cpf_cgc
            WHERE c.cpf_cgc = ANY(%s)
            ORDER BY c.cpf_cgc, c.data_prescricao
        """
        with connections[self.db_alias].cursor() as cursor:
            cursor.execute(sql, [list(cpfs)])
            rows = cursor.fetchall()
            column_names = [desc[0] for desc in cursor.description]
        return self._map_contract_rows(rows, column_names)

    def _fetch_contracts_by_cpf_or_cnj(self, cpfs: Iterable[str], cnjs: Iterable[str]) -> List[Dict]:
        cpf_values = [cpf for cpf in cpfs if cpf]
        cnj_values = [_normalize_cnj_lookup(cnj) for cnj in cnjs if _normalize_cnj_lookup(cnj)]
        if not cpf_values and not cnj_values:
            return []

        clauses: List[str] = []
        params: List[object] = []
        if cpf_values:
            clauses.append("c.cpf_cgc = ANY(%s)")
            params.append(cpf_values)
        if cnj_values:
            clauses.append(
                "NULLIF(regexp_replace(COALESCE(c.num_processo_jud, ''), '\\D', '', 'g'), '') IS NOT NULL "
                "AND RIGHT(LPAD(regexp_replace(COALESCE(c.num_processo_jud, ''), '\\D', '', 'g'), 20, '0'), 20) = ANY(%s)"
            )
            params.append(cnj_values)

        sql = f"""
            SELECT
                c.id,
                c.contrato,
                c.cpf_cgc,
                COALESCE(c.valor_aberto, 0) as valor_aberto,
                c.data_prescricao,
                COALESCE(c.uf, '') as uf,
                COALESCE(c.loja_nome, c.loja, '') as loja_nome,
                COALESCE(c.num_processo_jud, '') as num_processo_jud,
                COALESCE(cl.nome, '') as cliente_nome,
                cl.endereco_rua,
                cl.endereco_numero,
                cl.endereco_complemento,
                cl.endereco_bairro,
                cl.endereco_cidade,
                cl.endereco_uf,
                cl.endereco_cep,
                cl.telefone_ddd,
                cl.telefone_numero
            FROM b6_erp_contratos c
            LEFT JOIN b6_erp_clientes cl ON cl.cpf_cgc = c.cpf_cgc
            WHERE {" OR ".join(clauses)}
            ORDER BY c.cpf_cgc, c.data_prescricao
        """
        with connections[self.db_alias].cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            column_names = [desc[0] for desc in cursor.description]
        return self._map_contract_rows(rows, column_names)

    def _map_contract_rows(self, rows: List[Tuple], column_names: List[str]) -> List[Dict]:
        contracts: List[Dict] = []
        for row in rows:
            mapped = dict(zip(column_names, row))
            cpf_value = (mapped.get("cpf_cgc") or "").strip()
            mapped["cpf"] = cpf_value
            uf = (mapped.get("endereco_uf") or '').strip().upper()
            cep = _format_cep(mapped.get("endereco_cep"))
            endereco_map = {
                "A": _clean_street_name(mapped.get("endereco_rua"), mapped.get("endereco_numero")),
                "B": mapped.get("endereco_numero") or '',
                "C": mapped.get("endereco_complemento") or '',
                "D": mapped.get("endereco_bairro") or '',
                "E": mapped.get("endereco_cidade") or '',
                "F": _uf_to_nome(uf),
                "G": cep,
                "H": uf,
            }
            mapped["endereco"] = _montar_texto_endereco(endereco_map)
            mapped["telefone"] = _build_telefone(mapped)
            mapped["contato_tipo_pessoa"] = _determine_tipo_pessoa(mapped["cpf"])
            mapped["valor_aberto"] = Decimal(mapped.get("valor_aberto") or 0)
            contracts.append(mapped)
        return contracts

    def _hydrate_contracts_with_parcelas(self, contratos: List[Dict]) -> List[Dict]:
        if not contratos:
            return contratos
        contrato_ids = [c["id"] for c in contratos if c.get("id")]
        parcelas_map = self._fetch_parcelas_em_aberto(contrato_ids)
        for row in contratos:
            row["parcelas_aberto"] = parcelas_map.get(row.get("id"), {}).get("parcelas", 0)
            row["valor_parcelas_aberto"] = parcelas_map.get(row.get("id"), {}).get("valor", Decimal('0'))
        return contratos

    def _fetch_parcelas_em_aberto(self, contrato_ids: List[int]) -> Dict[int, Dict[str, Decimal]]:
        if not contrato_ids:
            return {}
        sql = """
            SELECT
                contrato_id,
                COUNT(*) FILTER (WHERE dt_rcb IS NULL) as parcelas,
                COALESCE(SUM(val_prt) FILTER (WHERE dt_rcb IS NULL), 0) as valor
            FROM b6_erp_parcelas
            WHERE contrato_id = ANY(%s)
            GROUP BY contrato_id
        """
        with connections[self.db_alias].cursor() as cursor:
            cursor.execute(sql, [contrato_ids])
            rows = cursor.fetchall()
        return {
            row[0]: {"parcelas": row[1] or 0, "valor": Decimal(row[2] or 0)}
            for row in rows
        }

    def _group_contracts_by_cpf(self, contracts: List[Dict]) -> Dict[str, List[Dict]]:
        grouped = defaultdict(list)
        for row in contracts:
            cpf = (row.get("cpf") or row.get("cpf_cgc") or "").strip()
            if not cpf:
                continue
            grouped[cpf].append(row)
        return grouped

    def fetch_cadastro_by_cpf(self, cpf: str) -> Dict[str, object]:
        cpf_clean = _normalize_digits(cpf)
        if not cpf_clean:
            return {}
        if not self.has_carteira_connection:
            raise DemandasImportError(
                f"Carteira configurada com a fonte '{self.db_alias}' não está disponível. "
                "Verifique a configuração em DATABASES."
            )
        try:
            contratos = self._fetch_contracts_by_cpf([cpf_clean])
        except OperationalError as exc:
            logger.exception("Falha ao buscar contratos por CPF na base da carteira")
            raise DemandasImportError("Não foi possível carregar os contratos da carteira.") from exc
        if not contratos:
            return {}
        contratos = self._hydrate_contracts_with_parcelas(contratos)

        primeiro = contratos[0]
        nome = primeiro.get("cliente_nome") or "Cliente sem nome"
        endereco = primeiro.get("endereco") or ""
        tipo_pessoa = primeiro.get("contato_tipo_pessoa") or _determine_tipo_pessoa(cpf_clean)
        telefone = primeiro.get("telefone") or ""

        contratos_payload = []
        for contrato in contratos:
            prescricao = contrato.get("data_prescricao")
            contratos_payload.append({
                "numero_contrato": contrato.get("contrato") or "",
                "valor_total_devido": str(contrato.get("valor_aberto") or Decimal('0')),
                "valor_causa": str(contrato.get("valor_aberto") or Decimal('0')),
                "parcelas_em_aberto": contrato.get("parcelas_aberto") or 0,
                "data_prescricao": prescricao.strftime("%Y-%m-%d") if prescricao else "",
                "contrato_id": contrato.get("id"),
            })

        return {
            "cpf": cpf_clean,
            "nome": nome,
            "documento": cpf_clean,
            "tipo_pessoa": tipo_pessoa,
            "endereco": endereco,
            "telefone": telefone,
            "contratos": contratos_payload,
        }

    def build_preview_for_cpfs(self, cpfs: Iterable[str]) -> Tuple[List[Dict[str, str]], Decimal]:
        normalized = [_normalize_digits(cpf) for cpf in cpfs if _normalize_digits(cpf)]
        if not normalized:
            return [], Decimal('0')
        if not self.has_carteira_connection:
            raise DemandasImportError(
                f"Carteira configurada com a fonte '{self.db_alias}' não está disponível. "
                "Verifique a configuração em DATABASES."
            )
        try:
            contratos = self._fetch_contracts_by_cpf(normalized)
        except OperationalError as exc:
            logger.exception("Falha ao buscar contratos por CPF na base da carteira")
            raise DemandasImportError("Não foi possível carregar os contratos da carteira.") from exc
        if not contratos:
            return [], Decimal('0')
        contratos = self._hydrate_contracts_with_parcelas(contratos)

        grouped = self._group_contracts_by_cpf(contratos)
        return self._build_preview_rows(grouped)

    def import_cpfs(self, cpfs: Iterable[str], etiqueta_nome: str, carteira: Optional[Carteira] = None) -> Dict[str, int]:
        normalized = [_normalize_digits(cpf) for cpf in cpfs if _normalize_digits(cpf)]
        if not normalized:
            return {"imported": 0, "skipped": 0}
        if not self.has_carteira_connection:
            raise DemandasImportError(
                f"Carteira configurada com a fonte '{self.db_alias}' não está disponível. "
                "Verifique a configuração em DATABASES."
            )
        try:
            contratos = self._fetch_contracts_by_cpf(normalized)
        except OperationalError as exc:
            logger.exception("Falha ao buscar contratos por CPF na base da carteira")
            raise DemandasImportError("Não foi possível carregar os contratos da carteira.") from exc
        if not contratos:
            return {"imported": 0, "skipped": 0}
        contratos = self._hydrate_contracts_with_parcelas(contratos)
        grouped = self._group_contracts_by_cpf(contratos)
        return self._apply_import(
            grouped,
            etiqueta_nome,
            carteira,
            apply_litis_sim_label=True,
        )

    def import_identifiers(
        self,
        identifiers: Optional[Iterable[str] | str],
        etiqueta_nome: str,
        carteira: Optional[Carteira] = None,
        *,
        link_only_existing: bool = True,
        allow_minimal_missing_cnjs: bool = False,
        allowed_ufs: Optional[Iterable[str]] = None,
    ) -> Dict[str, int]:
        parsed = self.parse_batch_identifiers(identifiers)
        cpfs = list(parsed["cpfs"])
        cnjs = list(parsed["cnjs"])
        if allowed_ufs:
            allowed = {str(uf or '').strip().upper() for uf in allowed_ufs if str(uf or '').strip()}
            if allowed:
                cnjs = [
                    cnj for cnj in cnjs
                    if (_extract_uf_from_cnj_like(cnj) or 'SEM_UF') in allowed
                ]
                # CPF não carrega UF no token; só mantém quando seleção inclui SEM_UF.
                if 'SEM_UF' not in allowed:
                    cpfs = []

        result = {
            "imported": 0,
            "skipped": 0,
            "minimal_created": 0,
            "minimal_linked": 0,
        }
        if not cpfs and not cnjs:
            return result
        if not self.has_carteira_connection:
            raise DemandasImportError(
                f"Carteira configurada com a fonte '{self.db_alias}' não está disponível. "
                "Verifique a configuração em DATABASES."
            )
        try:
            contratos = self._fetch_contracts_by_cpf_or_cnj(cpfs, cnjs)
        except OperationalError as exc:
            logger.exception("Falha ao buscar contratos por CNJ/CPF na base da carteira")
            raise DemandasImportError("Não foi possível carregar os contratos da carteira.") from exc

        matched_cnjs = set()
        if contratos:
            contratos = self._hydrate_contracts_with_parcelas(contratos)
            grouped = self._group_contracts_by_cpf(contratos)
            base_result = self._apply_import(
                grouped,
                etiqueta_nome,
                carteira,
                link_only_existing=link_only_existing,
                apply_litis_sim_label=bool(cpfs) and not bool(cnjs),
            )
            result["imported"] += int(base_result.get("imported") or 0)
            result["skipped"] += int(base_result.get("skipped") or 0)
        matched_cnjs = {
            _normalize_cnj_lookup(item.get("num_processo_jud"))
            for item in contratos
            if _normalize_cnj_lookup(item.get("num_processo_jud"))
        }

        if allow_minimal_missing_cnjs and cnjs:
            missing_cnjs = [cnj for cnj in cnjs if _normalize_cnj_digits(cnj) not in matched_cnjs]
            minimal_result = self._import_minimal_cnjs(
                missing_cnjs,
                carteira=carteira,
                etiqueta_nome=etiqueta_nome,
            )
            result["imported"] += int(minimal_result.get("imported") or 0)
            result["skipped"] += int(minimal_result.get("skipped") or 0)
            result["minimal_created"] += int(minimal_result.get("minimal_created") or 0)
            result["minimal_linked"] += int(minimal_result.get("minimal_linked") or 0)

        return result

    def _build_processo(self, cpf: str, contracts: List[Dict], carteira: Optional[Carteira] = None) -> ProcessoJudicial:
        total_aberto = sum((c.get('valor_aberto') or Decimal('0')) for c in contracts)
        uf_value = ''
        for contract in contracts:
            uf_candidate = (contract.get('endereco_uf') or '').strip().upper()
            if uf_candidate:
                uf_value = uf_candidate
                break
        if not uf_value:
            uf_value = (contracts[0].get('uf') or '').strip().upper()
        principal_cnj = next((c.get('num_processo_jud') for c in contracts if c.get('num_processo_jud')), None)
        processo = ProcessoJudicial.objects.create(
            cnj=_format_cnj(principal_cnj) if principal_cnj else None,
            uf=uf_value,
            vara=contracts[0].get('loja_nome') or '',
            tribunal='',
            valor_causa=total_aberto or None,
            soma_contratos=total_aberto,
            carteira=carteira,
        )
        self._ensure_carteira_link(processo, carteira)
        cpf_para_gravar = _normalize_digits(cpf) or cpf
        Parte.objects.bulk_create([
            Parte(
                processo=processo,
                tipo_polo='ATIVO',
                nome='',
                tipo_pessoa='PJ',
                documento='',
            ),
            Parte(
                processo=processo,
                tipo_polo='PASSIVO',
                nome=contracts[0].get('cliente_nome') or 'Cliente sem nome',
                tipo_pessoa=contracts[0].get('contato_tipo_pessoa', 'PF'),
                documento=cpf_para_gravar,
                endereco=contracts[0].get('endereco', ''),
            ),
        ])

        Contrato.objects.bulk_create([
            Contrato(
                processo=processo,
                numero_contrato=contract.get('contrato'),
                valor_total_devido=contract.get('valor_aberto'),
                valor_causa=contract.get('valor_aberto'),
                parcelas_em_aberto=contract.get('parcelas_aberto'),
                data_prescricao=contract.get('data_prescricao'),
            )
            for contract in contracts
        ])
        self._upsert_numeros_cnj(processo, contracts, carteira)

        return processo
