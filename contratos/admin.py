from django.contrib import admin
from django.utils.html import format_html
from django import forms
from django.db import models
from .models import ProcessoJudicial, Parte, Contrato

class ParteInline(admin.StackedInline):
    model = Parte
    extra = 1
    fk_name = 'processo'
    fieldsets = ((None, {'fields': (('tipo_polo', 'nome'), ('tipo_pessoa', 'documento'), 'endereco')}),)
    formfield_overrides = {
        models.TextField: {'widget': forms.Textarea(attrs={'rows': 4, 'cols': 40})},
    }

class ContratoInline(admin.StackedInline):
    model = Contrato
    extra = 1
    fk_name = 'processo'

@admin.register(ProcessoJudicial)
class ProcessoJudicialAdmin(admin.ModelAdmin):
    list_display = ('cnj', 'uf', 'get_polo_ativo', 'get_polo_passivo')
    search_fields = ('cnj', 'partes__nome')
    inlines = [ParteInline, ContratoInline]
    fieldsets = ((None, {'fields': ('cnj', ('uf', 'preencher_uf_button'), 'vara', 'tribunal', 'valor_causa')}),)
    readonly_fields = ('preencher_uf_button',)

    class Media:
        js = ('admin/js/processo_judicial_enhancer.js',)

    @admin.display(description="Polo Ativo")
    def get_polo_ativo(self, obj):
        ativo = obj.partes.filter(tipo_polo='ATIVO').first()
        return ativo.nome if ativo else "---"

    @admin.display(description="Polo Passivo")
    def get_polo_passivo(self, obj):
        passivo = obj.partes.filter(tipo_polo='PASSIVO').first()
        return passivo.nome if passivo else "---"

    @admin.display(description="")
    def preencher_uf_button(self, obj):
        return format_html('<button type="button" id="btn_preencher_uf" class="button">Preencher UF</button>')
