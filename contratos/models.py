import os
import re
import unicodedata
import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import connection, models, transaction
from django.db.utils import ProgrammingError
from django.db.models.signals import pre_delete, pre_save, post_save
from django.dispatch import receiver
from django.utils.text import slugify
from django.utils import timezone


def _generate_tipo_peticao_key():
    return str(uuid.uuid4())


def _generate_processo_cpf_lote_token():
    return uuid.uuid4().hex


from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
import datetime


def _normalize_documento_digits(value):
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def sanitize_processo_arquivo_filename(filename):
    original = os.path.basename(str(filename or '')).strip()
    if not original:
        return 'arquivo'
    base, ext = os.path.splitext(original)
    normalized = unicodedata.normalize('NFD', base)
    normalized = ''.join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r'[^A-Za-z0-9._ -]+', ' ', normalized)
    normalized = re.sub(r'\s+', ' ', normalized).strip(' ._-')
    normalized = normalized or 'arquivo'
    ext_normalized = unicodedata.normalize('NFD', ext)
    ext_normalized = ''.join(ch for ch in ext_normalized if not unicodedata.combining(ch))
    ext_normalized = re.sub(r'[^A-Za-z0-9.]', '', ext_normalized)
    ext_normalized = ext_normalized.lower()
    if ext and not ext_normalized.startswith('.'):
        ext_normalized = f'.{ext_normalized}'
    return f'{normalized[:180]}{ext_normalized[:20]}' if ext_normalized else normalized[:200]


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
    hex_color_validator = RegexValidator(
        regex=r'^#[0-9A-Fa-f]{6}$',
        message='Informe uma cor HEX válida no formato #RRGGBB.',
    )

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
    cor_grafico = models.CharField(
        max_length=7,
        default='#417690',
        verbose_name='Cor nos gráficos',
        help_text='Cor usada nos gráficos e no diagrama de interseções desta carteira.',
        validators=[hex_color_validator],
    )

    class Meta:
        verbose_name = "Carteira"
        verbose_name_plural = "Carteiras"
        ordering = ['nome']

    def __str__(self):
        return self.nome


class CarteiraUsuarioAcesso(models.Model):
    usuario = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='carteira_acessos',
        verbose_name='Usuário',
    )
    carteira = models.ForeignKey(
        Carteira,
        on_delete=models.CASCADE,
        related_name='usuario_acessos',
        verbose_name='Carteira',
    )
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name="Criado em")

    class Meta:
        verbose_name = "Acesso à Carteira (Usuário)"
        verbose_name_plural = "Acessos à Carteira (Usuários)"
        unique_together = ('usuario', 'carteira')
        ordering = ['usuario_id', 'carteira_id']

    def __str__(self):
        return f"{self.usuario} → {self.carteira}"

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
    carteiras_vinculadas = models.ManyToManyField(
        Carteira,
        blank=True,
        verbose_name="Carteiras vinculadas",
        related_name='processos_multicarteira',
    )

    heranca_valor = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Herança (R\$)"
    )
    heranca_descricao = models.TextField(
        blank=True,
        null=True,
        verbose_name="Descrição da Herança"
    )

    etiquetas = models.ManyToManyField(
        'Etiqueta',
        blank=True,
        verbose_name="Etiquetas"
    )

    checagem_sistemas = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Checagem de Sistemas"
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

    def vincular_carteira(self, carteira_obj):
        if not carteira_obj or not getattr(carteira_obj, 'pk', None):
            return
        if not self.pk:
            self.save()
        self.carteiras_vinculadas.add(carteira_obj)
        if not self.carteira_id:
            self.carteira = carteira_obj
            self.save(update_fields=['carteira'])

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

class ProcessoJudicialNumeroCnj(models.Model):
    processo = models.ForeignKey(
        ProcessoJudicial,
        on_delete=models.CASCADE,
        related_name='numeros_cnj',
        verbose_name="Processo Judicial"
    )
    PERTINENCIA_NEUTRO = 'NEUTRO'
    PERTINENCIA_PERTINENTE = 'PERTINENTE'
    PERTINENCIA_IMPERTINENTE = 'IMPERTINENTE'
    PERTINENCIA_CHOICES = [
        (PERTINENCIA_NEUTRO, 'Pertinência'),
        (PERTINENCIA_PERTINENTE, 'Pertinente Atuar'),
        (PERTINENCIA_IMPERTINENTE, 'Impertinente Atuar'),
    ]
    cnj = models.CharField(max_length=30, verbose_name="Número CNJ")
    uf = models.CharField(max_length=2, blank=True, verbose_name="UF")
    valor_causa = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Valor da Causa"
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
        related_name='numeros_cnj'
    )
    vara = models.CharField(max_length=255, blank=True, null=True, verbose_name="Vara")
    tribunal = models.CharField(max_length=50, blank=True, verbose_name="Tribunal")
    pertinencia_status = models.CharField(
        max_length=15,
        choices=PERTINENCIA_CHOICES,
        default=PERTINENCIA_NEUTRO,
        blank=True,
        verbose_name="Pertinência"
    )
    pertinencia_periodicidade_dias = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Periodicidade (dias)"
    )
    pertinencia_proximo_em = models.DateField(
        null=True,
        blank=True,
        verbose_name="Próxima revisita"
    )
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name="Criado em")
    atualizado_em = models.DateTimeField(auto_now=True, verbose_name="Atualizado em")

    class Meta:
        verbose_name = "Número CNJ"
        verbose_name_plural = "Números CNJ"
        ordering = ['-criado_em']

    def __str__(self):
        return f"{self.cnj} — {self.processo}"

