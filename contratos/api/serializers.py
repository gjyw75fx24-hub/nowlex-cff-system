from rest_framework import serializers
from django.contrib.auth.models import User
from django.urls import reverse
from ..models import (
    Tarefa,
    Prazo,
    ListaDeTarefas,
    TarefaMensagem,
    PrazoMensagem,
    ProcessoArquivo,
    TarefaNotificacao,
)

class UserSerializer(serializers.ModelSerializer):
    pending_tasks = serializers.IntegerField(read_only=True, default=0)
    pending_prazos = serializers.IntegerField(read_only=True, default=0)
    completed_tasks = serializers.IntegerField(read_only=True, default=0)
    completed_prazos = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'first_name',
            'last_name',
            'pending_tasks',
            'pending_prazos',
            'completed_tasks',
            'completed_prazos',
        ]

class ListaDeTarefasSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListaDeTarefas
        fields = ['id', 'nome']

class TarefaSerializer(serializers.ModelSerializer):
    responsavel = UserSerializer(read_only=True)
    lista = ListaDeTarefasSerializer(read_only=True)
    prioridade_display = serializers.CharField(source='get_prioridade_display', read_only=True)
    admin_url = serializers.SerializerMethodField()

    class Meta:
        model = Tarefa
        fields = [
            'id',
            'descricao',
            'lista',
            'data',
            'data_origem',
            'responsavel',
            'prioridade',
            'prioridade_display',
            'concluida',
            'observacoes',
            'admin_url',
            'processo_id',
        ]

    def get_admin_url(self, obj):
        try:
            return reverse('admin:contratos_processojudicial_change', args=[obj.processo_id])
        except Exception:
            return ''

class PrazoSerializer(serializers.ModelSerializer):
    responsavel = UserSerializer(read_only=True)
    alerta_unidade_display = serializers.CharField(source='get_alerta_unidade_display', read_only=True)
    admin_url = serializers.SerializerMethodField()

    class Meta:
        model = Prazo
        fields = [
            'id',
            'titulo',
            'data_limite',
            'data_limite_origem',
            'alerta_valor',
            'alerta_unidade',
            'alerta_unidade_display',
            'responsavel',
            'observacoes',
            'concluido',
            'admin_url',
            'processo_id',
        ]

    def get_admin_url(self, obj):
        try:
            return reverse('admin:contratos_processojudicial_change', args=[obj.processo_id])
        except Exception:
            return ''


class ProcessoArquivoSerializer(serializers.ModelSerializer):
    arquivo_url = serializers.SerializerMethodField()

    class Meta:
        model = ProcessoArquivo
        fields = ['id', 'nome', 'arquivo_url', 'criado_em']

    def get_arquivo_url(self, obj):
        if obj.arquivo:
            request = self.context.get('request')
            url = obj.arquivo.url
            if request and url.startswith('/'):
                return request.build_absolute_uri(url)
            return url
        return ''


class TarefaMensagemSerializer(serializers.ModelSerializer):
    autor = UserSerializer(read_only=True)
    anexos = ProcessoArquivoSerializer(many=True, read_only=True, default=[])

    class Meta:
        model = TarefaMensagem
        fields = ['id', 'texto', 'autor', 'criado_em', 'anexos']


class PrazoMensagemSerializer(serializers.ModelSerializer):
    autor = UserSerializer(read_only=True)
    anexos = ProcessoArquivoSerializer(many=True, read_only=True, default=[])

    class Meta:
        model = PrazoMensagem
        fields = ['id', 'texto', 'autor', 'criado_em', 'anexos']


class TarefaNotificacaoSerializer(serializers.ModelSerializer):
    tarefa_id = serializers.IntegerField(source='tarefa.id', read_only=True)
    descricao = serializers.CharField(source='tarefa.descricao', read_only=True)
    data = serializers.DateField(source='tarefa.data', read_only=True)
    processo_id = serializers.IntegerField(source='tarefa.processo_id', read_only=True)
    processo_cnj = serializers.CharField(source='tarefa.processo.cnj', read_only=True, default='')
    criado_por = serializers.SerializerMethodField()

    class Meta:
        model = TarefaNotificacao
        fields = [
            'id',
            'tarefa_id',
            'descricao',
            'data',
            'processo_id',
            'processo_cnj',
            'criado_por',
            'criada_em',
        ]

    def get_criado_por(self, obj):
        autor = getattr(obj.tarefa, 'criado_por', None)
        if not autor:
            return ''
        full_name = (autor.get_full_name() or '').strip()
        return full_name or autor.username or ''
