import logging
import re
from collections import defaultdict
from decimal import Decimal
from typing import Dict, Iterable, List, Mapping, Optional, Tuple

from django.conf import settings
from django.db import connections, transaction
from django.db.utils import OperationalError

from contratos.models import Contrato, Etiqueta, Parte, ProcessoJudicial

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


def _build_endereco(row: Mapping[str, Optional[str]]) -> str:
    parts = [
        row.get('endereco_rua'),
        row.get('endereco_numero'),
        row.get('endereco_complemento'),
        row.get('endereco_bairro'),
        row.get('endereco_cidade'),
        row.get('endereco_uf'),
        row.get('endereco_cep'),
    ]
    cleaned = [part.strip() for part in parts if part and part.strip()]
    return ', '.join(cleaned)


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
            rows.append({
                "cpf": _format_cpf(cpf),
                "cpf_raw": cpf_normalized,
                "nome": nome,
                "contratos": len(contracts),
                "total_aberto": _format_currency(total_aberto),
                "prescricao_ativadora": prescricao_text,
            })
        return rows, total_aberto_sum

    def import_period(self, data_de, data_ate, etiqueta_nome: str) -> Dict[str, int]:
        grouped = self._load_contracts_grouped_by_cpf(data_de, data_ate)
        return self._apply_import(grouped, etiqueta_nome)

    def import_selected_cpfs(self, data_de, data_ate, selected_cpfs: List[str], etiqueta_nome: str) -> Dict[str, int]:
        if not selected_cpfs:
            return {"imported": 0, "skipped": 0}
        normalized_cpfs = [_normalize_digits(cpf) for cpf in selected_cpfs if _normalize_digits(cpf)]
        grouped = self._load_contracts_grouped_by_cpf(data_de, data_ate, normalized_cpfs)
        return self._apply_import(grouped, etiqueta_nome)

    def _apply_import(self, grouped: Dict[str, List[Dict]], etiqueta_nome: str) -> Dict[str, int]:
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
                processo = self._build_processo(cpf, contracts)
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
            mapped["endereco"] = _build_endereco(mapped)
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

    def _build_processo(self, cpf: str, contracts: List[Dict]) -> ProcessoJudicial:
        total_aberto = sum((c.get('valor_aberto') or Decimal('0')) for c in contracts)
        processo = ProcessoJudicial.objects.create(
            cnj=next((c.get('num_processo_jud') for c in contracts if c.get('num_processo_jud')), None),
            uf=contracts[0].get('uf') or '',
            vara=contracts[0].get('loja_nome') or '',
            tribunal='',
            valor_causa=total_aberto or None,
            soma_contratos=total_aberto,
        )
        cpf_para_gravar = _normalize_digits(cpf) or cpf
        Parte.objects.bulk_create([
            Parte(
                processo=processo,
                tipo_polo='ATIVO',
                nome='Nowlex Demandas',
                tipo_pessoa='PJ',
                documento='00000000000191',
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
