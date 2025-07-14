# contratos/models.py
from django.db import models

# O modelo ProcessoJudicial agora vem primeiro, pois ele é o "pai" de todos.
class ProcessoJudicial(models.Model):
    cnj = models.CharField("Número CNJ", max_length=25, unique=True)
    uf = models.CharField("UF", max_length=2, blank=True)
    vara = models.CharField("Vara", max_length=255)
    tribunal = models.CharField("Tribunal", max_length=255, blank=True)
    valor_causa = models.DecimalField("Valor da Causa", max_digits=12, decimal_places=2)

    class Meta:
        verbose_name = "Processo Judicial"
        verbose_name_plural = "Processos Judiciais"

    def __str__(self):
        return self.cnj

    def save(self, *args, **kwargs):
        cnj_limpo = "".join(filter(str.isdigit, self.cnj or ""))
        if len(cnj_limpo) == 20:
            j, tr = cnj_limpo[13], cnj_limpo[14:16]
            cod_uf = f"{j}.{tr}"
            mapa_uf = {"8.01":"AC", "8.02":"AL", "8.03":"AP", "8.04":"AM", "8.05":"BA", "8.06":"CE", "8.07":"DF", "8.08":"ES", "8.09":"GO", "8.10":"MA", "8.11":"MT", "8.12":"MS", "8.13":"MG", "8.14":"PA", "8.15":"PB", "8.16":"PR", "8.17":"PE", "8.18":"PI", "8.19":"RJ", "8.20":"RN", "8.21":"RS", "8.22":"RO", "8.23":"RR", "8.24":"SC", "8.25":"SE", "8.26":"SP", "8.27":"TO"}
            mapa_tribunal = {"8.01":"TJAC", "8.02":"TJAL", "8.03":"TJAP", "8.04":"TJAM", "8.05":"TJBA", "8.06":"TJCE", "8.07":"TJDFT", "8.08":"TJES", "8.09":"TJGO", "8.10":"TJMA", "8.11":"TJMT", "8.12":"TJMS", "8.13":"TJMG", "8.14":"TJPA", "8.15":"TJPB", "8.16":"TJPR", "8.17":"TJPE", "8.18":"TJPI", "8.19":"TJRJ", "8.20":"TJRN", "8.21":"TJRS", "8.22":"TJRO", "8.23":"TJRR", "8.24":"TJSC", "8.25":"TJSE", "8.26":"TJSP", "8.27":"TJTO"}
            if not self.uf and cod_uf in mapa_uf: self.uf = mapa_uf[cod_uf]
            if not self.tribunal and cod_uf in mapa_tribunal: self.tribunal = mapa_tribunal[cod_uf]
        super().save(*args, **kwargs)

# O modelo Parte agora se liga ao Processo
class Parte(models.Model):
    TIPO_POLO_CHOICES = [('ATIVO', 'Polo Ativo'), ('PASSIVO', 'Polo Passivo')]
    TIPO_PESSOA_CHOICES = [('PF', 'Pessoa Física'), ('PJ', 'Pessoa Jurídica')]

    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name="partes")
    tipo_polo = models.CharField("Tipo de Polo", max_length=7, choices=TIPO_POLO_CHOICES)
    nome = models.CharField("Nome / Razão Social", max_length=255)
    tipo_pessoa = models.CharField("Tipo de Pessoa", max_length=2, choices=TIPO_PESSOA_CHOICES, default='PF')
    documento = models.CharField("CPF / CNPJ", max_length=18, unique=True)
    endereco = models.TextField("Endereço", blank=True)

    class Meta:
        verbose_name = "Parte"
        verbose_name_plural = "Partes"

    def __str__(self):
        return f"{self.nome} ({self.get_tipo_polo_display()})"

# O modelo Contrato também se liga ao Processo
class Contrato(models.Model):
    processo = models.ForeignKey(ProcessoJudicial, on_delete=models.CASCADE, related_name="contratos")
    numero_contrato = models.CharField("Número do Contrato", max_length=50, unique=True)
    valor_total_devido = models.DecimalField("Valor Total Devido", max_digits=12, decimal_places=2)
    parcelas_em_aberto = models.PositiveIntegerField("Parcelas em Aberto")
    data_contrato = models.DateField("Data do Contrato", null=True, blank=True)

    def __str__(self):
        return self.numero_contrato