# 🔽 NOVO MODELO PARA ARMAZENAR ANDAMENTOS
class AndamentoProcessual(models.Model):
    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='andamentos')
    numero_cnj = models.ForeignKey(
        ProcessoJudicialNumeroCnj,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='andamentos_processuais',
        verbose_name="Número CNJ",
    )
    data = models.DateTimeField(verbose_name="Data do Andamento")
    descricao = models.TextField(verbose_name="Descrição")
    detalhes = models.TextField(blank=True, null=True, verbose_name="Observações")

    class Meta:
        verbose_name = "Andamento Processual"
        verbose_name_plural = "Andamentos Processuais"
        ordering = ['-data'] # Mostra os mais recentes primeiro
        unique_together = ('processo', 'numero_cnj', 'data', 'descricao')

    def __str__(self):
        return f"Andamento de {self.data.strftime('%d/%m/%Y')} em {self.processo.cnj}"


class AndamentoProcessualPendente(models.Model):
    STATUS_NOVO = 'novo'
    STATUS_PENDENTE_RESPONDIDO_MANUALMENTE = 'pendente_respondido_manualmente'
    STATUS_TRATADO = 'tratado'

    STATUS_CHOICES = [
        (STATUS_NOVO, 'Novo'),
        (STATUS_PENDENTE_RESPONDIDO_MANUALMENTE, 'Pendente respondido manualmente'),
        (STATUS_TRATADO, 'Tratado'),
    ]

    processo = models.ForeignKey(
        ProcessoJudicial,
        on_delete=models.CASCADE,
        related_name='andamentos_pendentes',
        verbose_name='Processo',
    )
    andamento = models.OneToOneField(
        AndamentoProcessual,
        on_delete=models.CASCADE,
        related_name='pendencia',
        verbose_name='Andamento',
    )
    titulo = models.CharField(max_length=255, verbose_name='Título')
    texto_bruto = models.TextField(verbose_name='Texto bruto')
    data_andamento = models.DateTimeField(verbose_name='Data do andamento')
    data_deteccao = models.DateTimeField(default=timezone.now, verbose_name='Data de detecção')
    prazo_extraido = models.DateField(null=True, blank=True, verbose_name='Prazo extraído')
    status = models.CharField(
        max_length=40,
        choices=STATUS_CHOICES,
        default=STATUS_NOVO,
        verbose_name='Status',
    )
    tratado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='andamentos_processuais_tratados',
        verbose_name='Tratado por',
    )
    tratado_em = models.DateTimeField(null=True, blank=True, verbose_name='Tratado em')
    justificativa = models.TextField(blank=True, verbose_name='Justificativa')

    class Meta:
        verbose_name = 'Andamento Processual Pendente'
        verbose_name_plural = 'Andamentos Processuais Pendentes'
        ordering = ['-data_deteccao', '-id']

    def __str__(self):
        return f"Pendência AP #{self.pk} — {self.processo.cnj}"


def processo_arquivo_upload_path(instance, filename):
    processo_id = instance.processo_id or 'novo'
    safe_filename = sanitize_processo_arquivo_filename(filename)
    return f'processos/{processo_id}/pasta/{safe_filename}'


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
    tarefa = models.ForeignKey('Tarefa', on_delete=models.SET_NULL, null=True, blank=True, related_name='arquivos')
    mensagem = models.ForeignKey('TarefaMensagem', on_delete=models.SET_NULL, null=True, blank=True, related_name='anexos')
    prazo = models.ForeignKey('Prazo', on_delete=models.SET_NULL, null=True, blank=True, related_name='arquivos')
    prazo_mensagem = models.ForeignKey('PrazoMensagem', on_delete=models.SET_NULL, null=True, blank=True, related_name='anexos')

    class Meta:
        verbose_name = "Arquivo"
        verbose_name_plural = "Arquivos"
        ordering = ['-criado_em']

    def save(self, *args, **kwargs):
        if not self.nome and self.arquivo:
            self.nome = sanitize_processo_arquivo_filename(self.arquivo.name.split('/')[-1])
        super().save(*args, **kwargs)

    def __str__(self):
        return self.nome or f"Arquivo #{self.pk}"


