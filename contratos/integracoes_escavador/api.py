import requests
import re
from django.conf import settings

# URL base da API v2 do Escavador
URL_BASE_API = "https://api.escavador.com/api/v2"

def buscar_processo_por_cnj(cnj: str) -> dict:
    """
    Busca os dados de um processo na API v2 do Escavador, fazendo chamadas
    separadas para detalhes e movimentações, e unindo os resultados.

    Args:
        cnj: O número do processo no formato CNJ (com ou sem máscara).

    Returns:
        Um dicionário com os dados consolidados, ou um dicionário vazio em caso de erro.
    """
    if not cnj:
        print("Erro: Número CNJ não fornecido.")
        return {}

    cnj_limpo = re.sub(r'\D', '', cnj)
    if len(cnj_limpo) != 20:
        print(f"Erro: O CNJ '{cnj}' não parece ser válido após a limpeza.")
        return {}

    token = settings.ESCAVADOR_API_TOKEN
    # DEBUG: Verifica se o token foi carregado do .env
    if token:
        print(f"DEBUG: Usando token que começa")
    else:
        print("DEBUG: ERRO - Token do Escavador não foi encontrado nas configurações (settings.py).")
        return {}

    headers = {
        "Authorization": f"Bearer {token}",
        "X-Requested-With": "XMLHttpRequest",
    }

    try:
        # 1. Buscar os detalhes do processo
        url_detalhes = f"{URL_BASE_API}/processos/numero_cnj/{cnj_limpo}"
        response_detalhes = requests.get(url_detalhes, headers=headers)
        response_detalhes.raise_for_status()
        dados_processo = response_detalhes.json()

        # 2. Buscar as movimentações do processo
        url_movimentacoes = f"{URL_BASE_API}/processos/numero_cnj/{cnj_limpo}/movimentacoes"
        response_movimentacoes = requests.get(url_movimentacoes, headers=headers)
        response_movimentacoes.raise_for_status()
        dados_movimentacoes = response_movimentacoes.json()

        # 3. Unir os resultados
        dados_processo['movimentacoes'] = dados_movimentacoes.get('items', [])
        return dados_processo

    except requests.exceptions.HTTPError as http_err:
        print(f"Erro HTTP ao buscar processo {cnj_limpo}: {http_err}")
        # Tratamento de erro robusto
        try:
            erro_json = http_err.response.json()
            if isinstance(erro_json, dict):
                message = erro_json.get('error', {}).get('message', http_err.response.text)
                print(f"Mensagem da API: {message}")
            else:
                print(f"Resposta da API (não-JSON): {http_err.response.text}")
        except ValueError:
            print(f"Resposta da API (não-JSON): {http_err.response.text}")
            
    except requests.exceptions.RequestException as req_err:
        print(f"Erro de conexão ao buscar processo {cnj_limpo}: {req_err}")
    except Exception as e:
        print(f"Ocorreu um erro inesperado ao buscar processo {cnj_limpo}: {e}")

    return {}
