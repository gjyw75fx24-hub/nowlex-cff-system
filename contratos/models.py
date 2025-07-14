from django.db import models

class ProcessoJudicial(models.Model):
    cnj = models.CharField(max_length=30, unique=True, verbose_name="Número CNJ")
    uf = models.CharField(max_length=2, blank=True, verbose_name="UF")
    vara = models.CharField(max_length=255, verbose_name="Vara")
    tribunal = models.CharField(max_length=50, blank=True, verbose_name="Tribunal")
    valor_causa = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Valor da Causa")

    def __str__(self):
        return self.cnj

class Parte(models.Model):
    TIPO_POLO_CHOICES = [('ATIVO', 'Polo Ativo'), ('PASSIVO', 'Polo Passivo')]
    TIPO_PESSOA_CHOICES = [('PF', 'Pessoa Física'), ('PJ', 'Pessoa Jurídica')]

    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='partes')
    tipo_polo = models.CharField(max_length=7, choices=TIPO_POLO_CHOICES, verbose_name="Tipo de Polo")
    nome = models.CharField(max_length=255, verbose_name="Nome / Razão Social")
    tipo_pessoa = models.CharField(max_length=2, choices=TIPO_PESSOA_CHOICES, verbose_name="Tipo de Pessoa")
    documento = models.CharField(max_length=20, verbose_name="CPF / CNPJ")
    endereco = models.TextField(blank=True, null=True, verbose_name="Endereço")

    def __str__(self):
        return self.nome

class Contrato(models.Model):
    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name='contratos')
    numero_contrato = models.CharField(max_length=50, verbose_name="Número do Contrato")
    valor_total_devido = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Valor Total Devido")
    parcelas_em_aberto = models.IntegerField(verbose_name="Parcelas em Aberto")
    data_contrato = models.DateField(verbose_name="Data do Contrato")

    def __str__(self):
        return self.numero_contrato