class Pessoa(models.Model):
    TIPO_PESSOA_CHOICES = [('PF', 'Pessoa Física'), ('PJ', 'Pessoa Jurídica')]

    nome = models.CharField(max_length=255, blank=True, verbose_name="Nome / Razão Social")
    tipo_pessoa = models.CharField(
        max_length=2,
        choices=TIPO_PESSOA_CHOICES,
        blank=True,
        verbose_name="Tipo de Pessoa",
    )
    documento = models.CharField(max_length=20, blank=True, verbose_name="CPF / CNPJ")
    documento_normalizado = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        unique=True,
        db_index=True,
        editable=False,
        verbose_name="CPF / CNPJ (normalizado)",
    )
    obito = models.BooleanField(default=False, verbose_name="Óbito")
    obito_data = models.DateField(
        blank=True,
        null=True,
        verbose_name="Data do Óbito",
    )
    obito_cidade = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Cidade do Óbito",
    )
    obito_uf = models.CharField(
        max_length=2,
        blank=True,
        verbose_name="UF do Óbito",
    )
    obito_idade = models.PositiveSmallIntegerField(
        blank=True,
        null=True,
        verbose_name="Idade no Óbito",
    )
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name="Criado em")
    atualizado_em = models.DateTimeField(auto_now=True, verbose_name="Atualizado em")

    class Meta:
        verbose_name = "Pessoa"
        verbose_name_plural = "Pessoas"
        ordering = ["nome", "id"]

    def __str__(self):
        nome = (self.nome or "").strip()
        if nome:
            return nome
        return self.documento or f"Pessoa #{self.pk}"

    def save(self, *args, **kwargs):
        self.documento = (self.documento or "").strip()
        self.documento_normalizado = _normalize_documento_digits(self.documento) or None
        super().save(*args, **kwargs)


class Parte(models.Model):
    TIPO_POLO_CHOICES = [('ATIVO', 'Polo Ativo'), ('PASSIVO', 'Polo Passivo')]
    TIPO_PESSOA_CHOICES = [('PF', 'Pessoa Física'), ('PJ', 'Pessoa Jurídica')]

    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='partes_processuais')
    numero_cnj = models.ForeignKey(
        ProcessoJudicialNumeroCnj,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='partes_processuais',
        verbose_name="Número CNJ",
    )
    tipo_polo = models.CharField(max_length=7, choices=TIPO_POLO_CHOICES, verbose_name="Tipo de Polo")
    pessoa = models.ForeignKey(
        Pessoa,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='partes_processuais',
        verbose_name="Pessoa",
    )
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
    obito_data = models.DateField(
        blank=True,
        null=True,
        verbose_name="Data do Óbito"
    )
    obito_cidade = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Cidade do Óbito"
    )
    obito_uf = models.CharField(
        max_length=2,
        blank=True,
        verbose_name="UF do Óbito"
    )
    obito_idade = models.PositiveSmallIntegerField(
        blank=True,
        null=True,
        verbose_name="Idade no Óbito"
    )

    def __str__(self):
        return self.nome

    def _sync_pessoa(self):
        documento = (self.documento or "").strip()
        documento_normalizado = _normalize_documento_digits(documento)
        if not documento_normalizado:
            return

        defaults = {
            "documento": documento,
            "nome": (self.nome or "").strip(),
            "tipo_pessoa": (self.tipo_pessoa or "").strip(),
        }
        pessoa, created = Pessoa.objects.get_or_create(
            documento_normalizado=documento_normalizado,
            defaults=defaults,
        )

        if not created:
            update_fields = []
            nome = defaults["nome"]
            if nome and nome != pessoa.nome:
                pessoa.nome = nome
                update_fields.append("nome")
            tipo_pessoa = defaults["tipo_pessoa"]
            if tipo_pessoa and tipo_pessoa != pessoa.tipo_pessoa:
                pessoa.tipo_pessoa = tipo_pessoa
                update_fields.append("tipo_pessoa")
            if documento and documento != pessoa.documento:
                pessoa.documento = documento
                update_fields.append("documento")
            # Sincroniza dados de óbito do CPF (global) quando a parte já estiver marcada.
            if self.obito and not pessoa.obito:
                pessoa.obito = True
                update_fields.append("obito")
            if self.obito:
                if self.obito_data and not pessoa.obito_data:
                    pessoa.obito_data = self.obito_data
                    update_fields.append("obito_data")
                if self.obito_cidade and not pessoa.obito_cidade:
                    pessoa.obito_cidade = self.obito_cidade
                    update_fields.append("obito_cidade")
                if self.obito_uf and not pessoa.obito_uf:
                    pessoa.obito_uf = self.obito_uf
                    update_fields.append("obito_uf")
                if self.obito_idade is not None and pessoa.obito_idade is None:
                    pessoa.obito_idade = self.obito_idade
                    update_fields.append("obito_idade")
            if update_fields:
                pessoa.save(update_fields=update_fields)

        # Se o CPF já estiver marcado como óbito, espelha na parte atual.
        if pessoa.obito and not self.obito:
            self.obito = True
        if pessoa.obito:
            if pessoa.obito_data and not self.obito_data:
                self.obito_data = pessoa.obito_data
            if pessoa.obito_cidade and not self.obito_cidade:
                self.obito_cidade = pessoa.obito_cidade
            if pessoa.obito_uf and not self.obito_uf:
                self.obito_uf = pessoa.obito_uf
            if pessoa.obito_idade is not None and self.obito_idade is None:
                self.obito_idade = pessoa.obito_idade

        self.pessoa = pessoa

    def save(self, *args, **kwargs):
        self._sync_pessoa()
        super().save(*args, **kwargs)

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
    nome = models.CharField(max_length=255, blank=True, null=True, verbose_name="Nome completo")
    uf_oab = models.CharField(max_length=2, choices=UF_CHOICES, blank=True, null=True, verbose_name="UF da OAB")
    oab_numero = models.CharField(max_length=10, blank=True, null=True, verbose_name="Número da OAB")
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
        nome = (self.nome or '').strip()
        if nome:
            return nome
        processo_id = getattr(self, 'processo_id', None)
        return f"Acordo do processo {processo_id or '-'}"

