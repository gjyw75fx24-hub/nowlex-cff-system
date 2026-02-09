import datetime
import logging
import json
import os
import re

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.widgets import RelatedFieldWidgetWrapper
from django.contrib.admin.models import LogEntry, CHANGE
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from django.contrib.auth.models import User, Group  # Importar os modelos User e Group
from django.contrib.contenttypes.models import ContentType
from django.contrib.humanize.templatetags.humanize import intcomma
from django.db import models, transaction
from django.db.models import Count, FloatField, Max, OuterRef, Q, Sum, Subquery, Prefetch
from django.db.models.functions import Abs, Cast, Coalesce, Now
from django.http import HttpResponseNotAllowed, HttpResponseRedirect, JsonResponse, QueryDict
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html
from django.utils.safestring import mark_safe
from django.utils.translation import gettext_lazy as _
from decimal import Decimal, InvalidOperation

logger = logging.getLogger(__name__)

from .models import (
    AnaliseProcesso, AndamentoProcessual, AdvogadoPassivo, BuscaAtivaConfig,
    Carteira, Contrato, DocumentoModelo, Etiqueta, ListaDeTarefas, OpcaoResposta,
    Parte, ProcessoArquivo, ProcessoJudicial, ProcessoJudicialNumeroCnj, Prazo,
    QuestaoAnalise, StatusProcessual, Tarefa, TipoPeticao, TipoPeticaoAnexoContinua,
    _generate_tipo_peticao_key,
)
from .widgets import EnderecoWidget
from .forms import DemandasAnaliseForm
from .services.demandas import DemandasImportError, DemandasImportService, _format_currency, _format_cpf
from .services.peticao_combo import build_preview, generate_zip, PreviewError

PREPOSITIONS = {'da', 'de', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'a', 'o'}


def strip_related_widget(formfield):
    if formfield and isinstance(formfield.widget, RelatedFieldWidgetWrapper):
        formfield.widget = formfield.widget.widget
    return formfield


class NoRelatedLinksMixin:
    def formfield_for_dbfield(self, db_field, request, **kwargs):
        formfield = super().formfield_for_dbfield(db_field, request, **kwargs)
        return strip_related_widget(formfield)

def format_polo_name(value: str) -> str:
    if not value:
        return "-"
    parts = value.split()
    if not parts:
        return value
    formatted = []
    for idx, part in enumerate(parts):
        cleaned = part.strip().lower()
        if not cleaned:
            continue
        if idx > 0 and cleaned in PREPOSITIONS:
            formatted.append(cleaned)
        else:
            formatted.append(cleaned.title())
    return " ".join(formatted)

def normalize_label_title(value: str) -> str:
    if not value:
        return value
    parts = value.split()
    if not parts:
        return value
    formatted = []
    for idx, part in enumerate(parts):
        cleaned = part.strip().lower()
        if not cleaned:
            continue
        if idx > 0 and cleaned in PREPOSITIONS:
            formatted.append(cleaned)
        else:
            formatted.append(cleaned.title())
    return " ".join(formatted)


# Form para seleção de usuário na ação de delegar
class UserForm(forms.Form):
    user = forms.ModelChoiceField(
        queryset=User.objects.all().order_by('username'),
        label="Selecionar Usuário",
        empty_label="Nenhum (Remover Delegação)"
    )


# --- Supervisor helpers e admin personalizado -------------------------------
SUPERVISOR_GROUP_NAME = "Supervisor"

def ensure_supervisor_group():
    group, _ = Group.objects.get_or_create(name=SUPERVISOR_GROUP_NAME)
    return group

def is_user_supervisor(user):
    if not user or not getattr(user, 'pk', None):
        return False
    return user.groups.filter(name=SUPERVISOR_GROUP_NAME).exists()

class SupervisorUserCreationForm(UserCreationForm):
    is_supervisor = forms.BooleanField(
        required=False,
        label="Supervisor",
        help_text="Disponibiliza a aba Supervisionar na Análise do Processo."
    )

    class Meta(UserCreationForm.Meta):
        model = User
        fields = UserCreationForm.Meta.fields

    def save(self, commit=True):
        user = super().save(commit=False)
        user._is_supervisor_flag = self.cleaned_data.get('is_supervisor', False)
        if commit:
            user.save()
            self.save_m2m()
        return user

class SupervisorUserChangeForm(UserChangeForm):
    is_supervisor = forms.BooleanField(
        required=False,
        label="Supervisor",
        help_text="Disponibiliza a aba Supervisionar na Análise do Processo."
    )

    class Meta(UserChangeForm.Meta):
        model = User

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self.fields['is_supervisor'].initial = is_user_supervisor(self.instance)

    def save(self, commit=True):
        user = super().save(commit=False)
        user._is_supervisor_flag = self.cleaned_data.get('is_supervisor', False)
        if commit:
            user.save()
            self.save_m2m()
        return user

admin.site.unregister(User)

@admin.register(User)
class SupervisorUserAdmin(DjangoUserAdmin):
    form = SupervisorUserChangeForm
    add_form = SupervisorUserCreationForm

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        (_('Personal info'), {'fields': ('first_name', 'last_name', 'email')}),
        (
            _('Permissions'),
            {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions', 'is_supervisor')}
        ),
        (_('Important dates'), {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'password1', 'password2', 'is_supervisor'),
        }),
    )

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        supervisor_flag = getattr(form.instance, '_is_supervisor_flag', None)
        if supervisor_flag is None:
            supervisor_flag = form.cleaned_data.get('is_supervisor')
        if supervisor_flag is None:
            supervisor_flag = request.POST.get('is_supervisor') in ('on', 'True', '1', 'true')
        self._sync_supervisor_flag(form.instance, bool(supervisor_flag))

    def response_change(self, request, obj):
        if '_continue' not in request.POST and '_addanother' not in request.POST:
            messages.success(request, "Usuário salvo com sucesso.")
            return HttpResponseRedirect(request.path)
        return super().response_change(request, obj)

    def _sync_supervisor_flag(self, user, should_be_supervisor):
        group = ensure_supervisor_group()
        if should_be_supervisor:
            user.groups.add(group)
        else:
            user.groups.remove(group)


# --- Filtros ---
class EtiquetaFilter(admin.SimpleListFilter):
    title = 'Etiquetas'
    parameter_name = 'etiquetas'
    template = "admin/filter_checkbox.html"

    def lookups(self, request, model_admin):
        if not _show_filter_counts(request):
            queryset = Etiqueta.objects.order_by('ordem', 'nome')
            return [
                (etiqueta.id, etiqueta.nome)
                for etiqueta in queryset
            ]
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
            'query_string': changelist.get_query_string(
                {'_skip_saved_filters': '1'},
                remove=[self.parameter_name, 'o']
            ),
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
            params = {}
            if new_selected_ids:
                params[self.parameter_name] = ','.join(new_selected_ids)
            else:
                params['_skip_saved_filters'] = '1'
            
            query_string = changelist.get_query_string(
                params,
                remove=[self.parameter_name, 'o', '_skip_saved_filters']
            )

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
    change_list_template = 'admin/contratos/etiqueta/change_list.html'

    def get_changeform_initial_data(self, request):
        initial = super().get_changeform_initial_data(request)
        max_order = Etiqueta.objects.aggregate(max_ordem=Max('ordem'))['max_ordem'] or 0
        initial['ordem'] = max_order + 1
        return initial

    class Media:
        css = {
            'all': (
                'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/themes/classic.min.css',
            )
        }
        js = (
            'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/pickr.min.js',
            'admin/js/etiqueta_interface.js',
        )


