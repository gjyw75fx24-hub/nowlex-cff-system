from django.contrib import admin
from django.contrib.admin import SimpleListFilter
from django.db import models
from django.db.models import Count, Sum, Max
from django.http import HttpResponseRedirect
from django.utils.html import format_html
from django.urls import reverse
from django.contrib.humanize.templatetags.humanize import intcomma
import json
from django import forms
from django.utils.safestring import mark_safe

from .models import (
    ProcessoJudicial, Parte, Contrato, StatusProcessual, 
    AndamentoProcessual, Carteira
)

admin.site.site_header = "CFF SYSTEM"
admin.site.site_title = "Home"
admin.site.index_title = "Bem-vindo à Administração"

# --- Filtros ---
class TerceiroInteressadoFilter(SimpleListFilter):
    title = "⚠️ Terceiro Interessado"
    parameter_name = "terceiro_interessado"
    def lookups(self, request, model_admin):
        return [("sim", "Com terceiro interessado"), ("nao", "Apenas dois polos")]
    def queryset(self, request, queryset):
        if self.value() == "sim":
            return queryset.annotate(num_partes=models.Count("partes_processuais")).filter(num_partes__gt=2)
        if self.value() == "nao":
            return queryset.annotate(num_partes=models.Count("partes_processuais")).filter(num_partes__lte=2)
        return queryset

class AtivoStatusProcessualFilter(SimpleListFilter):
    title = 'Status Processual'
    parameter_name = 'status'
    def lookups(self, request, model_admin):
        return [(s.id, s.nome) for s in StatusProcessual.objects.filter(ativo=True).order_by('ordem')]
    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(status__id=self.value())
        return queryset

# --- Forms ---
from decimal import Decimal, InvalidOperation

class ProcessoJudicialForm(forms.ModelForm):
    class Meta:
        model = ProcessoJudicial
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["uf"].widget.attrs.update({"id": "id_uf", "style": "width: 60px;"})
        # Adiciona uma classe para o JavaScript encontrar o campo facilmente
        self.fields["valor_causa"] = forms.CharField(
    widget=forms.TextInput(attrs={"class": "money-mask"})
)


    def clean_valor_causa(self):
        """Limpa e converte o valor da causa (ex: 'R$ 1.234,56') para Decimal."""
        valor = self.cleaned_data.get('valor_causa')

        if isinstance(valor, Decimal):
            return valor

        if not valor:
            return Decimal('0.00')

        try:
            # Remove "R$", espaços, pontos de milhar e troca a vírgula por ponto
            valor_str = str(valor).replace("R$", "").replace(" ", "").replace(".", "").replace(",", ".")
            return Decimal(valor_str)
        except (InvalidOperation, ValueError, TypeError):
            raise forms.ValidationError("Por favor, insira um valor monetário válido.", code='invalid')


# --- Inlines ---
class AndamentoInline(admin.TabularInline):
    model = AndamentoProcessual
    extra = 0
    readonly_fields = ('data',)
    can_delete = True
    ordering = ('-data',)
    classes = ('dynamic-andamento',)
    formfield_overrides = {models.TextField: {"widget": forms.Textarea(attrs={"rows": 2, "cols": 100})}}

class ParteInline(admin.StackedInline):
    model = Parte
    extra = 1
    fk_name = "processo"
    classes = ('dynamic-partes',)
    can_delete = True
    fieldsets = ((None, {"fields": (("tipo_polo", "nome"), ("tipo_pessoa", "documento"), "endereco")}),)
    formfield_overrides = {models.TextField: {"widget": forms.Textarea(attrs={"rows": 4, "cols": 80})}}

class ContratoInline(admin.StackedInline):
    model = Contrato
    extra = 1
    fk_name = "processo"