class Contrato(models.Model):
    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='contratos')
    documento_titular = models.CharField(
        max_length=20,
        blank=True,
        verbose_name="CPF/CNPJ titular",
        help_text="Preenchido automaticamente para vincular o contrato à pessoa no card.",
    )
    numero_contrato = models.CharField(max_length=50, verbose_name="Número do Contrato", blank=True, null=True)
    valor_total_devido = models.DecimalField(max_digits=14, decimal_places=2, verbose_name="Valor Total Devido", blank=True, null=True)
    valor_causa = models.DecimalField("Valor da Causa", max_digits=14, decimal_places=2, null=True, blank=True)
    data_saldo_atualizado = models.DateField(verbose_name="Data saldo atualizado", blank=True, null=True)
    custas = models.DecimalField("Custas", max_digits=14, decimal_places=2, null=True, blank=True)
    parcelas_em_aberto = models.IntegerField(verbose_name="Parcelas em Aberto", blank=True, null=True)
    data_prescricao = models.DateField(verbose_name="Data de Prescrição", blank=True, null=True)
    status = models.IntegerField(
        verbose_name="Status",
        null=True,
        blank=True,
        help_text="Status importado da planilha (ex.: 3 = Cancelado).",
    )

    @property
    def is_prescrito(self):
        from django.utils import timezone
        if not self.data_prescricao:
            return False
        return self.data_prescricao < timezone.now().date()

    @property
    def is_cancelado(self):
        return self.status == 3

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
    AUTOMACAO_NENHUMA = ''
    AUTOMACAO_SOLICITACAO_ARQUIVOS_MASSA = 'solicitacao_arquivos_massa'
    AUTOMACAO_CHOICES = [
        (AUTOMACAO_NENHUMA, 'Sem automação'),
        (AUTOMACAO_SOLICITACAO_ARQUIVOS_MASSA, 'Solicitação de arquivos Massa'),
    ]

    nome = models.CharField(max_length=100, unique=True)
    automacao_tipo = models.CharField(
        max_length=64,
        choices=AUTOMACAO_CHOICES,
        blank=True,
        default=AUTOMACAO_NENHUMA,
        verbose_name='Automação',
    )

    def __str__(self):
        return self.nome

    class Meta:
        verbose_name = "Lista de Tarefas"
        verbose_name_plural = "Listas de Tarefas"
        ordering = ['nome']


class ListaDeTarefasArquivoConfig(models.Model):
    lista = models.ForeignKey(
        ListaDeTarefas,
        on_delete=models.CASCADE,
        related_name='arquivos_configurados',
        verbose_name='Lista',
    )
    nome = models.CharField(max_length=120, verbose_name='Nome do arquivo')
    nome_coluna = models.CharField(
        max_length=120,
        blank=True,
        verbose_name='Coluna da planilha',
        help_text='Opcional. Se vazio, usa o nome do arquivo.',
    )
    padrao_nome = models.CharField(
        max_length=160,
        verbose_name='Padrão do nome',
        help_text='Use {contrato} para inserir o número do contrato.',
    )
    ordem = models.PositiveSmallIntegerField(default=1, verbose_name='Ordem')
    ativo = models.BooleanField(default=True, verbose_name='Ativo')

    class Meta:
        verbose_name = 'Configuração de arquivo da lista'
        verbose_name_plural = 'Configurações de arquivos da lista'
        ordering = ['ordem', 'id']

    def __str__(self):
        return f'{self.lista.nome} - {self.nome}'

    def save(self, *args, **kwargs):
        self.nome = str(self.nome or '').strip()
        self.nome_coluna = str(self.nome_coluna or '').strip()
        self.padrao_nome = str(self.padrao_nome or '').strip() or '{contrato} - {arquivo}'
        super().save(*args, **kwargs)


class TarefaLote(models.Model):
    descricao = models.CharField(max_length=255, verbose_name="Descrição")
    criado_em = models.DateTimeField(auto_now_add=True, null=True, blank=True, verbose_name="Criado em")
    criado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name='tarefas_lotes',
        null=True,
        blank=True,
        verbose_name="Criado por"
    )

    def __str__(self):
        return self.descricao

    class Meta:
        verbose_name = "Lote de Tarefas"
        verbose_name_plural = "Lotes de Tarefas"
        ordering = ['-criado_em']


