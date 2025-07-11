# contratos/admin.py
from django.contrib import admin
from .models import Devedor, ProcessoJudicial, Contrato

@admin.register(Devedor)
class DevedorAdmin(admin.ModelAdmin):
    list_display = ('nome_completo', 'cpf')
    search_fields = ('nome_completo', 'cpf')

@admin.register(ProcessoJudicial)
class ProcessoJudicialAdmin(admin.ModelAdmin):
    # --- NOME AJUSTADO ---
    list_display = ('cnj', 'tribunal', 'vara', 'valor_causa')
    search_fields = ('cnj',)
    list_filter = ('tribunal',)

@admin.register(Contrato)
class ContratoAdmin(admin.ModelAdmin):
    list_display = (
        'numero_contrato', 'devedor', 'get_tribunal', 'get_cnj',
        'valor_total_devido', 'parcelas_em_aberto', 'data_contrato'
    )
    search_fields = (
        'numero_contrato',
        'devedor__nome_completo',
        'processo__cnj'  # --- CAMINHO AJUSTADO ---
    )
    list_filter = (
        'processo__tribunal', # --- CAMINHO AJUSTADO ---
        'devedor'
    )
    # --- NOME AJUSTADO ---
    raw_id_fields = ('devedor', 'processo')

    @admin.display(description='Tribunal (UF)', ordering='processo__tribunal')
    def get_tribunal(self, obj):
        # --- NOME AJUSTADO ---
        if obj.processo:
            return obj.processo.tribunal
        return "—"

    @admin.display(description='Nº Processo (CNJ)', ordering='processo__cnj')
    def get_cnj(self, obj):
        # --- NOME AJUSTADO ---
        if obj.processo:
            return obj.processo.cnj
        return "—"