@admin.register(DocumentoModelo)
class DocumentoModeloAdmin(admin.ModelAdmin):
    change_list_template = "admin/contratos/documentomodelo/change_list.html"
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

    class Media:
        css = {'all': ('admin/css/documento_modelo_peticoes.css',)}
        js = ('admin/js/documento_modelo_peticoes.js',)

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path(
                'tipos-peticao/',
                self.admin_site.admin_view(self.tipos_peticao_view),
                name='contratos_documentomodelo_tipos_peticao'
            ),
            path(
                'tipos-peticao/preview/',
                self.admin_site.admin_view(self.tipos_peticao_preview_view),
                name='contratos_documentomodelo_tipos_peticao_preview'
            ),
            path(
                'tipos-peticao/generate-zip/',
                self.admin_site.admin_view(self.tipos_peticao_generate_view),
                name='contratos_documentomodelo_tipos_peticao_generate'
            ),
            path(
                'tipos-peticao/anexos/',
                self.admin_site.admin_view(self.tipos_peticao_anexos_view),
                name='contratos_documentomodelo_tipos_peticao_anexos'
            ),
            path(
                'tipos-peticao/anexos/<int:anexo_id>/delete/',
                self.admin_site.admin_view(self.tipos_peticao_anexo_delete_view),
                name='contratos_documentomodelo_tipos_peticao_anexos_delete'
            ),
        ]
        return custom_urls + urls

    def changelist_view(self, request, extra_context=None):
        extra_context = extra_context or {}
        extra_context.setdefault(
            'tipos_peticao_api_url',
            reverse('admin:contratos_documentomodelo_tipos_peticao')
        )
        extra_context.setdefault(
            'tipos_peticao_preview_url',
            reverse('admin:contratos_documentomodelo_tipos_peticao_preview')
        )
        extra_context.setdefault(
            'tipos_peticao_generate_url',
            reverse('admin:contratos_documentomodelo_tipos_peticao_generate')
        )
        extra_context.setdefault('csrf_token', get_token(request))
        extra_context.setdefault(
            'tipos_peticao_anexos_url',
            reverse('admin:contratos_documentomodelo_tipos_peticao_anexos')
        )
        extra_context.setdefault(
            'tipos_peticao_anexos_delete_url_template',
            f"{reverse('admin:contratos_documentomodelo_tipos_peticao_anexos')}{{id}}/delete/"
        )
        return super().changelist_view(request, extra_context=extra_context)

    def tipos_peticao_view(self, request):
        if request.method == 'GET':
            try:
                tipos = list(TipoPeticao.objects.order_by('ordem').values('id', 'nome', 'ordem', 'key'))
            except Exception:
                logger.exception("Falha ao carregar tipos de petição")
                tipos = []
            seen_names = set()
            unique_tipos = []
            for tipo in tipos:
                nome = tipo.get('nome')
                if nome in seen_names:
                    continue
                seen_names.add(nome)
                unique_tipos.append(tipo)
            return JsonResponse({'tipos': unique_tipos})

        if request.method == 'POST':
            try:
                payload = json.loads(request.body.decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return JsonResponse({'error': 'Payload inválido.'}, status=400)

            raw_tipos = payload.get('tipos')
            if not isinstance(raw_tipos, list):
                return JsonResponse({'error': 'Formato inválido.'}, status=400)

            normalized = []
            seen = set()
            for entry in raw_tipos:
                if isinstance(entry, str):
                    nome = entry.strip()
                    key = ''
                elif isinstance(entry, dict):
                    nome = str(entry.get('nome', '')).strip()
                    key = str(entry.get('key', '') or '').strip()
                else:
                    continue
                if not nome or nome in seen:
                    continue
                seen.add(nome)
                normalized.append({'nome': nome, 'key': key})

            try:
                with transaction.atomic():
                    existing = {tipo.key: tipo for tipo in TipoPeticao.objects.all()}
                    new_keys = set()
                    ordem = 0
                    for entry in normalized:
                        nome = entry['nome']
                        key = entry['key']
                        tipo = None
                        if key and key in existing:
                            tipo = existing.pop(key)
                            tipo.nome = nome
                            tipo.ordem = ordem
                            tipo.save(update_fields=['nome', 'ordem'])
                        else:
                            tipo = TipoPeticao.objects.create(
                                nome=nome,
                                ordem=ordem,
                                key=key or _generate_tipo_peticao_key()
                            )
                        ordem += 1
                        new_keys.add(tipo.key)
                    TipoPeticao.objects.exclude(key__in=new_keys).delete()
            except Exception:
                logger.exception("Falha ao salvar tipos de petição")
                return JsonResponse({'error': 'Não foi possível salvar os tipos.'}, status=500)

        return JsonResponse({'status': 'ok'})

        return HttpResponseNotAllowed(['GET', 'POST'])

    def tipos_peticao_preview_view(self, request):
        if request.method != 'POST':
            return HttpResponseNotAllowed(['POST'])
        try:
            data = json.loads(request.body.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JsonResponse({'ok': False, 'error': 'Payload inválido.'}, status=400)
        tipo_id = data.get('tipo_id')
        arquivo_base_id = data.get('arquivo_base_id')
        if not tipo_id or not arquivo_base_id:
            return JsonResponse({'ok': False, 'error': 'Tipo e arquivo-base são obrigatórios.'}, status=400)
        try:
            preview = build_preview(tipo_id, arquivo_base_id)
        except PreviewError as exc:
            return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
        except Exception:
            logger.exception("Erro ao gerar preview de combo de petição")
            return JsonResponse({'ok': False, 'error': 'Não foi possível gerar o preview.'}, status=500)
        return JsonResponse({'ok': True, 'preview': preview})

    def tipos_peticao_generate_view(self, request):
        if request.method != 'POST':
            return HttpResponseNotAllowed(['POST'])
        try:
            data = json.loads(request.body.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JsonResponse({'ok': False, 'error': 'Payload inválido.'}, status=400)
        tipo_id = data.get('tipo_id')
        arquivo_base_id = data.get('arquivo_base_id')
        optional_ids = data.get('optional_ids', [])
        if not tipo_id or not arquivo_base_id:
            return JsonResponse({'ok': False, 'error': 'Tipo e arquivo-base são obrigatórios.'}, status=400)
        try:
            result = generate_zip(tipo_id, arquivo_base_id, optional_ids)
        except PreviewError as exc:
            return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
        except Exception:
            logger.exception("Erro ao gerar ZIP para petição")
            return JsonResponse({'ok': False, 'error': 'Não foi possível gerar o ZIP.'}, status=500)
        return JsonResponse({'ok': True, 'result': result})

    def tipos_peticao_anexos_view(self, request):
        if request.method == 'GET':
            anexos = TipoPeticaoAnexoContinua.objects.select_related('tipo_peticao').order_by(
                'tipo_peticao__nome', '-criado_em'
            )
            return JsonResponse({
                'ok': True,
                'anexos': [self._serialize_anexo(anexo) for anexo in anexos]
            })
        if request.method == 'POST':
            tipo_id = request.POST.get('tipo_id')
            if not tipo_id:
                return JsonResponse({'ok': False, 'error': 'Tipo de petição é obrigatório.'}, status=400)
            try:
                tipo = TipoPeticao.objects.get(pk=tipo_id)
            except TipoPeticao.DoesNotExist:
                return JsonResponse({'ok': False, 'error': 'Tipo de petição inválido.'}, status=400)
            arquivos = request.FILES.getlist('arquivo')
            if not arquivos:
                return JsonResponse({'ok': False, 'error': 'Nenhum arquivo enviado.'}, status=400)
            anexos = []
            for arquivo in arquivos:
                anexos.append(TipoPeticaoAnexoContinua.objects.create(
                    tipo_peticao=tipo,
                    arquivo=arquivo,
                    nome=str(arquivo.name)
                ))
            return JsonResponse({
                'ok': True,
                'anexos': [self._serialize_anexo(anexo) for anexo in anexos]
            })
        return HttpResponseNotAllowed(['GET', 'POST'])

    def tipos_peticao_anexo_delete_view(self, request, anexo_id):
        if request.method not in ('POST', 'DELETE'):
            return HttpResponseNotAllowed(['POST', 'DELETE'])
        try:
            anexo = TipoPeticaoAnexoContinua.objects.get(pk=anexo_id)
        except TipoPeticaoAnexoContinua.DoesNotExist:
            return JsonResponse({'ok': False, 'error': 'Anexo não encontrado.'}, status=404)
        tipo_id = anexo.tipo_peticao_id
        anexo.delete()
        return JsonResponse({
            'ok': True,
            'id': anexo_id,
            'tipo_id': tipo_id
        })

    @staticmethod
    def _serialize_anexo(anexo):
        return {
            'id': anexo.id,
            'tipo_id': anexo.tipo_peticao_id,
            'name': anexo.nome or os.path.basename(anexo.arquivo.name),
            'file_name': os.path.basename(anexo.arquivo.name),
            'url': anexo.arquivo.url,
            'created_at': anexo.criado_em.isoformat()
        }

@admin.register(ListaDeTarefas)
class ListaDeTarefasAdmin(admin.ModelAdmin):
    list_display = ('nome',)
    search_fields = ('nome',)


admin.site.site_header = "CFF SYSTEM"
admin.site.site_title = "Home"
admin.site.index_title = "Bem-vindo à Administração"

_original_app_index = admin.site.app_index

def _app_index_redirect(request, app_label, extra_context=None):
    if app_label == "contratos":
        redirect_url = (
            reverse("admin:contratos_processojudicial_changelist")
            + "?ord_prescricao=incluir&ord_ultima_edicao=recente"
        )
        return HttpResponseRedirect(redirect_url)
    return _original_app_index(request, app_label, extra_context=extra_context)

admin.site.app_index = _app_index_redirect

def configuracao_analise_view(request):
    context = admin.site.each_context(request)
    context.update({
        "title": "Configuração de Análise",
    })
    return render(request, "admin/contratos/configuracao_analise.html", context)

def configuracao_analise_tipos_view(request):
    context = admin.site.each_context(request)
    context.update({
        "title": "Tipos de Análise",
    })
    return render(request, "admin/contratos/configuracao_analise_tipos.html", context)

def configuracao_analise_novas_monitorias_view(request):
    context = admin.site.each_context(request)
    context.update({
        "title": "Novas Monitórias",
    })
    return render(request, "admin/contratos/configuracao_analise_novas_monitorias.html", context)


def demandas_analise_view(request):
    if not is_user_supervisor(request.user):
        messages.error(request, "Acesso restrito a supervisores.")
        return HttpResponseRedirect(reverse('admin:index'))

    form = DemandasAnaliseForm(request.POST or None)
    preview_rows = []
    period_label = ""
    preview_ready = False
    preview_total_label = _format_currency(Decimal('0'))
    import_action = request.POST.get('import_action')
    selected_cpfs = request.POST.getlist('selected_cpfs')
    preview_hint = (
        "Use o intervalo de prescrições para identificar CPFs elegíveis. "
        "Após implementar a importação em lote, esta lista mostrará os cadastros encontrados."
    )
    if form.is_valid():
        carteira = form.cleaned_data['carteira']
        alias = (carteira.fonte_alias or '').strip() or DemandasImportService.SOURCE_ALIAS
        preview_service = DemandasImportService(db_alias=alias)
        data_de = form.cleaned_data['data_de']
        data_ate = form.cleaned_data['data_ate']
        period_label = preview_service.build_period_label(data_de, data_ate)
        try:
            preview_rows, preview_total = preview_service.build_preview(data_de, data_ate)
            preview_total_label = _format_currency(preview_total)
            preview_ready = True
            if import_action in ("import_all", "import_selected"):
                etiqueta_nome = preview_service.build_etiqueta_nome(carteira, period_label)
                import_result = None
                if import_action == "import_selected":
                    filtered_cpfs = [cpf for cpf in selected_cpfs if cpf]
                    if not filtered_cpfs:
                        messages.warning(request, "Selecione pelo menos um CPF para importar.")
                    else:
                        import_result = preview_service.import_selected_cpfs(
                            data_de, data_ate, filtered_cpfs, etiqueta_nome, carteira
                        )
                else:
                    import_result = preview_service.import_period(data_de, data_ate, etiqueta_nome, carteira)

                if import_result:
                    summary = []
                    if import_result.get("imported"):
                        summary.append(f"{import_result['imported']} importados")
                    if import_result.get("skipped"):
                        summary.append(f"{import_result['skipped']} ignorados")
                    if summary:
                        messages.success(request, "Importação concluída: " + ", ".join(summary))
                    else:
                        messages.info(request, "Nenhum CPF foi importado.")
        except DemandasImportError as exc:
            messages.error(request, str(exc))

    context = admin.site.each_context(request)
    context.update({
        "title": "Demandas P/ Análise",
        "form": form,
        "preview_rows": preview_rows,
        "preview_ready": preview_ready,
        "period_label": period_label,
        "period_label_sample": period_label or "xx/xx/xxxx - xx/xx/xxxx",
        "preview_total_label": preview_total_label,
        "preview_hint": preview_hint,
    })
    return render(request, "admin/contratos/demandas_analise.html", context)

_original_get_admin_urls = admin.site.get_urls

def _get_admin_urls():
    urls = _original_get_admin_urls()
    custom_urls = [
        path(
            "contratos/configuracao-analise/",
            admin.site.admin_view(configuracao_analise_view),
            name="contratos_configuracao_analise",
        ),
        path(
            "contratos/configuracao-analise/tipos/",
            admin.site.admin_view(configuracao_analise_tipos_view),
            name="contratos_configuracao_analise_tipos",
        ),
        path(
            "contratos/configuracao-analise/tipos/novas-monitorias/",
            admin.site.admin_view(configuracao_analise_novas_monitorias_view),
            name="contratos_configuracao_analise_novas_monitorias",
        ),
        path(
            "contratos/demandas-analise/",
            admin.site.admin_view(demandas_analise_view),
            name="contratos_demandas_analise",
        ),
    ]
    return custom_urls + urls

admin.site.get_urls = _get_admin_urls

_original_get_app_list = admin.site.get_app_list

def _get_app_list(request, app_label=None):
    app_list = _original_get_app_list(request, app_label)
    for app in app_list:
        if app.get("app_label") != "contratos":
            continue
        insertion_index = None
        filtered_models = []
        for idx, model in enumerate(app.get("models", [])):
            if model.get("object_name") in {"QuestaoAnalise", "OpcaoResposta"}:
                if insertion_index is None:
                    insertion_index = idx
                continue
            filtered_models.append(model)
        if insertion_index is None:
            insertion_index = 0
        config_position = min(insertion_index, len(filtered_models))
        filtered_models.insert(
            config_position,
            {
                "name": "Configuração de Análise",
                "object_name": "ConfiguracaoAnalise",
                "admin_url": reverse("admin:contratos_configuracao_analise"),
                "add_url": None,
                "perms": {"add": False, "change": False, "delete": False, "view": True},
                "view_only": True,
            },
        )
        demandas_position = min(config_position + 1, len(filtered_models))
        filtered_models.insert(
            demandas_position,
            {
                "name": "Demandas P/ Análise",
                "object_name": "DemandasAnalise",
                "admin_url": reverse("admin:contratos_demandas_analise"),
                "add_url": None,
                "perms": {"add": False, "change": False, "delete": False, "view": True},
                "view_only": True,
            },
        )
        app["models"] = filtered_models
    return app_list

admin.site.get_app_list = _get_app_list

def _show_filter_counts(request):
    return request.GET.get('show_counts') == '1'

class TerceiroInteressadoFilter(admin.SimpleListFilter):
    title = "⚠️ Terceiro Interessado"
    parameter_name = "terceiro_interessado"

    def lookups(self, request, model_admin):
        if not _show_filter_counts(request):
            return [
                ("sim", "Com terceiro interessado"),
                ("nao", "Apenas dois polos"),
            ]
        base_qs = model_admin.get_queryset(request)
        qs_counts = base_qs.annotate(num_partes=models.Count("partes_processuais"))
        count_sim = qs_counts.filter(num_partes__gt=2).count()
        count_nao = qs_counts.filter(num_partes__lte=2).count()
        return [
            ("sim", mark_safe(f"Com terceiro interessado <span class='filter-count'>({count_sim})</span>")),
            ("nao", mark_safe(f"Apenas dois polos <span class='filter-count'>({count_nao})</span>")),
        ]

    def choices(self, changelist):
        current = self.value()
        extra_remove = ['o', 'p', '_changelist_filters', '_skip_saved_filters']
        other_filters = [k for k in changelist.params.keys() if k not in (self.parameter_name, '_skip_saved_filters')]
        for value, title in self.lookup_choices:
            selected = current == value
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name] + extra_remove + other_filters
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=extra_remove + other_filters
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': title,
            }

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
        if not _show_filter_counts(request):
            return [(s.id, s.nome) for s in StatusProcessual.objects.filter(ativo=True).order_by('ordem')]
        qs = model_admin.get_queryset(request)
        counts = {row['status__id']: row['total'] for row in qs.values('status__id').annotate(total=models.Count('id'))}
        items = []
        for s in StatusProcessual.objects.filter(ativo=True).order_by('ordem'):
            total = counts.get(s.id, 0)
            label = mark_safe(f"{s.nome} <span class='filter-count'>({total})</span>")
            items.append((s.id, label))
        return items

    def choices(self, changelist):
        current = str(self.value()) if self.value() is not None else None
        for value, label in self.lookup_choices:
            selected = str(value) == current
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o']
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=['o', '_skip_saved_filters']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(status__id=self.value())
        return queryset


class ParaSupervisionarFilter(admin.SimpleListFilter):
    title = 'Para Supervisionar'
    parameter_name = 'para_supervisionar'

    def lookups(self, request, model_admin):
        label = "Enviados P/ Avaliar"
        if not _show_filter_counts(request):
            return (('1', label),)
        qs = model_admin.get_queryset(request)
        count = qs.filter(analise_processo__para_supervisionar=True).count()
        label_html = mark_safe(f"{label} <span class='filter-count'>({count})</span>")
        return (('1', label_html),)

    def choices(self, changelist):
        current = self.value()
        for value, label in self.lookup_choices:
            selected = current == value
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o']
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=['o', '_skip_saved_filters']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        if self.value() == '1':
            return queryset.filter(analise_processo__para_supervisionar=True)
        return queryset


class LastEditOrderFilter(admin.SimpleListFilter):
    title = 'Última Edição'
    parameter_name = 'ord_ultima_edicao'

    def lookups(self, request, model_admin):
        return (
            ('recente', 'A → Z (mais recente primeiro)'),
            ('antigo', 'Z → A (mais distante primeiro)'),
        )

    def choices(self, changelist):
        current = self.value()
        for value, label in self.lookup_choices:
            selected = current == value
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o']
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=['o', '_skip_saved_filters']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

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
        if not _show_filter_counts(request):
            ufs = sorted({row for row in qs.values_list('uf', flat=True) if row})
            return [(uf, uf) for uf in ufs]
        counts = {row['uf']: row['total'] for row in qs.values('uf').annotate(total=models.Count('id')) if row['uf']}
        return [(uf, mark_safe(f"{uf} <span class='filter-count'>({counts.get(uf, 0)})</span>")) for uf in sorted(counts.keys())]

    def choices(self, changelist):
        current = self.value()
        all_query = changelist.get_query_string(
            {'_skip_saved_filters': '1'},
            remove=[self.parameter_name, 'o', '_skip_saved_filters']
        )
        yield {
            'selected': current is None,
            'query_string': all_query,
            'display': 'Todos',
        }
        for value, label in self.lookup_choices:
            selected = value == current
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o']
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=['o', '_skip_saved_filters']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        values = request.GET.getlist(self.parameter_name)
        if values:
            return queryset.filter(uf__in=values)
        return queryset


class CarteiraCountFilter(admin.SimpleListFilter):
    title = 'Carteira'
    parameter_name = 'carteira'

    def lookups(self, request, model_admin):
        if not _show_filter_counts(request):
            return [(cart.id, cart.nome) for cart in Carteira.objects.order_by('nome')]
        qs = model_admin.get_queryset(request)
        counts = {row['carteira__id']: row['total'] for row in qs.values('carteira__id').annotate(total=models.Count('id')) if row['carteira__id']}
        items = []
        for cart in Carteira.objects.order_by('nome'):
            total = counts.get(cart.id, 0)
            items.append((cart.id, mark_safe(f"{cart.nome} <span class='filter-count'>({total})</span>")))
        return items

    def choices(self, changelist):
        current = self.value()
        for value, label in self.lookup_choices:
            selected = str(value) == str(current) and current not in (None, '')
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o']
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=['o', '_skip_saved_filters']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(carteira_id=self.value())
        return queryset


class NaoJudicializadoFilter(admin.SimpleListFilter):
    title = 'Não Judicializado'
    parameter_name = 'nao_judicializado'

    def lookups(self, request, model_admin):
        if not _show_filter_counts(request):
            return [
                ('1', "Sem CNJ"),
                ('0', "Com CNJ"),
                ('all', "Todos"),
            ]
        qs = model_admin.get_queryset(request)
        count_sim = qs.filter(nao_judicializado=True).count()
        count_nao = qs.filter(nao_judicializado=False).count()
        total = count_sim + count_nao
        return [
            ('1', mark_safe(f"Sem CNJ <span class=\"filter-count\">({count_sim})</span>")),
            ('0', mark_safe(f"Com CNJ <span class=\"filter-count\">({count_nao})</span>")),
            ('all', mark_safe(f"Todos <span class=\"filter-count\">({total})</span>")),
        ]

    def _base_remove_keys(self, changelist):
        remove = set(changelist.params.keys())
        remove.update({'o', 'p', '_changelist_filters'})
        remove.discard('_skip_saved_filters')
        return list(remove)

    def choices(self, changelist):
        current = self.value()
        remove_keys = self._base_remove_keys(changelist)

        def build_query(apply_value=None):
            params = {'_skip_saved_filters': '1'}
            if apply_value and apply_value != 'all':
                params[self.parameter_name] = apply_value
            remove = list(remove_keys)
            remove.append(self.parameter_name)
            return changelist.get_query_string(params, remove=remove)

        for value, title in self.lookup_choices:
            if value == 'all':
                selected = current is None
                query_string = build_query(None)
            else:
                selected = current == value
                query_string = build_query(value if not selected else None)
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': title,
            }

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
        if not _show_filter_counts(request):
            items = [('none', "Não Delegado")]
            users = User.objects.filter(is_staff=True, is_active=True).order_by('username')
            user_items = []
            for user in users:
                full_name = user.get_full_name() or user.username
                user_items.append((user.id, full_name))
            user_items.sort(key=lambda x: str(x[1]).lower())
            items.extend(user_items)
            return items

        base_qs = model_admin.model.objects.all()
        counts = {
            row['delegado_para_id']: row['total']
            for row in base_qs.values('delegado_para_id').annotate(total=models.Count('id')).filter(delegado_para_id__isnull=False)
        }
        count_nao_delegado = base_qs.filter(delegado_para__isnull=True).count()
        items = [
            ('none', mark_safe(f"Não Delegado <span class='filter-count'>({count_nao_delegado})</span>"))
        ]
        users = User.objects.filter(is_staff=True, is_active=True).order_by('username')
        user_items = []
        for user in users:
            total = counts.get(user.id, 0)
            full_name = user.get_full_name() or user.username
            label = mark_safe(f"{full_name} <span class='filter-count'>({total})</span>")
            user_items.append((user.id, label))

        user_items.sort(key=lambda x: str(x[1]).lower())
        items.extend(user_items)

        return items

    def choices(self, changelist):
        current = self.value()
        for value, label in self.lookup_choices:
            selected = current == str(value)
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o']
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=['o', '_skip_saved_filters']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        if self.value() == 'none':
            return queryset.filter(delegado_para__isnull=True)
        if self.value():
            return queryset.filter(delegado_para_id=self.value())
        return queryset