class DemandaAnaliseLoteSalvo(models.Model):
    usuario = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='demandas_lotes_salvos',
        verbose_name='Usuário',
    )
    nome = models.CharField(max_length=120, verbose_name='Nome do lote')
    carteira = models.ForeignKey(
        Carteira,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='demandas_lotes_salvos',
        verbose_name='Carteira sugerida',
    )
    identificadores = models.TextField(verbose_name='CNJs/CPFs')
    ultimo_importado_em = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name='Última importação',
    )
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name='Criado em')
    atualizado_em = models.DateTimeField(auto_now=True, verbose_name='Atualizado em')

    class Meta:
        verbose_name = 'Lote salvo de demandas'
        verbose_name_plural = 'Lotes salvos de demandas'
        ordering = ['-atualizado_em', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['usuario', 'nome'],
                name='uniq_demandas_lote_salvo_usuario_nome',
            )
        ]

    def __str__(self):
        return f'{self.nome} ({self.usuario})'


class ProcessoCpfLoteSalvo(models.Model):
    criado_por = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='processo_cpf_lotes_salvos',
        verbose_name='Criado por',
    )
    token = models.CharField(
        max_length=32,
        unique=True,
        default=_generate_processo_cpf_lote_token,
        editable=False,
        verbose_name='Token',
    )
    nome = models.CharField(max_length=140, verbose_name='Nome da lista')
    cpfs = models.TextField(verbose_name='CPFs')
    compartilhado = models.BooleanField(default=False, verbose_name='Compartilhado')
    oculto_supervisor = models.BooleanField(default=False, verbose_name='Oculto para supervisores')
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name='Criado em')
    atualizado_em = models.DateTimeField(auto_now=True, verbose_name='Atualizado em')

    class Meta:
        verbose_name = 'Lista salva de CPFs'
        verbose_name_plural = 'Listas salvas de CPFs'
        ordering = ['-atualizado_em', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['criado_por', 'nome'],
                name='uniq_processo_cpf_lote_criado_por_nome',
            )
        ]

    def __str__(self):
        return f'{self.nome} ({self.criado_por})'


class ProcessoCnjLoteSalvo(models.Model):
    criado_por = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='processo_cnj_lotes_salvos',
        verbose_name='Criado por',
    )
    token = models.CharField(
        max_length=32,
        unique=True,
        default=_generate_processo_cpf_lote_token,
        editable=False,
        verbose_name='Token',
    )
    nome = models.CharField(max_length=140, verbose_name='Nome da lista')
    cnjs = models.TextField(verbose_name='CNJs')
    compartilhado = models.BooleanField(default=False, verbose_name='Compartilhado')
    oculto_supervisor = models.BooleanField(default=False, verbose_name='Oculto para supervisores')
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name='Criado em')
    atualizado_em = models.DateTimeField(auto_now=True, verbose_name='Atualizado em')

    class Meta:
        verbose_name = 'Lista salva de CNJs'
        verbose_name_plural = 'Listas salvas de CNJs'
        ordering = ['-atualizado_em', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['criado_por', 'nome'],
                name='uniq_processo_cnj_lote_criado_por_nome',
            )
        ]

    def __str__(self):
        return f'{self.nome} ({self.criado_por})'


class Tarefa(models.Model):
    PRIORIDADE_CHOICES = [
        ('B', 'Baixa'),
        ('M', 'Média'),
        ('A', 'Alta'),
    ]

    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='tarefas', null=True, blank=True)
    lote = models.ForeignKey('TarefaLote', on_delete=models.SET_NULL, null=True, blank=True, related_name='tarefas')
    descricao = models.CharField(max_length=255, verbose_name="Descrição")
    lista = models.ForeignKey(ListaDeTarefas, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Lista")
    data = models.DateField(verbose_name="Data")
    data_origem = models.DateField(blank=True, null=True, verbose_name="Data de origem")
    responsavel = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='tarefas_responsaveis')
    prioridade = models.CharField(max_length=1, choices=PRIORIDADE_CHOICES, default='M')
    concluida = models.BooleanField(default=False)
    concluido_em = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Concluído em",
    )
    concluido_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name='tarefas_concluidas',
        null=True,
        blank=True,
        verbose_name="Concluído por",
    )
    observacoes = models.TextField(blank=True, null=True, verbose_name="Observações")
    payload = models.JSONField(default=dict, blank=True, verbose_name='Payload')
    criado_em = models.DateTimeField(auto_now_add=True, null=True, blank=True, verbose_name="Criado em", editable=True)
    criado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name='tarefas_criadas',
        null=True,
        blank=True,
        verbose_name="Criado por"
    )

    def __str__(self):
        return self.descricao

    class Meta:
        verbose_name = "Tarefa"
        verbose_name_plural = "Tarefas"
        ordering = ['-data']