# --- ModelAdmins ---
class CarteiraAdmin(admin.ModelAdmin):
    list_display = ('nome', 'get_total_processos', 'get_valor_total_carteira', 'get_valor_medio_processo', 'ver_processos_link')
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.annotate(
            total_processos=models.Count('processos', distinct=True),
            valor_total=models.Sum('processos__valor_causa')
        )

    @admin.display(description='📊 Nº de Processos', ordering='total_processos')
    def get_total_processos(self, obj):
        return obj.total_processos

    @admin.display(description='💰 Valor Total (Valuation)', ordering='valor_total')
    def get_valor_total_carteira(self, obj):
        valor = obj.valor_total or 0
        return f"R$ {intcomma(valor, use_l10n=False).replace(',', 'X').replace('.', ',').replace('X', '.')}"

    @admin.display(description='📈 Valor Médio por Processo')
    def get_valor_medio_processo(self, obj):
        if obj.total_processos > 0 and obj.valor_total is not None:
            valor_medio = obj.valor_total / obj.total_processos
            return f"R$ {intcomma(valor_medio, use_l10n=False).replace(',', 'X').replace('.', ',').replace('X', '.')}"
        return "R$ 0,00"

    @admin.display(description='Ações')
    def ver_processos_link(self, obj):
        url = reverse("admin:contratos_processojudicial_changelist") + f"?carteira__id__exact={obj.id}"
        return format_html('<a href="{}">Ver Processos</a>', url)

    def changelist_view(self, request, extra_context=None):
        chart_data = list(self.get_queryset(request).values('nome', 'total_processos', 'valor_total'))
        extra_context = extra_context or {}
        extra_context['chart_data'] = json.dumps(chart_data, default=str)
        return super().changelist_view(request, extra_context=extra_context)

    class Media:
        js = ('https://cdn.jsdelivr.net/npm/chart.js', 'admin/js/carteira_charts.js')

class ProcessoJudicialAdmin(admin.ModelAdmin):
    form = ProcessoJudicialForm
    list_display = ("cnj", "get_polo_ativo", "get_x_separator", "get_polo_passivo", "uf", "status", "carteira", "busca_ativa")
    list_filter = ["busca_ativa", AtivoStatusProcessualFilter, "carteira", "uf", TerceiroInteressadoFilter]
    search_fields = ("cnj", "partes_processuais__nome",)
    inlines = [ParteInline, ContratoInline, AndamentoInline]
    readonly_fields = ("cnj_busca_online_display",)
    fieldsets = (
        ("Controle e Status", {"fields": ("status", "carteira", "busca_ativa")}),
        ("Dados do Processo", {"fields": ("cnj", "cnj_busca_online_display", "uf", "vara", "tribunal", "valor_causa")}),
    )

    class Media:
        css = {'all': (
            'admin/css/admin_tabs.css',
            'admin/css/custom_admin_styles.css',
        )}
        js = (
            'admin/js/processo_judicial_enhancer.js',
            'admin/js/admin_tabs.js',
            'admin/js/input_masks.js',
        )

    def history_view(self, request, object_id, extra_context=None):
        extra_context = extra_context or {}
        extra_context['object_id'] = object_id
        return super().history_view(request, object_id, extra_context=extra_context)

    def response_change(self, request, obj):
        if "_save" in request.POST:
            return HttpResponseRedirect(request.path)
        return super().response_change(request, obj)

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "status":
            kwargs["queryset"] = StatusProcessual.objects.filter(ativo=True, ordem__gt=0)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    @admin.display(description="")
    def get_x_separator(self, obj):
        return mark_safe('<span title="Mais de dois polos">⚠️</span>') if obj.partes_processuais.count() > 2 else "x"

    @admin.display(description="Polo Ativo")
    def get_polo_ativo(self, obj):
        return getattr(obj.partes_processuais.filter(tipo_polo="ATIVO").first(), 'nome', '---')

    @admin.display(description="Polo Passivo")
    def get_polo_passivo(self, obj):
        return getattr(obj.partes_processuais.filter(tipo_polo="PASSIVO").first(), 'nome', '---')

    @admin.display(description="Buscar Dados Online")
    def cnj_busca_online_display(self, obj=None):
        url_busca = "/api/contratos/buscar-dados-escavador/"
        return mark_safe(f'''
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" id="btn_buscar_cnj" class="button" data-url="{url_busca}" disabled>Dados Online</button>
            </div>
            <div id="cnj_feedback" style="margin-top: 5px; font-weight: bold;"></div>
        ''')


class StatusProcessualAdmin(admin.ModelAdmin):
    list_display = ("nome", "ordem", "ativo")
    list_editable = ("ordem", "ativo")
    list_filter = ("ativo",)
    ordering = ("ordem", "nome")
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        if 'ativo__exact' not in request.GET:
             return queryset.filter(ativo=True)
        return queryset

    def get_changeform_initial_data(self, request):
        initial = super().get_changeform_initial_data(request)
        max_order = StatusProcessual.objects.aggregate(max_ordem=Max('ordem'))['max_ordem'] or 0
        initial['ordem'] = max_order + 1
        return initial

    class Media:
        js = ('admin/js/status_normalizer.js',)