class JsonbPathQueryFirstText(models.Func):
    function = 'jsonb_path_query_first'
    template = "%(function)s(%(expressions)s) #>> '{}'"
    output_field = models.TextField()


class AprovacaoFilter(admin.SimpleListFilter):
    title = "Aprovação"
    parameter_name = "aprovacao"
    OPTIONS = [
        ("aprovado", "Aprovados"),
        ("reprovado", "Reprovados"),
        ("barrado", "Barrados"),
    ]

    PATH_KEYS = ("processos_vinculados", "saved_processos_vinculados")
    MATCH_CONDITIONS = {
        "aprovado": '@.supervisor_status == "aprovado" && @.barrado.ativo != true',
        "reprovado": '@.supervisor_status == "reprovado" && @.barrado.ativo != true',
        "barrado": '@.barrado.ativo == true',
    }

    def _json_path_expr_for_key(self, key, condition):
        path = f'$.{key}[*] ? ({condition})'
        return models.Func(
            models.F('analise_processo__respostas'),
            models.Value(path),
            function='jsonb_path_exists',
            output_field=models.BooleanField()
        )

    def _filter_queryset_by_condition(self, queryset, condition):
        match_q = None
        for key in self.PATH_KEYS:
            alias = f'_aprovacao_match_{key}'
            expr = self._json_path_expr_for_key(key, condition)
            queryset = queryset.annotate(**{alias: expr})
            current = models.Q(**{alias: True})
            match_q = current if match_q is None else match_q | current
        if match_q is None:
            return queryset.none()
        return queryset.filter(match_q)

    def lookups(self, request, model_admin):
        if not _show_filter_counts(request):
            return list(self.OPTIONS)
        qs = model_admin.get_queryset(request)
        items = []
        for value, label in self.OPTIONS:
            condition = self.MATCH_CONDITIONS.get(value)
            if condition:
                count = self._filter_queryset_by_condition(qs, condition).count()
                label_html = mark_safe(f"{label} <span class='filter-count'>({count})</span>")
                items.append((value, label_html))
            else:
                items.append((value, label))
        return items

    def choices(self, changelist):
        current = self.value()
        for value, label in self.lookup_choices:
            selected = current == value
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o', '_skip_saved_filters']
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=['o', '_skip_saved_filters']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        value = self.value()
        condition = self.MATCH_CONDITIONS.get(value)
        if not condition:
            return queryset
        queryset = self._filter_queryset_by_condition(queryset, condition)
        if value == "barrado":
            def _cast_data_para(key):
                path = f'$.{key}[*] ? (@.barrado.ativo == true).barrado.retorno_em'
                expr = JsonbPathQueryFirstText(
                    models.F('analise_processo__respostas'),
                    models.Value(path),
                )
                return Cast(expr, models.DateField())

            retorno_expr = Coalesce(
                _cast_data_para('processos_vinculados'),
                _cast_data_para('saved_processos_vinculados'),
            )
            queryset = queryset.annotate(
                _barrado_retorno=retorno_expr
            ).order_by(
                models.F('_barrado_retorno').asc(nulls_last=True),
                '-pk'
            )
        return queryset