class TarefaNotificacao(models.Model):
    TIPO_RECEBIDA = 'recebida'
    TIPO_DEVOLUTIVA = 'devolutiva'
    TIPO_MENCAO = 'mencao'
    TIPO_CHOICES = (
        (TIPO_RECEBIDA, 'Recebida'),
        (TIPO_DEVOLUTIVA, 'Devolutiva'),
        (TIPO_MENCAO, 'Menção'),
    )

    usuario = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='notificacoes_tarefas',
        verbose_name='Usuário',
    )
    tarefa = models.ForeignKey(
        Tarefa,
        on_delete=models.CASCADE,
        related_name='notificacoes',
        null=True,
        blank=True,
        verbose_name='Tarefa',
    )
    prazo = models.ForeignKey(
        'Prazo',
        on_delete=models.CASCADE,
        related_name='notificacoes',
        null=True,
        blank=True,
        verbose_name='Prazo',
    )
    tipo = models.CharField(
        max_length=20,
        choices=TIPO_CHOICES,
        default=TIPO_RECEBIDA,
        db_index=True,
        verbose_name='Tipo',
    )
    titulo = models.CharField(max_length=160, blank=True, default='', verbose_name='Título')
    descricao = models.TextField(blank=True, default='', verbose_name='Descrição')
    autor_nome = models.CharField(max_length=150, blank=True, default='', verbose_name='Autor exibido')
    justificativa = models.TextField(blank=True, default='', verbose_name='Justificativa')
    payload = models.JSONField(default=dict, blank=True, verbose_name='Payload')
    criada_em = models.DateTimeField(auto_now_add=True, verbose_name='Criada em')
    lida_em = models.DateTimeField(null=True, blank=True, verbose_name='Lida em')

    class Meta:
        verbose_name = 'Notificação de tarefa'
        verbose_name_plural = 'Notificações de tarefa'
        ordering = ['-criada_em', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['usuario', 'tarefa', 'tipo'],
                name='uniq_tarefanotificacao_usuario_tarefa_tipo',
            ),
            models.UniqueConstraint(
                fields=['usuario', 'prazo', 'tipo'],
                name='uniq_tarefanotificacao_usuario_prazo_tipo',
            ),
            models.CheckConstraint(
                condition=(
                    (models.Q(tarefa__isnull=False) & models.Q(prazo__isnull=True))
                    | (models.Q(tarefa__isnull=True) & models.Q(prazo__isnull=False))
                ),
                name='tarefanotificacao_single_target',
            ),
        ]

    def __str__(self):
        target_label = f'tarefa #{self.tarefa_id}' if self.tarefa_id else f'prazo #{self.prazo_id}'
        return f'Notificação {self.tipo} {target_label} para {self.usuario}'


def _close_pending_item_notifications(*, tarefa=None, prazo=None):
    if tarefa is None and prazo is None:
        return
    filters = {
        'lida_em__isnull': True,
        'tipo__in': [
            TarefaNotificacao.TIPO_RECEBIDA,
            TarefaNotificacao.TIPO_MENCAO,
        ],
    }
    if tarefa is not None:
        filters['tarefa'] = tarefa
    if prazo is not None:
        filters['prazo'] = prazo
    TarefaNotificacao.objects.filter(**filters).update(lida_em=timezone.now())


def _has_tarefa_notificacao_table():
    try:
        return TarefaNotificacao._meta.db_table in connection.introspection.table_names()
    except Exception:
        return False


@receiver(pre_save, sender=Tarefa)
def tarefa_cache_previous_receiver(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_responsavel_id = None
        return
    instance._previous_responsavel_id = (
        sender.objects.filter(pk=instance.pk).values_list('responsavel_id', flat=True).first()
    )


@receiver(post_save, sender=Tarefa)
def tarefa_sync_receiver_notification(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if not _has_tarefa_notificacao_table():
        return

    if instance.concluida:
        _close_pending_item_notifications(tarefa=instance)
        return

    previous_responsavel_id = getattr(instance, '_previous_responsavel_id', None)
    current_responsavel_id = instance.responsavel_id

    if previous_responsavel_id and previous_responsavel_id != current_responsavel_id:
        TarefaNotificacao.objects.filter(
            tarefa=instance,
            usuario_id=previous_responsavel_id,
            tipo=TarefaNotificacao.TIPO_RECEBIDA,
        ).delete()

    if not current_responsavel_id:
        return

    if not created and previous_responsavel_id == current_responsavel_id:
        return

    receiver = instance.responsavel
    if not receiver or not receiver.is_active:
        return

    if created and instance.criado_por_id and instance.criado_por_id == current_responsavel_id:
        return

    TarefaNotificacao.objects.update_or_create(
        tarefa=instance,
        prazo=None,
        usuario_id=current_responsavel_id,
        tipo=TarefaNotificacao.TIPO_RECEBIDA,
        defaults={
            'titulo': 'Nova tarefa recebida',
            'descricao': instance.descricao or '',
            'autor_nome': (
                (instance.criado_por.get_full_name() or '').strip()
                if instance.criado_por_id else ''
            ) or (instance.criado_por.username if instance.criado_por_id else ''),
            'justificativa': '',
        },
    )

@receiver(pre_delete, sender=Tarefa)
def cleanup_tarefa_related(sender, instance, **kwargs):
    # Alguns ambientes (especialmente em produção) podem não ter tabelas legadas
    # (ex.: `contratos_tarefahistorico`). Se tentarmos deletar nelas e a tabela não existir,
    # o PostgreSQL marca a transação como "aborted" e o admin falha ao salvar o resto do form.
    #
    # Portanto, fazemos a limpeza apenas nas tabelas que existem (best-effort).
    existing = set(connection.introspection.table_names())
    statements = [
        ("contratos_tarefahistorico", "DELETE FROM contratos_tarefahistorico WHERE tarefa_id = %s"),
        ("contratos_tarefamensagem", "DELETE FROM contratos_tarefamensagem WHERE tarefa_id = %s"),
    ]
    with connection.cursor() as cursor:
        for table, sql in statements:
            if table not in existing:
                continue
            cursor.execute(sql, [instance.pk])

class Prazo(models.Model):
    ALERTA_UNIDADE_CHOICES = [
        ('D', 'Dias antes'),
        ('H', 'Horas antes'),
    ]

    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='prazos', null=True, blank=True)
    titulo = models.CharField(max_length=255, verbose_name="Título")
    data_limite = models.DateTimeField(verbose_name="Data Limite")
    data_limite_origem = models.DateField(blank=True, null=True, verbose_name="Data limite de origem")
    alerta_valor = models.PositiveIntegerField(default=1, verbose_name="Alerta")
    alerta_unidade = models.CharField(max_length=1, choices=ALERTA_UNIDADE_CHOICES, default='D')
    responsavel = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='prazos_responsaveis')
    observacoes = models.TextField(blank=True, null=True)
    concluido = models.BooleanField(default=False)
    concluido_em = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Concluído em",
    )
    concluido_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name='prazos_concluidos',
        null=True,
        blank=True,
        verbose_name="Concluído por",
    )
    criado_em = models.DateTimeField(
        auto_now_add=True,
        null=True,
        blank=True,
        verbose_name="Criado em",
    )
    criado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name='prazos_criados',
        null=True,
        blank=True,
        verbose_name="Criado por",
    )

    def __str__(self):
        return self.titulo


