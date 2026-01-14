from rest_framework import generics, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.auth.models import User
from ..models import ProcessoJudicial, Tarefa, Prazo, ListaDeTarefas
from .serializers import TarefaSerializer, PrazoSerializer, UserSerializer, ListaDeTarefasSerializer
from django.db.models import Q
from django.urls import reverse

# Imports adicionados para as novas views
import requests
import os
import re
from django.http import JsonResponse
from django.views import View
import json
from datetime import datetime

class AgendaAPIView(APIView):
    """
    API para buscar todas as tarefas e prazos de um processo.
    """
    def get(self, request, processo_id):
        try:
            processo = ProcessoJudicial.objects.get(pk=processo_id)
            tarefas = Tarefa.objects.filter(processo=processo)
            prazos = Prazo.objects.filter(processo=processo)
            
            tarefas_data = TarefaSerializer(tarefas, many=True).data
            prazos_data = PrazoSerializer(prazos, many=True).data
            
            # Combina e ordena por data
            agenda_items = sorted(
                tarefas_data + prazos_data, 
                key=lambda x: x.get('data') or x.get('data_limite')
            )
            
            return Response(agenda_items)
        except ProcessoJudicial.DoesNotExist:
            return Response({"error": "Processo não encontrado."}, status=status.HTTP_404_NOT_FOUND)

class AgendaGeralAPIView(APIView):
    """
    Retorna todas as tarefas e prazos para a Agenda Geral.
    """
    def get(self, request):
        tarefas = (
            Tarefa.objects
            .select_related('processo', 'responsavel', 'lista')
            .filter(concluida=False)
        )
        prazos = (
            Prazo.objects
            .select_related('processo', 'responsavel')
            .filter(concluido=False)
        )

        tarefas_data = TarefaSerializer(tarefas, many=True).data
        for item in tarefas_data:
            item['type'] = 'T'
            item['date'] = item.get('data')

        prazos_data = PrazoSerializer(prazos, many=True).data
        for item in prazos_data:
            item['type'] = 'P'
            item['date'] = item.get('data_limite')
            item['title'] = item.get('titulo')

        agenda_items = sorted(
            tarefas_data + prazos_data,
            key=lambda x: x.get('date') or ''
        )
        return Response(agenda_items)

class TarefaCreateAPIView(generics.CreateAPIView):
    """
    API para criar uma nova tarefa para um processo.
    """
    serializer_class = TarefaSerializer

    def perform_create(self, serializer):
        processo = get_object_or_404(ProcessoJudicial, pk=self.kwargs.get('processo_id'))
        serializer.save(processo=processo)

class PrazoCreateAPIView(generics.CreateAPIView):
    """
    API para criar um novo prazo para um processo.
    """
    serializer_class = PrazoSerializer

    def perform_create(self, serializer):
        processo = get_object_or_404(ProcessoJudicial, pk=self.kwargs.get('processo_id'))
        serializer.save(processo=processo)

class UserSearchAPIView(generics.ListAPIView):
    """
    API para buscar usuários (responsáveis) por nome.
    """
    serializer_class = UserSerializer

    def get_queryset(self):
        query = self.request.query_params.get('q', '')
        if query:
            return User.objects.filter(
                Q(username__icontains=query) | 
                Q(first_name__icontains=query) | 
                Q(last_name__icontains=query)
            ).distinct()[:10]
        return User.objects.none()


class AgendaUsersAPIView(APIView):
    """
    Lista os usuários ativos para a seleção na Agenda Geral.
    """
    def get(self, request):
        users = (
            User.objects.filter(is_active=True)
            .order_by('first_name', 'last_name', 'username')[:40]
        )
        serializer = UserSerializer(users, many=True)
        return Response(serializer.data)

class ListaDeTarefasAPIView(generics.ListCreateAPIView):
    """
    API para listar e criar Listas de Tarefas.
    """
    queryset = ListaDeTarefas.objects.all()
    serializer_class = ListaDeTarefasSerializer

# --- NOVAS VIEWS PARA O BOTÃO CIA ---

# Funções auxiliares movidas para o escopo do módulo para reutilização
def _format_cep(v):
    d = re.sub(r'\D', '', str(v or ''))
    if len(d) == 8:
        return f"{d[:5]}-{d[5:]}"
    return d or ''

