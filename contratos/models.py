import uuid

from django.db import models


def _generate_tipo_peticao_key():
    return str(uuid.uuid4())
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
    fonte_alias = models.CharField(
        max_length=64,
        blank=True,
        verbose_name="Fonte da Carteira",
        help_text=(
            "Alias da conexão do banco que será utilizada para importar cadastros (ex.: "
            "carteira, carteira_bcs, carteira_teste). Deixe em branco para usar a conexão padrão 'carteira'."
        ),
    )

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
    soma_contratos = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        verbose_name="Soma dos Contratos",
        editable=False
    )

    VIABILIDADE_VIAVEL = 'VIAVEL'
    VIABILIDADE_INVIAVEL = 'INVIAVEL'
    VIABILIDADE_INCONCLUSIVO = 'INCONCLUSIVO'
    VIABILIDADE_CHOICES = [
        ('', '---'),
        (VIABILIDADE_VIAVEL, 'Viável'),
        (VIABILIDADE_INVIAVEL, 'Inviável'),
        (VIABILIDADE_INCONCLUSIVO, 'Inconclusivo'),
    ]
    viabilidade = models.CharField(
        max_length=15,
        choices=VIABILIDADE_CHOICES,
        default='',
        blank=True,
        verbose_name="Viabilidade",
        help_text="Indique se o processo está financeiramente viável, inviável ou inconclusivo."
    )
    
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
            parte_passiva = self.partes_processuais.filter(tipo_polo='PASSIVO').first()
            if parte_passiva:
                return parte_passiva.nome
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
    protocolado_no_tribunal = models.BooleanField(
        default=False,
        verbose_name="Confirmado protocolo no tribunal",
        help_text="Marque para indicar que este arquivo foi protocolado no tribunal."
    )
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
    data_nascimento = models.DateField(
        blank=True,
        null=True,
        verbose_name="Data de Nascimento"
    )
    endereco = models.TextField(blank=True, null=True, verbose_name="Endereço")
    advogados_info = models.TextField(
        blank=True,
        null=True,
        verbose_name="Informações dos Advogados"
    )
    obito = models.BooleanField(default=False, verbose_name="Óbito")

    def __str__(self):
        return self.nome

    class Meta:
        ordering = ['tipo_polo', 'id']


class Herdeiro(models.Model):
    cpf_falecido = models.CharField(max_length=20, db_index=True, verbose_name="CPF falecido")
    nome_completo = models.CharField(max_length=255, verbose_name="Nome completo")
    cpf = models.CharField(max_length=20, blank=True, null=True, verbose_name="CPF")
    rg = models.CharField(max_length=20, blank=True, null=True, verbose_name="RG")
    grau_parentesco = models.CharField(max_length=80, blank=True, null=True, verbose_name="Grau de parentesco")
    herdeiro_citado = models.BooleanField(default=False, verbose_name="Herdeiro citado")
    endereco = models.TextField(blank=True, null=True, verbose_name="Endereço")
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name="Criado em")
    atualizado_em = models.DateTimeField(auto_now=True, verbose_name="Atualizado em")

    class Meta:
        verbose_name = "Herdeiro"
        verbose_name_plural = "Herdeiros"
        ordering = ['-herdeiro_citado', 'id']

    def __str__(self):
        return self.nome_completo

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
        HABILITACAO = 'habilitacao', 'Habilitação'

    slug = models.CharField(
        max_length=50,
        unique=True,
        verbose_name="Chave",
        help_text=(
            "Identificador usado no backend para localizar o modelo. "
            "Valores padrão: monitoria_inicial, cobranca_judicial, habilitacao (adicione outros conforme necessário)."
        )
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


class TipoPeticao(models.Model):
    key = models.CharField(
        max_length=36,
        editable=False,
        default=_generate_tipo_peticao_key,
        db_index=True,
        verbose_name="Chave única"
    )
    nome = models.CharField(max_length=150, verbose_name="Nome da Petição")
    ordem = models.PositiveIntegerField(default=0, verbose_name="Ordem")
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name="Criado em")

    class Meta:
        verbose_name = "Tipo de Petição"
        verbose_name_plural = "Tipos de Petição"
        ordering = ['ordem', 'id']

    def __str__(self):
        return self.nome


