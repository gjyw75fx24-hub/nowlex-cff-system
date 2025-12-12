from django.contrib import admin, messages
from django.db import models
from django.db.models import FloatField
from django.db.models.functions import Now, Abs, Cast
from django.utils import timezone
from django.db.models import Count, Max, Subquery, OuterRef
from django.http import HttpResponseRedirect, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils.html import format_html
from django.urls import reverse, path
from django.contrib.humanize.templatetags.humanize import intcomma
import json
from django import forms
from django.utils.safestring import mark_safe
from decimal import Decimal, InvalidOperation
from django.contrib.auth.models import User # Importar o modelo User
from django.contrib.admin.models import LogEntry, CHANGE
from django.contrib.contenttypes.models import ContentType

from .models import (
    ProcessoJudicial, Parte, Contrato, StatusProcessual,
    AndamentoProcessual, Carteira, Etiqueta, ListaDeTarefas, Tarefa, Prazo,
    OpcaoResposta, QuestaoAnalise, AnaliseProcesso, BuscaAtivaConfig,
    AdvogadoPassivo, ProcessoArquivo, DocumentoModelo,
)
from .widgets import EnderecoWidget


# Form para seleção de usuário na ação de delegar
class UserForm(forms.Form):
    user = forms.ModelChoiceField(
        queryset=User.objects.all().order_by('username'),
        label="Selecionar Usuário",
        empty_label="Nenhum (Remover Delegação)"
    )


# --- Filtros ---
class EtiquetaFilter(admin.SimpleListFilter):
    title = 'Etiquetas'
    parameter_name = 'etiquetas'
    template = "admin/filter_checkbox.html"

    def lookups(self, request, model_admin):
        queryset = Etiqueta.objects.annotate(
            processo_count=Count('processojudicial')
        ).order_by('ordem', 'nome')
        
        return [
            (etiqueta.id, f"{etiqueta.nome} ({etiqueta.processo_count})")
            for etiqueta in queryset
        ]

    def queryset(self, request, queryset):
        valor = self.value()
        if valor:
            etiqueta_ids = valor.split(',')
            queryset = queryset.distinct()
            for etiqueta_id in etiqueta_ids:
                if etiqueta_id:
                    queryset = queryset.filter(etiquetas__id=etiqueta_id)
        return queryset

    def choices(self, changelist):
        selected_ids = self.value().split(',') if self.value() else []
        
        yield {
            'selected': not self.value(),
            'query_string': changelist.get_query_string(remove=[self.parameter_name]),
            'display': 'Todos',
        }

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


@admin.register(DocumentoModelo)
class DocumentoModeloAdmin(admin.ModelAdmin):
    list_display = ('nome', 'slug', 'arquivo', 'atualizado_em')
    readonly_fields = ('atualizado_em',)
    search_fields = ('nome', 'slug')
    ordering = ('slug', 'nome')
    fieldsets = (
        (None, {
            'fields': ('slug', 'nome', 'arquivo', 'descricao')
        }),
        ('Informações', {
            'fields': ('atualizado_em',),
        }),
    )

@admin.register(ListaDeTarefas)
class ListaDeTarefasAdmin(admin.ModelAdmin):
    list_display = ('nome',)
    search_fields = ('nome',)


admin.site.site_header = "CFF SYSTEM"
admin.site.site_title = "Home"
admin.site.index_title = "Bem-vindo à Administração"

class TerceiroInteressadoFilter(admin.SimpleListFilter):
    title = "⚠️ Terceiro Interessado"
    parameter_name = "terceiro_interessado"

    def lookups(self, request, model_admin):
        base_qs = model_admin.get_queryset(request)
        qs_counts = base_qs.annotate(num_partes=models.Count("partes_processuais"))
        count_sim = qs_counts.filter(num_partes__gt=2).count()
        count_nao = qs_counts.filter(num_partes__lte=2).count()
        return [
            ("sim", mark_safe(f"Com terceiro interessado <span class='filter-count'>({count_sim})</span>")),
            ("nao", mark_safe(f"Apenas dois polos <span class='filter-count'>({count_nao})</span>")),
        ]

    def queryset(self, request, queryset):
        qs = queryset.annotate(num_partes=models.Count("partes_processuais"))
        if self.value() == "sim":
            return qs.filter(num_partes__gt=2)
        if self.value() == "nao":
            return qs.filter(num_partes__lte=2)
        return qs

class AtivoStatusProcessualFilter(admin.SimpleListFilter):
    title = 'Classe Processual'
    parameter_name = 'status'

    def lookups(self, request, model_admin):
        # Conta quantos processos há por classe usando o queryset já filtrado
        qs = model_admin.get_queryset(request)
        counts = {row['status__id']: row['total'] for row in qs.values('status__id').annotate(total=models.Count('id'))}
        items = []
        for s in StatusProcessual.objects.filter(ativo=True).order_by('ordem'):
            total = counts.get(s.id, 0)
            label = mark_safe(f"{s.nome} <span class='filter-count'>({total})</span>")
            items.append((s.id, label))
        return items

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(status__id=self.value())
        return queryset


