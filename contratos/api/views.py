from rest_framework import generics, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.auth.models import User
from ..models import ProcessoJudicial, Tarefa, Prazo, ListaDeTarefas
from .serializers import TarefaSerializer, PrazoSerializer, UserSerializer, ListaDeTarefasSerializer
from django.db.models import Q

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
