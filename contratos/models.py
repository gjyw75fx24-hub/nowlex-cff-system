from django.db import models
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
import datetime


class Etiqueta(models.Model):
    nome = models.CharField(max_length=50, unique=True, verbose_name="Nome")
    cor_fundo = models.CharField(max_length=7, default="#417690", verbose_name="Cor de Fundo")
    cor_fonte = models.CharField(max_length=7, default="#FFFFFF", verbose_name="Cor da Fonte")
    ordem = models.PositiveIntegerField(default=1, verbose_name="Ordem")

    class Meta:
        verbose_name = "Etiqueta"
        verbose_name_plural = "Etiquetas"
        ordering = ['ordem', 'nome']

    def __str__(self):
        return self.nome

class Carteira(models.Model):
    nome = models.CharField(max_length=100, unique=True, verbose_name="Nome da Carteira")

    class Meta:
        verbose_name = "Carteira"
        verbose_name_plural = "Carteiras"
        ordering = ['nome']

    def __str__(self):
        return self.nome

class StatusProcessual(models.Model):
    nome = models.CharField(max_length=100, unique=True, verbose_name="Nome do Status")
    ordem = models.PositiveIntegerField(default=1, verbose_name="Ordem")
    ativo = models.BooleanField(default=True, verbose_name="Ativo")

    class Meta:
        verbose_name = "Classe Processual"
        verbose_name_plural = "Classes Processuais"
        ordering = ['ordem', 'nome']

    def __str__(self):
        return self.nome

class ProcessoJudicial(models.Model):
    cnj = models.CharField(max_length=30, null=True, blank=True, verbose_name="Número CNJ", db_index=True)
    nao_judicializado = models.BooleanField(default=True, editable=False, verbose_name="Não Judicializado")
    uf = models.CharField(max_length=2, blank=True, verbose_name="UF")
    vara = models.CharField(max_length=255, verbose_name="Vara", blank=True, null=True)
    tribunal = models.CharField(max_length=50, blank=True, verbose_name="Tribunal")
    valor_causa = models.DecimalField(max_digits=14, decimal_places=2, verbose_name="Valor da Causa", blank=True, null=True)
    
    status = models.ForeignKey(
        StatusProcessual,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Classe Processual"
    )
    
    carteira = models.ForeignKey(
        Carteira,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Carteira",
        related_name='processos'
    )

    etiquetas = models.ManyToManyField(
        'Etiqueta',
        blank=True,
        verbose_name="Etiquetas"
    )

    # 🔽 CAMPO ADICIONADO PARA CONTROLE DA BUSCA ATIVA
    busca_ativa = models.BooleanField(
        default=False,
        verbose_name="Busca Ativa",
        help_text="Se marcado, o sistema buscará andamentos para este processo automaticamente."
    )

    delegado_para = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='processos_delegados',
        verbose_name="Delegado Para"
    )

    def save(self, *args, **kwargs):
        if self.cnj and self.cnj.strip():
            self.nao_judicializado = False
        else:
            self.nao_judicializado = True
        super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        if self.cnj:
            qs = ProcessoJudicial.objects.filter(cnj=self.cnj)
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            if qs.exists():
                raise ValidationError({'cnj': 'Já existe um processo com este número CNJ.'})

    def __str__(self):
        if self.cnj:
            return self.cnj
        
        if self.pk:
            parte_principal = self.partes_processuais.first()
            if parte_principal:
                return f"Cadastro de {parte_principal.nome} (ID: {self.pk})"
            return f"Cadastro Simplificado #{self.pk}"
            
        return "Novo Cadastro"

# 🔽 NOVO MODELO PARA ARMAZENAR ANDAMENTOS
class AndamentoProcessual(models.Model):
    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='andamentos')
    data = models.DateTimeField(verbose_name="Data do Andamento")
    descricao = models.TextField(verbose_name="Descrição")
    detalhes = models.TextField(blank=True, null=True, verbose_name="Observações")

    class Meta:
        verbose_name = "Andamento Processual"
        verbose_name_plural = "Andamentos Processuais"
        ordering = ['-data'] # Mostra os mais recentes primeiro
        unique_together = ('processo', 'data', 'descricao')

    def __str__(self):
        return f"Andamento de {self.data.strftime('%d/%m/%Y')} em {self.processo.cnj}"


def processo_arquivo_upload_path(instance, filename):
    processo_id = instance.processo_id or 'novo'
    return f'processos/{processo_id}/pasta/{filename}'