class LastEditOrderFilter(admin.SimpleListFilter):
    title = 'Por Última Edição'
    parameter_name = 'ord_ultima_edicao'

    def lookups(self, request, model_admin):
        return (
            ('recente', 'A → Z (mais recente primeiro)'),
            ('antigo', 'Z → A (mais distante primeiro)'),
        )

    def queryset(self, request, queryset):
        if self.value() == 'recente':
            return queryset.order_by(models.F('last_edit_time').desc(nulls_last=True), '-pk')
        if self.value() == 'antigo':
            return queryset.order_by(models.F('last_edit_time').asc(nulls_last=True), 'pk')
        return queryset


class UFCountFilter(admin.SimpleListFilter):
    title = 'UF'
    parameter_name = 'uf'

    def lookups(self, request, model_admin):
        qs = model_admin.get_queryset(request)
        counts = {row['uf']: row['total'] for row in qs.values('uf').annotate(total=models.Count('id')) if row['uf']}
        return [(uf, mark_safe(f"{uf} <span class='filter-count'>({counts.get(uf, 0)})</span>")) for uf in sorted(counts.keys())]

    def queryset(self, request, queryset):
        values = request.GET.getlist(self.parameter_name)
        if values:
            return queryset.filter(uf__in=values)
        return queryset


class CarteiraCountFilter(admin.SimpleListFilter):
    title = 'Carteira'
    parameter_name = 'carteira'

    def lookups(self, request, model_admin):
        qs = model_admin.get_queryset(request)
        counts = {row['carteira__id']: row['total'] for row in qs.values('carteira__id').annotate(total=models.Count('id')) if row['carteira__id']}
        items = []
        for cart in Carteira.objects.order_by('nome'):
            total = counts.get(cart.id, 0)
            items.append((cart.id, mark_safe(f"{cart.nome} <span class='filter-count'>({total})</span>")))
        return items

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(carteira_id=self.value())
        return queryset


class NaoJudicializadoFilter(admin.SimpleListFilter):
    title = 'Por Não Judicializado'
    parameter_name = 'nao_judicializado'

    def lookups(self, request, model_admin):
        qs = model_admin.get_queryset(request)
        count_sim = qs.filter(nao_judicializado=True).count()
        count_nao = qs.filter(nao_judicializado=False).count()
        return [
            ('1', mark_safe(f"Sim <span class=\"filter-count\">({count_sim})</span>")),
            ('0', mark_safe(f"Não <span class=\"filter-count\">({count_nao})</span>")),
        ]

    def queryset(self, request, queryset):
        if self.value() == '1':
            return queryset.filter(nao_judicializado=True)
        if self.value() == '0':
            return queryset.filter(nao_judicializado=False)
        return queryset


class EquipeDelegadoFilter(admin.SimpleListFilter):
    title = "Equipe"
    parameter_name = "delegado_para"

    def lookups(self, request, model_admin):
        qs = model_admin.get_queryset(request)
        counts = qs.values('delegado_para_id').annotate(total=models.Count('id')).filter(delegado_para_id__isnull=False)
        user_map = {u.id: u for u in User.objects.filter(id__in=[c['delegado_para_id'] for c in counts])}
        items = []
        for row in counts:
            user = user_map.get(row['delegado_para_id'])
            username = user.username if user else ''
            full_name = user.get_full_name() if user else ''
            label = full_name or username or 'Sem nome'
            label = mark_safe(f"{label} <span class='filter-count'>({row['total']})</span>")
            items.append((row['delegado_para_id'], label))
        items.sort(key=lambda x: str(x[1]).lower())
        return items

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(delegado_para_id=self.value())
        return queryset