@receiver(pre_save, sender=Prazo)
def prazo_cache_previous_receiver(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_responsavel_id = None
        return
    instance._previous_responsavel_id = (
        sender.objects.filter(pk=instance.pk).values_list('responsavel_id', flat=True).first()
    )


@receiver(post_save, sender=Prazo)
def prazo_sync_receiver_notification(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if not _has_tarefa_notificacao_table():
        return

    if instance.concluido:
        _close_pending_item_notifications(prazo=instance)
        return

    previous_responsavel_id = getattr(instance, '_previous_responsavel_id', None)
    current_responsavel_id = instance.responsavel_id

    if previous_responsavel_id and previous_responsavel_id != current_responsavel_id:
        TarefaNotificacao.objects.filter(
            prazo=instance,
            usuario_id=previous_responsavel_id,
            tipo=TarefaNotificacao.TIPO_RECEBIDA,
        ).delete()

    if not current_responsavel_id:
        return

    if not created and previous_responsavel_id == current_responsavel_id:
        return

    receiver = instance.responsavel
    if not receiver or not receiver.is_active:
        return

    if created and instance.criado_por_id and instance.criado_por_id == current_responsavel_id:
        return

    TarefaNotificacao.objects.update_or_create(
        tarefa=None,
        prazo=instance,
        usuario_id=current_responsavel_id,
        tipo=TarefaNotificacao.TIPO_RECEBIDA,
        defaults={
            'titulo': 'Novo prazo recebido',
            'descricao': instance.titulo or '',
            'autor_nome': (
                (instance.criado_por.get_full_name() or '').strip()
                if instance.criado_por_id else ''
            ) or (instance.criado_por.username if instance.criado_por_id else ''),
            'justificativa': '',
        },
    )


class PrazoMensagem(models.Model):
    prazo = models.ForeignKey(Prazo, on_delete=models.CASCADE, related_name='mensagens')
    autor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='prazos_mensagens'
    )
    texto = models.TextField()
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Mensagem do Prazo"
        verbose_name_plural = "Mensagens do Prazo"
        ordering = ['-criado_em']

    def __str__(self):
        return f"{self.autor or 'Usuário'} em {self.criado_em:%d/%m/%Y %H:%M}"


class TarefaMensagem(models.Model):
    tarefa = models.ForeignKey(Tarefa, on_delete=models.CASCADE, related_name='mensagens')
    autor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tarefas_mensagens'
    )
    texto = models.TextField()
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Mensagem da Tarefa"
        verbose_name_plural = "Mensagens da Tarefa"
        ordering = ['-criado_em']

    def __str__(self):
        return f"{self.autor or 'Usuário'} em {self.criado_em:%d/%m/%Y %H:%M}"


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


class KpiGlobalConfig(models.Model):
    prioridade_default_carteira = models.ForeignKey(
        Carteira,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Carteira padrão (KPI Prioridade)",
    )
    atualizado_em = models.DateTimeField(auto_now=True, verbose_name="Atualizado em")
    atualizado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Atualizado por",
    )

    class Meta:
        verbose_name = "Configuração Global de KPI"
        verbose_name_plural = "Configuração Global de KPI"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Configuração Global de KPI"


