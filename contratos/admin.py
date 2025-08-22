from django.contrib import admin, messages
from django.db import models
from django.db.models import Count, Max
from django.http import HttpResponseRedirect, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.html import format_html
from django.urls import reverse, path
from django.contrib.humanize.templatetags.humanize import intcomma
import json
from django import forms
from django.utils.safestring import mark_safe
from decimal import Decimal, InvalidOperation

from .models import (
    ProcessoJudicial, Parte, Contrato, StatusProcessual, 
    AndamentoProcessual, Carteira, Etiqueta, ListaDeTarefas, Tarefa, Prazo
)

# --- Filtros ---
# --- Filtros ---
# Em contratos/admin.py

# Em contratos/admin.py

class EtiquetaFilter(admin.SimpleListFilter):
    title = 'Etiquetas'
    parameter_name = 'etiquetas'
    template = "admin/filter_checkbox.html" # Essencial para usar nosso template

    def lookups(self, request, model_admin):
        """
        Este método é obrigatório pelo Django. Retorna as opções de filtro,
        agora com a contagem de processos.
        """
        queryset = Etiqueta.objects.annotate(
            processo_count=Count('processojudicial')
        ).order_by('ordem', 'nome')
        
        return [
            (etiqueta.id, f"{etiqueta.nome} ({etiqueta.processo_count})")
            for etiqueta in queryset
        ]

    def queryset(self, request, queryset):
        """
        Filtra os processos para que contenham TODAS as etiquetas selecionadas.
        """
        valor = self.value()
        if valor:
            etiqueta_ids = valor.split(',')
            # Adiciona um .distinct() para evitar resultados duplicados na lista de processos
            queryset = queryset.distinct()
            for etiqueta_id in etiqueta_ids:
                if etiqueta_id:
                    queryset = queryset.filter(etiquetas__id=etiqueta_id)
        return queryset

    def choices(self, changelist):
        """
        Gera os links de filtro para o template, gerenciando a seleção múltipla.
        Este método é o que realmente será usado pelo nosso template.
        """
        selected_ids = self.value().split(',') if self.value() else []
        
        # Opção "Todos"
        yield {
            'selected': not self.value(),
            'query_string': changelist.get_query_string(remove=[self.parameter_name]),
            'display': 'Todos',
        }

        # Gera as opções para cada etiqueta
        for lookup, title in self.lookup_choices:
            lookup_str = str(lookup)
            selected = lookup_str in selected_ids
            
            new_selected_ids = list(selected_ids)
            if selected:
                new_selected_ids.remove(lookup_str)
            else:
                new_selected_ids.append(lookup_str)
            
            new_selected_ids = [sid for sid in new_selected_ids if sid]
            
            query_string = changelist.get_query_string({
                self.parameter_name: ','.join(new_selected_ids)
            })

            yield {
                'selected': selected,
                'query_string': query_string,
                'display': title,
            }


# --- Registro de Modelos Simples ---
@admin.register(Etiqueta)
class EtiquetaAdmin(admin.ModelAdmin):
    list_display = ('nome', 'ordem')
    list_editable = ('ordem',)
    ordering = ('ordem', 'nome')

    def get_changeform_initial_data(self, request):
        initial = super().get_changeform_initial_data(request)
        max_order = Etiqueta.objects.aggregate(max_ordem=Max('ordem'))['max_ordem'] or 0
        initial['ordem'] = max_order + 1
        return initial

@admin.register(ListaDeTarefas)
class ListaDeTarefasAdmin(admin.ModelAdmin):
    list_display = ('nome',)
    search_fields = ('nome',)


admin.site.site_header = "CFF SYSTEM"
admin.site.site_title = "Home"
admin.site.index_title = "Bem-vindo à Administração"

# --- Filtros ---
class TerceiroInteressadoFilter(admin.SimpleListFilter):
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

class AtivoStatusProcessualFilter(admin.SimpleListFilter):
    title = 'Status Processual'
    parameter_name = 'status'
    def lookups(self, request, model_admin):
        return [(s.id, s.nome) for s in StatusProcessual.objects.filter(ativo=True).order_by('ordem')]
    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(status__id=self.value())
        return queryset