class PrescricaoOrderFilter(admin.SimpleListFilter):
    title = "Por Prescrição"
    parameter_name = "ord_prescricao"

    def lookups(self, request, model_admin):
        return (
            ("az", "A → Z (mais próxima primeiro)"),
            ("za", "Z → A (mais distante primeiro)"),
            ("incluir", "Incluir prescritos"),
            ("clear", "Limpar"),
        )

    def choices(self, changelist):
        # Permite que clicar novamente em "Incluir prescritos" limpe o filtro
        include_value = "incluir"
        for lookup, title in self.lookup_choices:
            selected = self.value() == lookup
            if lookup == include_value and selected:
                qs = changelist.get_query_string(remove=[self.parameter_name])
            else:
                qs = changelist.get_query_string({self.parameter_name: lookup})
            yield {
                'selected': selected,
                'query_string': qs,
                'display': title,
            }

    def queryset(self, request, queryset):
        # Se filtrando explicitamente por não judicializado, não aplicamos ordenação/filtro de prescrição
        if request.GET.get('nao_judicializado') is not None:
            return queryset
        queryset = queryset.annotate(
            primeira_prescricao=models.Min('contratos__data_prescricao'),
        )
        # Ignora contratos já prescritos por padrão (controlado pelo checkbox complementar)
        if self.value() != "incluir":
            today = timezone.now().date()
            queryset = queryset.filter(
                models.Q(primeira_prescricao__gte=today) | models.Q(primeira_prescricao__isnull=True)
            )
        # Converte a diferença para segundos para usar ABS numérico (evita ABS de interval no Postgres)
        queryset = queryset.annotate(
            distancia_segundos=Abs(
                models.Func(
                    models.F('primeira_prescricao') - Now(),
                    function="DATE_PART",
                    template="DATE_PART('epoch', %(expressions)s)",
                    output_field=FloatField(),
                )
            )
        )
        queryset = queryset.annotate(
            distancia_prescricao=models.F('distancia_segundos')
        )
        if self.value() == "az":
            return queryset.order_by(models.F('distancia_prescricao').asc(nulls_last=True), 'pk')
        if self.value() == "za":
            return queryset.order_by(models.F('distancia_prescricao').desc(nulls_last=True), '-pk')
        if self.value() == "clear":
            return queryset
        # Default: sem filtro especial
        return queryset


class ViabilidadeFinanceiraFilter(admin.SimpleListFilter):
    title = "Viabilidade"
    parameter_name = 'viabilidade_financeira'

    def lookups(self, request, model_admin):
        return [
            (ProcessoJudicial.VIABILIDADE_VIAVEL, mark_safe('<span class="viabilidade-option viavel">Viável</span>')),
            (ProcessoJudicial.VIABILIDADE_INVIAVEL, mark_safe('<span class="viabilidade-option inviavel">Inviável</span>')),
            (ProcessoJudicial.VIABILIDADE_INCONCLUSIVO, mark_safe('<span class="viabilidade-option inconclusivo">Inconclusivo</span>')),
        ]

    def queryset(self, request, queryset):
        val = self.value()
        if val:
            return queryset.filter(viabilidade=val)
        return queryset


class AcordoStatusFilter(admin.SimpleListFilter):
    title = "Por Acordo"
    parameter_name = "acordo_status"

    def lookups(self, request, model_admin):
        from contratos.models import AdvogadoPassivo
        return (
            (AdvogadoPassivo.AcordoChoices.PROPOR, "Propor"),
            (AdvogadoPassivo.AcordoChoices.PROPOSTO, "Proposto"),
            (AdvogadoPassivo.AcordoChoices.FIRMADO, "Firmado"),
            (AdvogadoPassivo.AcordoChoices.RECUSADO, "Recusado"),
            ("sem", "Sem acordo"),
        )

    def queryset(self, request, queryset):
        value = self.value()
        if not value:
            return queryset
        if value == "sem":
            return queryset.filter(
                models.Q(advogados_passivos__acordo_status__isnull=True)
                | models.Q(advogados_passivos__acordo_status="")
            ).distinct()
        return queryset.filter(advogados_passivos__acordo_status=value).distinct()




class AndamentoProcessualForm(forms.ModelForm):
    class Meta:
        model = AndamentoProcessual
        fields = '__all__'
        widgets = {
            'descricao': forms.Textarea(attrs={'rows': 2, 'cols': 600}), # 6x a largura original
            'detalhes': forms.Textarea(attrs={'rows': 2, 'cols': 50}), # Proporcionalmente menor
        }

class AndamentoInline(admin.TabularInline):
    form = AndamentoProcessualForm
    model = AndamentoProcessual
    extra = 0
    can_delete = True
    ordering = ('-data',)
    classes = ('dynamic-andamento',)

class ParteForm(forms.ModelForm):
    class Meta:
        model = Parte
        fields = '__all__'
        widgets = {
            'endereco': EnderecoWidget(),
            'obito': forms.HiddenInput(),
        }

class ParteInline(admin.StackedInline):
    model = Parte
    form = ParteForm
    extra = 0
    fk_name = "processo"
    classes = ('dynamic-partes',)
    can_delete = True
    fieldsets = (
        (
            None,
            {
                "fields": (
                    ("tipo_polo", "tipo_pessoa"),
                    ("nome", "documento"),
                    "endereco",
                    "obito",
                )
            },
        ),
    )


