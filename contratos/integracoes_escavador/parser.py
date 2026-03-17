from decimal import Decimal, InvalidOperation
import hashlib
from datetime import datetime
from django.db import connection
from django.db.models import Count
from django.utils import timezone
from django.utils.timezone import make_aware
from contratos.models import (
    ProcessoJudicial,
    StatusProcessual,
    Parte,
    AndamentoProcessual,
    AndamentoProcessualPendente,
)

def parse_dados_processo(processo: ProcessoJudicial, dados_api: dict):
    """
    Atualiza um objeto ProcessoJudicial com os dados vindos da API.
    """
    # A UF só é atualizada se não estiver preenchida
    if not processo.uf and dados_api.get('uf'):
        processo.uf = dados_api.get('uf', '')

    processo.vara = dados_api.get('vara', 'Não informado')
    processo.tribunal = dados_api.get('tribunal', {}).get('nome', 'Não informado')
    
    # Trata o valor da causa
    valor_causa_str = dados_api.get('valor_causa', {}).get('valor', '0')
    try:
        processo.valor_causa = Decimal(valor_causa_str)
    except (InvalidOperation, TypeError):
        processo.valor_causa = Decimal('0.00')

    # Associa o StatusProcessual (classe processual)
    nome_classe_processual = build_safe_status_nome(dados_api.get('classe_processual'))
    if nome_classe_processual:
        status, _ = StatusProcessual.objects.get_or_create(
            nome=nome_classe_processual,
            defaults={'ordem': 0} # Ordem padrão para novos status
        )
        processo.status = status

def parse_partes_processo(processo: ProcessoJudicial, dados_api: dict):
    """
    Cria ou atualiza as partes do processo a partir dos dados da API.
    Limpa as partes antigas antes de adicionar as novas para evitar duplicatas.
    """
    processo.partes_processuais.all().delete()  # Usa o related_name correto

    numero_cnj_obj = _resolve_numero_cnj_for_processo(processo)
    partes_envolvidas = dados_api.get('partes_envolvidas', [])
    for parte_api in partes_envolvidas:
        # Mapeia o tipo de polo
        tipo_polo_api = parte_api.get('tipo', '').upper()
        if 'ATIVO' in tipo_polo_api or 'AUTOR' in tipo_polo_api:
            tipo_polo = 'ATIVO'
        elif 'PASSIVO' in tipo_polo_api or 'REU' in tipo_polo_api:
            tipo_polo = 'PASSIVO'
        else:
            continue # Ignora partes sem polo definido

        # Mapeia o tipo de pessoa e documento
        documento = parte_api.get('documento')
        tipo_pessoa = 'PF' if len(documento or '') <= 14 else 'PJ'

        Parte.objects.create(
            processo=processo,
            numero_cnj=numero_cnj_obj,
            tipo_polo=tipo_polo,
            nome=parte_api.get('nome', 'Nome não informado'),
            tipo_pessoa=tipo_pessoa,
            documento=documento or 'Não informado',
        )

def _normalize_descricao(descricao: str | None) -> str:
    if not descricao:
        return ""
    return " ".join(str(descricao).split())


def _truncate_with_hash(value: str, max_len: int) -> str:
    normalized = _normalize_descricao(value)
    if not normalized:
        return ""
    if len(normalized) <= max_len:
        return normalized
    digest = hashlib.md5(normalized.encode('utf-8')).hexdigest()[:12]
    suffix = f" [{digest}]"
    base_len = max(1, max_len - len(suffix))
    return normalized[:base_len].rstrip() + suffix


def build_safe_status_nome(nome: str | None) -> str:
    return _truncate_with_hash(nome or '', 100)


def build_safe_andamento_descricao(descricao: str | None) -> str:
    return _truncate_with_hash(descricao or '', 255)


def build_safe_andamento_fields(descricao: str | None, detalhes: str | None = '') -> tuple[str, str]:
    normalized = _normalize_descricao(descricao)
    safe_descricao = build_safe_andamento_descricao(normalized)
    detalhes_text = str(detalhes or '').strip()
    if normalized and safe_descricao and normalized != safe_descricao:
        full_text = f"Conteudo completo: {normalized}"
        detalhes_text = f"{detalhes_text}\n\n{full_text}".strip() if detalhes_text else full_text
    return safe_descricao, detalhes_text


def _build_andamento_titulo(descricao: str | None) -> str:
    return build_safe_andamento_descricao(descricao)


def _has_andamento_pendente_table():
    try:
        return AndamentoProcessualPendente._meta.db_table in connection.introspection.table_names()
    except Exception:
        return False