class ProtocoladosFilter(admin.SimpleListFilter):
    title = "Protocolados"
    parameter_name = "protocolados"

    OPTIONS = [
        ("monitoria", "Monitória"),
        ("cobranca", "Cobrança Judicial"),
        ("habilitacao", "Habilitação"),
    ]

    LOOKUP_KEYWORDS = {
        "monitoria": ["monitória", "monitoria"],
        "cobranca": ["cobrança", "cobranca"],
        "habilitacao": ["habilitação", "habilitacao"],
    }

    def _protocolados_qs(self, qs, value):
        keywords = self.LOOKUP_KEYWORDS.get(value)
        if not keywords:
            return qs.none()
        protocol_q = models.Q(arquivos__protocolado_no_tribunal=True)
        name_q = models.Q()
        for keyword in keywords:
            name_q |= models.Q(arquivos__nome__icontains=keyword)
        return qs.filter(protocol_q & name_q).distinct()

    def lookups(self, request, model_admin):
        if not _show_filter_counts(request):
            return list(self.OPTIONS)
        qs = model_admin.get_queryset(request)
        items = []
        for value, label in self.OPTIONS:
            count = self._protocolados_qs(qs, value).count()
            label_html = mark_safe(f"{label} <span class='filter-count'>({count})</span>")
            items.append((value, label_html))
        return items

    def choices(self, changelist):
        current = self.value()
        remove_params = [self.parameter_name, 'o', 'p', '_skip_saved_filters']
        for value, label in self.lookup_choices:
            selected = current == value and current is not None
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=remove_params
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value, '_skip_saved_filters': '1'},
                    remove=['o', 'p']
                )
            yield {
                "selected": selected,
                "query_string": query_string,
                "display": label,
            }

    def queryset(self, request, queryset):
        val = self.value()
        if not val:
            return queryset
        return self._protocolados_qs(queryset, val)


class PrescricaoOrderFilter(admin.SimpleListFilter):
    title = "Prescrição"
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
        # Ignora processos com todos os contratos prescritos enquanto o checkbox não está ativo
        today = timezone.now().date()
        if self.value() != "incluir":
            nao_prescrito_q = (
                models.Q(contratos__data_prescricao__gte=today) |
                models.Q(contratos__data_prescricao__isnull=True)
            )
            queryset = queryset.annotate(
                contratos_nao_prescritos=Count('contratos', filter=nao_prescrito_q)
            ).filter(
                contratos_nao_prescritos__gt=0
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
    title = "Viabilidade $"
    parameter_name = 'viabilidade_financeira'

    OPTIONS = [
        ('0', mark_safe('<span class="viabilidade-option viabilidade">Viabilidade</span>')),
        (ProcessoJudicial.VIABILIDADE_VIAVEL, mark_safe('<span class="viabilidade-option viavel">Viável</span>')),
        (ProcessoJudicial.VIABILIDADE_INVIAVEL, mark_safe('<span class="viabilidade-option inviavel">Inviável</span>')),
        (ProcessoJudicial.VIABILIDADE_INCONCLUSIVO, mark_safe('<span class="viabilidade-option inconclusivo">Inconclusivo</span>')),
    ]

    def lookups(self, request, model_admin):
        if not _show_filter_counts(request):
            return list(self.OPTIONS)
        qs = model_admin.get_queryset(request)
        items = []
        for value, label_html_original in self.OPTIONS:
            label_text = label_html_original.split('>')[1].split('<')[0]
            if value == '0':
                count = qs.filter(models.Q(viabilidade="") | models.Q(viabilidade__isnull=True)).count()
            else:
                count = qs.filter(viabilidade=value).count()
            label_html = mark_safe(f"<span class='viabilidade-option {value}'>{label_text}</span> <span class='filter-count'>({count})</span>")
            items.append((value, label_html))
        return items

    def choices(self, changelist):
        current = self.value()
        for value, label in self.lookup_choices:
            selected = current == value
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o', '_skip_saved_filters']
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=['o', '_skip_saved_filters']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        val = self.value()
        if val == '0':
            return queryset.filter(models.Q(viabilidade="") | models.Q(viabilidade__isnull=True))
        if val:
            return queryset.filter(viabilidade=val)
        return queryset


class AcordoStatusFilter(admin.SimpleListFilter):
    title = "Acordo"
    parameter_name = "acordo_status"

    def lookups(self, request, model_admin):
        from contratos.models import AdvogadoPassivo
        if not _show_filter_counts(request):
            return [
                (AdvogadoPassivo.AcordoChoices.PROPOR, "Propor"),
                (AdvogadoPassivo.AcordoChoices.PROPOSTO, "Proposto"),
                (AdvogadoPassivo.AcordoChoices.FIRMADO, "Firmado"),
                (AdvogadoPassivo.AcordoChoices.RECUSADO, "Recusado"),
                ("sem", "Sem acordo"),
            ]

        qs = model_admin.get_queryset(request)
        items = []
        options = (
            (AdvogadoPassivo.AcordoChoices.PROPOR, "Propor"),
            (AdvogadoPassivo.AcordoChoices.PROPOSTO, "Proposto"),
            (AdvogadoPassivo.AcordoChoices.FIRMADO, "Firmado"),
            (AdvogadoPassivo.AcordoChoices.RECUSADO, "Recusado"),
            ("sem", "Sem acordo"),
        )

        for value, label in options:
            if value == "sem":
                count = qs.filter(
                    models.Q(advogados_passivos__acordo_status__isnull=True) |
                    models.Q(advogados_passivos__acordo_status="")
                ).distinct().count()
            else:
                count = qs.filter(advogados_passivos__acordo_status=value).distinct().count()

            label_html = mark_safe(f"{label} <span class='filter-count'>({count})</span>")
            items.append((value, label_html))

        return items

    def choices(self, changelist):
        current = self.value()
        for value, label in self.lookup_choices:
            selected = current == value
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o', '_skip_saved_filters']
                )
            else:
                query_string = changelist.get_query_string({self.parameter_name: value})
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

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


