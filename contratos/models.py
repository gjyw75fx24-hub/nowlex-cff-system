from django.db import models
from django.contrib.auth.models import User


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
        verbose_name = "Status Processual"
        verbose_name_plural = "Status Processuais"
        ordering = ['ordem', 'nome']

    def __str__(self):
        return self.nome

class ProcessoJudicial(models.Model):
    cnj = models.CharField(max_length=30, unique=True, verbose_name="Número CNJ")
    uf = models.CharField(max_length=2, blank=True, verbose_name="UF")
    vara = models.CharField(max_length=255, verbose_name="Vara")
    tribunal = models.CharField(max_length=50, blank=True, verbose_name="Tribunal")
    valor_causa = models.DecimalField(max_digits=14, decimal_places=2, verbose_name="Valor da Causa")
    
    status = models.ForeignKey(
        StatusProcessual,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Status Processual"
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

    def __str__(self):
        return self.cnj

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

class Advogado(models.Model):
    parte = models.ForeignKey(Parte, on_delete=models.CASCADE, related_name='advogados')
    nome = models.CharField(max_length=255, verbose_name="Nome")
    cpf = models.CharField(max_length=14, blank=True, null=True, verbose_name="CPF")
    numero_oab = models.CharField(max_length=20, verbose_name="Número OAB")
    uf_oab = models.CharField(max_length=2, verbose_name="UF OAB")

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

    class Meta:
        verbose_name = "Prazo"
        verbose_name_plural = "Prazos"
        ordering = ['data_limite']