def _normalize_cnj_digits(value: str | None) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _resolve_numero_cnj_for_processo(processo: ProcessoJudicial):
    if not processo:
        return None
    current_digits = _normalize_cnj_digits(processo.cnj)
    if current_digits:
        for item in processo.numeros_cnj.all().only("id", "cnj"):
            if _normalize_cnj_digits(item.cnj) == current_digits:
                return item
    return processo.numeros_cnj.order_by("-criado_em", "-id").only("id").first()


def remover_andamentos_duplicados(processo: ProcessoJudicial):
    seen = set()
    duplicate_ids = []

    for andamento in (
        AndamentoProcessual.objects
        .filter(processo=processo)
        .order_by('data', 'pk')
    ):
        normalized_descricao = _normalize_descricao(andamento.descricao)
        key = (andamento.numero_cnj_id, andamento.data, normalized_descricao)
        if key in seen:
            duplicate_ids.append(andamento.pk)
        else:
            seen.add(key)

    if duplicate_ids:
        deleted_count, _ = AndamentoProcessual.objects.filter(pk__in=duplicate_ids).delete()
        return deleted_count
    return 0


def parse_andamentos_processo(processo: ProcessoJudicial, dados_api: dict) -> int:
    """
    Cria ou atualiza os andamentos do processo a partir dos dados da API.
    Usa get_or_create para evitar a criação de andamentos duplicados.
    """
    movimentacoes = dados_api.get('movimentacoes', [])
    novos_andamentos = 0
    remover_andamentos_duplicados(processo)
    numero_cnj_obj = _resolve_numero_cnj_for_processo(processo)
    numero_cnj_id = numero_cnj_obj.id if numero_cnj_obj else None
    existentes = {
        (andamento.numero_cnj_id, andamento.data.isoformat(), _normalize_descricao(andamento.descricao))
        for andamento in processo.andamentos.all()
    }
    detected_at = timezone.now()
    pending_table_available = _has_andamento_pendente_table()
    for andamento_api in movimentacoes:
        data_str = andamento_api.get('data')
        descricao = andamento_api.get('conteudo')
        safe_descricao, safe_detalhes = build_safe_andamento_fields(
            descricao,
            ((andamento_api.get('fonte') or {}).get('nome')),
        )

        if not data_str or not safe_descricao:
            continue

        try:
            data_andamento = make_aware(datetime.fromisoformat(data_str))
            chave = (numero_cnj_id, data_andamento.isoformat(), safe_descricao)
            if chave in existentes:
                continue

            andamento_obj, criado = AndamentoProcessual.objects.get_or_create(
                processo=processo,
                numero_cnj=numero_cnj_obj,
                data=data_andamento,
                descricao=safe_descricao,
                defaults={'detalhes': safe_detalhes},
            )
            if not criado and safe_detalhes and safe_detalhes != (andamento_obj.detalhes or '').strip():
                andamento_obj.detalhes = safe_detalhes
                andamento_obj.save(update_fields=['detalhes'])
            if criado:
                novos_andamentos += 1
                existentes.add(chave)
                if pending_table_available:
                    titulo = _build_andamento_titulo(descricao)
                    if not titulo:
                        titulo = f"Andamento {data_andamento.date().isoformat()}"
                    AndamentoProcessualPendente.objects.get_or_create(
                        andamento=andamento_obj,
                        defaults={
                            'processo': processo,
                            'titulo': titulo,
                            'texto_bruto': descricao,
                            'data_andamento': data_andamento,
                            'data_deteccao': detected_at,
                        },
                    )
        except (ValueError, TypeError):
            print(f"Formato de data inválido para o andamento: {data_str}")
            continue
    return novos_andamentos
def _remover_andamentos_duplicados(processo: ProcessoJudicial):
    duplicados = (
        AndamentoProcessual.objects
        .filter(processo=processo)
        .values('numero_cnj_id', 'data', 'descricao')
        .annotate(qtd=Count('id'))
        .filter(qtd__gt=1)
    )
    for dup in duplicados:
        registros = (
            AndamentoProcessual.objects
            .filter(
                processo=processo,
                numero_cnj_id=dup['numero_cnj_id'],
                data=dup['data'],
                descricao=dup['descricao']
            )
            .order_by('pk')
        )
        ids_para_excluir = [obj.pk for obj in list(registros)[1:]]
        if ids_para_excluir:
            AndamentoProcessual.objects.filter(pk__in=ids_para_excluir).delete()