class AdvogadoPassivoInline(admin.StackedInline):
    model = AdvogadoPassivo
    fk_name = "processo"
    extra = 0
    autocomplete_fields = ('responsavel',)
    classes = ('advogado-passivo-inline',)
    verbose_name_plural = "Advogado Parte Passiva"
    fieldsets = (
        (
            None,
            {"fields": (
                ("nome", "responsavel"),
                ("uf_oab", "oab_numero"),
                ("email", "telefone"),
                "acordo_status",
                "valor_acordado",
                "observacao",
                ("agendar_ligacao_em", "lembrete_enviado"),
            )},
        ),
    )

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        formfield = super().formfield_for_dbfield(db_field, request, **kwargs)
        if db_field.name == 'valor_acordado':
            css = formfield.widget.attrs.get('class', '')
            formfield.widget.attrs['class'] = (css + ' money-mask').strip()
        return formfield


class ContratoForm(forms.ModelForm):
    class Meta:
        model = Contrato
        fields = "__all__"

    valor_total_devido = forms.DecimalField(
        required=False,
        decimal_places=2,
        max_digits=14,
        widget=forms.TextInput(attrs={'class': 'vTextField'})
    )
    valor_causa = forms.DecimalField(
        required=False,
        decimal_places=2,
        max_digits=14,
        widget=forms.TextInput(attrs={'class': 'vTextField'})
    )

    def _clean_decimal(self, field_name):
        raw = self.data.get(self.add_prefix(field_name), '')
        if raw is None:
            return None
        raw = str(raw).strip()
        if raw == '':
            return None
        if ',' in raw:
            raw = raw.replace('.', '').replace(',', '.')
        try:
            return Decimal(raw)
        except InvalidOperation:
            raise forms.ValidationError("Informe um número válido.")

    def clean_valor_total_devido(self):
        return self._clean_decimal('valor_total_devido')

    def clean_valor_causa(self):
        return self._clean_decimal('valor_causa')


class ContratoInline(admin.StackedInline):
    form = ContratoForm
    model = Contrato
    extra = 0
    fk_name = "processo"

class TarefaInline(admin.TabularInline):
    model = Tarefa
    extra = 0
    autocomplete_fields = ['responsavel']

class PrazoInline(admin.TabularInline):
    model = Prazo
    extra = 0

class ProcessoArquivoInline(admin.TabularInline):
    model = ProcessoArquivo
    extra = 0
    fields = ('nome', 'arquivo', 'enviado_por', 'criado_em')
    readonly_fields = ('criado_em',)
    autocomplete_fields = ['enviado_por']
    verbose_name = "Arquivo"
    verbose_name_plural = "Arquivos"