class ProcessoArquivo(models.Model):
    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='arquivos')
    nome = models.CharField(max_length=255, blank=True, verbose_name="Nome do arquivo")
    arquivo = models.FileField(upload_to=processo_arquivo_upload_path, verbose_name="Arquivo")
    enviado_por = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Enviado por")
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name="Criado em")

    class Meta:
        verbose_name = "Arquivo"
        verbose_name_plural = "Arquivos"
        ordering = ['-criado_em']

    def save(self, *args, **kwargs):
        if not self.nome and self.arquivo:
            self.nome = self.arquivo.name.split('/')[-1]
        super().save(*args, **kwargs)

    def __str__(self):
        return self.nome or f"Arquivo #{self.pk}"


class Parte(models.Model):
    TIPO_POLO_CHOICES = [('ATIVO', 'Polo Ativo'), ('PASSIVO', 'Polo Passivo')]
    TIPO_PESSOA_CHOICES = [('PF', 'Pessoa Física'), ('PJ', 'Pessoa Jurídica')]

    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='partes_processuais')
    tipo_polo = models.CharField(max_length=7, choices=TIPO_POLO_CHOICES, verbose_name="Tipo de Polo")
    nome = models.CharField(max_length=255, verbose_name="Nome / Razão Social")
    tipo_pessoa = models.CharField(max_length=2, choices=TIPO_PESSOA_CHOICES, verbose_name="Tipo de Pessoa")
    documento = models.CharField(max_length=20, verbose_name="CPF / CNPJ")
    endereco = models.TextField(blank=True, null=True, verbose_name="Endereço")
    advogados_info = models.TextField(
        blank=True,
        null=True,
        verbose_name="Informações dos Advogados"
    )

    def __str__(self):
        return self.nome

    class Meta:
        ordering = ['tipo_polo', 'id']

class Advogado(models.Model):
    parte = models.ForeignKey(Parte, on_delete=models.CASCADE, related_name='advogados')
    nome = models.CharField(max_length=255, verbose_name="Nome")
    cpf = models.CharField(max_length=14, blank=True, null=True, verbose_name="CPF")
    numero_oab = models.CharField(max_length=20, verbose_name="Número OAB")
    uf_oab = models.CharField(max_length=2, verbose_name="UF OAB")

    def __str__(self):
        return self.nome


class AdvogadoPassivo(models.Model):
    class AcordoChoices(models.TextChoices):
        PROPOR = 'PROPOR', 'Propor'
        PROPOSTO = 'PROPOSTO', 'Proposto'
        FIRMADO = 'FIRMADO', 'Firmado'
        RECUSADO = 'RECUSADO', 'Recusado'

    UF_CHOICES = [
        ('AC', 'AC'), ('AL', 'AL'), ('AP', 'AP'), ('AM', 'AM'), ('BA', 'BA'),
        ('CE', 'CE'), ('DF', 'DF'), ('ES', 'ES'), ('GO', 'GO'), ('MA', 'MA'),
        ('MT', 'MT'), ('MS', 'MS'), ('MG', 'MG'), ('PA', 'PA'), ('PB', 'PB'),
        ('PR', 'PR'), ('PE', 'PE'), ('PI', 'PI'), ('RJ', 'RJ'), ('RN', 'RN'),
        ('RS', 'RS'), ('RO', 'RO'), ('RR', 'RR'), ('SC', 'SC'), ('SP', 'SP'),
        ('SE', 'SE'), ('TO', 'TO'),
    ]

    processo = models.ForeignKey(
        ProcessoJudicial,
        on_delete=models.CASCADE,
        related_name='advogados_passivos'
    )
    responsavel = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Responsável pelo contato"
    )
    nome = models.CharField(max_length=255, verbose_name="Nome completo")
    uf_oab = models.CharField(max_length=2, choices=UF_CHOICES, verbose_name="UF da OAB")
    oab_numero = models.CharField(max_length=10, verbose_name="Número da OAB")
    email = models.EmailField(blank=True, null=True, verbose_name="E-mail")
    telefone = models.CharField(max_length=20, blank=True, null=True, verbose_name="Telefone")
    acordo_status = models.CharField(
        max_length=10,
        choices=AcordoChoices.choices,
        blank=True,
        verbose_name="Acordo"
    )
    valor_acordado = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Valor Acordado"
    )
    observacao = models.TextField(blank=True, null=True, verbose_name="Observação")
    agendar_ligacao_em = models.DateTimeField(blank=True, null=True, verbose_name="Agendar ligação em")
    lembrete_enviado = models.BooleanField(default=False, verbose_name="Lembrete enviado")

    class Meta:
        verbose_name = "Advogado da Parte Passiva"
        verbose_name_plural = "Advogados da Parte Passiva"
        ordering = ['nome']

    def __str__(self):
        return self.nome