class BuscaAtivaFilter(admin.SimpleListFilter):
    title = "Busca Ativa"
    parameter_name = "busca_ativa"

    OPTIONS = (
        ('1', 'Com Busca Ativa'),
        ('0', 'Sem Busca Ativa'),
    )

    def lookups(self, request, model_admin):
        if not _show_filter_counts(request):
            return list(self.OPTIONS)
        qs = model_admin.get_queryset(request)
        items = []
        for value, label in self.OPTIONS:
            if value == '1':
                count = qs.filter(busca_ativa=True).count()
            else: # '0'
                count = qs.filter(busca_ativa=False).count()
            
            label_html = mark_safe(f"{label} <span class='filter-count'>({count})</span>")
            items.append((value, label_html))
        return items

    def choices(self, changelist):
        current = self.value()
        for value, label in self.lookup_choices:
            selected = current == value
            if selected:
                query_string = changelist.get_query_string(remove=[self.parameter_name])
            else:
                query_string = changelist.get_query_string({self.parameter_name: value})
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        value = self.value()
        if value == '1':
            return queryset.filter(busca_ativa=True)
        if value == '0':
            return queryset.filter(busca_ativa=False)
        return queryset




class AndamentoProcessualForm(forms.ModelForm):
    class Meta:
        model = AndamentoProcessual
        fields = '__all__'
        widgets = {
            'descricao': forms.Textarea(attrs={'rows': 2, 'cols': 600}), # 6x a largura original
            'detalhes': forms.Textarea(attrs={'rows': 2, 'cols': 50}), # Proporcionalmente menor
        }

class AndamentoInline(NoRelatedLinksMixin, admin.TabularInline):
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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        for field_name in ('tipo_polo', 'nome', 'documento'):
            field = self.fields.get(field_name)
            if not field:
                continue
            field.required = False

        polo_field = self.fields.get('tipo_polo')
        if polo_field and polo_field.choices:
            default_choice = polo_field.choices[0]
            if default_choice[0] != '':
                polo_field.choices = [('', '---------')] + list(polo_field.choices)

class ParteInline(NoRelatedLinksMixin, admin.StackedInline):
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
                    "nome",
                    ("documento", "data_nascimento"),
                    "endereco",
                    ("obito",),
                )
            },
        ),
    )


class AdvogadoPassivoInline(NoRelatedLinksMixin, admin.StackedInline):
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



def normalize_decimal_string(value):
    if value is None:
        return ''
    normalized = str(value).strip()
    if not normalized:
        return ''
    normalized = normalized.replace('\u00A0', '')
    normalized = normalized.replace('R$', '')
    normalized = normalized.replace(' ', '')
    has_comma = ',' in normalized
    has_dot = '.' in normalized
    if has_comma and has_dot:
        normalized = normalized.replace('.', '')
        normalized = normalized.replace(',', '.')
    elif has_comma:
        normalized = normalized.replace(',', '.')
    return normalized


class MoneyDecimalField(forms.DecimalField):
    def to_python(self, value):
        normalized = normalize_decimal_string(value)
        return super().to_python(normalized)


def format_decimal_brl(value):
    if value in (None, ''):
        return ''
    try:
        decimal_value = Decimal(value)
    except (InvalidOperation, TypeError):
        return ''
    quantized = decimal_value.quantize(Decimal('0.01'))
    formatted = f"{quantized:,.2f}"
    formatted = formatted.replace(',', 'X').replace('.', ',').replace('X', '.')
    return f"R$ {formatted}"