def _uf_to_nome(uf_sigla):
    UFS = {
        'AC':'Acre', 'AL':'Alagoas', 'AP':'Amapá', 'AM':'Amazonas', 'BA':'Bahia', 'CE':'Ceará', 'DF':'Distrito Federal',
        'ES':'Espírito Santo', 'GO':'Goiás', 'MA':'Maranhão', 'MT':'Mato Grosso', 'MS':'Mato Grosso do Sul', 'MG':'Minas Gerais',
        'PA':'Pará', 'PB':'Paraíba', 'PR':'Paraná', 'PE':'Pernambuco', 'PI':'Piauí', 'RJ':'Rio de Janeiro', 'RN':'Rio Grande do Norte',
        'RS':'Rio Grande do Sul', 'RO':'Rondônia', 'RR':'Roraima', 'SC':'Santa Catarina', 'SP':'São Paulo', 'SE':'Sergipe', 'TO':'Tocantins'
    }
    return UFS.get(uf_sigla.upper(), '')

def _clean_street_name(rua, num):
    s = str(rua or '').strip()
    n = str(num or '').strip()
    if not s:
        return ''
    if n:
        s = re.sub(r'\s*,\s*' + re.escape(n) + r'(\b.*)?$', '', s, flags=re.IGNORECASE)
        s = re.sub(r'\s+' + re.escape(n) + r'(\b.*)?$', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s*,\s*\d[\w\s\-\/]*$', '', s)
    s = re.sub(r'\s+\d[\w\-\/]*$', '', s)
    return s.strip()

def _montar_texto_endereco(m):
    return (
        f"A: {m.get('A', '')} - "
        f"B: {m.get('B', '')} - "
        f"C: {m.get('C', '')} - "
        f"D: {m.get('D', '')} - "
        f"E: {m.get('E', '')} - "
        f"F: {m.get('F', '')} - "
        f"G: {m.get('G', '')} - "
        f"H: {m.get('H', '')}"
    )

class FetchAddressAPIView(View):
    """
    Busca o endereço na API externa usando o CPF.
    """
    def get(self, request, cpf):
        api_key = os.getenv('END_API_KEY')
        if not api_key:
            return JsonResponse({'error': 'A chave da API não está configurada no servidor.'}, status=500)

        url = f'https://nowlex-mini-erp-api.onrender.com/api/clientes/cpf/{cpf}?contracts=true'
        headers = {'X-API-Key': api_key}
        
        try:
            res = requests.get(url, headers=headers, timeout=10)
            res.raise_for_status()

            payload = res.json()
            d = payload.get('data', {})

            rua_raw = d.get('endereco_rua', '')
            num = d.get('endereco_numero', '')
            uf = (d.get('endereco_uf', '') or '').upper()
            cep = _format_cep(d.get('endereco_cep', ''))
            
            map_data = {
                'A': _clean_street_name(rua_raw, num),
                'B': num,
                'C': d.get('endereco_complemento', ''),
                'D': d.get('endereco_bairro', ''),
                'E': d.get('endereco_cidade', ''),
                'F': _uf_to_nome(uf),
                'G': cep,
                'H': uf
            }

            endereco_formatado = _montar_texto_endereco(map_data)
            return JsonResponse({'endereco_formatado': endereco_formatado})

        except requests.exceptions.HTTPError as e:
            if e.response.status_code in [401, 403]:
                return JsonResponse({'error': 'Acesso negado pela API de endereços.'}, status=403)
            if e.response.status_code == 404:
                return JsonResponse({'error': 'CPF não encontrado na API de endereços.'}, status=404)
            return JsonResponse({'error': f'Erro na API externa: {e.response.status_code}'}, status=500)
        except requests.exceptions.RequestException as e:
            return JsonResponse({'error': f'Erro de conexão com a API de endereços: {e}'}, status=500)

class SaveManualAddressAPIView(View):
    """
    Salva o endereço fornecido manualmente e replica para outros processos com o mesmo CPF.
    """
    def post(self, request, *args, **kwargs):
        try:
            data = json.loads(request.body)
            cpf = data.get('cpf', '').replace('.', '').replace('-', '')
            if not cpf:
                return JsonResponse({'error': 'CPF não fornecido.'}, status=400)

            # Limpa e formata os dados do formulário
            uf = (data.get('H', '') or '').upper()[:2]
            cep = _format_cep(data.get('G', ''))

            map_data = {
                'A': data.get('A', ''),
                'B': data.get('B', ''),
                'C': data.get('C', ''),
                'D': data.get('D', ''),
                'E': data.get('E', ''),
                'F': data.get('F', ''),
                'G': cep,
                'H': uf
            }
            
            endereco_formatado = _montar_texto_endereco(map_data)

            # Encontra os IDs dos processos que têm uma parte com o CPF fornecido
            processos_ids = Parte.objects.filter(documento=cpf).values_list('processo_id', flat=True).distinct()
            
            # Atualiza todos os processos encontrados
            updated_count = ProcessoJudicial.objects.filter(id__in=processos_ids).update(endereco=endereco_formatado)

            if updated_count > 0:
                message = f'Endereço atualizado para {updated_count} processo(s) com este CPF.'
            else:
                message = 'Endereço salvo. Nenhum processo encontrado com este CPF para replicação.'

            return JsonResponse({'message': message, 'endereco_formatado': endereco_formatado})
        
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Dados inválidos.'}, status=400)
        except Exception as e:
            return JsonResponse({'error': f'Ocorreu um erro interno: {e}'}, status=500)


class BuscarDadosEscavadorView(View):
    """
    Busca os dados de um processo na API do Escavador usando o número CNJ.
    """
    def get(self, request, numero_cnj):
        api_key = os.getenv('ESCAVADOR_API_TOKEN')
        if not api_key:
            return JsonResponse({'status': 'error', 'message': 'A chave da API do Escavador não está configurada no servidor.'}, status=500)

        url = f'https://api.escavador.com/api/v2/processos/numero_cnj/{numero_cnj}'
        headers = {'Authorization': f'Bearer {api_key}'}
        
        try:
            res = requests.get(url, headers=headers, timeout=15)
            res.raise_for_status()
            
            escavador_data = res.json()

            processo_data = {}
            partes_data = []
            andamentos_data = []

            if escavador_data:
                primeira_fonte = escavador_data.get('fontes', [{}])[0]
                capa_fonte = primeira_fonte.get('capa', {})
                tribunal_fonte = primeira_fonte.get('tribunal', {})

                processo_data = {
                    'numero_cnj': escavador_data.get('numero_cnj'),
                    'uf': escavador_data.get('estado_origem', {}).get('sigla'),
                    'vara': capa_fonte.get('orgao_julgador'),
                    'tribunal': tribunal_fonte.get('sigla'),
                    'valor_causa': capa_fonte.get('valor_causa', {}).get('valor'),
                    'status_id': capa_fonte.get('classe') or 'DESCONHECIDO',
                    'status_nome': capa_fonte.get('classe') or 'DESCONHECIDO',
                }

                # Utiliza um dicionário para desduplicar as partes pelo nome
                partes_encontradas = {}

                for fonte in escavador_data.get('fontes', []):
                    for envolvido in fonte.get('envolvidos', []):
                        polo_escavador = envolvido.get('polo', '').upper()
                        nome_envolvido = envolvido.get('nome')

                        # Se o envolvido não tem nome, ou já foi adicionado, pula
                        if not nome_envolvido or nome_envolvido in partes_encontradas:
                            continue

                        # Mapeia polo ATIVO ou PASSIVO. Ignora outros por enquanto para evitar ruído.
                        tipo_polo_django = None
                        if polo_escavador == 'ATIVO':
                            tipo_polo_django = 'ATIVO'
                        elif polo_escavador == 'PASSIVO':
                            tipo_polo_django = 'PASSIVO'

                        if tipo_polo_django:
                            documento = envolvido.get('cpf') or envolvido.get('cnpj')
                            
                            partes_encontradas[nome_envolvido] = {
                                'nome': nome_envolvido,
                                'tipo_polo': tipo_polo_django,
                                'tipo_pessoa': envolvido.get('tipo_pessoa'),
                                'documento': documento,
                                'endereco': ''
                            }
                
                partes_data = list(partes_encontradas.values())

                # Andamentos processuais
                andamentos_data = []
                for fonte in escavador_data.get('fontes', []):
                    fonte_nome = fonte.get('fonte', {}).get('nome')
                    for mov in fonte.get('movimentacoes', []):
                        data_raw = mov.get('data')
                        data_iso = None
                        if data_raw:
                            try:
                                data_iso = datetime.fromisoformat(data_raw).isoformat()
                            except ValueError:
                                # Mantém o valor bruto caso o formato seja diferente
                                data_iso = data_raw

                        andamentos_data.append({
                            'data': data_iso,
                            'descricao': mov.get('conteudo') or mov.get('titulo'),
                            'detalhes': fonte_nome,
                        })

            return JsonResponse({
                'status': 'success',
                'message': 'Dados obtidos com sucesso!',
                'processo': processo_data,
                'partes': partes_data,
                'andamentos': andamentos_data
            })

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                return JsonResponse({'status': 'error', 'message': 'Processo não encontrado no Escavador.'}, status=404)
            return JsonResponse({'status': 'error', 'message': f'Erro na API do Escavador: {e.response.status_code}'}, status=500)
        except requests.exceptions.RequestException as e:
            return JsonResponse({'status': 'error', 'message': f'Erro de conexão com a API do Escavador: {e}'}, status=500)