# Definir um formulário para AnaliseProcesso para garantir o widget correto
class AnaliseProcessoAdminForm(forms.ModelForm):
    class Meta:
        model = AnaliseProcesso
        fields = '__all__'
        widgets = {
            'respostas': forms.Textarea(attrs={'class': 'vLargeTextField analise-respostas-json', 'style': 'display: none;'})
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Campo não obrigatório: a análise pode começar vazia e ser preenchida via JS
        self.fields['respostas'].required = False
        # Verifica se a instância existe e tem uma primary key (ou seja, já foi salva)
        # e tenta acessar processo_judicial de forma segura.
        if self.instance and self.instance.pk:
            try:
                cnj_analise = self.instance.processo_judicial.cnj
                self.fields['respostas'].widget.attrs['data-analise-cnj'] = cnj_analise
                # Adiciona a data de atualização ao widget
                if self.instance.updated_at:
                    self.fields['respostas'].widget.attrs['data-analise-updated-at'] = self.instance.updated_at.isoformat()
                # Adiciona o nome do usuário que atualizou
                if self.instance.updated_by:
                    self.fields['respostas'].widget.attrs['data-analise-updated-by'] = self.instance.updated_by.get_full_name() or self.instance.updated_by.username
            except AnaliseProcesso.processo_judicial.RelatedObjectDoesNotExist:
                # Se o AnaliseProcesso existir mas não tiver um processo_judicial
                # associado (o que não deveria acontecer para um OneToOneField salvo),
                # ou se for uma instância nova ainda não associada.
                pass

    def clean_respostas(self):
        # Garante que retornamos um dict mesmo quando vazio ou não enviado,
        # evitando erros de validação e permitindo que o default seja usado.
        data = self.cleaned_data.get('respostas')
        return data or {}

class AnaliseProcessoInline(admin.StackedInline): # Usando StackedInline para melhor visualização do JSONField
    form = AnaliseProcessoAdminForm # Usar o formulário customizado
    model = AnaliseProcesso
    classes = ('analise-procedural-group',)
    can_delete = False # Geralmente, só queremos uma análise por processo, não deletável diretamente aqui.
    verbose_name_plural = "Análise de Processo"
    fk_name = 'processo_judicial' # Garantir que o fk_name esteja correto, pois é um OneToOneField
    fields = ('respostas',) # Apenas o campo JSONField será editável
    extra = 1 # Alterado para 1, para permitir a criação de uma nova instância se não houver
    max_num = 1 # Mantido em 1 por enquanto para a questão da visualização
    template = 'admin/contratos/analiseprocesso/stacked.html'

    class Media:
        css = {'all': ('admin/css/analise_processo.css',)}
        js = ('admin/js/analise_processo_arvore.js',)

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

class ValorCausaOrderFilter(admin.SimpleListFilter):
    title = 'Por Valor da Causa'
    parameter_name = 'valor_causa_order'

    def lookups(self, request, model_admin):
        return [
            ('desc', 'Z a A (Maior primeiro)'),
            ('asc', 'A a Z (Menor primeiro)'),
        ]

    def queryset(self, request, queryset):
        value = self.value()
        if value == 'desc':
            return queryset.order_by('-valor_causa')
        if value == 'asc':
            return queryset.order_by('valor_causa')
        return queryset


class ObitoFilter(admin.SimpleListFilter):
    title = 'Por Óbito'
    parameter_name = 'obito'

    def lookups(self, request, model_admin):
        return [
            ('sim', 'Com Óbito'),
            ('nao', 'Sem Óbito'),
        ]

    def queryset(self, request, queryset):
        val = self.value()
        if val == 'sim':
            return queryset.filter(partes_processuais__obito=True).distinct()
        if val == 'nao':
            return queryset.exclude(partes_processuais__obito=True).distinct()
        return queryset


@admin.register(ProcessoJudicial)
class ProcessoJudicialAdmin(admin.ModelAdmin):
    readonly_fields = ('valor_causa',)
    list_display = ("cnj", "get_polo_ativo", "get_x_separator", "get_polo_passivo", "uf", "status", "carteira", "busca_ativa", "nao_judicializado")
    list_filter = [LastEditOrderFilter, EquipeDelegadoFilter, PrescricaoOrderFilter, ViabilidadeFinanceiraFilter, ValorCausaOrderFilter, ObitoFilter, AcordoStatusFilter, "busca_ativa", NaoJudicializadoFilter, AtivoStatusProcessualFilter, CarteiraCountFilter, UFCountFilter, TerceiroInteressadoFilter, EtiquetaFilter]
    search_fields = ("cnj", "partes_processuais__nome", "partes_processuais__documento",)
    inlines = [ParteInline, AdvogadoPassivoInline, ContratoInline, AndamentoInline, TarefaInline, PrazoInline, AnaliseProcessoInline, ProcessoArquivoInline]
    fieldsets = (
        ("Controle e Status", {"fields": ("status", "carteira", "busca_ativa", "viabilidade")}),
        ("Dados do Processo", {"fields": ("cnj", "uf", "vara", "tribunal", "valor_causa")}),
    )
    change_form_template = "admin/contratos/processojudicial/change_form_navegacao.html"
    history_template = "admin/contratos/processojudicial/object_history.html"
    change_list_template = "admin/contratos/processojudicial/change_list_mapa.html"
    actions = ['excluir_andamentos_selecionados', 'delegate_processes']

    def save_model(self, request, obj, form, change):
        # Garante que a carteira escolhida no formulário seja persistida
        obj.carteira = form.cleaned_data.get('carteira')
        super().save_model(request, obj, form, change)

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        ct = ContentType.objects.get_for_model(ProcessoJudicial)
        last_logs = LogEntry.objects.filter(
            content_type=ct,
            object_id=Cast(OuterRef('pk'), models.CharField()),
            action_flag=CHANGE
        ).order_by('-action_time')
        return qs.annotate(
            last_edit_time=Subquery(last_logs.values('action_time')[:1]),
            last_edit_user_id=Subquery(last_logs.values('user_id')[:1]),
        )

    def change_view(self, request, object_id, form_url='', extra_context=None):
        extra_context = extra_context or {}
        
        # Preserva os filtros da changelist para a navegação
        changelist_filters = request.GET.get('_changelist_filters')

        # Clona os filtros para o queryset da changelist, evitando que o Django
        # tente filtrar pelo parâmetro especial "_changelist_filters"
        from django.http import QueryDict
        original_get = request.GET
        if changelist_filters:
            request.GET = QueryDict(changelist_filters, mutable=False)
        else:
            request.GET = QueryDict('', mutable=False)
        
        # Usa o mesmo queryset da changelist para consistência
        changelist = self.get_changelist_instance(request)
        queryset = changelist.get_queryset(request)

        # Restaura o GET original para não afetar o restante do fluxo
        request.GET = original_get
        
        # Garante uma ordenação consistente
        ordering = self.get_ordering(request) or ('-pk',)
        object_list = list(queryset.order_by(*ordering).values_list('pk', flat=True))
        
        try:
            current_index = object_list.index(int(object_id))
        except ValueError:
            current_index = -1

        prev_obj_id = object_list[current_index - 1] if current_index > 0 else None
        next_obj_id = object_list[current_index + 1] if current_index != -1 and current_index < len(object_list) - 1 else None

        # Monta as URLs preservando os filtros
        base_url = reverse('admin:contratos_processojudicial_changelist') + "{}"
        filter_params = f'?{changelist_filters}' if changelist_filters else ''

        extra_context['prev_obj_url'] = base_url.format(f'{prev_obj_id}/change/{filter_params}') if prev_obj_id else None
        extra_context['next_obj_url'] = base_url.format(f'{next_obj_id}/change/{filter_params}') if next_obj_id else None
        extra_context['delegar_users'] = User.objects.order_by('username')
        
        return super().change_view(request, object_id, form_url, extra_context=extra_context)


    def save_formset(self, request, form, formset, change):
        if formset.model == AnaliseProcesso:
            # Salva manualmente para garantir persistência do JSON (contratos para monitória)
            # e ainda alimentar as listas usadas pelo Django para mensagens.
            new_objects = []
            changed_objects = []
            deleted_objects = []

            for inline_form in formset.forms:
                # Ignore completely empty inline rows that Django still validates,
                # otherwise we end up persisting a blank AnaliseProcesso without FK.
                if not inline_form.has_changed() and not inline_form.cleaned_data.get('DELETE'):
                    continue

                if inline_form.cleaned_data.get('DELETE'):
                    obj = inline_form.instance
                    if obj.pk:
                        obj.delete()
                        deleted_objects.append(obj)
                    continue

                instance = inline_form.save(commit=False)
                if isinstance(instance, AnaliseProcesso):
                    # Assegura que o FK seja preenchido ao criar novo processo
                    if not instance.processo_judicial_id:
                        instance.processo_judicial = form.instance
                    instance.updated_by = request.user

                is_new = instance.pk is None
                instance.save()
                inline_form.save_m2m()

                if is_new:
                    new_objects.append(instance)
                else:
                    changed_objects.append((instance, inline_form.changed_data))

            formset.new_objects = new_objects
            formset.changed_objects = changed_objects
            formset.deleted_objects = deleted_objects
        else:
            super().save_formset(request, form, formset, change)


    def changelist_view(self, request, extra_context=None):
        extra_context = extra_context or {}
        changelist = self.get_changelist_instance(request)
        queryset = changelist.get_queryset(request)
        
        etiquetas_data = {}
        for processo in queryset:
            etiquetas = processo.etiquetas.order_by('ordem', 'nome').values('nome', 'cor_fundo', 'cor_fonte')
            etiquetas_data[processo.pk] = list(etiquetas)
        
        extra_context['etiquetas_data_json'] = json.dumps(etiquetas_data)
        extra_context['delegar_users'] = User.objects.order_by('username')
        
        return super().changelist_view(request, extra_context=extra_context)

    class Media:
        css = {
            'all': (
                'admin/css/admin_tabs.css', 
                'admin/css/custom_admin_styles.css',
                'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/themes/classic.min.css',
                'admin/css/cia_button.css',
                'admin/css/endereco_widget.css', # <--- Adicionado
                'admin/css/analise_processo.css', # <--- Adicionado
            )
        }
        js = (
            'admin/js/vendor/jquery/jquery.min.js', 
            'admin/js/jquery.init.js',
            'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/pickr.min.js',
            'admin/js/processo_judicial_enhancer.js', 
            'admin/js/admin_tabs.js', 
            'admin/js/etiqueta_interface.js',
            'admin/js/filter_search.js',
            'admin/js/mapa_interativo.js',
            'admin/js/tarefas_prazos_interface.js',
            'admin/js/soma_contratos.js',
            'admin/js/cia_button.js',
            'admin/js/analise_processo_arvore.js',
            'admin/js/cpf_formatter.js',
            'admin/js/info_card_manager.js',
         )

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path('<path:object_id>/etiquetas/', self.admin_site.admin_view(self.etiquetas_view), name='processo_etiquetas'),
            path('etiquetas/criar/', self.admin_site.admin_view(self.criar_etiqueta_view), name='etiqueta_criar'),
            path('delegate-select-user/', self.admin_site.admin_view(self.delegate_select_user_view), name='processo_delegate_select_user'), # NEW PATH
            path('delegate-bulk/', self.admin_site.admin_view(self.delegate_bulk_view), name='processo_delegate_bulk'),
            path('<path:object_id>/atualizar-andamentos/', self.admin_site.admin_view(self.atualizar_andamentos_view), name='processo_atualizar_andamentos'),
            path('<path:object_id>/delegar-inline/', self.admin_site.admin_view(self.delegar_inline_view), name='processo_delegate_inline'),
        ]
        return custom_urls + urls

    def delegate_bulk_view(self, request):
        if request.method != 'POST':
            return JsonResponse({'error': 'Método não permitido'}, status=405)
        ids = request.POST.get('ids', '')
        user_id = request.POST.get('user_id')
        if not ids:
            return JsonResponse({'error': 'Nenhum processo selecionado'}, status=400)
        try:
            pk_list = [int(i) for i in ids.split(',') if i]
        except ValueError:
            return JsonResponse({'error': 'IDs inválidos'}, status=400)
        user = None
        if user_id:
            user = User.objects.filter(pk=user_id).first()
            if not user:
                return JsonResponse({'error': 'Usuário inválido'}, status=400)
        updated = self.model.objects.filter(pk__in=pk_list).update(delegado_para=user)
        return JsonResponse({'updated': updated})

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

    def atualizar_andamentos_view(self, request, object_id):
        """
        Endpoint acionado pelo botão 'Atualizar andamentos agora'.
        Busca andamentos na API do Escavador para o processo com CNJ informado
        e salva no banco.
        """
        processo = get_object_or_404(ProcessoJudicial, pk=object_id)

        if not processo.cnj:
            self.message_user(request, "Processo sem CNJ. Preencha o CNJ para buscar andamentos.", level=messages.ERROR)
            return HttpResponseRedirect(reverse('admin:contratos_processojudicial_change', args=[object_id]))

        try:
            from contratos.integracoes_escavador.atualizador import atualizar_processo_do_escavador
            resultado = atualizar_processo_do_escavador(processo.cnj)
            if resultado:
                self.message_user(request, f"Andamentos atualizados para o processo {processo.cnj}.", level=messages.SUCCESS)
            else:
                self.message_user(request, f"Não foi possível atualizar andamentos para o processo {processo.cnj}. Verifique o token da API.", level=messages.ERROR)
        except Exception as exc:
            self.message_user(request, f"Erro ao atualizar andamentos: {exc}", level=messages.ERROR)

        return HttpResponseRedirect(reverse('admin:contratos_processojudicial_change', args=[object_id]))

    def history_view(self, request, object_id, extra_context=None):
        extra_context = extra_context or {}
        extra_context['object_id'] = object_id
        return super().history_view(request, object_id, extra_context=extra_context)

    def response_change(self, request, obj):
        if '_action' in request.POST and request.POST['_action'] == 'excluir_andamentos_selecionados':
            selected_andamento_ids = []
            # Iterate through the POST data to find selected inline items
            for key, value in request.POST.items():
                if key.startswith('andamentos-') and key.endswith('-id') and value:
                    # Check if the corresponding DELETE checkbox is marked
                    form_idx = key.split('-')[1]
                    delete_key = f'andamentos-{form_idx}-DELETE'
                    if delete_key in request.POST:
                        selected_andamento_ids.append(value)
            
            if selected_andamento_ids:
                count, _ = AndamentoProcessual.objects.filter(pk__in=selected_andamento_ids).delete()
                self.message_user(request, f"{count} andamento(s) foram excluídos com sucesso.", messages.SUCCESS)
            else:
                self.message_user(request, "Nenhum andamento foi selecionado para exclusão.", messages.WARNING)
            
            return HttpResponseRedirect(request.path)

        messages.success(request, "Processo Salvo!")
        if "_save" in request.POST:
            return HttpResponseRedirect(request.path)
        return super().response_change(request, obj)

    def response_add(self, request, obj, post_url_continue=None):
        """
        Após salvar um novo processo, permanece na tela de detalhes.
        """
        return HttpResponseRedirect(
            reverse('admin:contratos_processojudicial_change', args=[obj.pk])
        )

    def excluir_andamentos_selecionados(self, request, queryset):
        # Esta função será chamada quando a ação for executada
        # O queryset aqui será dos ProcessoJudicial, mas precisamos dos AndamentoProcessual
        # Esta action será acionada via um botão customizado no change_form
        
        # A lógica de exclusão será tratada no response_change
        pass
    excluir_andamentos_selecionados.short_description = "Excluir Andamentos Selecionados"

    def delegate_processes(self, request, queryset):
        # Redireciona para uma view intermediária para selecionar o usuário
        selected_ids = ','.join(str(pk) for pk in queryset.values_list('pk', flat=True))
        return HttpResponseRedirect(f'delegate-select-user/?ids={selected_ids}')
    delegate_processes.short_description = "Delegar processos selecionados"

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

    def delegate_select_user_view(self, request):
        opts = self.model._meta
        app_label = opts.app_label
        
        # Recupera os IDs dos processos selecionados da URL
        selected_ids = request.GET.get('ids', '')
        if not selected_ids:
            self.message_user(request, "Nenhum processo selecionado para delegar.", messages.WARNING)
            return HttpResponseRedirect("../")
        
        process_pks = [int(pk) for pk in selected_ids.split(',')]
        
        if request.method == 'POST':
            form = UserForm(request.POST)
            if form.is_valid():
                selected_user = form.cleaned_data['user']
                
                # Atualiza os processos
                self.model.objects.filter(pk__in=process_pks).update(delegado_para=selected_user)
                
                user_name = selected_user.username if selected_user else "Ninguém"
                self.message_user(request, f"{len(process_pks)} processo(s) delegados para {user_name} com sucesso.", messages.SUCCESS)
                return HttpResponseRedirect("../") # Volta para a changelist
            else:
                self.message_user(request, "Por favor, selecione um usuário válido.", messages.ERROR)
        else:
            form = UserForm()
        
        context = {
            'form': form,
            'process_pks': process_pks,
            'opts': opts,
            'app_label': app_label,
            'title': "Delegar Processos Selecionados",
            'is_popup': False,
            'media': self.media, # Inclui os assets do admin para o formulário
        }
        return render(request, 'admin/contratos/processojudicial/delegate_select_user.html', context)

    def delegar_inline_view(self, request, object_id):
        processo = get_object_or_404(ProcessoJudicial, pk=object_id)
        if request.method == 'POST':
            user_id = request.POST.get('delegado_para')
            if user_id:
                user = User.objects.filter(pk=user_id).first()
                processo.delegado_para = user
            else:
                processo.delegado_para = None
            processo.save()
            user_name = (processo.delegado_para.get_full_name() or processo.delegado_para.username) if processo.delegado_para else "Ninguém"
            self.message_user(request, f"Processo delegado para {user_name}.", messages.SUCCESS)
        return HttpResponseRedirect(reverse('admin:contratos_processojudicial_change', args=[object_id]))