class ContratoForm(forms.ModelForm):
    class Meta:
        model = Contrato
        fields = "__all__"
        labels = {
            'valor_total_devido': 'Salvo em aberto',
            'valor_causa': 'Saldo atualizado',
        }

    valor_total_devido = MoneyDecimalField(
        required=False,
        decimal_places=2,
        max_digits=14,
        label="Saldo em aberto",
        widget=forms.TextInput(attrs={'class': 'vTextField money-mask'})
    )
    valor_causa = MoneyDecimalField(
        required=False,
        decimal_places=2,
        max_digits=14,
        label="Saldo atualizado",
        widget=forms.TextInput(attrs={'class': 'vTextField money-mask'})
    )
    data_saldo_atualizado = forms.DateField(
        required=False,
        widget=forms.HiddenInput()
    )
    custas = MoneyDecimalField(
        required=False,
        decimal_places=2,
        max_digits=14,
        widget=forms.TextInput(attrs={'class': 'vTextField money-mask'})
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field_name in ('valor_total_devido', 'valor_causa', 'custas'):
            prefixed_name = self.add_prefix(field_name)
            if self.data and self.data.get(prefixed_name):
                continue
            value = getattr(self.instance, field_name, None)
            formatted = format_decimal_brl(value)
            if formatted:
                self.initial[field_name] = formatted

    def _clean_decimal(self, field_name):
        raw = self.data.get(self.add_prefix(field_name), '')
        normalized = normalize_decimal_string(raw)
        if not normalized:
            return None
        try:
            return Decimal(normalized)
        except InvalidOperation:
            raise forms.ValidationError("Informe um número válido.")

    def clean_valor_total_devido(self):
        return self._clean_decimal('valor_total_devido')

    def clean_valor_causa(self):
        return self._clean_decimal('valor_causa')

    def clean_custas(self):
        return self._clean_decimal('custas')

    class Media:
        js = ('contratos/js/contrato_money_mask.js',)


class ProcessoJudicialForm(forms.ModelForm):
    cnj_entries_data = forms.CharField(
        required=False,
        widget=forms.HiddenInput()
    )
    cnj_active_index = forms.IntegerField(
        required=False,
        widget=forms.HiddenInput()
    )
    valor_causa = MoneyDecimalField(
        required=False,
        decimal_places=2,
        max_digits=14,
        widget=forms.TextInput(attrs={'class': 'vTextField money-mask'})
    )

    class Meta:
        model = ProcessoJudicial
        exclude = ('heranca_valor', 'heranca_descricao')
        widgets = {
            'valor_causa': forms.TextInput(attrs={'class': 'vTextField money-mask'})
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        value = self.initial.get('valor_causa')
        if value is None and self.instance.pk:
            value = getattr(self.instance, 'valor_causa', None)
        if value not in (None, ''):
            formatted = format_decimal_brl(value)
            self.initial['valor_causa'] = formatted


class ContratoInline(NoRelatedLinksMixin, admin.StackedInline):
    form = ContratoForm
    model = Contrato
    extra = 0
    fk_name = "processo"

class TarefaInlineForm(forms.ModelForm):
    criado_por_label = forms.CharField(required=False, widget=forms.HiddenInput())
    criado_em_value = forms.CharField(required=False, widget=forms.HiddenInput())

    class Meta:
        model = Tarefa
        fields = [
            'descricao',
            'lista',
            'data',
            'responsavel',
            'prioridade',
            'observacoes',
            'concluida',
            'criado_por_label',
            'criado_em_value',
        ]
        widgets = {
            'criado_por_label': forms.HiddenInput(),
            'criado_em_value': forms.HiddenInput(),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        creator = getattr(self.instance, 'criado_por', None)
        if creator:
            display = creator.get_full_name() or creator.username
            self.initial['criado_por_label'] = display
            self.fields['criado_por_label'].initial = display
        created_at = getattr(self.instance, 'criado_em', None)
        if created_at:
            value = created_at.isoformat()
            self.initial['criado_em_value'] = value
            self.fields['criado_em_value'].initial = value


class TarefaInline(NoRelatedLinksMixin, admin.TabularInline):
    form = TarefaInlineForm
    model = Tarefa
    extra = 0
    autocomplete_fields = ['responsavel']
    fields = ['descricao', 'lista', 'data', 'responsavel', 'prioridade', 'observacoes', 'concluida']
    readonly_fields = ('criado_por', 'criado_em')

class PrazoInlineForm(forms.ModelForm):
    class Meta:
        model = Prazo
        fields = '__all__'
        widgets = {
            'observacoes': forms.Textarea(attrs={'placeholder': 'Observações', 'rows': 5}),
        }

    def clean(self):
        cleaned = super().clean()
        # Permite preencher só a data; completa hora padrão 00:00
        date_key = self.add_prefix('data_limite_0')
        time_key = self.add_prefix('data_limite_1')
        date_raw = self.data.get(date_key) or self.data.get(self.add_prefix('data_limite'))
        time_raw = self.data.get(time_key) or '00:00'
        if date_raw and not cleaned.get('data_limite'):
            parsed_date = None
            for fmt in ('%d/%m/%Y', '%Y-%m-%d'):
                try:
                    parsed_date = datetime.datetime.strptime(date_raw, fmt).date()
                    break
                except Exception:
                    continue
            if parsed_date:
                try:
                    parsed_time = datetime.datetime.strptime(time_raw, '%H:%M').time()
                except Exception:
                    parsed_time = datetime.time(0, 0)
                dt = datetime.datetime.combine(parsed_date, parsed_time)
                if timezone.is_naive(dt):
                    dt = timezone.make_aware(dt, timezone.get_current_timezone())
                cleaned['data_limite'] = dt
                if 'data_limite' in self._errors:
                    del self._errors['data_limite']
        return cleaned


class PrazoInline(NoRelatedLinksMixin, admin.TabularInline):
    model = Prazo
    form = PrazoInlineForm
    extra = 0
    template = 'admin/edit_inline/tabular.html'
    fields = ['titulo', 'data_limite', 'alerta_valor', 'alerta_unidade', 'responsavel', 'observacoes', 'concluido']

class ProcessoArquivoInline(NoRelatedLinksMixin, admin.TabularInline):
    model = ProcessoArquivo
    extra = 0
    fields = ('nome', 'arquivo', 'enviado_por', 'protocolado_no_tribunal', 'criado_em')
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
        return sanitize_supervision_respostas(data or {})


def sanitize_supervision_respostas(respostas):
    if not isinstance(respostas, dict):
        return {}

    def normalize_barrado(card):
        if not isinstance(card, dict):
            return
        status = card.get('supervisor_status')
        barrado = card.get('barrado')
        if not isinstance(barrado, dict):
            barrado = {}
            card['barrado'] = barrado
        barrado.setdefault('ativo', False)
        barrado.setdefault('inicio', None)
        barrado.setdefault('retorno_em', None)
        if status != 'aprovado':
            barrado['ativo'] = False
            barrado['inicio'] = None
            barrado['retorno_em'] = None

    for key in ('processos_vinculados', 'saved_processos_vinculados'):
        cards = respostas.get(key)
        if isinstance(cards, list):
            for card in cards:
                normalize_barrado(card)

    return respostas

class AnaliseProcessoInline(NoRelatedLinksMixin, admin.StackedInline): # Usando StackedInline para melhor visualização do JSONField
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
    title = 'Valor da Causa'
    parameter_name = 'valor_causa_order'

    FILTER_OPTIONS = [
        ('desc', 'Z a A (Maior primeiro)'),
        ('asc', 'A a Z (Menor primeiro)'),
        ('zerados', 'Zerados'),
    ]

    def lookups(self, request, model_admin):
        return self.FILTER_OPTIONS

    def choices(self, changelist):
        current = self.value() or None

        for value, label in self.FILTER_OPTIONS:
            selected = current == value
            if selected:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o']
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value},
                    remove=['o']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        value = self.value() or None
        if not value:
            return queryset

        if value == 'desc':
            return queryset.filter(valor_causa__gt=0).order_by(
                models.F('valor_causa').desc(nulls_last=True),
                '-pk'
            )

        if value == 'asc':
            return queryset.filter(valor_causa__gt=0).order_by(
                models.F('valor_causa').asc(nulls_first=True),
                'pk'
            )

        if value == 'zerados':
            return queryset.filter(
                Q(valor_causa__lte=0) | Q(valor_causa__isnull=True)
            ).order_by('pk')

        return queryset


class ObitoFilter(admin.SimpleListFilter):
    title = 'Óbito'
    parameter_name = 'obito'

    OPTIONS = [
        ('sim', 'Com Óbito'),
        ('nao', 'Sem Óbito'),
    ]

    def lookups(self, request, model_admin):
        if not _show_filter_counts(request):
            return list(self.OPTIONS)
        qs = model_admin.get_queryset(request)
        items = []
        for value, label in self.OPTIONS:
            if value == 'sim':
                count = qs.filter(partes_processuais__obito=True).distinct().count()
            else: # 'nao'
                count = qs.exclude(partes_processuais__obito=True).distinct().count()
            label_html = mark_safe(f"{label} <span class='filter-count'>({count})</span>")
            items.append((value, label_html))
        return items

    def choices(self, changelist):
        current = self.value()
        for value, label in self.lookup_choices:
            selected = current == value
            if selected:
                query_string = changelist.get_query_string(remove=[self.parameter_name])
            else:
                query_string = changelist.get_query_string({self.parameter_name: value})
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        val = self.value()
        if val == 'sim':
            return queryset.filter(partes_processuais__obito=True).distinct()
        if val == 'nao':
            return queryset.exclude(partes_processuais__obito=True).distinct()
        return queryset


@admin.register(ProcessoJudicial)
class ProcessoJudicialAdmin(NoRelatedLinksMixin, admin.ModelAdmin):
    form = ProcessoJudicialForm
    readonly_fields = ()
    class Media:
        js = ('contratos/js/contrato_money_mask.js',)
    list_display = ("uf", "cpf_passivo", "get_polo_passivo", "get_x_separator", "get_polo_ativo",
                    "cnj_with_navigation", "classe_processual", "carteira", "nao_judicializado", "busca_ativa")
    list_display_links = ("cnj_with_navigation",)
    BASE_LIST_FILTERS = [
        LastEditOrderFilter,
        EquipeDelegadoFilter,
        AprovacaoFilter,
        ProtocoladosFilter,
        PrescricaoOrderFilter,
        ViabilidadeFinanceiraFilter,
        ValorCausaOrderFilter,
        ObitoFilter,
        AcordoStatusFilter,
        BuscaAtivaFilter,
        NaoJudicializadoFilter,
        AtivoStatusProcessualFilter,
        CarteiraCountFilter,
        UFCountFilter,
        TerceiroInteressadoFilter,
        EtiquetaFilter,
    ]
    list_filter = BASE_LIST_FILTERS[:]
    search_fields = ("cnj", "partes_processuais__nome", "partes_processuais__documento", "contratos__numero_contrato")
    inlines = [ParteInline, AdvogadoPassivoInline, ContratoInline, AndamentoInline, TarefaInline, PrazoInline, AnaliseProcessoInline, ProcessoArquivoInline]
    def get_search_results(self, request, queryset, search_term):
        qs, use_distinct = super().get_search_results(request, queryset, search_term)
        if not search_term:
            return qs, use_distinct
        sanitized_digits = re.sub(r'\D', '', search_term)
        if sanitized_digits:
            escaped_digits = ''.join(re.escape(d) for d in sanitized_digits)
            digit_pattern = ''.join(f'{d}\\D*' for d in escaped_digits)
            filters = (
                Q(partes_processuais__documento__icontains=sanitized_digits)
                | Q(partes_processuais__documento__iregex=rf'.*{digit_pattern}')
                | Q(cnj__iregex=rf'.*{digit_pattern}')
            )
            extra = queryset.filter(filters)
            qs = (qs | extra).distinct()
            use_distinct = True
        return qs, use_distinct
    fieldsets = (
        ("Dados do Processo", {"fields": ("cnj", "uf", "valor_causa", "status", "viabilidade", "carteira", "vara", "tribunal", "busca_ativa")}),
    )
    change_form_template = "admin/contratos/processojudicial/change_form_navegacao.html"
    history_template = "admin/contratos/processojudicial/object_history.html"
    change_list_template = "admin/contratos/processojudicial/change_list_mapa.html"
    actions = ['excluir_andamentos_selecionados', 'delegate_processes']

    FILTER_SESSION_KEY = 'processo_last_filters'
    FILTER_SKIP_KEY = 'processo_skip_last_filters'

    def get_list_filter(self, request):
        filters = list(self.BASE_LIST_FILTERS)
        if is_user_supervisor(request.user):
            filters.insert(0, ParaSupervisionarFilter)
        return filters

    def _sanitize_filter_qs(self, qs):
        params = QueryDict(qs, mutable=True)
        for key in ('o', 'p', '_changelist_filters', '_skip_saved_filters'):
            params.pop(key, None)
        params.pop('aprovacao', None)
        return params.urlencode()

    def _handle_saved_filters(self, request):
        stored = request.session.get(self.FILTER_SESSION_KEY)
        skip = request.session.pop(self.FILTER_SKIP_KEY, False)
        if request.GET.get('nao_judicializado') is not None:
            request.session.pop(self.FILTER_SESSION_KEY, None)
            request.session[self.FILTER_SKIP_KEY] = True
            skip = True
        if stored and '=' not in stored:
            stored = None
            request.session.pop(self.FILTER_SESSION_KEY, None)
        sanitized = self._sanitize_filter_qs(request.GET.urlencode())
        if request.GET.get('_skip_saved_filters'):
            request.session.pop(self.FILTER_SESSION_KEY, None)
            request.session[self.FILTER_SKIP_KEY] = True
            clean_url = f"{request.path}?{sanitized}" if sanitized else request.path
            if clean_url != request.get_full_path():
                return HttpResponseRedirect(clean_url)
            return None
        if not request.GET and stored and not skip:
            request.session[self.FILTER_SKIP_KEY] = True
            return HttpResponseRedirect(f"{request.path}?{stored}")
        if sanitized:
            request.session[self.FILTER_SESSION_KEY] = sanitized
            request.session.pop(self.FILTER_SKIP_KEY, None)
        elif request.GET and not request.GET.get('_changelist_filters'):
            request.session.pop(self.FILTER_SESSION_KEY, None)
            request.session[self.FILTER_SKIP_KEY] = True
        return None

    def save_model(self, request, obj, form, change):
        entries_payload = form.cleaned_data.get('cnj_entries_data')
        entries = self._parse_cnj_entries(entries_payload)
        active_entry = self._get_active_entry(entries, form.cleaned_data.get('cnj_active_index'))
        if not entries:
            obj.cnj = ''
            obj.uf = ''
            obj.valor_causa = None
            obj.status = None
            obj.carteira = None
            obj.vara = ''
            obj.tribunal = ''
        if active_entry:
            obj.cnj = active_entry.get('cnj') or obj.cnj
            obj.uf = active_entry.get('uf') or obj.uf
            obj.valor_causa = self._decimal_from_string(active_entry.get('valor_causa'))
            status_id = active_entry.get('status')
            carteira_id = active_entry.get('carteira')
            obj.status_id = int(status_id) if status_id else None
            obj.carteira_id = int(carteira_id) if carteira_id else None
            obj.vara = active_entry.get('vara') or obj.vara
            obj.tribunal = active_entry.get('tribunal') or obj.tribunal
        super().save_model(request, obj, form, change)
        self._sync_cnj_entries(obj, entries)

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

    def _build_cnj_entries_context(self, obj):
        if not obj:
            return []
        entries = []
        queryset = obj.numeros_cnj.all().order_by('-criado_em')
        for entry in queryset:
            entries.append({
                'id': entry.pk,
                'cnj': entry.cnj or '',
                'uf': entry.uf or '',
                'valor_causa': format_decimal_brl(entry.valor_causa),
                'status': entry.status_id,
                'carteira': entry.carteira_id,
                'vara': entry.vara or '',
                'tribunal': entry.tribunal or '',
            })
        if not entries and obj.cnj:
            entries.append({
                'id': None,
                'cnj': obj.cnj or '',
                'uf': obj.uf or '',
                'valor_causa': format_decimal_brl(obj.valor_causa),
                'status': obj.status_id,
                'carteira': obj.carteira_id,
                'vara': obj.vara or '',
                'tribunal': obj.tribunal or '',
            })
        return entries

    def _determine_active_index(self, entries, obj):
        if not entries:
            return 0
        current_cnj = obj.cnj if obj else None
        for idx, entry in enumerate(entries):
            if current_cnj and entry.get('cnj') and entry.get('cnj') == current_cnj:
                return idx
        return 0

    def _parse_cnj_entries(self, payload):
        if not payload:
            return []
        try:
            data = json.loads(payload or '[]')
        except (TypeError, ValueError):
            return []
        if not isinstance(data, list):
            return []
        sanitized = []
        seen = set()
        status_cache = {}
        carteira_cache = {}
        for item in data:
            if not isinstance(item, dict):
                continue
            raw_id = item.get('id')
            parsed_id = None
            try:
                parsed_id = int(raw_id)
            except (TypeError, ValueError):
                parsed_id = None
            cnj_val = (item.get('cnj') or '').strip()
            if not cnj_val:
                continue
            status_raw = item.get('status')
            carteira_raw = item.get('carteira')
            status_id = None
            if status_raw not in (None, ''):
                try:
                    status_id = int(status_raw)
                except (TypeError, ValueError):
                    status_label = str(status_raw)
                    status_label = re.sub(r'^\s*\d+\s*-\s*', '', status_label).strip()
                    if status_label:
                        normalized_label = normalize_label_title(status_label)
                        cache_key = normalized_label.lower()
                        if cache_key in status_cache:
                            status_id = status_cache[cache_key]
                        else:
                            status_obj = StatusProcessual.objects.filter(nome__iexact=normalized_label).only('id').first()
                            if not status_obj and normalized_label != status_label:
                                status_obj = StatusProcessual.objects.filter(nome__iexact=status_label).only('id').first()
                            status_id = status_obj.id if status_obj else None
                            status_cache[cache_key] = status_id
            carteira_id = None
            if carteira_raw not in (None, ''):
                try:
                    carteira_id = int(carteira_raw)
                except (TypeError, ValueError):
                    carteira_label = str(carteira_raw)
                    carteira_label = re.sub(r'^\s*\d+\s*-\s*', '', carteira_label).strip()
                    if carteira_label:
                        normalized_label = normalize_label_title(carteira_label)
                        cache_key = normalized_label.lower()
                        if cache_key in carteira_cache:
                            carteira_id = carteira_cache[cache_key]
                        else:
                            carteira_obj = Carteira.objects.filter(nome__iexact=normalized_label).only('id').first()
                            if not carteira_obj and normalized_label != carteira_label:
                                carteira_obj = Carteira.objects.filter(nome__iexact=carteira_label).only('id').first()
                            carteira_id = carteira_obj.id if carteira_obj else None
                            carteira_cache[cache_key] = carteira_id
            key = cnj_val
            if key in seen:
                continue
            seen.add(key)
            sanitized.append({
                'id': parsed_id,
                'cnj': cnj_val,
                'uf': (item.get('uf') or '').strip(),
                'valor_causa': item.get('valor_causa') or '',
                'status': status_id,
                'carteira': carteira_id,
                'vara': (item.get('vara') or '').strip(),
                'tribunal': (item.get('tribunal') or '').strip(),
            })
        return sanitized

    def _get_active_entry(self, entries, index):
        if not entries:
            return None
        if index is None or index < 0 or index >= len(entries):
            return entries[0]
        return entries[index]

    def _decimal_from_string(self, raw):
        value = normalize_decimal_string(raw)
        if not value:
            return None
        try:
            return Decimal(value)
        except (InvalidOperation, TypeError):
            return None

    def _sync_cnj_entries(self, processo, entries):
        processo.numeros_cnj.all().delete()
        if not entries:
            return
        for entry_data in entries:
            cnj_value = (entry_data.get('cnj') or '').strip()
            if not cnj_value:
                continue
            entry_obj = ProcessoJudicialNumeroCnj(
                processo=processo,
                cnj=cnj_value,
                uf=(entry_data.get('uf') or '').strip(),
                valor_causa=self._decimal_from_string(entry_data.get('valor_causa')),
                status_id=entry_data.get('status'),
                carteira_id=entry_data.get('carteira'),
                vara=(entry_data.get('vara') or '').strip(),
                tribunal=(entry_data.get('tribunal') or '').strip(),
            )
            entry_obj.save()

    @admin.display(description="Número CNJ", ordering="cnj")
    def cnj_with_navigation(self, obj):
        cnj_values = []
        for entry in obj.numeros_cnj.order_by('-criado_em'):
            if entry.cnj:
                cnj_values.append(entry.cnj)
        if obj.cnj and obj.cnj not in cnj_values:
            cnj_values.insert(0, obj.cnj)
        cnj_values = list(dict.fromkeys(cnj_values))
        if not cnj_values:
            return "-"
        current_cnj = obj.cnj if obj.cnj in cnj_values else cnj_values[0]
        current_index = cnj_values.index(current_cnj)
        total = len(cnj_values)
        values_json = json.dumps(cnj_values).replace('"', '&quot;')
        prev_disabled = 'true' if current_index <= 0 else 'false'
        next_disabled = 'true' if current_index >= total - 1 else 'false'
        prev_btn = format_html(
            '<button type="button" class="cnj-nav-control" data-direction="prev" data-disabled="{}">‹</button>',
            prev_disabled
        )
        next_btn = format_html(
            '<button type="button" class="cnj-nav-control" data-direction="next" data-disabled="{}">›</button>',
            next_disabled
        )
        counter = format_html('{}/{}', current_index + 1, total)
        control_buttons = format_html('{}{}', prev_btn, next_btn)
        return format_html(
            '<div class="cnj-nav-wrapper" style="display:flex; align-items:center; gap:6px;" data-cnj-values="{}" data-cnj-index="{}">'
            '<span class="cnj-current">{}</span>'
            '<div class="cnj-nav-controls">{}</div>'
            '<span class="cnj-nav-count">{}</span>'
            '</div>',
            mark_safe(values_json),
            current_index,
            current_cnj,
            control_buttons,
            counter
        )

    @admin.display(description="CPF Passivo")
    def cpf_passivo(self, obj):
        parte = obj.partes_processuais.filter(tipo_polo='PASSIVO').first()
        if parte and parte.documento:
            return _format_cpf(parte.documento)
        return "-"

    @admin.display(description=mark_safe('<span style="white-space:nowrap;">Valuation por Contratos</span>'))
    def valor_causa_display(self, obj):
        valor = obj.contratos.aggregate(total=Coalesce(models.Sum('valor_causa'), Decimal('0.00')))['total']
        if not valor or valor == Decimal('0.00'):
            return "-"
        return format_decimal_brl(valor)

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        formfield = super().formfield_for_dbfield(db_field, request, **kwargs)
        if db_field.name == 'valor_causa':
            css = formfield.widget.attrs.get('class', '')
            classes = (css + ' money-mask').strip()
            formfield.widget = forms.TextInput(attrs={'class': classes})
        return formfield

    def change_view(self, request, object_id, form_url='', extra_context=None):
        extra_context = extra_context or {}
        obj = self.get_object(request, object_id)
        if obj:
            extra_context['valuation_display'] = self.valor_causa_display(obj)
            cnj_entries = self._build_cnj_entries_context(obj)
            extra_context['cnj_entries_json'] = mark_safe(json.dumps(cnj_entries))
            extra_context['cnj_active_index'] = self._determine_active_index(cnj_entries, obj)
            active_idx = extra_context['cnj_active_index']
            extra_context['cnj_active_display'] = cnj_entries[active_idx]['cnj'] if cnj_entries and 0 <= active_idx < len(cnj_entries) else (obj.cnj or '')
        else:
            extra_context['cnj_entries_json'] = mark_safe(json.dumps([]))
            extra_context['cnj_active_index'] = 0
            extra_context['cnj_active_display'] = ''
        
        # Preserva os filtros da changelist para a navegação
        changelist_filters = request.GET.get('_changelist_filters')

        # Clona os filtros para o queryset da changelist, evitando que o Django
        # tente filtrar pelo parâmetro especial "_changelist_filters"
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
        
        # Garante uma ordenação consistente com baixo custo
        ordering = self.get_ordering(request) or ('-pk',)
        prev_obj_id = None
        next_obj_id = None
        ordering_fields = list(ordering) if isinstance(ordering, (list, tuple)) else [ordering]
        if ordering_fields and all(field in ('pk', '-pk') for field in ordering_fields) and obj:
            primary_order = ordering_fields[0]
            if primary_order == '-pk':
                prev_obj = queryset.filter(pk__gt=obj.pk).order_by('pk').first()
                next_obj = queryset.filter(pk__lt=obj.pk).order_by('-pk').first()
            else:
                prev_obj = queryset.filter(pk__lt=obj.pk).order_by('-pk').first()
                next_obj = queryset.filter(pk__gt=obj.pk).order_by('pk').first()
            prev_obj_id = prev_obj.pk if prev_obj else None
            next_obj_id = next_obj.pk if next_obj else None

        # Monta as URLs preservando os filtros
        base_url = reverse('admin:contratos_processojudicial_changelist') + "{}"
        filter_params = f'?{changelist_filters}' if changelist_filters else ''

        extra_context['prev_obj_url'] = base_url.format(f'{prev_obj_id}/change/{filter_params}') if prev_obj_id else None
        extra_context['next_obj_url'] = base_url.format(f'{next_obj_id}/change/{filter_params}') if next_obj_id else None
        extra_context['delegar_users'] = User.objects.order_by('username')
        extra_context['is_supervisor'] = is_user_supervisor(request.user)
        extra_context['tipos_peticao_api_url'] = reverse('admin:contratos_documentomodelo_tipos_peticao')
        extra_context['tipos_peticao_preview_url'] = reverse('admin:contratos_documentomodelo_tipos_peticao_preview')
        extra_context['tipos_peticao_generate_url'] = reverse('admin:contratos_documentomodelo_tipos_peticao_generate')
        extra_context['csrf_token'] = get_token(request)
        
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
        elif formset.model == AndamentoProcessual:
            from contratos.integracoes_escavador.parser import remover_andamentos_duplicados

            processo = form.instance
            remover_andamentos_duplicados(processo)
            seen_keys = set()

            for inline_form in formset.forms:
                cleaned = getattr(inline_form, 'cleaned_data', None)
                if not cleaned or cleaned.get('DELETE'):
                    continue
                data = cleaned.get('data')
                descricao = (cleaned.get('descricao') or '').strip()
                if not data or not descricao:
                    continue
                chave = (data, descricao)
                if chave in seen_keys:
                    cleaned['DELETE'] = True
                else:
                    seen_keys.add(chave)

            return super().save_formset(request, form, formset, change)
        else:
            super().save_formset(request, form, formset, change)


    def changelist_view(self, request, extra_context=None):
        if not is_user_supervisor(request.user) and request.GET.get('para_supervisionar'):
            params = request.GET.copy()
            params.pop('para_supervisionar', None)
            clean_url = request.path
            if params:
                clean_url = f"{clean_url}?{params.urlencode()}"
            return HttpResponseRedirect(clean_url)
        redirect = self._handle_saved_filters(request)
        if redirect:
            return redirect
        extra_context = extra_context or {}
        changelist = self.get_changelist_instance(request)
        result_list = changelist.result_list
        if hasattr(result_list, 'prefetch_related'):
            result_list = result_list.prefetch_related(
                Prefetch('etiquetas', queryset=Etiqueta.objects.order_by('ordem', 'nome'))
            )

        etiquetas_data = {}
        for processo in result_list:
            etiquetas = [
                {'nome': etiqueta.nome, 'cor_fundo': etiqueta.cor_fundo, 'cor_fonte': etiqueta.cor_fonte}
                for etiqueta in processo.etiquetas.all()
            ]
            etiquetas_data[processo.pk] = etiquetas
        
        extra_context['etiquetas_data_json'] = json.dumps(etiquetas_data)
        extra_context['delegar_users'] = User.objects.order_by('username')
        
        return super().changelist_view(request, extra_context=extra_context)

    class Media:
        css = {
            'all': (
                'admin/css/admin_tabs.css',
                'admin/css/custom_admin_styles.css?v=20260209b',
                'admin/css/cia_button.css',
                'admin/css/endereco_widget.css', # <--- Adicionado
            )
        }
        js = (
            'admin/js/vendor/jquery/jquery.min.js', 
            'admin/js/jquery.init.js',
            'admin/js/processo_judicial_enhancer.js?v=20260209b',
            'admin/js/admin_tabs.js', 
            'admin/js/processo_judicial_lazy_loader.js',
            'admin/js/etiqueta_interface.js',
            'admin/js/filter_search.js',
            'admin/js/soma_contratos.js',
            'admin/js/cia_button.js',
            'admin/js/cpf_formatter.js',
            'admin/js/info_card_manager.js',
         )

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path('<path:object_id>/etiquetas/', self.admin_site.admin_view(self.etiquetas_view), name='processo_etiquetas'),
            path('<path:object_id>/checagem-sistemas/', self.admin_site.admin_view(self.checagem_sistemas_view), name='processo_checagem_sistemas'),
            path('etiquetas/criar/', self.admin_site.admin_view(self.criar_etiqueta_view), name='etiqueta_criar'),
            path('delegate-select-user/', self.admin_site.admin_view(self.delegate_select_user_view), name='processo_delegate_select_user'), # NEW PATH
            path('delegate-bulk/', self.admin_site.admin_view(self.delegate_bulk_view), name='processo_delegate_bulk'),
            path('<path:object_id>/atualizar-andamentos/', self.admin_site.admin_view(self.atualizar_andamentos_view), name='processo_atualizar_andamentos'),
            path('<path:object_id>/remover-andamentos-duplicados/', self.admin_site.admin_view(self.remover_andamentos_duplicados_view), name='processo_remover_andamentos_duplicados'),
            path('<path:object_id>/delegar-inline/', self.admin_site.admin_view(self.delegar_inline_view), name='processo_delegate_inline'),
            path('parte/<int:parte_id>/obito-info/', self.admin_site.admin_view(self.obito_info_view), name='parte_obito_info'),
        ]
        return custom_urls + urls

    def checagem_sistemas_view(self, request, object_id):
        processo = get_object_or_404(ProcessoJudicial, pk=object_id)
        if not self.has_view_or_change_permission(request, processo):
            return JsonResponse({'error': 'Permissão negada.'}, status=403)

        if request.method == 'GET':
            payload = processo.checagem_sistemas or {}
            if not isinstance(payload, dict):
                payload = {}
            return JsonResponse(payload)

        if request.method != 'POST':
            return JsonResponse({'error': 'Método não permitido'}, status=405)

        try:
            data = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Dados inválidos.'}, status=400)

        questions = data.get('questions')
        if questions is None:
            questions = {}
        if not isinstance(questions, dict):
            return JsonResponse({'error': 'Formato inválido.'}, status=400)

        updated_at = data.get('updated_at')
        processo.checagem_sistemas = {
            'questions': questions,
            'updated_at': updated_at,
        }
        processo.save(update_fields=['checagem_sistemas'])
        return JsonResponse({'status': 'ok'})

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
            from contratos.integracoes_escavador.parser import remover_andamentos_duplicados
            resultado = atualizar_processo_do_escavador(processo.cnj)
            if resultado:
                _, novos_andamentos = resultado
                if novos_andamentos:
                    self.message_user(request, f"Andamentos atualizados para o processo {processo.cnj}.", level=messages.SUCCESS)
                else:
                    self.message_user(request, "Nenhum novo andamento encontrado no momento.", level=messages.INFO)
            else:
                self.message_user(request, f"Não foi possível atualizar andamentos para o processo {processo.cnj}. Verifique o token da API.", level=messages.ERROR)
        except Exception as exc:
            self.message_user(request, f"Erro ao atualizar andamentos: {exc}", level=messages.ERROR)

        return HttpResponseRedirect(reverse('admin:contratos_processojudicial_change', args=[object_id]))

    def remover_andamentos_duplicados_view(self, request, object_id):
        if request.method != 'POST':
            return JsonResponse({'status': 'error', 'message': 'Método não permitido.'}, status=405)
        processo = get_object_or_404(ProcessoJudicial, pk=object_id)
        from contratos.integracoes_escavador.parser import remover_andamentos_duplicados
        try:
            removed = remover_andamentos_duplicados(processo)
            message = (f"{removed} andamento(s) duplicado(s) removido(s)." if removed else "Não foram encontrados andamentos duplicados.")
            return JsonResponse({'status': 'success', 'removed': removed, 'message': message})
        except Exception as exc:
            return JsonResponse({'status': 'error', 'message': f"Erro ao remover duplicados: {exc}"}, status=500)

    def history_view(self, request, object_id, extra_context=None):
        extra_context = extra_context or {}
        extra_context['object_id'] = object_id
        return super().history_view(request, object_id, extra_context=extra_context)

    def response_change(self, request, obj):
        delete_trigger = request.POST.get('_action') == 'Excluir Andamentos Selecionados'
        if delete_trigger or request.POST.get('action') == 'excluir_andamentos_selecionados':
            selected_andamento_ids = set()
            for key, value in request.POST.items():
                if not key.endswith('-DELETE'):
                    continue
                if not value:
                    continue
                base = key[:-7]  # remove trailing '-DELETE'
                id_key = f'{base}-id'
                andamento_id = request.POST.get(id_key)
                if andamento_id:
                    selected_andamento_ids.add(andamento_id)

            if selected_andamento_ids:
                count, _ = AndamentoProcessual.objects.filter(pk__in=selected_andamento_ids).delete()
                self.message_user(request, f"{count} andamento(s) foram excluídos com sucesso.", messages.SUCCESS)
            else:
                self.message_user(request, "Nenhum andamento foi selecionado para exclusão.", messages.WARNING)
            
            return HttpResponseRedirect(request.path)

        from contratos.integracoes_escavador.parser import remover_andamentos_duplicados
        remover_andamentos_duplicados(obj)
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

    @admin.display(description="X")
    def get_x_separator(self, obj):
        return mark_safe('<span title="Mais de dois polos">⚠️</span>') if obj.partes_processuais.count() > 2 else "x"

    @admin.display(description="Polo Ativo")
    def get_polo_ativo(self, obj):
        nome = getattr(obj.partes_processuais.filter(tipo_polo="ATIVO").first(), 'nome', '')
        return format_polo_name(nome)

    @admin.display(description="Polo Passivo")
    def get_polo_passivo(self, obj):
        nome = getattr(obj.partes_processuais.filter(tipo_polo="PASSIVO").first(), 'nome', '')
        return format_polo_name(nome)

    @admin.display(description="Classe Processual", ordering="status")
    def classe_processual(self, obj):
        return obj.status or '-'

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

    def obito_info_view(self, request, parte_id):
        if request.method not in ('POST', 'GET'):
            return JsonResponse({'error': 'Método não permitido'}, status=405)
        if not request.user.has_perm('contratos.change_parte'):
            return JsonResponse({'error': 'Permissão negada'}, status=403)
        parte = get_object_or_404(Parte, pk=parte_id)
        if request.method == 'GET':
            return JsonResponse({
                'status': 'ok',
                'obito_data': parte.obito_data.isoformat() if parte.obito_data else '',
                'obito_cidade': parte.obito_cidade or '',
                'obito_uf': parte.obito_uf or '',
                'obito_idade': parte.obito_idade if parte.obito_idade is not None else '',
            })
        try:
            payload = json.loads(request.body.decode('utf-8') or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Dados inválidos'}, status=400)
        data_value = (payload.get('data_obito') or '').strip()
        parsed_date = None
        if data_value:
            try:
                slash_match = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', data_value)
                if slash_match:
                    day = int(slash_match.group(1))
                    month = int(slash_match.group(2))
                    year = int(slash_match.group(3))
                    parsed_date = datetime.date(year, month, day)
                elif re.fullmatch(r'\d{4}', data_value):
                    parsed_date = datetime.date(int(data_value), 1, 1)
                elif re.fullmatch(r'\d{4}-\d{2}', data_value):
                    year, month = data_value.split('-')
                    parsed_date = datetime.date(int(year), int(month), 1)
                else:
                    parsed_date = datetime.date.fromisoformat(data_value)
            except ValueError:
                return JsonResponse({'error': 'Data inválida'}, status=400)
        cidade = (payload.get('cidade') or '').strip()
        uf = (payload.get('uf') or '').strip().upper()[:2]
        idade_value = (payload.get('idade') or '').strip()
        idade = None
        if idade_value:
            try:
                idade = int(idade_value)
                if idade < 0 or idade > 120:
                    return JsonResponse({'error': 'Idade inválida'}, status=400)
            except ValueError:
                return JsonResponse({'error': 'Idade inválida'}, status=400)
        parte.obito_data = parsed_date
        parte.obito_cidade = cidade
        parte.obito_uf = uf
        parte.obito_idade = idade
        if parsed_date or cidade or uf or idade is not None:
            parte.obito = True
        parte.save(update_fields=['obito', 'obito_data', 'obito_cidade', 'obito_uf', 'obito_idade'])
        return JsonResponse({
            'status': 'ok',
            'obito_data': parte.obito_data.isoformat() if parte.obito_data else '',
            'obito_cidade': parte.obito_cidade or '',
            'obito_uf': parte.obito_uf or '',
            'obito_idade': parte.obito_idade if parte.obito_idade is not None else '',
        })
@admin.register(BuscaAtivaConfig)
class BuscaAtivaConfigAdmin(admin.ModelAdmin):
    list_display = ("horario", "habilitado", "ultima_execucao")
    readonly_fields = ("ultima_execucao",)
    change_form_template = "admin/contratos/buscaativaconfig/change_form.html"

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
        
