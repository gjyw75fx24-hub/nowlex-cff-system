import logging
import re
from collections import defaultdict
from decimal import Decimal
from typing import Dict, Iterable, List, Mapping, Optional, Tuple

from django.conf import settings
from django.db import connections, transaction
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


def _format_cnj(value: Optional[str]) -> str:
    digits = _normalize_cnj_digits(value)
    if len(digits) != 20:
        return str(value or '').strip()
    return f"{digits[:7]}-{digits[7:9]}.{digits[9:13]}.{digits[13:14]}.{digits[14:16]}.{digits[16:20]}"



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
            with transaction.atomic():
                processo = self._find_existing_processo(cpf, carteira)
                changed = False
                if processo:
                    changed = self._upsert_existing_processo(processo, cpf, contracts, carteira)
                else:
                    processo = self._build_processo(cpf, contracts, carteira)
                    changed = True
                processo.etiquetas.add(etiqueta)
                if changed:
                    imported += 1
                else:
                    skipped += 1
        return {"imported": imported, "skipped": skipped}

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