class ComboDocumentoPattern(models.Model):
    CATEGORIA_FIXO = 'FIXO'
    CATEGORIA_CONTRATO = 'CONTRATO'
    CATEGORIA_ANEXO = 'ANEXO'
    CATEGORIA_CHOICES = (
        (CATEGORIA_FIXO, 'Fixo/Obrigatório'),
        (CATEGORIA_CONTRATO, 'Por contrato'),
        (CATEGORIA_ANEXO, 'Anexo opcional'),
    )

    tipo_peticao = models.ForeignKey(
        TipoPeticao,
        on_delete=models.CASCADE,
        related_name='combo_patterns'
    )
    categoria = models.CharField(
        max_length=10,
        choices=CATEGORIA_CHOICES,
        default=CATEGORIA_FIXO,
        verbose_name="Categoria"
    )
    ordem = models.PositiveIntegerField(default=0, verbose_name="Ordem")
    label_template = models.CharField(
        max_length=255,
        verbose_name="Rótulo esperado",
        help_text="Use 'xxxxxxxxx' para o placeholder de contrato."
    )
    keywords = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Palavras-chave",
        help_text="Palavras que devem estar no nome do arquivo (case-insensitive)."
    )
    placeholder = models.CharField(
        max_length=32,
        default='xxxxxxxxx',
        blank=True,
        verbose_name="Placeholder de contrato"
    )
    obrigatorio = models.BooleanField(
        default=True,
        verbose_name="Obrigatório",
        help_text="Define se a ausência gera item em 'faltantes'."
    )

    class Meta:
        verbose_name = "Configuração de documento para o combo"
        verbose_name_plural = "Configurações de combo"
        ordering = ['tipo_peticao', 'categoria', 'ordem']

    def __str__(self):
        return f"{self.tipo_peticao.nome} › {self.get_categoria_display()} ({self.label_template})"


def peticao_zip_upload_path(instance, filename):
    processo_id = instance.processo_id or 'novo'
    return f'processos/{processo_id}/peticoes/{filename}'


class ZipGerado(models.Model):
    tipo_peticao = models.ForeignKey(
        TipoPeticao,
        on_delete=models.PROTECT,
        related_name='zips_gerados'
    )
    processo = models.ForeignKey(
        ProcessoJudicial,
        on_delete=models.CASCADE,
        related_name='zips_peticao'
    )
    arquivo_base = models.ForeignKey(
        ProcessoArquivo,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='zips_gerados'
    )
    zip_file = models.FileField(
        upload_to=peticao_zip_upload_path,
        verbose_name="Arquivo ZIP"
    )
    missing = models.JSONField(default=list, blank=True)
    contratos = models.JSONField(default=list, blank=True)
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "ZIP gerado para petição"
        verbose_name_plural = "ZIPs gerados para petições"
        ordering = ['-criado_em']

    def __str__(self):
        return self.zip_file.name.split('/')[-1]


class TipoPeticaoAnexoContinua(models.Model):
    tipo_peticao = models.ForeignKey(
        TipoPeticao,
        on_delete=models.CASCADE,
        related_name='anexos_continuos'
    )
    arquivo = models.FileField(
        upload_to='peticoes/anexos_continuos/',
        verbose_name='Arquivo do combo'
    )
    nome = models.CharField(
        max_length=255,
        blank=True,
        verbose_name='Nome exibido'
    )
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name='Criado em')

    class Meta:
        verbose_name = 'Anexo contínuo'
        verbose_name_plural = 'Anexos contínuos'
        ordering = ['-criado_em']

    def __str__(self):
        label = self.nome or self.arquivo.name
        return f"{self.tipo_peticao.nome} › {label}"


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
    data_origem = models.DateField(blank=True, null=True, verbose_name="Data de origem")
    responsavel = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='tarefas_responsaveis')
    prioridade = models.CharField(max_length=1, choices=PRIORIDADE_CHOICES, default='M')
    concluida = models.BooleanField(default=False)
    observacoes = models.TextField(blank=True, null=True, verbose_name="Observações")

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
    data_limite_origem = models.DateField(blank=True, null=True, verbose_name="Data limite de origem")
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
    para_supervisionar = models.BooleanField(
        default=False,
        verbose_name="Marcar para Supervisionar",
        help_text="Ativo quando algum processo vinculado estiver marcado para supervisão."
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

    def save(self, *args, **kwargs):
        self.para_supervisionar = self._respostas_requerem_supervisao()
        super().save(*args, **kwargs)

    def _respostas_requerem_supervisao(self):
        respostas = getattr(self, 'respostas', {}) or {}
        for key in ('processos_vinculados', 'saved_processos_vinculados'):
            entries = respostas.get(key)
            if not entries or not isinstance(entries, list):
                continue
            for item in entries:
                if isinstance(item, dict) and item.get('supervisionado'):
                    return True
        return False