class Contrato(models.Model):
    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='contratos')
    numero_contrato = models.CharField(max_length=50, verbose_name="Número do Contrato", blank=True, null=True)
    valor_total_devido = models.DecimalField(max_digits=14, decimal_places=2, verbose_name="Valor Total Devido", blank=True, null=True)
    valor_causa = models.DecimalField("Valor da Causa", max_digits=14, decimal_places=2, null=True, blank=True)
    parcelas_em_aberto = models.IntegerField(verbose_name="Parcelas em Aberto", blank=True, null=True)
    data_prescricao = models.DateField(verbose_name="Data de Prescrição", blank=True, null=True)

    @property
    def is_prescrito(self):
        from django.utils import timezone
        if not self.data_prescricao:
            return False
        return self.data_prescricao < timezone.now().date()

    def __str__(self):
        return self.numero_contrato if self.numero_contrato else f"Contrato do processo {self.processo.cnj}"


class DocumentoModelo(models.Model):
    class SlugChoices(models.TextChoices):
        MONITORIA_INICIAL = 'monitoria_inicial', 'Monitoria Inicial'
        COBRANCA_JUDICIAL = 'cobranca_judicial', 'Cobrança Judicial'

    slug = models.CharField(
        max_length=50,
        unique=True,
        choices=SlugChoices.choices,
        verbose_name="Chave",
        help_text="Identificador usado no backend para localizar o modelo."
    )
    nome = models.CharField(max_length=150, verbose_name="Nome exibido")
    arquivo = models.FileField(
        upload_to='documentos_modelo/',
        verbose_name="Arquivo DOCX",
        help_text="Envie o arquivo .docx que servirá como minuta."
    )
    descricao = models.TextField(
        blank=True,
        verbose_name="Orientações",
        help_text="Informações extras sobre placeholders ou variantes."
    )
    atualizado_em = models.DateTimeField(auto_now=True, verbose_name="Última atualização")

    class Meta:
        verbose_name = "Documento Modelo"
        verbose_name_plural = "Documentos Modelo"
        ordering = ['slug', 'nome']

    def __str__(self):
        return self.nome


class ParteProcessoAdvogado(models.Model):
    parte = models.ForeignKey(Parte, on_delete=models.CASCADE)
    advogado = models.ForeignKey(Advogado, on_delete=models.CASCADE)

    class Meta:
        unique_together = ('parte', 'advogado')
        verbose_name = "Relação Parte-Advogado"
        verbose_name_plural = "Relações Parte-Advogado"

    def __str__(self):
        return f"{self.parte.nome} - {self.advogado.nome}"

class AndamentoProcessualAdvogado(models.Model):
    andamento = models.ForeignKey(AndamentoProcessual, on_delete=models.CASCADE)
    advogado = models.ForeignKey(Advogado, on_delete=models.CASCADE)

    class Meta:
        unique_together = ('andamento', 'advogado')
        verbose_name = "Relação Andamento-Advogado"
        verbose_name_plural = "Relações Andamento-Advogado"

    def __str__(self):
        return f"Andamento de {self.andamento.id} - Advogado {self.advogado.nome}"

# --- Modelos de Tarefas e Prazos ---

class ListaDeTarefas(models.Model):
    nome = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.nome

    class Meta:
        verbose_name = "Lista de Tarefas"
        verbose_name_plural = "Listas de Tarefas"
        ordering = ['nome']

class Tarefa(models.Model):
    PRIORIDADE_CHOICES = [
        ('B', 'Baixa'),
        ('M', 'Média'),
        ('A', 'Alta'),
    ]

    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='tarefas')
    descricao = models.CharField(max_length=255, verbose_name="Descrição")
    lista = models.ForeignKey(ListaDeTarefas, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Lista")
    data = models.DateField(verbose_name="Data")
    responsavel = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='tarefas_responsaveis')
    prioridade = models.CharField(max_length=1, choices=PRIORIDADE_CHOICES, default='M')
    concluida = models.BooleanField(default=False)

    def __str__(self):
        return self.descricao

    class Meta:
        verbose_name = "Tarefa"
        verbose_name_plural = "Tarefas"
        ordering = ['-data']