def delegate_select_user_view(self, request):
        opts = self.model._meta
        app_label = opts.app_label
        
        # Recupera os IDs dos processos selecionados da URL
        selected_ids = request.GET.get('ids', '')
        if not selected_ids:
            self.message_user(request, "Nenhum processo selecionado para delegar.", messages.WARNING)
            return HttpResponseRedirect("../")
        
        process_pks = [int(pk) for pk in selected_ids.split(',')]
        
        if request.method == 'POST':
            form = UserForm(request.POST)
            if form.is_valid():
                selected_user = form.cleaned_data['user']
                
                # Atualiza os processos
                self.model.objects.filter(pk__in=process_pks).update(delegado_para=selected_user)
                
                user_name = selected_user.username if selected_user else "Ninguém"
                self.message_user(request, f"{len(process_pks)} processo(s) delegados para {user_name} com sucesso.", messages.SUCCESS)
                return HttpResponseRedirect("../") # Volta para a changelist
            else:
                self.message_user(request, "Por favor, selecione um usuário válido.", messages.ERROR)
        else:
            form = UserForm()
        
        context = {
            'form': form,
            'process_pks': process_pks,
            'opts': opts,
            'app_label': app_label,
            'title': "Delegar Processos Selecionados",
            'is_popup': False,
            'media': self.media, # Inclui os assets do admin para o formulário
        }
        return render(request, 'admin/contratos/processojudicial/delegate_select_user.html', context)