# --- Forms ---
class ProcessoJudicialForm(forms.ModelForm):
    class Meta:
        model = ProcessoJudicial
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["uf"].widget.attrs.update({"id": "id_uf", "style": "width: 60px;"})
        self.fields["valor_causa"] = forms.CharField(
            widget=forms.TextInput(attrs={"class": "money-mask"}),
            required=False
        )

    def clean_valor_causa(self):
        valor = self.cleaned_data.get('valor_causa')
        if not valor:
            return Decimal('0.00')
        valor_str = str(valor).replace("R$", "").strip().replace(".", "").replace(",", ".")
        try:
            return Decimal(valor_str)
        except (InvalidOperation, ValueError, TypeError):
            raise forms.ValidationError("Por favor, insira um valor monetário válido.", code='invalid')

# --- Inlines ---
class AndamentoInline(admin.TabularInline):
    model = AndamentoProcessual
    extra = 0
    readonly_fields = ()
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

class TarefaInline(admin.TabularInline):
    model = Tarefa
    extra = 0
    autocomplete_fields = ['responsavel']

class PrazoInline(admin.TabularInline):
    model = Prazo
    extra = 0
    autocomplete_fields = ['responsavel']


# --- ModelAdmins ---
@admin.register(Carteira)
class CarteiraAdmin(admin.ModelAdmin):
    list_display = ('nome', 'get_total_processos', 'get_valor_total_carteira', 'get_valor_medio_processo', 'ver_processos_link')
    change_list_template = "admin/contratos/carteira/change_list.html"
    
    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
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
            return f"R$ {intcomma(round(valor_medio, 2), use_l10n=False).replace(',', 'X').replace('.', ',').replace('X', '.')}"
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