class Prazo(models.Model):
    ALERTA_UNIDADE_CHOICES = [
        ('D', 'Dias antes'),
        ('H', 'Horas antes'),
    ]

    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='prazos')
    titulo = models.CharField(max_length=255, verbose_name="Título")
    data_limite = models.DateTimeField(verbose_name="Data Limite")
    alerta_valor = models.PositiveIntegerField(default=1, verbose_name="Alerta")
    alerta_unidade = models.CharField(max_length=1, choices=ALERTA_UNIDADE_CHOICES, default='D')
    responsavel = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='prazos_responsaveis')
    observacoes = models.TextField(blank=True, null=True)
    concluido = models.BooleanField(default=False)

    def __str__(self):
        return self.titulo


class BuscaAtivaConfig(models.Model):
    horario = models.TimeField(default=datetime.time(3, 0), verbose_name="Horário diário")
    habilitado = models.BooleanField(default=True, verbose_name="Busca ativa habilitada")
    ultima_execucao = models.DateTimeField(null=True, blank=True, verbose_name="Última execução")

    class Meta:
        verbose_name = "Configuração de Busca Ativa"
        verbose_name_plural = "Configuração de Busca Ativa"

    def save(self, *args, **kwargs):
        # Garante apenas um registro (singleton simples)
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Configuração de Busca Ativa"


# --- Modelos para o Motor da Árvore de Decisão de Análise ---

class QuestaoAnalise(models.Model):
    TIPO_CAMPO_CHOICES = [
        ('OPCOES', 'Opções (dropdown)'),
        ('TEXTO', 'Texto Curto'),
        ('TEXTO_LONGO', 'Texto Longo (observações)'),
        ('DATA', 'Data'),
        ('PROCESSO_VINCULADO', 'Interface de Processos Vinculados'),
        ('CONTRATOS_MONITORIA', 'Seleção de Contratos para Monitória'),
    ]
    
    texto_pergunta = models.CharField(max_length=255, verbose_name="Texto da Pergunta/Critério")
    chave = models.CharField(max_length=50, unique=True, blank=True, null=True, verbose_name="Chave de Referência (Slug)")
    tipo_campo = models.CharField(max_length=20, choices=TIPO_CAMPO_CHOICES, default='OPCOES', verbose_name="Tipo de Campo de Resposta")
    is_primeira_questao = models.BooleanField(
        default=False, 
        verbose_name="É a primeira questão da análise?",
        help_text="Marque apenas uma questão como a primeira. Será o ponto de partida da árvore."
    )
    ordem = models.PositiveIntegerField(default=10, verbose_name="Ordem de Exibição")

    class Meta:
        verbose_name = "Questão da Análise"
        verbose_name_plural = "1. Questões da Análise"
        ordering = ['ordem', 'texto_pergunta']

    def __str__(self):
        return self.texto_pergunta

class OpcaoResposta(models.Model):
    questao_origem = models.ForeignKey(
        'QuestaoAnalise', 
        on_delete=models.CASCADE, 
        related_name='opcoes',
        verbose_name="Questão de Origem"
    )
    texto_resposta = models.CharField(max_length=255, verbose_name="Texto da Opção de Resposta")
    proxima_questao = models.ForeignKey(
        'QuestaoAnalise',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='veio_de_opcao',
        verbose_name="Próxima Questão (se esta opção for escolhida)"
    )
    
    class Meta:
        verbose_name = "Opção de Resposta"
        verbose_name_plural = "2. Opções de Respostas"
        ordering = ['questao_origem', 'texto_resposta']

    def __str__(self):
        return f"{self.questao_origem.texto_pergunta[:30]}... -> {self.questao_origem}" # Corrigido para mostrar a origem

# --- Modelo para armazenar as respostas da Análise de Processo ---

class AnaliseProcesso(models.Model):
    processo_judicial = models.OneToOneField(
        ProcessoJudicial,
        on_delete=models.CASCADE,
        related_name='analise_processo',
        verbose_name="Processo Judicial"
    )
    respostas = models.JSONField(
        default=dict,
        verbose_name="Respostas da Análise"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Atualizado por"
    )

    class Meta:
        verbose_name = "Análise de Processo"
        verbose_name_plural = "Análises de Processos"

    def __str__(self):
        return f"Análise para {self.processo_judicial.cnj}"