@admin.register(BuscaAtivaConfig)
class BuscaAtivaConfigAdmin(admin.ModelAdmin):
    list_display = ("horario", "habilitado", "ultima_execucao")
    readonly_fields = ("ultima_execucao",)

    def has_add_permission(self, request):
        # Impede múltiplos registros; apenas edição do único registro
        return not BuscaAtivaConfig.objects.exists()

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

# --- Admin para o Motor da Árvore de Decisão ---

class OpcaoRespostaInline(admin.TabularInline):
    model = OpcaoResposta
    extra = 1
    fk_name = 'questao_origem'
    # Autocomplete para facilitar a seleção da próxima questão
    autocomplete_fields = ['proxima_questao']

@admin.register(QuestaoAnalise) # Referência por string
class QuestaoAnaliseAdmin(admin.ModelAdmin):
    list_display = ('texto_pergunta', 'chave', 'tipo_campo', 'is_primeira_questao', 'ordem')
    list_filter = ('tipo_campo', 'is_primeira_questao')
    search_fields = ('texto_pergunta', 'chave',)
    list_editable = ('is_primeira_questao', 'ordem')
    inlines = [OpcaoRespostaInline]
    
    fieldsets = (
        (None, {
            "fields": ('texto_pergunta', 'tipo_campo', 'ordem')
        }),
        ("Ponto de Partida", {
            "classes": ('collapse',),
            "fields": ('is_primeira_questao',),
            "description": "Marque esta opção para definir esta questão como o início da análise. Só deve haver uma."
        }),
    )

@admin.register(OpcaoResposta) # Referência por string
class OpcaoRespostaAdmin(admin.ModelAdmin):
    list_display = ('questao_origem', 'texto_resposta', 'proxima_questao')
        
