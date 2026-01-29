import logging
import re
from collections import defaultdict
from decimal import Decimal
from typing import Dict, Iterable, List, Mapping, Optional, Tuple

from django.conf import settings
from django.db import connections, transaction
from django.db.utils import OperationalError

from contratos.models import Carteira, Contrato, Etiqueta, Parte, ProcessoJudicial

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



class DemandasImportService:
    SOURCE_ALIAS = 'carteira'

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

    def build_preview(self, data_de, data_ate) -> Tuple[List[Dict[str, str]], Decimal]:
        grouped = self._load_contracts_grouped_by_cpf(data_de, data_ate)
        rows = []
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
                uf_candidate = (contract.get('endereco_uf') or '').strip().upper()
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

    def import_period(self, data_de, data_ate, etiqueta_nome: str, carteira: Optional[Carteira] = None) -> Dict[str, int]:
        grouped = self._load_contracts_grouped_by_cpf(data_de, data_ate)
        return self._apply_import(grouped, etiqueta_nome, carteira)

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
        return self._apply_import(grouped, etiqueta_nome, carteira)

    def _apply_import(
        self,
        grouped: Dict[str, List[Dict]],
        etiqueta_nome: str,
        carteira: Optional[Carteira],
    ) -> Dict[str, int]:
        if not grouped:
            return {"imported": 0, "skipped": 0}

        etiqueta = Etiqueta.objects.get_or_create(
            nome=etiqueta_nome,
            defaults={"cor_fundo": "#b5b5b5", "cor_fonte": "#222222"}
        )[0]
        imported = 0
        skipped = 0
        for cpf, contracts in grouped.items():
            documento_clean = _normalize_digits(cpf)
            documento_variants = {cpf}
            if documento_clean:
                documento_variants.add(documento_clean)
            if Parte.objects.filter(documento__in=documento_variants).exists():
                skipped += 1
                continue
            with transaction.atomic():
                processo = self._build_processo(cpf, contracts, carteira)
                processo.etiquetas.add(etiqueta)
                imported += 1
        return {"imported": imported, "skipped": skipped}

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

        contracts = []
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

        contracts = []
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
        contrato_ids = [c["id"] for c in contratos if c.get("id")]
        parcelas_map = self._fetch_parcelas_em_aberto(contrato_ids)
        for row in contratos:
            row["parcelas_aberto"] = parcelas_map.get(row.get("id"), {}).get("parcelas", 0)
            row["valor_parcelas_aberto"] = parcelas_map.get(row.get("id"), {}).get("valor", Decimal('0'))

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
        contrato_ids = [c["id"] for c in contratos if c.get("id")]
        parcelas_map = self._fetch_parcelas_em_aberto(contrato_ids)
        for row in contratos:
            row["parcelas_aberto"] = parcelas_map.get(row.get("id"), {}).get("parcelas", 0)
            row["valor_parcelas_aberto"] = parcelas_map.get(row.get("id"), {}).get("valor", Decimal('0'))

        grouped = self._group_contracts_by_cpf(contratos)
        rows = []
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
                uf_candidate = (contract.get('endereco_uf') or '').strip().upper()
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
        contrato_ids = [c["id"] for c in contratos if c.get("id")]
        parcelas_map = self._fetch_parcelas_em_aberto(contrato_ids)
        for row in contratos:
            row["parcelas_aberto"] = parcelas_map.get(row.get("id"), {}).get("parcelas", 0)
            row["valor_parcelas_aberto"] = parcelas_map.get(row.get("id"), {}).get("valor", Decimal('0'))
        grouped = self._group_contracts_by_cpf(contratos)
        return self._apply_import(grouped, etiqueta_nome, carteira)

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
        processo = ProcessoJudicial.objects.create(
            cnj=next((c.get('num_processo_jud') for c in contracts if c.get('num_processo_jud')), None),
            uf=uf_value,
            vara=contracts[0].get('loja_nome') or '',
            tribunal='',
            valor_causa=total_aberto or None,
            soma_contratos=total_aberto,
            carteira=carteira,
        )
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

        return processo
