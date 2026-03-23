from rest_framework import serializers
from django.contrib.auth.models import User
from django.urls import reverse
from ..models import (
    Tarefa,
    Prazo,
    ListaDeTarefas,
    ListaDeTarefasArquivoConfig,
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
    arquivos_configurados = serializers.SerializerMethodField()

    class Meta:
        model = ListaDeTarefas
        fields = ['id', 'nome', 'automacao_tipo', 'arquivos_configurados']

    def get_arquivos_configurados(self, obj):
        arquivos = getattr(obj, 'arquivos_configurados', None)
        if arquivos is None:
            queryset = obj.arquivos_configurados.filter(ativo=True).order_by('ordem', 'id')
        else:
            queryset = [
                arquivo for arquivo in arquivos.all()
                if getattr(arquivo, 'ativo', False)
            ]
        return ListaDeTarefasArquivoConfigSerializer(queryset, many=True).data


class ListaDeTarefasArquivoConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListaDeTarefasArquivoConfig
        fields = ['id', 'nome', 'nome_coluna', 'padrao_nome', 'ordem']

class TarefaSerializer(serializers.ModelSerializer):
    responsavel = UserSerializer(read_only=True)
    lista = ListaDeTarefasSerializer(read_only=True)
    prioridade_display = serializers.CharField(source='get_prioridade_display', read_only=True)
    admin_url = serializers.SerializerMethodField()
    display_title = serializers.SerializerMethodField()

    class Meta:
        model = Tarefa
        fields = [
            'id',
            'descricao',
            'display_title',
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

    def get_display_title(self, obj):
        lista = getattr(obj, 'lista', None)
        if lista and getattr(lista, 'automacao_tipo', '') == ListaDeTarefas.AUTOMACAO_SOLICITACAO_ARQUIVOS_MASSA:
            return 'Solicitação de Arquivos'
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
    item_tipo = serializers.SerializerMethodField()
    item_id = serializers.SerializerMethodField()
    tarefa_id = serializers.SerializerMethodField()
    prazo_id = serializers.SerializerMethodField()
    tipo = serializers.CharField(read_only=True)
    titulo = serializers.SerializerMethodField()
    descricao = serializers.SerializerMethodField()
    data = serializers.SerializerMethodField()
    processo_id = serializers.SerializerMethodField()
    processo_cnj = serializers.SerializerMethodField()
    autor_nome = serializers.SerializerMethodField()
    justificativa = serializers.CharField(read_only=True)

    class Meta:
        model = TarefaNotificacao
        fields = [
            'id',
            'item_tipo',
            'item_id',
            'tarefa_id',
            'prazo_id',
            'tipo',
            'titulo',
            'descricao',
            'data',
            'processo_id',
            'processo_cnj',
            'autor_nome',
            'justificativa',
            'criada_em',
        ]

    def get_titulo(self, obj):
        if obj.titulo:
            return obj.titulo
        if obj.prazo_id:
            if obj.tipo == TarefaNotificacao.TIPO_DEVOLUTIVA:
                return 'Prazo solicitado atendido'
            return 'Novo prazo recebido'
        if obj.tipo == TarefaNotificacao.TIPO_DEVOLUTIVA:
            return 'Tarefa solicitada atendida'
        return 'Nova tarefa recebida'

    def get_descricao(self, obj):
        if obj.descricao:
            return obj.descricao
        descricao_item = (
            getattr(obj.tarefa, 'descricao', '') if obj.tarefa_id
            else getattr(obj.prazo, 'titulo', '')
        ) or ''
        if descricao_item:
            return descricao_item
        if obj.tipo == TarefaNotificacao.TIPO_DEVOLUTIVA:
            return 'O prazo solicitado foi atendido.' if obj.prazo_id else 'A tarefa solicitada foi atendida.'
        return 'Você recebeu um novo prazo.' if obj.prazo_id else 'Você recebeu uma nova tarefa.'

    def get_autor_nome(self, obj):
        if obj.autor_nome:
            return obj.autor_nome
        if obj.tipo == TarefaNotificacao.TIPO_DEVOLUTIVA:
            autor = getattr(obj.tarefa, 'concluido_por', None) if obj.tarefa_id else getattr(obj.prazo, 'concluido_por', None)
        else:
            autor = getattr(obj.tarefa, 'criado_por', None) if obj.tarefa_id else getattr(obj.prazo, 'criado_por', None)
        if not autor:
            return ''
        full_name = (autor.get_full_name() or '').strip()
        return full_name or autor.username or ''

    def get_item_tipo(self, obj):
        return 'P' if obj.prazo_id else 'T'

    def get_item_id(self, obj):
        return obj.prazo_id if obj.prazo_id else obj.tarefa_id

    def get_tarefa_id(self, obj):
        return obj.tarefa_id

    def get_prazo_id(self, obj):
        return obj.prazo_id

    def get_data(self, obj):
        if obj.tarefa_id:
            return getattr(obj.tarefa, 'data', None)
        data_limite = getattr(obj.prazo, 'data_limite', None)
        return data_limite.date() if data_limite else None

    def get_processo_id(self, obj):
        return getattr(obj.tarefa, 'processo_id', None) if obj.tarefa_id else getattr(obj.prazo, 'processo_id', None)

    def get_processo_cnj(self, obj):
        processo = getattr(obj.tarefa, 'processo', None) if obj.tarefa_id else getattr(obj.prazo, 'processo', None)
        return getattr(processo, 'cnj', '') or ''