# --- Modelos para o Motor da Árvore de Decisão de Análise ---

class TipoAnaliseObjetiva(models.Model):
    nome = models.CharField(max_length=120, unique=True, verbose_name="Nome")
    slug = models.SlugField(
        max_length=140,
        unique=True,
        blank=True,
        verbose_name="Slug",
        help_text="Identificador interno usado na seleção do tipo de análise."
    )
    hashtag = models.CharField(
        max_length=160,
        blank=True,
        verbose_name="Hashtag",
        help_text="Usado nas Observações (ex.: #causa-passiva). Se vazio, será gerado automaticamente."
    )
    ativo = models.BooleanField(default=True, verbose_name="Ativo")
    versao = models.PositiveIntegerField(default=1, verbose_name="Versão")
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name="Criado em")
    atualizado_em = models.DateTimeField(auto_now=True, verbose_name="Atualizado em")
    atualizado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tipos_analise_atualizados",
        verbose_name="Atualizado por"
    )

    class Meta:
        verbose_name = "Tipo de Análise Objetiva"
        verbose_name_plural = "Tipos de Análise Objetiva"
        ordering = ['nome']

    def __str__(self):
        return self.nome

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.nome)[:140]
        if not self.hashtag:
            self.hashtag = f"#{self.slug}" if self.slug else ""
        super().save(*args, **kwargs)

    def bump_version(self, user=None):
        self.versao = (self.versao or 0) + 1
        self.atualizado_em = timezone.now()
        if user and getattr(user, "pk", None):
            self.atualizado_por = user
        self.save(update_fields=["versao", "atualizado_em", "atualizado_por"])


class QuestaoAnalise(models.Model):
    TIPO_CAMPO_CHOICES = [
        ('OPCOES', 'Opções (dropdown)'),
        ('TEXTO', 'Texto Curto'),
        ('TEXTO_LONGO', 'Texto Longo (observações)'),
        ('DATA', 'Data'),
        ('PROCESSO_VINCULADO', 'Interface de Processos Vinculados'),
        ('CONTRATOS_MONITORIA', 'Seleção de Contratos para Monitória'),
    ]
    
    tipo_analise = models.ForeignKey(
        TipoAnaliseObjetiva,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="questoes",
        verbose_name="Tipo de Análise"
    )
    texto_pergunta = models.CharField(max_length=255, verbose_name="Texto da Pergunta/Critério")
    chave = models.CharField(max_length=50, unique=True, blank=True, null=True, verbose_name="Chave de Referência (Slug)")
    tipo_campo = models.CharField(max_length=20, choices=TIPO_CAMPO_CHOICES, default='OPCOES', verbose_name="Tipo de Campo de Resposta")
    is_primeira_questao = models.BooleanField(
        default=False, 
        verbose_name="É a primeira questão da análise?",
        help_text="Marque apenas uma questão como a primeira. Será o ponto de partida da árvore."
    )
    habilita_supervisao = models.BooleanField(
        default=False,
        verbose_name="Habilita Supervisionar",
        help_text="Quando marcado, o botão Supervisionar passa a ser exibido a partir desta questão."
    )
    ordem = models.PositiveIntegerField(default=10, verbose_name="Ordem de Exibição")
    ativo = models.BooleanField(default=True, verbose_name="Ativo")

    class Meta:
        verbose_name = "Questão da Análise"
        verbose_name_plural = "1. Questões da Análise"
        ordering = ['ordem', 'texto_pergunta']

    def __str__(self):
        texto = (self.texto_pergunta or "").strip()
        if self.tipo_analise_id:
            tipo_label = (getattr(self.tipo_analise, "nome", "") or getattr(self.tipo_analise, "slug", "")).strip()
            if tipo_label:
                return f"{texto} - {tipo_label}"
        return texto

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
    ativo = models.BooleanField(default=True, verbose_name="Ativo")
    
    class Meta:
        verbose_name = "Opção de Resposta"
        verbose_name_plural = "2. Opções de Respostas"
        ordering = ['questao_origem', 'texto_resposta']

    def clean(self):
        super().clean()
        if not self.proxima_questao_id:
            return
        origem_tipo_id = getattr(self.questao_origem, 'tipo_analise_id', None)
        prox_tipo_id = getattr(self.proxima_questao, 'tipo_analise_id', None)
        if origem_tipo_id and prox_tipo_id and origem_tipo_id != prox_tipo_id:
            raise ValidationError({
                'proxima_questao': (
                    'A próxima questão deve pertencer ao mesmo Tipo de Análise da questão de origem.'
                )
            })

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
        concluded_statuses = {'aprovado', 'reprovado'}
        for key in ('processos_vinculados', 'saved_processos_vinculados'):
            entries = respostas.get(key)
            if not entries or not isinstance(entries, list):
                continue
            for item in entries:
                if not isinstance(item, dict) or not item.get('supervisionado'):
                    continue
                status = str(item.get('supervisor_status') or 'pendente').strip().lower()
                if status in concluded_statuses:
                    continue
                return True
        return False
