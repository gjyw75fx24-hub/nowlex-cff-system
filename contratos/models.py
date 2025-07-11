# contratos/models.py
from django.db import models

class Devedor(models.Model):
    SEXO_CHOICES = [
        ('H', 'Homem'),
        ('M', 'Mulher'),
    ]
    cpf = models.CharField("CPF", max_length=14, unique=True)
    nome_completo = models.CharField("Nome Completo", max_length=255)
    sexo_biologico = models.CharField("Sexo Biológico", max_length=1, choices=SEXO_CHOICES)

    class Meta:
        verbose_name = "Devedor"
        verbose_name_plural = "Devedores"

    def __str__(self):
        return self.nome_completo

class ProcessoJudicial(models.Model):
    # --- NOME AJUSTADO ---
    cnj = models.CharField("Número CNJ", max_length=25, unique=True)
    valor_causa = models.DecimalField("Valor da Causa", max_digits=12, decimal_places=2)
    vara = models.CharField("Vara", max_length=255)
    tribunal = models.CharField("Tribunal", max_length=255)
verbose_name_plural = "Processos Judiciais"

def __str__(self):
        return self.cnj

class Contrato(models.Model):
    numero_contrato = models.CharField("Número do Contrato", max_length=50, unique=True)
    valor_total_devido = models.DecimalField("Valor Total Devido", max_digits=12, decimal_places=2)
    parcelas_em_aberto = models.PositiveIntegerField("Parcelas em Aberto")
    data_contrato = models.DateField("Data do Contrato", null=True, blank=True)

    devedor = models.ForeignKey(
        Devedor,
        on_delete=models.PROTECT,
        verbose_name="Devedor"
    )
    # --- NOME AJUSTADO ---
    processo = models.OneToOneField(
        ProcessoJudicial,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Processo"
    )

    class Meta:
        verbose_name = "Contrato"
        verbose_name_plural = "Contratos"

    def __str__(self):
        return self.numero_contrato
