from django.db import transaction
from contratos.models import ProcessoJudicial
from .api import buscar_processo_por_cnj
from .parser import parse_dados_processo, parse_partes_processo, parse_andamentos_processo

def atualizar_processo_do_escavador(cnj: str) -> ProcessoJudicial | None:
    """
    Orquestra a busca de dados de um processo na API do Escavador e
    atualiza o banco de dados local, incluindo os andamentos.

    Args:
        cnj: O número do processo no formato CNJ.

    Returns:
        A instância do ProcessoJudicial atualizada e salva, ou None se ocorrer um erro.
    """
    # 1. Buscar dados na API
    dados_api = buscar_processo_por_cnj(cnj)
    if not dados_api:
        print(f"Não foi possível obter dados para o CNJ {cnj} da API do Escavador.")
        return None

    try:
        with transaction.atomic():
            # 2. Obter ou criar o processo judicial
            processo, created = ProcessoJudicial.objects.get_or_create(
                cnj=cnj,
                defaults={
                    'vara': dados_api.get('vara', 'Aguardando dados...'),
                    'valor_causa': 0.00,
                }
            )

            # 3. Popular/atualizar os dados principais do processo
            parse_dados_processo(processo, dados_api)
            
            # 4. Popular/atualizar as partes (apenas na criação inicial para evitar sobrecarga)
            if created:
                parse_partes_processo(processo, dados_api)

            # 5. Popular/atualizar os andamentos
            parse_andamentos_processo(processo, dados_api)

            # 6. Salvar o processo principal
            processo.save()
            
            print(f"Processo {cnj} {'criado' if created else 'atualizado'} com sucesso.")
            return processo

    except Exception as e:
        print(f"Erro ao salvar os dados do processo {cnj} no banco de dados: {e}")
        return None
