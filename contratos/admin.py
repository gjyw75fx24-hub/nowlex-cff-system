# contratos/admin.py
from django.contrib import admin
from django.utils.html import format_html
from django import forms
from .models import ProcessoJudicial, Parte, Contrato

# Formulário para reduzir o campo Endereço e ajustar larguras
class ParteInlineForm(forms.ModelForm):
    class Meta:
        model = Parte
        fields = '__all__'
        widgets = {
            'endereco': forms.Textarea(attrs={'rows': 4, 'cols': 40}),
            'nome': forms.TextInput(attrs={'size': '30'}),
            'documento': forms.TextInput(attrs={'size': '20'}),
        }

class ParteInline(admin.StackedInline):
    model = Parte
    extra = 2
    fk_name = 'processo'
    # Organiza os campos para melhor alinhamento
    fieldsets = (
        (None, {
            'fields': (('tipo_polo', 'nome'), ('tipo_pessoa', 'documento'), 'endereco')
        }),
    )
    form = ParteInlineForm

class ContratoInline(admin.StackedInline):
    model = Contrato
    extra = 1
    fk_name = 'processo'

# Formulário para ajustar a largura do campo UF
class ProcessoJudicialForm(forms.ModelForm):
    class Meta:
        model = ProcessoJudicial
        fields = '__all__'
        widgets = {
            'uf': forms.TextInput(attrs={'size': '5'}),
        }

@admin.register(ProcessoJudicial)
class ProcessoJudicialAdmin(admin.ModelAdmin):
    list_display = ('cnj', 'uf', 'vara', 'tribunal')
    search_fields = ('cnj',)
    inlines = [ParteInline, ContratoInline]
    form = ProcessoJudicialForm

    # 👇 VOLTAMOS PARA A ABORDAGEM SEGURA E FUNCIONAL
    fieldsets = (
        (None, {
            'fields': (
                'cnj', 
                ('uf', 'preencher_uf_button'), # Botão ao lado do campo UF
                'vara', 
                'tribunal', 
                'valor_causa'
            )
        }),
    )
    
    readonly_fields = ('preencher_uf_button',)

    # 👇 CARREGAMOS APENAS O SCRIPT ESSENCIAL
    class Media:
        js = ('admin/js/processo_judicial_enhancer.js',)

    @admin.display(description="")
    def preencher_uf_button(self, obj):
        return format_html('<button type="button" id="btn_preencher_uf" class="button">Preencher UF</button>')
