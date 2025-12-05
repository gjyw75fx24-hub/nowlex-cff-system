from decimal import Decimal, InvalidOperation
from datetime import datetime
from django.utils.timezone import make_aware
from contratos.models import ProcessoJudicial, StatusProcessual, Parte, AndamentoProcessual

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
    nome_classe_processual = dados_api.get('classe_processual')
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
            tipo_polo=tipo_polo,
            nome=parte_api.get('nome', 'Nome não informado'),
            tipo_pessoa=tipo_pessoa,
            documento=documento or 'Não informado',
        )

def parse_andamentos_processo(processo: ProcessoJudicial, dados_api: dict):
    """
    Cria ou atualiza os andamentos do processo a partir dos dados da API.
    Usa get_or_create para evitar a criação de andamentos duplicados.
    """
    movimentacoes = dados_api.get('movimentacoes', [])
    for andamento_api in movimentacoes:
        data_str = andamento_api.get('data')
        descricao = andamento_api.get('conteudo')

        if not data_str or not descricao:
            continue

        try:
            # Converte a data para um objeto datetime com fuso horário
            data_andamento = make_aware(datetime.fromisoformat(data_str))
            
            # Cria o andamento apenas se ele não existir
            AndamentoProcessual.objects.get_or_create(
                processo=processo,
                data=data_andamento,
                descricao=descricao
            )
        except (ValueError, TypeError):
            print(f"Formato de data inválido para o andamento: {data_str}")
            continue