@admin.register(ProcessoJudicial)
class ProcessoJudicialAdmin(admin.ModelAdmin):
    form = ProcessoJudicialForm
    list_display = ("cnj", "get_polo_ativo", "get_x_separator", "get_polo_passivo", "uf", "status", "carteira", "busca_ativa")
    list_filter = ["busca_ativa", AtivoStatusProcessualFilter, "carteira", "uf", TerceiroInteressadoFilter, EtiquetaFilter]
    search_fields = ("cnj", "partes_processuais__nome",)
    inlines = [ParteInline, ContratoInline, AndamentoInline, TarefaInline, PrazoInline]
    fieldsets = (
        ("Controle e Status", {"fields": ("status", "carteira", "busca_ativa")}),
        ("Dados do Processo", {"fields": ("cnj", "uf", "vara", "tribunal", "valor_causa")}),
    )
    change_form_template = "admin/contratos/processojudicial/change_form_etiquetas.html"
    history_template = "admin/contratos/processojudicial/object_history.html"
    change_list_template = "admin/contratos/processojudicial/change_list_mapa.html"

    def changelist_view(self, request, extra_context=None):
        # Prepara o contexto extra ANTES de chamar o método pai.
        extra_context = extra_context or {}
        
        # Usa o changelist para obter o queryset filtrado.
        changelist = self.get_changelist_instance(request)
        queryset = changelist.get_queryset(request)
        
        etiquetas_data = {}
        for processo in queryset:
            etiquetas = processo.etiquetas.order_by('ordem', 'nome').values('nome', 'cor_fundo', 'cor_fonte')
            etiquetas_data[processo.pk] = list(etiquetas)
        
        extra_context['etiquetas_data_json'] = json.dumps(etiquetas_data)
        
        return super().changelist_view(request, extra_context=extra_context)

    class Media:
        css = {
            'all': (
                'admin/css/admin_tabs.css', 
                'admin/css/custom_admin_styles.css',
                'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/themes/classic.min.css'
            )
        }
        js = (
            'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/pickr.min.js',
            'admin/js/processo_judicial_enhancer.js', 
            'admin/js/admin_tabs.js', 
            'admin/js/input_masks.js', 
            'admin/js/etiqueta_interface.js',
            'admin/js/filter_search.js',
            'admin/js/mapa_interativo.js',
            'admin/js/tarefas_prazos_interface.js' # <-- Adicionado
         )

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path('<path:object_id>/etiquetas/', self.admin_site.admin_view(self.etiquetas_view), name='processo_etiquetas'),
            path('etiquetas/criar/', self.admin_site.admin_view(self.criar_etiqueta_view), name='etiqueta_criar'),
        ]
        return custom_urls + urls

    def etiquetas_view(self, request, object_id):
        processo = get_object_or_404(ProcessoJudicial, pk=object_id)
        if request.method == 'POST':
            try:
                data = json.loads(request.body)
                etiqueta_id = data.get('etiqueta_id')
                action = data.get('action')
                etiqueta = get_object_or_404(Etiqueta, pk=etiqueta_id)
                if action == 'add':
                    processo.etiquetas.add(etiqueta)
                    return JsonResponse({'status': 'added', 'etiqueta': {'id': etiqueta.id, 'nome': etiqueta.nome, 'cor_fundo': etiqueta.cor_fundo, 'cor_fonte': etiqueta.cor_fonte}})
                elif action == 'remove':
                    processo.etiquetas.remove(etiqueta)
                    return JsonResponse({'status': 'removed'})
                return JsonResponse({'status': 'error', 'message': 'Ação inválida.'}, status=400)
            except (json.JSONDecodeError, Etiqueta.DoesNotExist):
                return JsonResponse({'status': 'error', 'message': 'Dados inválidos.'}, status=400)
        
        todas_etiquetas = list(Etiqueta.objects.values('id', 'nome', 'cor_fundo', 'cor_fonte'))
        etiquetas_processo = list(processo.etiquetas.values('id', 'nome', 'cor_fundo', 'cor_fonte'))
        return JsonResponse({'todas_etiquetas': todas_etiquetas, 'etiquetas_processo': etiquetas_processo})

    def criar_etiqueta_view(self, request):
        if request.method == 'POST':
            try:
                data = json.loads(request.body)
                nome = data.get('nome', '').strip()
                cor_fundo = data.get('cor_fundo', '#417690')
                cor_fonte = data.get('cor_fonte', '#FFFFFF')

                if nome and not Etiqueta.objects.filter(nome__iexact=nome).exists():
                    # Calcula a próxima ordem disponível
                    max_order = Etiqueta.objects.aggregate(max_ordem=Max('ordem'))['max_ordem'] or 0
                    nova_ordem = max_order + 1
                    
                    etiqueta = Etiqueta.objects.create(
                        nome=nome, 
                        cor_fundo=cor_fundo, 
                        cor_fonte=cor_fonte,
                        ordem=nova_ordem
                    )
                    return JsonResponse({'status': 'created', 'etiqueta': {'id': etiqueta.id, 'nome': etiqueta.nome, 'cor_fundo': etiqueta.cor_fundo, 'cor_fonte': etiqueta.cor_fonte}}, status=201)
                return JsonResponse({'status': 'error', 'message': 'Nome inválido ou já existe.'}, status=400)
            except json.JSONDecodeError:
                return JsonResponse({'status': 'error', 'message': 'Dados inválidos.'}, status=400)
        return JsonResponse({'status': 'error', 'message': 'Método não permitido.'}, status=405)

    def history_view(self, request, object_id, extra_context=None):
        extra_context = extra_context or {}
        extra_context['object_id'] = object_id
        return super().history_view(request, object_id, extra_context=extra_context)

    def response_change(self, request, obj):
        messages.success(request, "Processo Salvo!")
        if "_save" in request.POST:
            return HttpResponseRedirect(request.path)
        return super().response_change(request, obj)

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "status":
            kwargs["queryset"] = StatusProcessual.objects.filter(ativo=True, ordem__gte=0)
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

@admin.register(StatusProcessual)
class StatusProcessualAdmin(admin.ModelAdmin):
    list_display = ("nome", "ordem", "ativo")
    list_editable = ("ordem", "ativo")
    list_filter = ("ativo",)
    ordering = ("ordem", "nome")
    change_list_template = 'admin/contratos/statusprocessual/change_list.html'

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

    def save_model(self, request, obj, form, change):
        if change and 'ordem' in form.changed_data:
            try:
                original_obj = StatusProcessual.objects.get(pk=obj.pk)
                if obj.ordem > 0:
                    canonical_status = StatusProcessual.objects.filter(ordem=obj.ordem).exclude(pk=obj.pk).first()
                    if canonical_status:
                        origin_status_name = original_obj.nome
                        canonical_status_name = canonical_status.nome
                        updated_count = ProcessoJudicial.objects.filter(status=original_obj).update(status=canonical_status)
                        obj.nome = f"{origin_status_name} (MESCLADO EM {canonical_status_name})"
                        obj.ativo = False
                        obj.ordem = 0
                        messages.success(request, f"O status '{origin_status_name}' foi mesclado com '{canonical_status_name}'. {updated_count} processo(s) foram atualizados.")
            except StatusProcessual.DoesNotExist:
                pass
        super().save_model(request, obj, form, change)