from rest_framework import generics, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.auth.models import User
from ..models import ProcessoJudicial, Tarefa, Prazo, ListaDeTarefas
from .serializers import TarefaSerializer, PrazoSerializer, UserSerializer, ListaDeTarefasSerializer
from django.db.models import Q

# Imports adicionados para as novas views
import requests
import os
import re
from django.http import JsonResponse
from django.views import View
import json

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
                'G': f"CEP: {cep}" if cep else '',
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
                'G': f"CEP: {cep}" if cep else '',
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
