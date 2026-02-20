import datetime
import logging
import json
import os
import re
import uuid
import unicodedata
from urllib.parse import quote, unquote, urlparse
from typing import Optional

from django.conf import settings
from django import forms
from django.contrib import admin, messages
from django.contrib.admin.widgets import RelatedFieldWidgetWrapper
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.contrib.admin.models import LogEntry, CHANGE
from django.contrib.admin.views.main import ChangeList
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from django.contrib.auth.models import User, Group  # Importar os modelos User e Group
from django.contrib.contenttypes.models import ContentType
from django.contrib.humanize.templatetags.humanize import intcomma
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.management.color import no_style
from django.db import connection, models, transaction
from django.db.models import Count, FloatField, Max, OuterRef, Q, Sum, Subquery, Prefetch, Window
from django.db.models.expressions import RawSQL
from django.db.models.functions import Abs, Cast, Coalesce, Now, RowNumber
from django.db.utils import IntegrityError, OperationalError, ProgrammingError
from django.http import HttpResponse, HttpResponseNotAllowed, HttpResponseRedirect, JsonResponse, QueryDict
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
    Carteira, CarteiraUsuarioAcesso, Contrato, DemandaAnaliseLoteSalvo, DocumentoModelo, Etiqueta, ListaDeTarefas, OpcaoResposta,
    Parte, ProcessoArquivo, ProcessoJudicial, ProcessoJudicialNumeroCnj, Prazo,
    QuestaoAnalise, StatusProcessual, Tarefa, TarefaLote, TipoAnaliseObjetiva, TipoPeticao, TipoPeticaoAnexoContinua,
    _generate_tipo_peticao_key,
)
from .permissoes import filter_processos_queryset_for_user, get_user_allowed_carteira_ids
from .widgets import EnderecoWidget
from .forms import DemandasAnaliseForm, DemandasAnalisePlanilhaForm
from .services.demandas import (
    DemandasImportError,
    DemandasImportService,
    _format_currency,
    _format_cpf,
)
from .services.peticao_combo import build_preview, generate_zip, PreviewError
from .services.online_presence import (
    TOKEN_SALT as ONLINE_PRESENCE_TOKEN_SALT,
    get_presence_settings,
    is_online_presence_enabled,
    list_online_presence_rows,
    record_online_presence,
)
from .services.passivas_planilha import (
    PassivasPlanilhaError,
    build_passivas_rows_from_file_bytes,
    import_passivas_rows,
    normalize_cnj_digits,
    normalize_cpf,
    normalize_header,
    validate_planilha_upload,
)

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

class CarteiraBulkForm(forms.Form):
    carteira = forms.ModelChoiceField(
        queryset=Carteira.objects.order_by('nome'),
        required=False,
        empty_label="(Remover carteira)",
        label="Carteira",
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

    carteiras_permitidas = forms.ModelMultipleChoiceField(
        required=False,
        label="Carteiras",
        queryset=Carteira.objects.order_by('nome'),
        widget=forms.CheckboxSelectMultiple,
        help_text="Selecione as carteiras que este usuário pode acessar. Em branco = sem restrição (compatibilidade).",
    )

    def save(self, commit=True):
        user = super().save(commit=False)
        user._is_supervisor_flag = self.cleaned_data.get('is_supervisor', False)
        user._carteiras_permitidas = list(self.cleaned_data.get('carteiras_permitidas', []))
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
            if 'carteiras_permitidas' in self.fields:
                self.fields['carteiras_permitidas'].initial = list(
                    Carteira.objects.filter(usuario_acessos__usuario=self.instance).values_list('id', flat=True)
                )

    carteiras_permitidas = forms.ModelMultipleChoiceField(
        required=False,
        label="Carteiras",
        queryset=Carteira.objects.order_by('nome'),
        widget=forms.CheckboxSelectMultiple,
        help_text="Selecione as carteiras que este usuário pode acessar. Em branco = sem restrição (compatibilidade).",
    )

    def save(self, commit=True):
        user = super().save(commit=False)
        user._is_supervisor_flag = self.cleaned_data.get('is_supervisor', False)
        user._carteiras_permitidas = list(self.cleaned_data.get('carteiras_permitidas', []))
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
            {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions', 'is_supervisor', 'carteiras_permitidas')}
        ),
        (_('Important dates'), {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'password1', 'password2', 'is_supervisor', 'carteiras_permitidas'),
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

        carteiras = getattr(form.instance, '_carteiras_permitidas', None)
        if carteiras is None:
            carteiras = form.cleaned_data.get('carteiras_permitidas', [])
        carteira_ids = [c.id for c in (carteiras or []) if getattr(c, 'id', None)]
        CarteiraUsuarioAcesso.objects.filter(usuario=form.instance).exclude(
            carteira_id__in=carteira_ids
        ).delete()
        existing = set(
            CarteiraUsuarioAcesso.objects.filter(usuario=form.instance).values_list('carteira_id', flat=True)
        )
        for carteira_id in carteira_ids:
            if carteira_id in existing:
                continue
            CarteiraUsuarioAcesso.objects.create(usuario=form.instance, carteira_id=carteira_id)

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
        redirect_url = reverse("admin:contratos_processojudicial_changelist")
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
    tipos = []
    tipo_monitoria = None
    try:
        tipos = list(
            TipoAnaliseObjetiva.objects.all().order_by('-ativo', 'nome')
        )
        tipo_monitoria = next((t for t in tipos if t.slug == 'novas-monitorias'), None)
    except (ProgrammingError, OperationalError):
        tipos = []
        messages.warning(
            request,
            "Tipos de Análise Objetiva ainda não estão disponíveis neste banco. "
            "Rode as migrações para habilitar a funcionalidade."
        )
    context.update({
        "title": "Tipos de Análise",
        "tipos_analise_objetiva": tipos,
        "tipo_monitoria": tipo_monitoria,
        "is_supervisor": is_user_supervisor(request.user) or bool(getattr(request.user, 'is_superuser', False)),
    })
    return render(request, "admin/contratos/configuracao_analise_tipos.html", context)

def configuracao_analise_tipo_objetiva_view(request, tipo_id: int):
    if not (is_user_supervisor(request.user) or bool(getattr(request.user, 'is_superuser', False))):
        messages.error(request, "Acesso restrito a supervisores.")
        return HttpResponseRedirect(reverse('admin:index'))

    try:
        tipo = TipoAnaliseObjetiva.objects.get(pk=tipo_id)
    except (ProgrammingError, OperationalError):
        messages.warning(
            request,
            "Tipos de Análise Objetiva ainda não estão disponíveis neste banco. "
            "Rode as migrações para habilitar a funcionalidade."
        )
        return HttpResponseRedirect(reverse('admin:contratos_configuracao_analise_tipos'))
    except TipoAnaliseObjetiva.DoesNotExist:
        messages.error(request, "Tipo de análise não encontrado.")
        return HttpResponseRedirect(reverse('admin:contratos_configuracao_analise_tipos'))

    context = admin.site.each_context(request)
    context.update({
        "title": tipo.nome,
        "tipo": tipo,
    })
    return render(request, "admin/contratos/configuracao_analise_tipo_objetiva.html", context)

def configuracao_analise_tipo_objetiva_export_view(request, tipo_id: int):
    if not (is_user_supervisor(request.user) or bool(getattr(request.user, 'is_superuser', False))):
        messages.error(request, "Acesso restrito a supervisores.")
        return HttpResponseRedirect(reverse('admin:index'))

    try:
        tipo = TipoAnaliseObjetiva.objects.get(pk=tipo_id)
    except (ProgrammingError, OperationalError):
        messages.warning(
            request,
            "Tipos de Análise Objetiva ainda não estão disponíveis neste banco. "
            "Rode as migrações para habilitar a funcionalidade."
        )
        return HttpResponseRedirect(reverse('admin:contratos_configuracao_analise_tipos'))
    except TipoAnaliseObjetiva.DoesNotExist:
        messages.error(request, "Tipo de análise não encontrado.")
        return HttpResponseRedirect(reverse('admin:contratos_configuracao_analise_tipos'))

    questoes = (
        QuestaoAnalise.objects.filter(tipo_analise=tipo)
        .prefetch_related("opcoes", "opcoes__proxima_questao")
        .order_by("ordem", "id")
    )
    payload = {
        "tipo": {
            "nome": tipo.nome,
            "slug": tipo.slug,
            "hashtag": tipo.hashtag,
            "ativo": bool(tipo.ativo),
            "versao": int(tipo.versao or 1),
        },
        "questoes": [],
    }
    for questao in questoes:
        opcoes = (
            OpcaoResposta.objects.filter(questao_origem=questao)
            .select_related("proxima_questao")
            .order_by("id")
        )
        payload["questoes"].append(
            {
                "texto_pergunta": questao.texto_pergunta,
                "chave": questao.chave,
                "tipo_campo": questao.tipo_campo,
                "ordem": int(questao.ordem or 0),
                "ativo": bool(questao.ativo),
                "is_primeira_questao": bool(questao.is_primeira_questao),
                "opcoes": [
                    {
                        "texto_resposta": opcao.texto_resposta,
                        "ativo": bool(opcao.ativo),
                        "proxima_questao_chave": (
                            opcao.proxima_questao.chave if opcao.proxima_questao_id else None
                        ),
                    }
                    for opcao in opcoes
                ],
            }
        )

    filename = f"{tipo.slug or 'tipo_analise'}.json"
    response = HttpResponse(
        json.dumps(payload, ensure_ascii=False, indent=2),
        content_type="application/json; charset=utf-8",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response

def _sync_tipo_objetiva_from_payload(payload: dict, user=None, bump_version: bool = False):
    tipo_data = payload.get("tipo") or {}
    questoes_data = payload.get("questoes") or []

    slug = (tipo_data.get("slug") or "").strip()
    nome = (tipo_data.get("nome") or "").strip()
    if not slug or not nome:
        raise ValueError("JSON inválido: tipo.slug e tipo.nome são obrigatórios.")

    hashtag = (tipo_data.get("hashtag") or "").strip()
    ativo = bool(tipo_data.get("ativo", True))

    tipo, created = TipoAnaliseObjetiva.objects.get_or_create(
        slug=slug,
        defaults={
            "nome": nome,
            "hashtag": hashtag,
            "ativo": ativo,
            "versao": int(tipo_data.get("versao") or 1),
        },
    )

    changed = False
    if tipo.nome != nome:
        tipo.nome = nome
        changed = True
    if hashtag and tipo.hashtag != hashtag:
        tipo.hashtag = hashtag
        changed = True
    if tipo.ativo != ativo:
        tipo.ativo = ativo
        changed = True
    tipo.save()

    questoes_by_chave = {q.chave: q for q in QuestaoAnalise.objects.filter(tipo_analise=tipo)}
    incoming_chaves = set()

    for qd in questoes_data:
        chave = (qd.get("chave") or "").strip()
        if not chave:
            raise ValueError("JSON inválido: toda questão deve ter 'chave'.")
        incoming_chaves.add(chave)

        conflito = QuestaoAnalise.objects.filter(chave=chave).exclude(tipo_analise=tipo).exists()
        if conflito:
            raise ValueError(f"Conflito: já existe uma questão com chave '{chave}' em outro Tipo de Análise.")

        defaults = {
            "tipo_analise": tipo,
            "texto_pergunta": qd.get("texto_pergunta") or "",
            "tipo_campo": qd.get("tipo_campo") or "OPCOES",
            "ordem": int(qd.get("ordem") or 0),
            "ativo": bool(qd.get("ativo", True)),
            "is_primeira_questao": bool(qd.get("is_primeira_questao", False)),
        }

        questao = questoes_by_chave.get(chave)
        if questao is None:
            questao = QuestaoAnalise.objects.create(chave=chave, **defaults)
            questoes_by_chave[chave] = questao
            changed = True
        else:
            for field, value in defaults.items():
                if getattr(questao, field) != value:
                    setattr(questao, field, value)
                    changed = True
            questao.save()

    for chave, questao in list(questoes_by_chave.items()):
        if chave in incoming_chaves:
            continue
        if questao.ativo:
            questao.ativo = False
            questao.is_primeira_questao = False
            questao.save(update_fields=["ativo", "is_primeira_questao"])
            changed = True

    primeiras = list(
        QuestaoAnalise.objects.filter(tipo_analise=tipo, is_primeira_questao=True, ativo=True).order_by("ordem", "id")
    )
    if len(primeiras) > 1:
        keep = primeiras[0]
        QuestaoAnalise.objects.filter(tipo_analise=tipo, is_primeira_questao=True, ativo=True).exclude(pk=keep.pk).update(
            is_primeira_questao=False
        )
        changed = True

    pending_next = []  # (opcao, prox_chave)
    for qd in questoes_data:
        chave = (qd.get("chave") or "").strip()
        questao = questoes_by_chave.get(chave)
        if not questao:
            continue
        desired = qd.get("opcoes") or []
        desired_texts = []
        for od in desired:
            texto = (od.get("texto_resposta") or "").strip()
            if not texto:
                continue
            desired_texts.append(texto)
            opcao, opt_created = OpcaoResposta.objects.get_or_create(
                questao_origem=questao,
                texto_resposta=texto,
                defaults={"ativo": bool(od.get("ativo", True)), "proxima_questao": None},
            )
            if opt_created:
                changed = True
            else:
                ativo_od = bool(od.get("ativo", True))
                if opcao.ativo != ativo_od:
                    opcao.ativo = ativo_od
                    changed = True
                opcao.save()
            pending_next.append((opcao, (od.get("proxima_questao_chave") or "").strip() or None))

        for opcao in OpcaoResposta.objects.filter(questao_origem=questao):
            if opcao.texto_resposta in desired_texts:
                continue
            if opcao.ativo:
                opcao.ativo = False
                opcao.proxima_questao = None
                opcao.save(update_fields=["ativo", "proxima_questao"])
                changed = True

    for opcao, prox_chave in pending_next:
        prox_obj = questoes_by_chave.get(prox_chave) if prox_chave else None
        if opcao.proxima_questao_id != (prox_obj.id if prox_obj else None):
            opcao.proxima_questao = prox_obj
            opcao.save(update_fields=["proxima_questao"])
            changed = True

    if bump_version and changed:
        tipo.bump_version(user=user)

    return tipo, created, changed

def configuracao_analise_tipo_objetiva_import_view(request, tipo_id: Optional[int] = None):
    if not (is_user_supervisor(request.user) or bool(getattr(request.user, 'is_superuser', False))):
        messages.error(request, "Acesso restrito a supervisores.")
        return HttpResponseRedirect(reverse('admin:index'))

    tipo_target = None
    if tipo_id is not None:
        try:
            tipo_target = TipoAnaliseObjetiva.objects.get(pk=tipo_id)
        except TipoAnaliseObjetiva.DoesNotExist:
            tipo_target = None

    context = admin.site.each_context(request)
    context.update({
        "title": "Importar Tipo de Análise (JSON)",
        "tipo_target": tipo_target,
    })

    if request.method != 'POST':
        return render(request, "admin/contratos/configuracao_analise_tipo_objetiva_import.html", context)

    upload = request.FILES.get("json_file")
    if not upload:
        messages.error(request, "Selecione um arquivo JSON.")
        return render(request, "admin/contratos/configuracao_analise_tipo_objetiva_import.html", context)

    try:
        raw = upload.read().decode("utf-8")
        payload = json.loads(raw or "{}")
    except Exception:
        messages.error(request, "JSON inválido.")
        return render(request, "admin/contratos/configuracao_analise_tipo_objetiva_import.html", context)

    bump_version = request.POST.get("bump_version") in ("on", "1", "true", "True")

    try:
        tipo, created, changed = _sync_tipo_objetiva_from_payload(payload, user=request.user, bump_version=bump_version)
    except ValueError as exc:
        messages.error(request, str(exc))
        return render(request, "admin/contratos/configuracao_analise_tipo_objetiva_import.html", context)

    if tipo_target and tipo_target.id != tipo.id:
        messages.error(
            request,
            f"Este import é para '{tipo_target.slug}', mas o JSON é de '{tipo.slug}'.",
        )
        return render(request, "admin/contratos/configuracao_analise_tipo_objetiva_import.html", context)

    if created:
        messages.success(request, f"Tipo '{tipo.nome}' importado (criado) com sucesso.")
    else:
        messages.success(
            request,
            f"Tipo '{tipo.nome}' importado com sucesso. Alterações: {'sim' if changed else 'não'}.",
        )
    return HttpResponseRedirect(reverse('admin:contratos_configuracao_analise_tipos'))

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

    lote_session_key = f"demandas_analise_lote_state_{request.user.id}"
    lote_selected_session_key = f"demandas_analise_lote_saved_id_{request.user.id}"
    saved_lote_state = request.session.get(lote_session_key, {}) if request.method != 'POST' else {}
    saved_lotes = list(
        DemandaAnaliseLoteSalvo.objects.filter(usuario=request.user)
        .select_related('carteira')
        .order_by('nome')
    )
    saved_lotes_by_id = {str(item.id): item for item in saved_lotes}
    if request.method == 'POST':
        form = DemandasAnaliseForm(request.POST or None)
    else:
        form = DemandasAnaliseForm(initial={
            "modo_busca": saved_lote_state.get("modo_busca") or DemandasAnaliseForm.MODO_PERIODO,
            "lote_identificadores": saved_lote_state.get("lote_identificadores") or "",
            "carteira": saved_lote_state.get("carteira_id"),
        })

    preview_rows = []
    period_label = ""
    selected_saved_lote_id = (
        str(
            (request.POST.get('lote_salvo_id') if request.method == 'POST' else request.session.get(lote_selected_session_key))
            or ''
        ).strip()
    )
    lote_salvo_nome = (request.POST.get('lote_salvo_nome') or '').strip() if request.method == 'POST' else ''
    if not lote_salvo_nome and selected_saved_lote_id in saved_lotes_by_id:
        lote_salvo_nome = saved_lotes_by_id[selected_saved_lote_id].nome
    selected_mode = (
        request.POST.get('modo_busca')
        or saved_lote_state.get("modo_busca")
        or DemandasAnaliseForm.MODO_PERIODO
    ).strip()
    preview_ready = False
    preview_total_label = _format_currency(Decimal('0'))
    import_action = (request.POST.get('import_action') or request.POST.get('action_override') or '').strip()
    selected_cpfs = request.POST.getlist('selected_cpfs')
    selected_ufs = [str(uf or '').strip().upper() for uf in request.POST.getlist('selected_ufs') if str(uf or '').strip()]
    preview_parse_meta = {}
    preview_uf_totals = []
    preview_uf_options = []
    preview_uf_summary_total = 0
    preview_uf_summary_title = "Quantidade por UF (cadastros encontrados)"
    preview_uf_unmapped_count = 0
    preview_uf_explainer = ""
    import_feedback_text = ""
    import_feedback_level = ""
    preview_hint = (
        "Use o intervalo de prescrições para identificar CPFs elegíveis e revisar os cadastros "
        "antes de confirmar a importação."
    )
    form_is_valid = False

    def _normalize_preview_uf(value: Optional[str]) -> str:
        uf = (value or '').strip().upper()
        return uf or 'SEM_UF'

    def _get_imported_cpfs_for_carteira(rows, carteira_obj):
        if not carteira_obj or not carteira_obj.id or not rows:
            return set()
        cpf_values = sorted({
            str(row.get("cpf_raw") or "").strip()
            for row in rows
            if str(row.get("cpf_raw") or "").strip()
        })
        if not cpf_values:
            return set()
        queryset = (
            Parte.objects.filter(tipo_polo='PASSIVO')
            .filter(
                Q(processo__carteira_id=carteira_obj.id)
                | Q(processo__carteiras_vinculadas__id=carteira_obj.id)
            )
            .annotate(
                documento_digits=RawSQL(
                    "regexp_replace(COALESCE(documento, ''), '\\D', '', 'g')",
                    []
                )
            )
            .filter(documento_digits__in=cpf_values)
            .values_list('documento_digits', flat=True)
            .distinct()
        )
        return set(queryset)

    def _sort_preview_rows_by_uf(rows):
        return sorted(
            rows,
            key=lambda row: (
                _normalize_preview_uf(row.get('uf_endereco')) == 'SEM_UF',
                _normalize_preview_uf(row.get('uf_endereco')),
                (row.get('cpf_raw') or row.get('cpf') or ''),
            )
        )

    def _build_preview_uf_totals(rows):
        counts = {}
        for row in rows:
            uf = _normalize_preview_uf(row.get('uf_endereco'))
            counts[uf] = counts.get(uf, 0) + 1
        ordered = sorted(
            counts.items(),
            key=lambda item: (
                item[0] == 'SEM_UF',
                item[0],
            )
        )
        return [{"uf": uf, "total": total} for uf, total in ordered]

    def _build_preview_uf_options(rows, imported_cpfs):
        grouped = {}
        for row in rows:
            uf = _normalize_preview_uf(row.get('uf_endereco'))
            cpf = str(row.get('cpf_raw') or '').strip()
            is_imported = cpf in imported_cpfs if cpf else False
            row['already_imported'] = is_imported
            if uf not in grouped:
                grouped[uf] = {
                    "uf": uf,
                    "total": 0,
                    "imported": 0,
                    "pending": 0,
                    "disabled": False,
                }
            grouped[uf]["total"] += 1
            if is_imported:
                grouped[uf]["imported"] += 1
            else:
                grouped[uf]["pending"] += 1
        ordered = sorted(
            grouped.values(),
            key=lambda item: (item["uf"] == 'SEM_UF', item["uf"])
        )
        for item in ordered:
            item["disabled"] = item["pending"] == 0
        return ordered

    def _get_imported_cnjs_for_carteira(valid_cnjs, carteira_obj):
        if not carteira_obj or not carteira_obj.id:
            return set()
        normalized_cnjs = sorted({
            str(cnj or "").strip()
            for cnj in (valid_cnjs or [])
            if str(cnj or "").strip()
        })
        if not normalized_cnjs:
            return set()

        processos_match = (
            ProcessoJudicial.objects
            .annotate(
                cnj_digits=RawSQL(
                    "RIGHT(LPAD(regexp_replace(COALESCE(\"contratos_processojudicial\".\"cnj\", ''), '\\D', '', 'g'), 20, '0'), 20)",
                    [],
                )
            )
            .filter(cnj_digits__in=normalized_cnjs)
            .filter(
                Q(carteira_id=carteira_obj.id)
                | Q(carteiras_vinculadas__id=carteira_obj.id)
            )
            .values_list('cnj_digits', flat=True)
            .distinct()
        )
        numeros_match = (
            ProcessoJudicialNumeroCnj.objects
            .annotate(
                cnj_digits=RawSQL(
                    "RIGHT(LPAD(regexp_replace(COALESCE(\"contratos_processojudicialnumerocnj\".\"cnj\", ''), '\\D', '', 'g'), 20, '0'), 20)",
                    [],
                )
            )
            .filter(cnj_digits__in=normalized_cnjs)
            .filter(
                Q(carteira_id=carteira_obj.id)
                | Q(processo__carteira_id=carteira_obj.id)
                | Q(processo__carteiras_vinculadas__id=carteira_obj.id)
            )
            .values_list('cnj_digits', flat=True)
            .distinct()
        )
        return set(processos_match).union(set(numeros_match))

    def _build_preview_uf_options_from_input(uf_totals, valid_uf_totals, valid_cnjs_by_uf, carteira_obj):
        valid_map = {
            str(item.get("uf") or "SEM_UF"): int(item.get("total") or 0)
            for item in (valid_uf_totals or [])
        }
        all_valid_cnjs = []
        for cnj_list in (valid_cnjs_by_uf or {}).values():
            all_valid_cnjs.extend(list(cnj_list or []))
        imported_cnjs = _get_imported_cnjs_for_carteira(all_valid_cnjs, carteira_obj)

        ordered = sorted(
            uf_totals,
            key=lambda item: (str(item.get("uf") or "") == 'SEM_UF', str(item.get("uf") or ""))
        )
        options = []
        for item in ordered:
            uf = str(item.get("uf") or "SEM_UF")
            total = int(item.get("total") or 0)
            valid_total = int(valid_map.get(uf, 0))
            uf_valid_cnjs = list((valid_cnjs_by_uf or {}).get(uf, []) or [])
            imported_total = sum(1 for cnj in uf_valid_cnjs if str(cnj or "").strip() in imported_cnjs)
            pending_total = max(0, valid_total - imported_total)
            options.append({
                "uf": uf,
                "total": total,
                "imported": imported_total,
                "pending": pending_total,
                "valid_total": valid_total,
                "disabled": pending_total == 0,
            })
        return options

    def _get_saved_lote_by_id(raw_id: Optional[str]) -> Optional[DemandaAnaliseLoteSalvo]:
        lote_id = str(raw_id or '').strip()
        if not lote_id:
            return None
        if lote_id in saved_lotes_by_id:
            return saved_lotes_by_id[lote_id]
        try:
            lote_pk = int(lote_id)
        except (TypeError, ValueError):
            return None
        return (
            DemandaAnaliseLoteSalvo.objects
            .filter(usuario=request.user, id=lote_pk)
            .select_related('carteira')
            .first()
        )

    def _resolve_carteira_from_post() -> Optional[Carteira]:
        raw_id = str(request.POST.get('carteira') or '').strip()
        if not raw_id:
            return None
        try:
            carteira_id = int(raw_id)
        except (TypeError, ValueError):
            return None
        return Carteira.objects.filter(id=carteira_id).first()

    if request.method == 'POST' and (
        selected_mode == DemandasAnaliseForm.MODO_LOTE
        or import_action in {"save_lote", "load_lote", "delete_lote"}
    ):
        if selected_saved_lote_id:
            try:
                request.session[lote_selected_session_key] = int(selected_saved_lote_id)
            except (TypeError, ValueError):
                request.session.pop(lote_selected_session_key, None)
        else:
            request.session.pop(lote_selected_session_key, None)

    if request.method == 'POST' and import_action in {"save_lote", "load_lote", "delete_lote"}:
        lote_obj = _get_saved_lote_by_id(selected_saved_lote_id)
        identifiers_text_post = (request.POST.get('lote_identificadores') or '').strip()
        carteira_post = _resolve_carteira_from_post()

        if import_action == "save_lote":
            if (request.POST.get('modo_busca') or '').strip() != DemandasAnaliseForm.MODO_LOTE:
                messages.warning(request, "A lista salva está disponível apenas no modo CNJ/CPF (lote).")
            elif not lote_salvo_nome:
                messages.warning(request, "Informe um nome para salvar a lista.")
            elif not identifiers_text_post:
                messages.warning(request, "Informe ao menos um CNJ/CPF para salvar a lista.")
            else:
                created = False
                if lote_obj and lote_obj.nome == lote_salvo_nome:
                    lote_to_save = lote_obj
                else:
                    lote_to_save = (
                        DemandaAnaliseLoteSalvo.objects
                        .filter(usuario=request.user, nome=lote_salvo_nome)
                        .first()
                    )
                    if not lote_to_save:
                        lote_to_save = DemandaAnaliseLoteSalvo(usuario=request.user, nome=lote_salvo_nome)
                        created = True
                lote_to_save.identificadores = identifiers_text_post
                lote_to_save.carteira = carteira_post
                lote_to_save.save()
                request.session[lote_selected_session_key] = lote_to_save.id
                request.session[lote_session_key] = {
                    "modo_busca": DemandasAnaliseForm.MODO_LOTE,
                    "lote_identificadores": identifiers_text_post,
                    "carteira_id": carteira_post.id if carteira_post and carteira_post.id else None,
                }
                if created:
                    messages.success(request, f"Lista '{lote_to_save.nome}' salva com sucesso.")
                else:
                    messages.success(request, f"Lista '{lote_to_save.nome}' atualizada com sucesso.")

        elif import_action == "load_lote":
            if not lote_obj:
                messages.warning(request, "Selecione uma lista salva para carregar.")
            else:
                request.session[lote_selected_session_key] = lote_obj.id
                request.session[lote_session_key] = {
                    "modo_busca": DemandasAnaliseForm.MODO_LOTE,
                    "lote_identificadores": lote_obj.identificadores or "",
                    "carteira_id": lote_obj.carteira_id,
                }
                messages.success(request, f"Lista '{lote_obj.nome}' carregada.")

        elif import_action == "delete_lote":
            if not lote_obj:
                messages.warning(request, "Selecione uma lista salva para excluir.")
            else:
                deleted_name = lote_obj.nome
                current_state = request.session.get(lote_session_key) or {}
                current_identifiers = str(current_state.get("lote_identificadores") or "").strip()
                current_carteira_id = current_state.get("carteira_id")
                lote_identifiers = str(lote_obj.identificadores or "").strip()
                lote_carteira_id = lote_obj.carteira_id
                lote_obj.delete()
                request.session.pop(lote_selected_session_key, None)
                if current_identifiers == lote_identifiers and current_carteira_id == lote_carteira_id:
                    request.session.pop(lote_session_key, None)
                messages.success(request, f"Lista '{deleted_name}' excluída.")

        return HttpResponseRedirect(reverse('admin:contratos_demandas_analise'))

    if form.is_valid():
        form_is_valid = True
        carteira = form.cleaned_data['carteira']
        alias = (carteira.fonte_alias or '').strip() or DemandasImportService.SOURCE_ALIAS
        preview_service = DemandasImportService(db_alias=alias)
        selected_mode = form.cleaned_data.get('modo_busca') or DemandasAnaliseForm.MODO_PERIODO

        try:
            if selected_mode == DemandasAnaliseForm.MODO_LOTE:
                identifiers_text = (form.cleaned_data.get('lote_identificadores') or '').strip()
                period_label = "CNJ/CPF (lote)"
                preview_hint = (
                    "Use CNJ ou CPF (com/sem formatação). Se o cadastro já existir em outra carteira, "
                    "a importação apenas vincula a nova carteira indicada."
                )
                if identifiers_text:
                    request.session[lote_session_key] = {
                        "modo_busca": DemandasAnaliseForm.MODO_LOTE,
                        "lote_identificadores": identifiers_text,
                        "carteira_id": carteira.id if carteira and carteira.id else None,
                    }
                preview_rows, preview_total, preview_parse_meta = preview_service.build_preview_for_identifiers(
                    identifiers_text
                )
                preview_total_label = _format_currency(preview_total)
                preview_ready = True
                imported_cpfs_for_preview = _get_imported_cpfs_for_carteira(preview_rows, carteira)
                for row in preview_rows:
                    cpf_raw = str(row.get('cpf_raw') or '').strip()
                    row['already_imported'] = cpf_raw in imported_cpfs_for_preview if cpf_raw else False

                invalid_tokens = preview_parse_meta.get("invalid_tokens") or []
                if invalid_tokens and import_action == "preview":
                    sample = ", ".join(invalid_tokens[:5])
                    suffix = "..." if len(invalid_tokens) > 5 else ""
                    messages.warning(
                        request,
                        f"Foram ignorados {len(invalid_tokens)} item(ns) inválidos no lote: {sample}{suffix}",
                    )

                if import_action in ("import_all", "import_selected"):
                    etiqueta_nome = preview_service.build_etiqueta_nome(carteira, period_label)
                    import_result = None
                    import_scope_label = ""
                    if import_action == "import_selected":
                        filtered_cpfs = [cpf for cpf in selected_cpfs if cpf]
                        selected_ufs_set = {uf for uf in selected_ufs if uf}
                        selected_cnjs = []
                        if not filtered_cpfs and selected_ufs and preview_rows:
                            filtered_cpfs = sorted({
                                str(row.get('cpf_raw') or '').strip()
                                for row in preview_rows
                                if str(row.get('cpf_raw') or '').strip()
                                and _normalize_preview_uf(row.get('uf_endereco')) in selected_ufs_set
                                and not bool(row.get('already_imported'))
                            })
                            if filtered_cpfs and selected_ufs_set:
                                import_scope_label = "UFs: " + ", ".join(sorted(selected_ufs_set))
                        if not filtered_cpfs and selected_ufs_set:
                            valid_cnjs_by_uf = preview_parse_meta.get("valid_cnjs_by_uf") or {}
                            selected_cnjs = sorted({
                                str(cnj or "").strip()
                                for uf in selected_ufs_set
                                for cnj in (valid_cnjs_by_uf.get(uf) or [])
                                if str(cnj or "").strip()
                            })
                            if selected_cnjs and not import_scope_label:
                                import_scope_label = "UFs: " + ", ".join(sorted(selected_ufs_set))
                        if not filtered_cpfs:
                            if selected_cnjs:
                                import_result = preview_service.import_identifiers(
                                    selected_cnjs,
                                    etiqueta_nome,
                                    carteira,
                                    link_only_existing=True,
                                    allow_minimal_missing_cnjs=False,
                                    allowed_ufs=selected_ufs_set or None,
                                )
                            elif selected_ufs and not preview_rows:
                                if selected_ufs_set:
                                    import_scope_label = "UFs: " + ", ".join(sorted(selected_ufs_set))
                                import_result = preview_service.import_identifiers(
                                    identifiers_text,
                                    etiqueta_nome,
                                    carteira,
                                    link_only_existing=True,
                                    allow_minimal_missing_cnjs=False,
                                    allowed_ufs=selected_ufs_set,
                                )
                                if not import_result or (
                                    not int(import_result.get("imported") or 0)
                                    and not int(import_result.get("minimal_created") or 0)
                                    and not int(import_result.get("minimal_linked") or 0)
                                ):
                                    messages.warning(request, "As UFs selecionadas não possuem CNJ válido (20 dígitos) pendente de importação.")
                                    import_feedback_text = "As UFs selecionadas não possuem CNJ válido (20 dígitos) pendente de importação."
                                    import_feedback_level = "warning"
                            else:
                                messages.warning(request, "Selecione pelo menos um CPF ou UF com pendência para importar.")
                                import_feedback_text = "Selecione pelo menos um CPF ou UF com pendência para importar."
                                import_feedback_level = "warning"
                        else:
                            import_result = preview_service.import_cpfs(
                                filtered_cpfs,
                                etiqueta_nome,
                                carteira,
                            )
                    else:
                        import_result = preview_service.import_identifiers(
                            identifiers_text,
                            etiqueta_nome,
                            carteira,
                            link_only_existing=True,
                            allow_minimal_missing_cnjs=False,
                        )

                    if import_result:
                        lote_obj_for_import = _get_saved_lote_by_id(selected_saved_lote_id)
                        if lote_obj_for_import:
                            lote_obj_for_import.ultimo_importado_em = timezone.now()
                            lote_obj_for_import.identificadores = identifiers_text
                            lote_obj_for_import.carteira = carteira
                            lote_obj_for_import.save()
                            request.session[lote_selected_session_key] = lote_obj_for_import.id
                        summary = []
                        if import_result.get("imported"):
                            summary.append(f"{import_result['imported']} importados")
                        if import_result.get("skipped"):
                            summary.append(f"{import_result['skipped']} ignorados")
                        minimal_created = int(import_result.get("minimal_created") or 0)
                        minimal_linked = int(import_result.get("minimal_linked") or 0)
                        if minimal_created:
                            summary.append(f"{minimal_created} criados por CNJ")
                        if minimal_linked:
                            summary.append(f"{minimal_linked} vinculados por CNJ")
                        ignored_invalid_count = len(preview_parse_meta.get("invalid_tokens") or [])
                        if ignored_invalid_count:
                            summary.append(f"{ignored_invalid_count} inválidos ignorados")
                        if summary:
                            if import_scope_label:
                                messages.success(request, f"Importação concluída ({import_scope_label}): " + ", ".join(summary))
                                import_feedback_text = f"Importação concluída ({import_scope_label}): " + ", ".join(summary)
                            else:
                                messages.success(request, "Importação concluída: " + ", ".join(summary))
                                import_feedback_text = "Importação concluída: " + ", ".join(summary)
                            import_feedback_level = "success"
                        else:
                            messages.info(request, "Nenhum cadastro foi importado.")
                            import_feedback_text = "Nenhum cadastro foi importado."
                            import_feedback_level = "info"
                    elif import_action in ("import_all", "import_selected") and not import_feedback_text:
                        messages.info(request, "Nenhum cadastro foi importado.")
                        import_feedback_text = "Nenhum cadastro foi importado."
                        import_feedback_level = "info"
            else:
                data_de = form.cleaned_data['data_de']
                data_ate = form.cleaned_data['data_ate']
                period_label = preview_service.build_period_label(data_de, data_ate)
                preview_hint = (
                    "Use o intervalo de prescrições para identificar CPFs elegíveis e revisar os cadastros "
                    "antes de confirmar a importação."
                )
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

    if preview_rows:
        preview_rows = _sort_preview_rows_by_uf(preview_rows)
        carteira_for_status = form.cleaned_data.get('carteira') if form_is_valid else None
        imported_cpfs = _get_imported_cpfs_for_carteira(preview_rows, carteira_for_status)
        preview_uf_options = _build_preview_uf_options(preview_rows, imported_cpfs)
        preview_uf_totals = _build_preview_uf_totals(preview_rows)
        preview_uf_summary_total = len(preview_rows)
    elif selected_mode == DemandasAnaliseForm.MODO_LOTE:
        parsed_uf_totals = preview_parse_meta.get("input_uf_totals") or []
        if parsed_uf_totals:
            preview_uf_totals = parsed_uf_totals
            carteira_for_options = form.cleaned_data.get('carteira') if form_is_valid else None
            preview_uf_options = _build_preview_uf_options_from_input(
                parsed_uf_totals,
                preview_parse_meta.get("valid_uf_totals") or [],
                preview_parse_meta.get("valid_cnjs_by_uf") or {},
                carteira_for_options,
            )
            preview_uf_summary_total = int(preview_parse_meta.get("input_uf_total_count") or 0)
            preview_uf_summary_title = "Quantidade por UF (entradas CNJ do lote)"
    if selected_mode == DemandasAnaliseForm.MODO_LOTE and preview_parse_meta.get("total_tokens"):
        preview_uf_unmapped_count = max(
            0,
            int(preview_parse_meta.get("total_tokens") or 0) - int(preview_uf_summary_total or 0),
        )
        preview_uf_explainer = (
            "Resumo por UF usa o mapeamento do CNJ (mesma regra do botão Preencher UF). "
            "Entradas sem estrutura mínima para inferência entram em 'Sem UF inferível'."
        )

    saved_lotes = list(
        DemandaAnaliseLoteSalvo.objects.filter(usuario=request.user)
        .select_related('carteira')
        .order_by('nome')
    )
    saved_lotes_by_id = {str(item.id): item for item in saved_lotes}
    if not lote_salvo_nome and selected_saved_lote_id in saved_lotes_by_id:
        lote_salvo_nome = saved_lotes_by_id[selected_saved_lote_id].nome

    context = admin.site.each_context(request)
    context.update({
        "title": "Demandas P/ Análise",
        "form": form,
        "preview_rows": preview_rows,
        "preview_ready": preview_ready,
        "period_label": period_label,
        "period_label_sample": period_label or ("CNJ/CPF (lote)" if selected_mode == DemandasAnaliseForm.MODO_LOTE else "xx/xx/xxxx - xx/xx/xxxx"),
        "preview_total_label": preview_total_label,
        "preview_hint": preview_hint,
        "preview_parse_meta": preview_parse_meta,
        "preview_uf_totals": preview_uf_totals,
        "preview_uf_options": preview_uf_options,
        "preview_uf_summary_total": preview_uf_summary_total,
        "preview_uf_summary_title": preview_uf_summary_title,
        "preview_uf_unmapped_count": preview_uf_unmapped_count,
        "preview_uf_explainer": preview_uf_explainer,
        "import_feedback_text": import_feedback_text,
        "import_feedback_level": import_feedback_level,
        "selected_ufs": selected_ufs,
        "selected_mode": selected_mode,
        "saved_lotes": saved_lotes,
        "selected_saved_lote_id": selected_saved_lote_id,
        "lote_salvo_nome": lote_salvo_nome,
    })
    return render(request, "admin/contratos/demandas_analise.html", context)


def demandas_analise_planilha_view(request):
    if not is_user_supervisor(request.user):
        messages.error(request, "Acesso restrito a supervisores.")
        return HttpResponseRedirect(reverse('admin:index'))

    import_modal_session_key = "passivas_planilha_last_import_modal"
    form = DemandasAnalisePlanilhaForm(request.POST or None, request.FILES or None)
    preview = None
    import_result = None
    import_modal_data = request.session.pop(import_modal_session_key, None)
    selected_cpfs = []
    selected_cpfs_payload = ""

    action = (request.POST.get("action") or request.POST.get("action_override")) if request.method == "POST" else None
    import_action_requested = request.method == "POST" and action == "import"
    consider_priority = request.method == "POST" and (
        request.POST.get("considerar_prioridade") in {"1", "true", "True", "on", "yes"}
    )
    selected_priority_keys = [
        normalize_header(v)
        for v in (request.POST.getlist("selected_prioridades") if request.method == "POST" else [])
        if normalize_header(v)
    ]
    selected_priority_keys = list(dict.fromkeys(selected_priority_keys))
    priority_options = []

    def _uploads_session_key() -> str:
        return "passivas_planilha_uploads"

    def _pending_actions_session_key() -> str:
        return "passivas_planilha_pending_actions"

    def _cleanup_old_uploads(session_dict: dict) -> dict:
        # Remove itens antigos e arquivos inexistentes (best-effort).
        now = timezone.now()
        cleaned = {}
        for token, meta in (session_dict or {}).items():
            try:
                ts = meta.get("ts")
                path = meta.get("path") or ""
                if not ts or not path:
                    continue
                age = now - timezone.datetime.fromisoformat(ts)
                if age.days >= 2:
                    try:
                        if os.path.exists(path):
                            os.remove(path)
                    except Exception:
                        pass
                    continue
                if not os.path.exists(path):
                    continue
                cleaned[token] = meta
            except Exception:
                continue
        return cleaned

    def _cleanup_old_pending(session_dict: dict) -> dict:
        # Remove pendências antigas (best-effort).
        now = timezone.now()
        cleaned = {}
        for token, meta in (session_dict or {}).items():
            try:
                ts = meta.get("ts")
                if not ts:
                    continue
                age = now - timezone.datetime.fromisoformat(ts)
                if age.days >= 2:
                    continue
                cleaned[token] = meta
            except Exception:
                continue
        return cleaned

    def _extract_priority_options(rows):
        labels_by_key = {}
        for row in rows:
            key = normalize_header(getattr(row, "prioridade", ""))
            label = str(getattr(row, "prioridade", "") or "").strip()
            if not key or not label:
                continue
            if key not in labels_by_key:
                labels_by_key[key] = label
        return [
            {"value": key, "label": labels_by_key[key]}
            for key in sorted(labels_by_key.keys(), key=lambda item: labels_by_key[item].upper())
        ]

    def _build_imported_status_map(rows, carteira_obj, tipo_analise_obj):
        cpfs = {normalize_cpf(getattr(r, "cpf", "")) for r in rows if getattr(r, "cpf", "")}
        cpfs.discard("")
        if not cpfs:
            return {}

        processes = (
            ProcessoJudicial.objects.filter(
                partes_processuais__documento__in=cpfs,
            )
            .distinct()
            .order_by("id")
            .prefetch_related("partes_processuais", "carteiras_vinculadas")
            .select_related("analise_processo", "carteira")
        )

        cpf_status_map = {}
        target_tipo_id = str(getattr(tipo_analise_obj, "id", ""))
        target_carteira_id = int(getattr(carteira_obj, "id", 0) or 0)

        for proc in processes:
            respostas = {}
            analise_obj = getattr(proc, "analise_processo", None)
            if analise_obj and isinstance(analise_obj.respostas, dict):
                respostas = analise_obj.respostas

            proc_carteiras = {}
            if proc.carteira_id:
                proc_carteiras[int(proc.carteira_id)] = (
                    getattr(getattr(proc, "carteira", None), "nome", None) or f"Carteira {proc.carteira_id}"
                )
            for carteira_vinculada in getattr(proc, "carteiras_vinculadas", []).all():
                if carteira_vinculada and getattr(carteira_vinculada, "id", None):
                    proc_carteiras[int(carteira_vinculada.id)] = carteira_vinculada.nome

            imported_cnjs = set()
            for source_key in ("saved_processos_vinculados", "processos_vinculados"):
                cards = respostas.get(source_key) if isinstance(respostas, dict) else []
                if not isinstance(cards, list):
                    continue
                for card in cards:
                    if not isinstance(card, dict):
                        continue
                    analysis_type = card.get("analysis_type")
                    card_tipo_id = ""
                    if isinstance(analysis_type, dict) and analysis_type.get("id") is not None:
                        card_tipo_id = str(analysis_type.get("id"))
                    if card_tipo_id and target_tipo_id and card_tipo_id != target_tipo_id:
                        continue
                    card_carteira_id = card.get("carteira_id")
                    if card_carteira_id not in (None, "") and str(card_carteira_id) != str(target_carteira_id):
                        continue
                    cnj_digits = normalize_cnj_digits(card.get("cnj"))
                    if cnj_digits:
                        imported_cnjs.add(cnj_digits)

            partes_manager = getattr(proc, "partes_processuais", None)
            if not partes_manager:
                continue
            for parte in partes_manager.all():
                cpf_parte = normalize_cpf(getattr(parte, "documento", ""))
                if not cpf_parte or cpf_parte not in cpfs:
                    continue
                bucket = cpf_status_map.setdefault(
                    cpf_parte,
                    {
                        "imported_cnjs": set(),
                        "has_process": False,
                        "carteiras": {},
                        "has_selected_carteira": False,
                    },
                )
                bucket["has_process"] = True
                bucket["imported_cnjs"].update(imported_cnjs)
                if proc_carteiras:
                    bucket["carteiras"].update(proc_carteiras)
                if target_carteira_id and target_carteira_id in proc_carteiras:
                    bucket["has_selected_carteira"] = True

        status_map = {}
        for cpf in cpfs:
            data = cpf_status_map.get(cpf, {})
            imported = set(data.get("imported_cnjs") or set())
            has_process = bool(data.get("has_process"))
            carteiras_map = data.get("carteiras") or {}
            carteiras_sorted = [
                nome
                for _, nome in sorted(
                    carteiras_map.items(),
                    key=lambda item: str(item[1]).upper(),
                )
                if str(nome or "").strip()
            ]
            other_carteiras_sorted = [
                nome
                for carteira_id, nome in sorted(
                    carteiras_map.items(),
                    key=lambda item: str(item[1]).upper(),
                )
                if int(carteira_id) != target_carteira_id and str(nome or "").strip()
            ]
            if has_process and not carteiras_sorted:
                carteiras_display = "Sem carteira vinculada"
            else:
                carteiras_display = ", ".join(carteiras_sorted) if carteiras_sorted else "-"
            status_map[cpf] = {
                "imported_cnjs": imported,
                "has_process": has_process,
                "has_selected_carteira": bool(data.get("has_selected_carteira")),
                "existing_carteiras": carteiras_sorted,
                "existing_carteiras_display": carteiras_display,
                "other_carteiras": other_carteiras_sorted,
                "other_carteiras_display": ", ".join(other_carteiras_sorted) if other_carteiras_sorted else "",
            }
        return status_map

    def _remove_selected_cpfs(*, selected_cpfs_list, carteira_obj):
        normalized_cpfs = {
            normalize_cpf(value)
            for value in (selected_cpfs_list or [])
            if normalize_cpf(value)
        }
        target_carteira_id = int(getattr(carteira_obj, "id", 0) or 0)
        summary = {
            "selected_cpfs": len(normalized_cpfs),
            "affected_cpfs": 0,
            "matched_processes": 0,
            "deleted_processes": 0,
            "unlinked_processes": 0,
            "removed_cnjs": 0,
            "removed_cards": 0,
        }
        if not normalized_cpfs or not target_carteira_id:
            return summary

        normalized_documento_expr = models.Func(
            models.F("documento"),
            models.Value(r"\D"),
            models.Value(""),
            models.Value("g"),
            function="regexp_replace",
        )
        processo_ids = set(
            Parte.objects.annotate(_doc_digits=normalized_documento_expr)
            .filter(_doc_digits__in=normalized_cpfs)
            .values_list("processo_id", flat=True)
        )
        if not processo_ids:
            return summary

        processos = (
            ProcessoJudicial.objects.filter(id__in=processo_ids)
            .distinct()
            .order_by("id")
            .prefetch_related("partes_processuais", "carteiras_vinculadas", "numeros_cnj")
            .select_related("analise_processo")
        )

        matched = []
        for processo in processos:
            processo_cpfs = {
                normalize_cpf(getattr(parte, "documento", ""))
                for parte in processo.partes_processuais.all()
                if normalize_cpf(getattr(parte, "documento", ""))
            }
            if not processo_cpfs.intersection(normalized_cpfs):
                continue

            linked_ids = set(processo.carteiras_vinculadas.values_list("id", flat=True))
            has_target_vinculo = False
            if processo.carteira_id == target_carteira_id:
                has_target_vinculo = True
            elif target_carteira_id in linked_ids:
                has_target_vinculo = True
            elif processo.numeros_cnj.filter(carteira_id=target_carteira_id).exists():
                has_target_vinculo = True
            else:
                analise_obj = getattr(processo, "analise_processo", None)
                respostas = analise_obj.respostas if analise_obj and isinstance(analise_obj.respostas, dict) else {}
                for source_key in ("saved_processos_vinculados", "processos_vinculados"):
                    cards = respostas.get(source_key)
                    if not isinstance(cards, list):
                        continue
                    if any(
                        isinstance(card, dict)
                        and str(card.get("carteira_id") or "") == str(target_carteira_id)
                        for card in cards
                    ):
                        has_target_vinculo = True
                        break

            if has_target_vinculo:
                matched.append((processo, processo_cpfs))

        summary["matched_processes"] = len(matched)
        affected_cpfs = set()

        with transaction.atomic():
            for processo, processo_cpfs in matched:
                affected_cpfs.update(processo_cpfs.intersection(normalized_cpfs))
                summary["removed_cnjs"] += processo.numeros_cnj.count()

                analise_obj = getattr(processo, "analise_processo", None)
                if analise_obj and isinstance(analise_obj.respostas, dict):
                    respostas = dict(analise_obj.respostas or {})
                    for source_key in ("saved_processos_vinculados", "processos_vinculados"):
                        cards = respostas.get(source_key)
                        if isinstance(cards, list):
                            summary["removed_cards"] += len(cards)

                processo.delete()
                summary["deleted_processes"] += 1

        summary["affected_cpfs"] = len(affected_cpfs)
        return summary

    # Cancelar importação: remove anexo mantido e limpa pendências, sem precisar sair da tela.
    if request.method == "POST" and action == "cancel":
        token = (request.POST.get("upload_token") or "").strip()
        uploads = _cleanup_old_uploads(request.session.get(_uploads_session_key(), {}))
        pending_actions = _cleanup_old_pending(request.session.get(_pending_actions_session_key(), {}))
        removed = False
        try:
            if token and token in uploads:
                try:
                    path = uploads[token].get("path")
                    if path and os.path.exists(path):
                        os.remove(path)
                except Exception:
                    pass
                uploads.pop(token, None)
                removed = True
            if token and token in pending_actions:
                pending_actions.pop(token, None)
        finally:
            request.session[_uploads_session_key()] = uploads
            request.session[_pending_actions_session_key()] = pending_actions

        if removed:
            messages.success(request, "Importação cancelada: anexo descartado e tela limpa.")
        else:
            messages.info(request, "Nada para cancelar (nenhum anexo mantido).")
        return HttpResponseRedirect(reverse("admin:contratos_demandas_analise_planilha"))

    if request.method == "POST" and form.is_valid():
        raw_selected_cpfs = (request.POST.get("selected_cpfs_payload") or "").strip()
        if raw_selected_cpfs:
            selected_cpfs = [
                normalize_cpf(v)
                for v in raw_selected_cpfs.split(",")
                if normalize_cpf(v)
            ]
            selected_cpfs = list(dict.fromkeys(selected_cpfs))
        else:
            selected_cpfs = [
                normalize_cpf(v)
                for v in request.POST.getlist("selected_cpfs")
                if normalize_cpf(v)
            ]
            selected_cpfs = list(dict.fromkeys(selected_cpfs))
        selected_cpfs_payload = ",".join(selected_cpfs)
        upload = form.cleaned_data.get("arquivo")
        token = (form.cleaned_data.get("upload_token") or "").strip()
        file_bytes = b""
        upload_name = ""

        uploads = _cleanup_old_uploads(request.session.get(_uploads_session_key(), {}))
        request.session[_uploads_session_key()] = uploads
        pending_actions = _cleanup_old_pending(request.session.get(_pending_actions_session_key(), {}))
        request.session[_pending_actions_session_key()] = pending_actions

        if upload:
            upload_name = getattr(upload, "name", "") or ""
            file_bytes = upload.read() or b""
        elif token and token in uploads:
            upload_name = uploads[token].get("name") or ""
            try:
                with open(uploads[token]["path"], "rb") as fp:
                    file_bytes = fp.read()
            except Exception:
                file_bytes = b""
        else:
            messages.error(request, "Envie a planilha novamente (anexo não encontrado na sessão).")
            file_bytes = b""

        try:
            validate_planilha_upload(upload_name, file_bytes)
            parsed_all = build_passivas_rows_from_file_bytes(
                file_bytes,
                upload_name=upload_name,
                sheet_prefix=(form.cleaned_data.get("sheet_prefix") or "E - PASSIVAS"),
                uf_filter=(form.cleaned_data.get("uf") or ""),
                limit=int(form.cleaned_data.get("limit") or 0),
            )
            priority_options = _extract_priority_options(parsed_all)
            if consider_priority and selected_priority_keys:
                selected_keys = set(selected_priority_keys)
                parsed = [
                    row
                    for row in parsed_all
                    if normalize_header(getattr(row, "prioridade", "")) in selected_keys
                ]
            else:
                parsed = parsed_all
        except (ValidationError, PassivasPlanilhaError) as exc:
            messages.error(request, str(exc))
            parsed = []
            parsed_all = []
            priority_options = []

        if parsed:
            def _has_analysis_fields(row):
                def _is_filled(v):
                    if v is None:
                        return False
                    s = str(v).strip()
                    if not s:
                        return False
                    if s in {"---", "-", "—"}:
                        return False
                    return True

                return any(
                    [
                        _is_filled(row.consignado),
                        _is_filled(row.status_processo_passivo),
                        _is_filled(row.procedencia),
                        _is_filled(row.julgamento),
                        _is_filled(row.sucumbencias),
                        _is_filled(row.transitado),
                        row.data_transito is not None,
                        _is_filled(row.tipo_acao),
                        _is_filled(row.observacoes),
                        _is_filled(row.fase_recursal),
                        _is_filled(row.cumprimento_sentenca),
                        _is_filled(row.habilitacao),
                    ]
                )

            # Persistir upload novo para permitir prévias/importações graduais sem reenviar o arquivo.
            should_persist_upload = bool(upload)
            if should_persist_upload:
                token = uuid.uuid4().hex
                tmp_dir = "/tmp/nowlex_passivas_planilha"
                try:
                    os.makedirs(tmp_dir, exist_ok=True)
                    ext = os.path.splitext(upload_name or "")[1].lower()
                    if ext not in {".xlsx", ".csv"}:
                        ext = ".xlsx"
                    tmp_path = os.path.join(tmp_dir, f"{token}{ext}")
                    with open(tmp_path, "wb") as fp:
                        fp.write(file_bytes)
                    uploads[token] = {
                        "path": tmp_path,
                        "name": upload_name or f"planilha{ext}",
                        "ts": timezone.now().isoformat(),
                        "user_id": getattr(request.user, "id", None),
                    }
                    request.session[_uploads_session_key()] = uploads
                    form.initial["upload_token"] = token
                except Exception:
                    messages.warning(request, "Não foi possível manter o anexo na sessão. Reenvie ao importar.")

            cpfs = {r.cpf for r in parsed if r.cpf}
            cnjs = {r.cnj_digits for r in parsed if r.cnj_digits}
            ufs = {r.uf for r in parsed if r.uf}
            imported_status = _build_imported_status_map(
                parsed,
                carteira_obj=form.cleaned_data["carteira"],
                tipo_analise_obj=form.cleaned_data["tipo_analise"],
            )
            selected_priority_order = {key: idx for idx, key in enumerate(selected_priority_keys)}
            cpf_map = {}
            for r in parsed:
                if not r.cpf:
                    continue
                priority_label = str(r.prioridade or "").strip()
                priority_key = normalize_header(priority_label)
                entry = cpf_map.setdefault(
                    r.cpf,
                    {
                        "cpf": r.cpf,
                        "uf": r.uf or "",
                        "parte_contraria": r.parte_contraria or "",
                        "cnjs": set(),
                        "prechecked": False,
                        "prioridade_keys": set(),
                        "prioridade_labels": {},
                    },
                )
                if r.uf and not entry["uf"]:
                    entry["uf"] = r.uf
                if r.parte_contraria and not entry["parte_contraria"]:
                    entry["parte_contraria"] = r.parte_contraria
                if r.cnj_digits:
                    entry["cnjs"].add(r.cnj_digits)
                if _has_analysis_fields(r):
                    entry["prechecked"] = True
                if priority_key and priority_label:
                    entry["prioridade_keys"].add(priority_key)
                    if priority_key not in entry["prioridade_labels"]:
                        entry["prioridade_labels"][priority_key] = priority_label

            cpf_rows = []
            analysed_cpfs = 0
            imported_cpfs = 0
            for cpf_key, entry in cpf_map.items():
                if bool(entry["prechecked"]):
                    analysed_cpfs += 1
                imported_entry = imported_status.get(normalize_cpf(cpf_key), {})
                imported_cnjs = set(imported_entry.get("imported_cnjs") or set())
                imported_count = len(entry["cnjs"].intersection(imported_cnjs))
                total_cnjs = len(entry["cnjs"])
                imported_full = bool(total_cnjs and imported_count >= total_cnjs)
                imported_partial = bool(imported_count and not imported_full)
                has_process = bool(imported_entry.get("has_process"))
                has_selected_carteira = bool(imported_entry.get("has_selected_carteira"))
                other_carteiras_display = imported_entry.get("other_carteiras_display") or ""
                exists_only_other_carteira = bool(has_process and not has_selected_carteira and other_carteiras_display)
                if imported_full:
                    imported_cpfs += 1

                priority_labels = [
                    entry["prioridade_labels"][key]
                    for key in sorted(entry["prioridade_keys"], key=lambda item: entry["prioridade_labels"][item].upper())
                ]
                priority_display = ", ".join(priority_labels) if priority_labels else "-"
                if selected_priority_order:
                    candidate_ranks = [selected_priority_order[k] for k in entry["prioridade_keys"] if k in selected_priority_order]
                    priority_rank = min(candidate_ranks) if candidate_ranks else 999
                else:
                    priority_rank = 999

                cpf_rows.append(
                    {
                        "cpf": entry["cpf"],
                        "uf": entry["uf"] or "-",
                        "parte_contraria": entry["parte_contraria"] or "-",
                        "cnj_count": len(entry["cnjs"]),
                        "prechecked": bool(entry["prechecked"]),
                        "prioridade": priority_display,
                        "imported_count": imported_count,
                        "imported_total": total_cnjs,
                        "imported_full": imported_full,
                        "imported_partial": imported_partial,
                        "has_process": has_process,
                        "has_selected_carteira": has_selected_carteira,
                        "exists_only_other_carteira": exists_only_other_carteira,
                        "other_carteiras_display": other_carteiras_display,
                        "existing_carteiras_display": imported_entry.get("existing_carteiras_display") or "-",
                        "checked": (
                            cpf_key in selected_cpfs
                        ) if selected_cpfs else (not imported_full),
                        "priority_rank": priority_rank,
                    }
                )
            cpf_rows.sort(
                key=lambda x: (
                    str(x["uf"] or "ZZ"),
                    x["priority_rank"],
                    0 if x["checked"] else 1,
                    str(x["cpf"]),
                )
            )
            not_imported_by_uf_map = {}
            not_imported_cpfs = 0
            for row in cpf_rows:
                if row.get("imported_full"):
                    continue
                not_imported_cpfs += 1
                uf_label = str(row.get("uf") or "-").strip().upper() or "-"
                bucket = not_imported_by_uf_map.setdefault(
                    uf_label,
                    {
                        "uf": uf_label,
                        "total": 0,
                        "cadastros": [],
                    },
                )
                bucket["total"] += 1
                bucket["cadastros"].append(
                    {
                        "cpf": row.get("cpf") or "-",
                        "parte_contraria": row.get("parte_contraria") or "-",
                        "cnj_count": row.get("cnj_count") or 0,
                        "imported_count": row.get("imported_count") or 0,
                        "imported_total": row.get("imported_total") or 0,
                    }
                )
            not_imported_by_uf = [
                not_imported_by_uf_map[key]
                for key in sorted(not_imported_by_uf_map.keys())
            ]
            preview = {
                "rows": len(parsed),
                "cpfs": len(cpfs),
                "cnjs": len(cnjs),
                "ufs": ", ".join(sorted([u for u in ufs if u])) or "-",
                "upload_token": token or "",
                "cpf_rows": cpf_rows,
                "analysed_cpfs": analysed_cpfs,
                "imported_cpfs": imported_cpfs,
                "not_imported_cpfs": not_imported_cpfs,
                "not_imported_by_uf": not_imported_by_uf,
                "priority_options_count": len(priority_options),
            }

            if action == "import":
                if selected_cpfs:
                    parsed = [r for r in parsed if r.cpf in set(selected_cpfs)]
                try:
                    import_result = import_passivas_rows(
                        parsed,
                        carteira=form.cleaned_data["carteira"],
                        tipo_analise=form.cleaned_data["tipo_analise"],
                        dry_run=False,
                        user=request.user,
                    )

                    # Aplica pendências de Agenda Geral (ex.: tarefas) criadas antes de importar.
                    applied_tasks = 0
                    applied_tasks_targets = 0
                    try:
                        pending_actions = request.session.get(_pending_actions_session_key(), {}) or {}
                        token_pending = (token or "").strip()
                        pending_for_token = pending_actions.get(token_pending) if token_pending else None
                        pending_tarefas = []
                        if isinstance(pending_for_token, dict):
                            pending_tarefas = pending_for_token.get("tarefas") or []

                        imported_cpfs = {r.cpf for r in parsed if getattr(r, "cpf", "")}
                        if imported_cpfs and isinstance(pending_tarefas, list) and pending_tarefas:
                            carteira = form.cleaned_data["carteira"]
                            processos = (
                                ProcessoJudicial.objects.filter(
                                    Q(carteira=carteira) | Q(carteiras_vinculadas=carteira),
                                    partes_processuais__documento__in=imported_cpfs,
                                )
                                .distinct()
                                .order_by("id")
                                .prefetch_related("partes_processuais")
                            )
                            cpf_to_processo = {}
                            for proc in processos:
                                partes_manager = getattr(proc, "partes_processuais", None)
                                if not partes_manager:
                                    continue
                                for parte in partes_manager.all():
                                    doc = (parte.documento or "").strip()
                                    if not doc or doc not in imported_cpfs:
                                        continue
                                    cpf_to_processo.setdefault(doc, proc)

                            for item in pending_tarefas:
                                if not isinstance(item, dict):
                                    continue
                                cpfs_item = [c for c in (item.get("cpfs") or []) if c]
                                payload = item.get("payload") or {}
                                if not isinstance(payload, dict):
                                    continue
                                target_cpfs = [c for c in cpfs_item if c in imported_cpfs]
                                if not target_cpfs:
                                    continue

                                descricao = (payload.get("descricao") or "").strip()
                                data_raw = (payload.get("data") or "").strip()
                                if not (descricao and data_raw):
                                    continue
                                try:
                                    data_dt = datetime.date.fromisoformat(data_raw)
                                except Exception:
                                    continue

                                lista_id = payload.get("lista_id") or None
                                responsavel_id = payload.get("responsavel_id") or None
                                prioridade = (payload.get("prioridade") or "M").strip().upper()[:1] or "M"
                                observacoes = (payload.get("observacoes") or "").strip()
                                concluida = bool(payload.get("concluida"))
                                comentario_texto = (payload.get("comentario_texto") or "").strip()
                                if comentario_texto:
                                    observacoes = (observacoes + "\n\n" if observacoes else "") + f"Comentário: {comentario_texto}"

                                lista = ListaDeTarefas.objects.filter(id=lista_id).first() if lista_id else None
                                responsavel = User.objects.filter(id=responsavel_id).first() if responsavel_id else None

                                lote = TarefaLote.objects.create(
                                    descricao=f"Planilha (pendente): {descricao}",
                                    criado_por=request.user,
                                )

                                targets = []
                                for cpf in target_cpfs:
                                    proc = cpf_to_processo.get(cpf)
                                    if proc:
                                        targets.append(proc)
                                if not targets:
                                    continue

                                applied_tasks_targets += len(targets)
                                for proc in targets:
                                    Tarefa.objects.create(
                                        processo=proc,
                                        lote=lote,
                                        descricao=descricao,
                                        lista=lista,
                                        data=data_dt,
                                        responsavel=responsavel,
                                        prioridade=prioridade,
                                        concluida=concluida,
                                        observacoes=observacoes,
                                        criado_por=request.user,
                                    )
                                    applied_tasks += 1

                            # Limpa pendências consumidas deste token.
                            if token_pending and token_pending in pending_actions:
                                pending_actions.pop(token_pending, None)
                                request.session[_pending_actions_session_key()] = pending_actions
                    except Exception:
                        applied_tasks = 0
                        applied_tasks_targets = 0

                    messages.success(
                        request,
                        "Importação concluída. "
                        f"Cadastros: {import_result.created_cadastros} novos, {import_result.updated_cadastros} atualizados. "
                        f"CNJs: {import_result.created_cnjs} novos, {import_result.updated_cnjs} atualizados. "
                        f"Cards: {import_result.created_cards} novos, {import_result.updated_cards} atualizados.",
                    )
                    import_modal_data = {
                        "created_cadastros": import_result.created_cadastros,
                        "updated_cadastros": import_result.updated_cadastros,
                        "created_cnjs": import_result.created_cnjs,
                        "updated_cnjs": import_result.updated_cnjs,
                        "created_cards": import_result.created_cards,
                        "updated_cards": import_result.updated_cards,
                        "reused_priority_tags": import_result.reused_priority_tags,
                        "standardized_priority_tags": import_result.standardized_priority_tags,
                        "applied_tasks": applied_tasks,
                        "applied_tasks_targets": applied_tasks_targets,
                    }
                    request.session[import_modal_session_key] = import_modal_data
                    if import_result.reused_priority_tags or import_result.standardized_priority_tags:
                        messages.info(
                            request,
                            "Etiquetas de prioridade existentes foram reaproveitadas automaticamente. "
                            f"Reaproveitadas: {import_result.reused_priority_tags}. "
                            f"Padronizadas (nome/cor): {import_result.standardized_priority_tags}.",
                        )
                    if applied_tasks:
                        messages.success(
                            request,
                            f"Agenda Geral: {applied_tasks} tarefa(s) aplicada(s) automaticamente em {applied_tasks_targets} processo(s) após a importação.",
                        )
                except Exception as exc:
                    messages.error(request, f"Falha ao importar: {exc}")
                    import_modal_data = {
                        "title": "Falha ao importar",
                        "error": str(exc),
                    }
            elif action == "remove":
                supervisor_password = (request.POST.get("supervisor_password") or "").strip()
                if not selected_cpfs:
                    messages.warning(request, "Selecione ao menos um CPF para remover.")
                    import_modal_data = {
                        "title": "Remoção não concluída",
                        "note": "Nenhum CPF selecionado para remoção.",
                    }
                elif not supervisor_password:
                    messages.error(request, "Informe a senha de Supervisor para concluir a remoção.")
                    import_modal_data = {
                        "title": "Remoção não concluída",
                        "error": "Senha de Supervisor não informada.",
                    }
                elif not request.user.check_password(supervisor_password):
                    messages.error(request, "Senha de Supervisor inválida.")
                    import_modal_data = {
                        "title": "Remoção não concluída",
                        "error": "Senha de Supervisor inválida.",
                    }
                else:
                    try:
                        remove_summary = _remove_selected_cpfs(
                            selected_cpfs_list=selected_cpfs,
                            carteira_obj=form.cleaned_data["carteira"],
                        )
                        messages.success(
                            request,
                            "Remoção concluída. "
                            f"Cadastros removidos: {remove_summary['deleted_processes']}. "
                            f"Cadastros desvinculados da carteira: {remove_summary['unlinked_processes']}.",
                        )
                        import_modal_data = {
                            "title": "Remoção concluída",
                            "mode": "remove",
                            "carteira_nome": getattr(form.cleaned_data["carteira"], "nome", ""),
                            **remove_summary,
                        }
                    except Exception as exc:
                        messages.error(request, f"Falha ao remover: {exc}")
                        import_modal_data = {
                            "title": "Falha ao remover",
                            "error": str(exc),
                        }

    if import_action_requested and import_modal_data is None:
        if import_result is not None:
            import_modal_data = {
                "created_cadastros": import_result.created_cadastros,
                "updated_cadastros": import_result.updated_cadastros,
                "created_cnjs": import_result.created_cnjs,
                "updated_cnjs": import_result.updated_cnjs,
                "created_cards": import_result.created_cards,
                "updated_cards": import_result.updated_cards,
                "reused_priority_tags": getattr(import_result, "reused_priority_tags", 0),
                "standardized_priority_tags": getattr(import_result, "standardized_priority_tags", 0),
            }
        else:
            import_modal_data = {
                "title": "Importação finalizada",
                "note": "Nenhuma alteração foi aplicada nesta execução.",
            }

    # Nome do arquivo mantido (quando já houve prévia)
    kept_name = ""
    try:
        token_for_name = (preview or {}).get("upload_token") or (request.POST.get("upload_token") or "")
        uploads = request.session.get(_uploads_session_key(), {}) or {}
        if token_for_name and token_for_name in uploads:
            kept_name = uploads[token_for_name].get("name") or ""
    except Exception:
        kept_name = ""

    context = admin.site.each_context(request)
    context.update(
        {
            "title": "Demandas P/ Análise (Modo Planilha)",
            "form": form,
            "preview": preview,
            "import_result": import_result,
            "import_modal_data": import_modal_data,
            "back_url": reverse("admin:contratos_demandas_analise"),
            "upload_token_value": (preview or {}).get("upload_token") or (request.POST.get("upload_token") or ""),
            "kept_upload_name": kept_name,
            "consider_priority": consider_priority,
            "priority_options": priority_options,
            "selected_priority_keys": selected_priority_keys,
            "selected_cpfs_payload": selected_cpfs_payload,
        }
    )
    return render(request, "admin/contratos/demandas_analise_planilha.html", context)


def demandas_analise_planilha_pending_tarefas_view(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    if not is_user_supervisor(request.user):
        return JsonResponse({"detail": "Acesso restrito a supervisores."}, status=403)

    try:
        payload = json.loads((request.body or b"").decode("utf-8") or "{}")
    except Exception:
        payload = {}

    upload_token = (payload.get("upload_token") or "").strip()
    cpfs = payload.get("cpfs") or []
    tarefa_payload = payload.get("payload") or {}

    if not upload_token:
        return JsonResponse({"detail": "upload_token é obrigatório."}, status=400)
    if not isinstance(cpfs, list) or not [c for c in cpfs if c]:
        return JsonResponse({"detail": "Selecione ao menos um CPF."}, status=400)
    if not isinstance(tarefa_payload, dict):
        return JsonResponse({"detail": "payload inválido."}, status=400)

    uploads = request.session.get("passivas_planilha_uploads", {}) or {}
    if upload_token not in uploads:
        return JsonResponse({"detail": "Anexo não encontrado na sessão. Faça a prévia novamente."}, status=400)

    session_key = "passivas_planilha_pending_actions"
    pending = request.session.get(session_key, {}) or {}
    bucket = pending.get(upload_token)
    if not isinstance(bucket, dict):
        bucket = {"tarefas": [], "ts": timezone.now().isoformat()}
    bucket["ts"] = timezone.now().isoformat()

    tasks_list = bucket.get("tarefas")
    if not isinstance(tasks_list, list):
        tasks_list = []

    tasks_list.append(
        {
            "cpfs": [str(c).strip() for c in cpfs if str(c).strip()],
            "payload": tarefa_payload,
            "created_by": getattr(request.user, "id", None),
            "created_at": timezone.now().isoformat(),
        }
    )
    bucket["tarefas"] = tasks_list
    pending[upload_token] = bucket
    request.session[session_key] = pending

    return JsonResponse({"stored": True, "cpfs": len(set([c for c in cpfs if c]))})

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
            "contratos/configuracao-analise/tipos/<int:tipo_id>/",
            admin.site.admin_view(configuracao_analise_tipo_objetiva_view),
            name="contratos_configuracao_analise_tipo_objetiva",
        ),
        path(
            "contratos/configuracao-analise/tipos/<int:tipo_id>/export/",
            admin.site.admin_view(configuracao_analise_tipo_objetiva_export_view),
            name="contratos_configuracao_analise_tipo_objetiva_export",
        ),
        path(
            "contratos/configuracao-analise/tipos/import/",
            admin.site.admin_view(configuracao_analise_tipo_objetiva_import_view),
            name="contratos_configuracao_analise_tipo_objetiva_import",
        ),
        path(
            "contratos/configuracao-analise/tipos/<int:tipo_id>/import/",
            admin.site.admin_view(configuracao_analise_tipo_objetiva_import_view),
            name="contratos_configuracao_analise_tipo_objetiva_import_for",
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
        path(
            "contratos/demandas-analise/planilha/",
            admin.site.admin_view(demandas_analise_planilha_view),
            name="contratos_demandas_analise_planilha",
        ),
        path(
            "contratos/demandas-analise/planilha/pending/tarefas/",
            admin.site.admin_view(demandas_analise_planilha_pending_tarefas_view),
            name="contratos_demandas_analise_planilha_pending_tarefas",
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
            if model.get("object_name") in {"QuestaoAnalise", "OpcaoResposta", "TipoAnaliseObjetiva"}:
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

FILTER_COUNTS_SESSION_KEY = "processo_show_filter_counts"


def _show_filter_counts(request):
    show_counts = request.GET.get('show_counts')
    facets_flag = request.GET.get('_facets')

    if show_counts is not None:
        normalized_show_counts = str(show_counts).strip().lower()
        enabled = normalized_show_counts not in {'0', 'false', 'off', 'no'}
        try:
            request.session[FILTER_COUNTS_SESSION_KEY] = enabled
        except Exception:
            pass
        return enabled

    if '_facets' in request.GET:
        normalized_facets = str(facets_flag or '1').strip().lower()
        enabled = normalized_facets not in {'0', 'false', 'off', 'no'}
        try:
            request.session[FILTER_COUNTS_SESSION_KEY] = enabled
        except Exception:
            pass
        return enabled

    try:
        if FILTER_COUNTS_SESSION_KEY in request.session:
            return bool(request.session.get(FILTER_COUNTS_SESSION_KEY))
    except Exception:
        pass

    return False

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

    @staticmethod
    def _parse_selected(values):
        if values is None:
            raw_list = []
        elif isinstance(values, (list, tuple)):
            raw_list = [v for v in values if v]
        else:
            raw_list = [values] if values else []

        # Compat: aceita uf=RS,SC (string única) e uf=RS&uf=SC (repetido)
        if len(raw_list) == 1 and ',' in raw_list[0]:
            raw_list = [v.strip() for v in raw_list[0].split(',') if v.strip()]

        return sorted({str(v).strip().upper() for v in raw_list if str(v).strip()})

    @classmethod
    def _get_selected_ufs(cls, request):
        return cls._parse_selected(request.GET.getlist('uf'))

    def lookups(self, request, model_admin):
        qs = model_admin.get_queryset(request)
        if not _show_filter_counts(request):
            ufs = sorted({row for row in qs.values_list('uf', flat=True) if row})
            # Inclui um wrapper identificável para que JS/CSS possa mirar apenas este filtro,
            # sem "pegar" links de outros filtros (o Django preserva `uf=...` nas URLs).
            return [(uf, mark_safe(f"<span class='uf-choice'>{uf}</span>")) for uf in ufs]
        counts = {row['uf']: row['total'] for row in qs.values('uf').annotate(total=models.Count('id')) if row['uf']}
        return [
            (
                uf,
                mark_safe(
                    f"<span class='uf-choice'>{uf}</span> "
                    f"<span class='filter-count'>({counts.get(uf, 0)})</span>"
                ),
            )
            for uf in sorted(counts.keys())
        ]

    def choices(self, changelist):
        current_values = set(self._parse_selected(self.value()))
        all_query = changelist.get_query_string(
            {'_skip_saved_filters': '1'},
            remove=[self.parameter_name, 'o', '_skip_saved_filters']
        )
        yield {
            'selected': not current_values,
            'query_string': all_query,
            'display': 'Todos',
        }
        for value, label in self.lookup_choices:
            value_upper = str(value).upper()
            selected = value_upper in current_values
            next_values = set(current_values)
            if selected:
                next_values.discard(value_upper)
            else:
                next_values.add(value_upper)

            if next_values:
                query_string = changelist.get_query_string(
                    {self.parameter_name: ",".join(sorted(next_values))},
                    remove=['o', '_skip_saved_filters']
                )
            else:
                query_string = changelist.get_query_string(
                    {'_skip_saved_filters': '1'},
                    remove=[self.parameter_name, 'o']
                )
            yield {
                'selected': selected,
                'query_string': query_string,
                'display': label,
            }

    def queryset(self, request, queryset):
        values = self._get_selected_ufs(request)
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
        items = []
        for cart in Carteira.objects.order_by('nome'):
            total = qs.filter(
                Q(carteira_id=cart.id) | Q(carteiras_vinculadas__id=cart.id)
            ).distinct().count()
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
        selected_value = self.value() or request.GET.get('carteira__id__exact')
        if selected_value:
            return queryset.filter(
                Q(carteira_id=selected_value) | Q(carteiras_vinculadas__id=selected_value)
            ).distinct()
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
        ("pre_aprovado", "Pré-aprovados"),
        ("aprovado", "Aprovados"),
        ("reprovado", "Reprovados"),
        ("barrado", "Barrados"),
    ]

    PATH_KEYS = ("processos_vinculados", "saved_processos_vinculados")
    MATCH_CONDITIONS = {
        "aprovado": '@.supervisor_status == "aprovado" && @.barrado.ativo != true',
        "pre_aprovado": '@.supervisor_status == "pre_aprovado" && @.barrado.ativo != true',
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


class TipoAnaliseConcluidaFilter(admin.SimpleListFilter):
    title = "Por Análise"
    parameter_name = "tipo_analise"
    exclude_parameter_name = "tipo_analise_exclude"

    PATH_KEY = "saved_processos_vinculados"

    def __init__(self, request, params, model, model_admin):
        # SimpleListFilter, por padrão, só consome `parameter_name`. Precisamos também
        # consumir `exclude_parameter_name` para que ele não "sobre" e vire lookup
        # do model (causando IncorrectLookupParameters).
        #
        # Observação: fazemos o pop ANTES do super().__init__ para garantir que, mesmo
        # se `lookups()` (chamado dentro do super) falhar por qualquer motivo, o
        # parâmetro extra não ficará pendurado e não será interpretado como lookup
        # do model pelo ChangeList.
        exclude_value = None
        if self.exclude_parameter_name in params:
            try:
                exclude_value = params.pop(self.exclude_parameter_name)
            except Exception:
                exclude_value = None

        super().__init__(request, params, model, model_admin)

        if exclude_value:
            try:
                self.used_parameters[self.exclude_parameter_name] = exclude_value[-1]
            except Exception:
                self.used_parameters[self.exclude_parameter_name] = str(exclude_value)

    def expected_parameters(self):
        # Faz o Django Admin entender que este filtro consome também `tipo_analise_exclude`,
        # evitando que o parâmetro seja interpretado como lookup do model (e estoure FieldError).
        return [self.parameter_name, self.exclude_parameter_name]

    def _annotate_queryset(self, queryset, slug: str):
        # "Concluída" aqui significa: existe card salvo desse tipo E ele tem
        # algum conteúdo de análise (não conta CNJ/valor causa/parte contrária).
        #
        # Regra: considera analisado se tiver alguma resposta preenchida em
        # `tipo_de_acao_respostas` (qualquer chave) OU `observacoes` não vazias.
        alias_obs = "_tipo_analise_obs_match"
        alias_resp = "_tipo_analise_resp_match"

        path_obs = f'$.{self.PATH_KEY}[*] ? (@.analysis_type.slug == "{slug}" && @.observacoes != null && @.observacoes != "")'
        # Seleciona qualquer valor não-vazio dentro do objeto tipo_de_acao_respostas.
        path_resp = (
            f'$.{self.PATH_KEY}[*] ? (@.analysis_type.slug == "{slug}").'
            'tipo_de_acao_respostas.* ? (@ != null && @ != "" && @ != "---")'
        )

        queryset = queryset.annotate(
            **{
                alias_obs: models.Func(
                    models.F("analise_processo__respostas"),
                    models.Value(path_obs),
                    function="jsonb_path_exists",
                    output_field=models.BooleanField(),
                ),
                alias_resp: models.Func(
                    models.F("analise_processo__respostas"),
                    models.Value(path_resp),
                    function="jsonb_path_exists",
                    output_field=models.BooleanField(),
                ),
            }
        )
        return queryset, alias_obs, alias_resp

    def _filter_queryset(self, queryset, slug: str):
        queryset, alias_obs, alias_resp = self._annotate_queryset(queryset, slug)
        return queryset.filter(models.Q(**{alias_obs: True}) | models.Q(**{alias_resp: True}))

    def _exclude_queryset(self, queryset, slug: str):
        queryset, alias_obs, alias_resp = self._annotate_queryset(queryset, slug)
        # "Sem conclusão" = nenhum conteúdo de análise encontrado no card salvo.
        return queryset.filter(models.Q(**{alias_obs: False}) & models.Q(**{alias_resp: False}))

    def lookups(self, request, model_admin):
        tipos = list(TipoAnaliseObjetiva.objects.filter(ativo=True).order_by("nome"))
        # As contagens (facets) são calculadas em `choices()` usando `changelist.get_queryset(...)`,
        # para que respeitem os outros filtros ativos (ex.: "Incluir prescritos", "Carteira", "UF", etc).
        # Aqui retornamos apenas os slugs/nomes.
        return [(t.slug, t.nome) for t in tipos]

    def choices(self, changelist):
        current = (self.value() or "").strip()
        # `expected_parameters()` faz o admin "consumir" este parâmetro e movê-lo para `used_parameters`.
        current_exclude = str(self.used_parameters.get(self.exclude_parameter_name, "") or "").strip()
        all_query = changelist.get_query_string(
            {"_skip_saved_filters": "1"},
            remove=[self.parameter_name, self.exclude_parameter_name, "o", "_skip_saved_filters"],
        )
        yield {
            "selected": (not current) and (not current_exclude),
            "query_string": all_query,
            "display": "Todos",
        }
        add_counts = _show_filter_counts(self.request)
        # Base para facets: aplica todos os filtros EXCETO este (tipo_analise/tipo_analise_exclude),
        # garantindo que as contagens do "−" e do "(count)" reflitam a lista atual do usuário.
        #
        # Importante: usar `changelist.get_queryset()` aqui pode mutar `changelist.filter_specs`
        # e causar efeitos colaterais durante o render (e já vimos discrepâncias de contagem).
        # Por isso, criamos um ChangeList "fresh" apenas para cálculo das contagens.
        base_qs = None
        if add_counts:
            try:
                fresh_cl = changelist.model_admin.get_changelist_instance(self.request)
                base_qs = fresh_cl.get_queryset(
                    self.request,
                    exclude_parameters=self.expected_parameters(),
                )
            except Exception:
                base_qs = None

        for value, label in self.lookup_choices:
            value_str = str(value)
            selected = value_str == current and bool(current)

            if selected:
                query_string = changelist.get_query_string(
                    {"_skip_saved_filters": "1"},
                    remove=[self.parameter_name, "o"],
                )
            else:
                query_string = changelist.get_query_string(
                    {self.parameter_name: value_str},
                    remove=[self.exclude_parameter_name, "o", "_skip_saved_filters"],
                )

            minus_query = changelist.get_query_string(
                {self.exclude_parameter_name: value_str},
                remove=[self.parameter_name, "o", "_skip_saved_filters"],
            )
            minus_active = value_str == current_exclude and bool(current_exclude)

            include_count = None
            minus_count = None
            if add_counts and base_qs is not None:
                try:
                    include_count = self._filter_queryset(base_qs, value_str).count()
                except Exception:
                    include_count = 0
                try:
                    minus_count = self._exclude_queryset(base_qs, value_str).count()
                except Exception:
                    minus_count = 0

            label_html = label
            if include_count is not None:
                label_html = mark_safe(f"{label} <span class='filter-count'>({include_count})</span>")

            # Observação: o template do admin envolve `display` num <a>. Para evitar <a> aninhado,
            # renderizamos o "−" como <span> clicável e tratamos via JS (change_list.html).
            display = mark_safe(
                f'{label_html} <span class="analysis-exclude{" active" if minus_active else ""}" '
                f'title="Mostrar SEM conclusão deste tipo" data-href="{minus_query}">−'
                + (
                    f'<span class="analysis-exclude-count">({minus_count})</span>'
                    if minus_count is not None
                    else ""
                )
                + "</span>"
            )
            yield {
                "selected": selected,
                "query_string": query_string,
                "display": display,
            }

    def queryset(self, request, queryset):
        slug = (self.value() or "").strip()
        exclude_slug = (self.used_parameters.get(self.exclude_parameter_name) or "").strip()
        if slug and exclude_slug:
            # Evita ambiguidade: se ambos vierem por qualquer motivo, prioriza o "include".
            exclude_slug = ""
        if slug:
            return self._filter_queryset(queryset, slug)
        if exclude_slug:
            return self._exclude_queryset(queryset, exclude_slug)
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
        value = self.value()
        # Modo "incluir prescritos": não adiciona cálculos extras.
        if value == "incluir":
            return queryset
        queryset = queryset.annotate(
            primeira_prescricao=models.Min('contratos__data_prescricao'),
        )
        # Ignora processos com todos os contratos prescritos enquanto o checkbox não está ativo
        today = timezone.now().date()
        if value != "incluir":
            nao_prescrito_q = (
                models.Q(contratos__data_prescricao__gte=today) |
                models.Q(contratos__data_prescricao__isnull=True)
            )
            queryset = queryset.annotate(
                contratos_nao_prescritos=Count('contratos', filter=nao_prescrito_q)
            ).filter(
                contratos_nao_prescritos__gt=0
            )
        if value in {"az", "za"}:
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
            ).annotate(
                distancia_prescricao=models.F('distancia_segundos')
            )
        if value == "az":
            return queryset.order_by(models.F('distancia_prescricao').asc(nulls_last=True), 'pk')
        if value == "za":
            return queryset.order_by(models.F('distancia_prescricao').desc(nulls_last=True), '-pk')
        if value == "clear":
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
            'numero_cnj': forms.HiddenInput(),
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
            'numero_cnj': forms.HiddenInput(),
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
        carteiras_field = self.fields.get('carteiras_vinculadas')
        if carteiras_field:
            carteiras_field.queryset = Carteira.objects.order_by('nome')
            carteiras_field.widget = forms.CheckboxSelectMultiple(
                attrs={'class': 'carteiras-vinculadas-toggle'}
            )
            carteiras_field.help_text = (
                "Ative as carteiras vinculadas. A carteira principal será definida automaticamente."
            )


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
        raw_supervision_date = str(card.get('supervision_date') or '').strip()
        if raw_supervision_date:
            parsed_supervision_date = None
            raw_supervision_date = raw_supervision_date.split('T', 1)[0]
            for fmt in ('%Y-%m-%d', '%d/%m/%Y'):
                try:
                    parsed_supervision_date = datetime.datetime.strptime(raw_supervision_date, fmt).date()
                    break
                except (TypeError, ValueError):
                    continue
            card['supervision_date'] = parsed_supervision_date.isoformat() if parsed_supervision_date else ''
        else:
            card['supervision_date'] = ''
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
        # A Análise do Processo é carregada via `processo_judicial_lazy_loader.js`
        # quando a aba "Análise de Processo" é ativada.
        css = {'all': ()}
        js = ()


class ProcessoJudicialChangeList(ChangeList):
    """
    Remove lookup params customizados do fluxo padrão do Django admin.
    Esses params são consumidos por lógica própria e não correspondem
    a campos reais de ProcessoJudicial.
    """
    CUSTOM_INTERSECTION_PARAMS = (
        'intersection_carteira_a',
        'intersection_carteira_b',
        'show_counts',
        'tab',
        'kpi_carteira_id',
        'kpi_tipo_id',
        'kpi_question',
        'kpi_answer',
        'kpi_uf',
        'peticao_tipo',
        'peticao_carteira_id',
        'priority_kpi_tag_id',
        'priority_kpi_status',
        'priority_kpi_uf',
    )

    def get_filters_params(self, params=None):
        lookup_params = super().get_filters_params(params=params)
        for key in self.CUSTOM_INTERSECTION_PARAMS:
            lookup_params.pop(key, None)
        return lookup_params

    def get_queryset(self, request, exclude_parameters=None):
        excluded = list(exclude_parameters or [])
        for key in self.CUSTOM_INTERSECTION_PARAMS:
            if key not in excluded:
                excluded.append(key)
        return super().get_queryset(request, exclude_parameters=excluded)

    def get_results(self, request):
        super().get_results(request)
        # Em contextos filtrados por carteira/KPI/interseção, o "X total"
        # do Django (full_result_count global) confunde a leitura do usuário.
        # Forçamos a mesma base do filtro aplicado.
        scoped_params = (
            "carteira",
            "carteira__id__exact",
            "intersection_carteira_a",
            "intersection_carteira_b",
            "kpi_carteira_id",
            "peticao_carteira_id",
            "priority_kpi_tag_id",
        )
        if any(request.GET.get(param) for param in scoped_params):
            self.full_result_count = self.result_count

@admin.register(Carteira)
class CarteiraAdmin(admin.ModelAdmin):
    list_display = ('nome', 'get_total_processos', 'get_valor_total_carteira', 'get_valor_medio_processo', 'ver_processos_link')
    change_list_template = "admin/contratos/carteira/change_list.html"
    fields = ('nome', 'fonte_alias', 'cor_grafico')

    def _can_edit_carteira(self, request):
        user = getattr(request, "user", None)
        return bool(user and getattr(user, "is_authenticated", False) and (user.is_superuser or is_user_supervisor(user)))

    def get_list_display_links(self, request, list_display):
        if not self._can_edit_carteira(request):
            return None
        return super().get_list_display_links(request, list_display)

    def has_change_permission(self, request, obj=None):
        if not self._can_edit_carteira(request):
            return False
        return super().has_change_permission(request, obj=obj)

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path(
                'kpi-online-presence/',
                self.admin_site.admin_view(self.kpi_online_presence_view),
                name='contratos_carteira_kpi_online_presence',
            ),
        ]
        return custom_urls + urls

    def kpi_online_presence_view(self, request):
        if request.method != 'GET':
            return JsonResponse({'error': 'Método não permitido.'}, status=405)
        if not is_user_supervisor(request.user):
            return JsonResponse({'error': 'Permissão negada.'}, status=403)

        settings_map = get_presence_settings()
        if not is_online_presence_enabled():
            return JsonResponse(
                {
                    'enabled': False,
                    'rows': [],
                    'idle_seconds': int(settings_map['idle_seconds']),
                    'ttl_seconds': int(settings_map['ttl_seconds']),
                }
            )

        rows = []
        for item in list_online_presence_rows():
            processo_id = int(item.get('processo_id') or 0)
            if not processo_id:
                continue
            rows.append(
                {
                    'user_id': int(item.get('user_id') or 0),
                    'user_label': item.get('user_label') or '',
                    'processo_id': processo_id,
                    'processo_label': item.get('processo_label') or f'Cadastro #{processo_id}',
                    'processo_url': reverse('admin:contratos_processojudicial_change', args=[processo_id]),
                    'carteira_id': int(item.get('carteira_id') or 0),
                    'carteira_label': item.get('carteira_label') or '',
                    'session_key': item.get('session_key') or '',
                    'tab_id': item.get('tab_id') or '',
                    'path': item.get('path') or '',
                    'visible': bool(item.get('visible')),
                    'is_idle': bool(item.get('is_idle')),
                    'is_online': bool(item.get('is_online')),
                    'elapsed_seconds': int(item.get('elapsed_seconds') or 0),
                    'idle_for_seconds': int(item.get('idle_for_seconds') or 0),
                    'last_seen_at': int(item.get('last_seen_at') or 0),
                    'last_interaction_at': int(item.get('last_interaction_at') or 0),
                    'started_at': int(item.get('started_at') or 0),
                }
            )

        return JsonResponse(
            {
                'enabled': True,
                'rows': rows,
                'idle_seconds': int(settings_map['idle_seconds']),
                'ttl_seconds': int(settings_map['ttl_seconds']),
                'generated_at': timezone.now().isoformat(),
            }
        )
    
    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            total_processos=models.Count('processos_multicarteira', distinct=True),
            valor_total=models.Sum('processos_multicarteira__valor_causa')
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
        url = reverse("admin:contratos_processojudicial_changelist") + f"?carteira={obj.id}"
        return format_html('<a href="{}">Ver Processos</a>', url)

    def _build_carteira_intersections(self):
        carteiras = list(Carteira.objects.order_by('nome').values('id', 'nome', 'cor_grafico'))
        process_changelist_url = reverse("admin:contratos_processojudicial_changelist")
        if not carteiras:
            return {
                "carteiras": [],
                "pairs": [],
                "total_unique_cpfs": 0,
                "process_changelist_url": process_changelist_url,
            }

        valid_ids = {c['id'] for c in carteiras}
        carteira_cpfs = {c['id']: set() for c in carteiras}
        cpf_membership = {}
        processo_carteiras = {}

        processos = (
            ProcessoJudicial.objects.filter(
                Q(carteira_id__in=valid_ids) | Q(carteiras_vinculadas__id__in=valid_ids)
            )
            .values_list('id', 'carteira_id', 'carteiras_vinculadas__id')
            .distinct()
        )
        for processo_id, carteira_principal_id, carteira_vinculada_id in processos:
            bucket = processo_carteiras.setdefault(processo_id, set())
            if carteira_principal_id in valid_ids:
                bucket.add(carteira_principal_id)
            if carteira_vinculada_id in valid_ids:
                bucket.add(carteira_vinculada_id)

        if processo_carteiras:
            partes = (
                Parte.objects.filter(tipo_polo='PASSIVO', processo_id__in=processo_carteiras.keys())
                .exclude(documento__isnull=True)
                .exclude(documento__exact='')
                .values_list('processo_id', 'documento')
                .distinct()
            )
        else:
            partes = []

        for processo_id, documento in partes:
            cpf_digits = re.sub(r'\D', '', str(documento or ''))
            if not cpf_digits:
                continue
            for carteira_id in processo_carteiras.get(processo_id, set()):
                carteira_cpfs[carteira_id].add(cpf_digits)
                cpf_membership.setdefault(cpf_digits, set()).add(carteira_id)

        total_unique_cpfs = len(cpf_membership)
        carteira_items = []
        for carteira in carteiras:
            cpfs = carteira_cpfs.get(carteira['id'], set())
            carteira_items.append({
                "id": carteira['id'],
                "nome": carteira['nome'],
                "cor_grafico": carteira.get('cor_grafico') or '#417690',
                "cpf_total": len(cpfs),
                "percent_global": round((len(cpfs) * 100.0 / total_unique_cpfs), 2) if total_unique_cpfs else 0.0,
            })

        pair_items = []
        for i, carteira_a in enumerate(carteiras):
            cpfs_a = carteira_cpfs.get(carteira_a['id'], set())
            for carteira_b in carteiras[i + 1:]:
                cpfs_b = carteira_cpfs.get(carteira_b['id'], set())
                if not cpfs_a and not cpfs_b:
                    continue
                intersection = cpfs_a.intersection(cpfs_b)
                if not intersection:
                    continue
                union = cpfs_a.union(cpfs_b)
                count_inter = len(intersection)
                pair_items.append({
                    "a_id": carteira_a['id'],
                    "a_nome": carteira_a['nome'],
                    "b_id": carteira_b['id'],
                    "b_nome": carteira_b['nome'],
                    "key": f"{min(carteira_a['id'], carteira_b['id'])}-{max(carteira_a['id'], carteira_b['id'])}",
                    "count": count_inter,
                    "pct_a": round((count_inter * 100.0 / len(cpfs_a)), 2) if cpfs_a else 0.0,
                    "pct_b": round((count_inter * 100.0 / len(cpfs_b)), 2) if cpfs_b else 0.0,
                    "pct_union": round((count_inter * 100.0 / len(union)), 2) if union else 0.0,
                })
        pair_items.sort(key=lambda item: (-item['count'], item['a_nome'], item['b_nome']))
        return {
            "carteiras": carteira_items,
            "pairs": pair_items,
            "total_unique_cpfs": total_unique_cpfs,
            "process_changelist_url": process_changelist_url,
        }

    def _build_carteira_kpi_data(self, request=None):
        def _safe_int(value):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def _clean_text(value):
            if value is None:
                return ""
            return str(value).strip()

        def _normalize_answer(value):
            text = _clean_text(value).lower()
            if not text:
                return ""
            text = unicodedata.normalize("NFKD", text)
            text = "".join(ch for ch in text if not unicodedata.combining(ch))
            return re.sub(r"\s+", " ", text).strip()

        def _normalize_filename_text(value):
            text = _clean_text(value).lower()
            if not text:
                return ""
            text = unicodedata.normalize("NFKD", text)
            text = "".join(ch for ch in text if not unicodedata.combining(ch))
            text = text.replace("_", " ").replace("-", " ")
            return re.sub(r"\s+", " ", text).strip()

        def _normalize_type_text(value):
            text = _clean_text(value).lower()
            if not text:
                return ""
            text = unicodedata.normalize("NFKD", text)
            text = "".join(ch for ch in text if not unicodedata.combining(ch))
            text = text.replace("#", " ").replace("_", " ").replace("-", " ")
            return re.sub(r"\s+", " ", text).strip()

        def _parse_datetime_value(value):
            if isinstance(value, datetime.datetime):
                dt = value
            elif isinstance(value, str):
                raw = value.strip()
                if not raw:
                    return None
                try:
                    dt = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
                except ValueError:
                    return None
            else:
                return None
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_default_timezone())
            return timezone.localtime(dt)

        def _build_tipo_fallback_meta(nome, slug):
            slug_norm = _normalize_type_text(slug)
            nome_norm = _normalize_type_text(nome)
            hashtag_norm = _normalize_type_text(slug)
            search_text = " ".join(part for part in (slug_norm, nome_norm, hashtag_norm) if part)
            return {
                "id": None,
                "nome": nome,
                "slug": slug,
                "hashtag": f"#{slug.replace('-', '_')}",
                "slug_norm": slug_norm,
                "nome_norm": nome_norm,
                "hashtag_norm": hashtag_norm,
                "search_text": search_text,
            }

        def _classify_peticao_kind(nome, arquivo_nome):
            joined = f"{_normalize_filename_text(nome)} {_normalize_filename_text(arquivo_nome)}".strip()
            if not joined:
                return ""
            if "monitoria inicial" in joined:
                return "monitoria_inicial"
            if "cobranca judicial" in joined:
                return "cobranca_judicial"
            if "habilitacao" in joined:
                return "habilitacao"
            return ""

        def _is_yes(value):
            return _normalize_answer(value) in {"sim", "s", "yes", "y"}

        def _is_no(value):
            return _normalize_answer(value) in {"nao", "n", "no"}

        def _get_cards_from_respostas(respostas):
            if not isinstance(respostas, dict):
                return []
            saved_cards = respostas.get("saved_processos_vinculados")
            if isinstance(saved_cards, list) and saved_cards:
                return saved_cards
            active_cards = respostas.get("processos_vinculados")
            if isinstance(active_cards, list) and active_cards:
                return active_cards
            return []

        def _is_filled_response_value(value):
            if value is None:
                return False
            if isinstance(value, str):
                cleaned = value.strip()
                if not cleaned:
                    return False
                if cleaned in {"---", "-", "—"}:
                    return False
                return True
            if isinstance(value, dict):
                return any(_is_filled_response_value(item) for item in value.values())
            if isinstance(value, (list, tuple, set)):
                return any(_is_filled_response_value(item) for item in value)
            return True

        def _card_has_analysis_content(card):
            if not isinstance(card, dict):
                return False
            if _is_filled_response_value(card.get("observacoes")):
                return True
            respostas_obj = card.get("tipo_de_acao_respostas")
            if not isinstance(respostas_obj, dict):
                return False
            return any(_is_filled_response_value(value) for value in respostas_obj.values())

        def _process_has_analysis_content(respostas):
            cards = _get_cards_from_respostas(respostas)
            if not cards:
                return False
            return any(_card_has_analysis_content(card) for card in cards if isinstance(card, dict))

        technical_response_keys = {
            "ativar_botao_monitoria",
            "contratos_para_monitoria",
        }

        process_changelist_url = reverse("admin:contratos_processojudicial_changelist")
        carteira_lookup = {
            carteira["id"]: carteira["nome"]
            for carteira in Carteira.objects.order_by("nome").values("id", "nome")
        }
        passivas_carteira_id = next(
            (
                carteira_id
                for carteira_id, carteira_nome in carteira_lookup.items()
                if _normalize_type_text(carteira_nome) == "passivas"
            ),
            None,
        )
        tipos_rows = list(TipoAnaliseObjetiva.objects.values("id", "nome", "slug", "hashtag"))
        tipo_lookup = {}
        tipo_by_slug = {}
        tipo_by_nome = {}
        tipo_by_hashtag = {}
        tipo_monitoria_default = None
        tipo_passivas_default = None

        for tipo in tipos_rows:
            tipo_id = _safe_int(tipo.get("id"))
            if not tipo_id:
                continue
            nome = _clean_text(tipo.get("nome"))
            slug = _clean_text(tipo.get("slug"))
            hashtag = _clean_text(tipo.get("hashtag"))
            slug_norm = _normalize_type_text(slug)
            nome_norm = _normalize_type_text(nome)
            hashtag_norm = _normalize_type_text(hashtag)
            search_text = " ".join(part for part in (slug_norm, nome_norm, hashtag_norm) if part)
            meta = {
                "id": tipo_id,
                "nome": nome,
                "slug": slug,
                "hashtag": hashtag,
                "slug_norm": slug_norm,
                "nome_norm": nome_norm,
                "hashtag_norm": hashtag_norm,
                "search_text": search_text,
            }
            tipo_lookup[tipo_id] = meta
            if slug_norm and slug_norm not in tipo_by_slug:
                tipo_by_slug[slug_norm] = meta
            if nome_norm and nome_norm not in tipo_by_nome:
                tipo_by_nome[nome_norm] = meta
            if hashtag_norm and hashtag_norm not in tipo_by_hashtag:
                tipo_by_hashtag[hashtag_norm] = meta

        def _resolve_tipo_meta(analysis_type, respostas_obj):
            if not isinstance(analysis_type, dict):
                analysis_type = {}
            if not isinstance(respostas_obj, dict):
                respostas_obj = {}

            # 1) Prioriza id explícito no card
            tipo_id = _safe_int(analysis_type.get("id"))
            if tipo_id and tipo_id in tipo_lookup:
                return tipo_lookup[tipo_id]

            # 2) Fallback por slug/nome/hashtag quando vier sem id
            slug_norm = _normalize_type_text(analysis_type.get("slug"))
            if slug_norm and slug_norm in tipo_by_slug:
                return tipo_by_slug[slug_norm]

            nome_norm = _normalize_type_text(analysis_type.get("nome"))
            if nome_norm and nome_norm in tipo_by_nome:
                return tipo_by_nome[nome_norm]

            hashtag_norm = _normalize_type_text(analysis_type.get("hashtag"))
            if hashtag_norm and hashtag_norm in tipo_by_hashtag:
                return tipo_by_hashtag[hashtag_norm]

            analysis_type_search = " ".join(
                part for part in (slug_norm, nome_norm, hashtag_norm) if part
            )
            if "monitor" in analysis_type_search:
                return tipo_monitoria_default
            if "passiv" in analysis_type_search:
                return tipo_passivas_default

            # 2.5) Legado: inferência por chaves de perguntas (QuestaoAnalise -> tipo_analise)
            # Isso cobre casos onde o card veio sem analysis_type, mas as respostas já
            # pertencem claramente a um tipo (ex.: consignado/status_processo_passivo = Passivas).
            tipo_hits_by_question = {}
            for chave in respostas_obj.keys():
                q_meta = questao_lookup.get(chave) if isinstance(questao_lookup, dict) else None
                if not q_meta:
                    continue
                q_tipo_id = _safe_int(q_meta.get("tipo_analise_id"))
                if not q_tipo_id:
                    continue
                tipo_hits_by_question[q_tipo_id] = tipo_hits_by_question.get(q_tipo_id, 0) + 1
            if tipo_hits_by_question:
                best_tipo_id = max(tipo_hits_by_question.items(), key=lambda item: item[1])[0]
                if best_tipo_id in tipo_lookup:
                    return tipo_lookup[best_tipo_id]

            # 3) Legado: infere por sinais das respostas
            # Regras:
            # - Sinais fortes de Monitória têm prioridade para evitar [Sem tipo] em casos óbvios.
            # - Se não houver sinais fortes, cai para sinais de Passivas.
            # - Persistindo dúvida, usa "tipo_de_acao" como heurística.
            has_monitoria_hard_signals = any(
                key in respostas_obj
                for key in (
                    "judicializado_pela_massa",
                    "propor_monitoria",
                    "repropor_monitoria",
                )
            )
            has_monitoria_soft_signals = any(
                key in respostas_obj
                for key in (
                    "contratos_para_monitoria",
                )
            )
            has_passivas_signals = any(
                key in respostas_obj
                for key in (
                    "procedencia",
                    "cumprimento_de_sentenca",
                    "data_de_transito",
                    "transitado",
                    "julgamento",
                )
            )
            tipo_acao_norm = _normalize_type_text(respostas_obj.get("tipo_de_acao"))
            if has_monitoria_hard_signals:
                return tipo_monitoria_default
            if has_passivas_signals:
                return tipo_passivas_default
            if has_monitoria_soft_signals:
                return tipo_monitoria_default
            if "monitor" in tipo_acao_norm:
                return tipo_monitoria_default
            if "passiv" in tipo_acao_norm:
                return tipo_passivas_default

            # 4) Fallback final: nunca deixar KPI em [Sem tipo]
            return tipo_passivas_default or tipo_monitoria_default

        for tipo_meta in tipo_lookup.values():
            search_text = tipo_meta.get("search_text", "")
            if tipo_monitoria_default is None and "monitor" in search_text:
                tipo_monitoria_default = tipo_meta
            if tipo_passivas_default is None and "passiv" in search_text:
                tipo_passivas_default = tipo_meta

        # Fallback preferencial por slug conhecido
        tipo_monitoria_default = tipo_by_slug.get("novas monitorias") or tipo_by_slug.get("monitorias") or tipo_monitoria_default
        tipo_passivas_default = tipo_by_slug.get("passivas") or tipo_by_slug.get("passiva") or tipo_passivas_default
        if tipo_monitoria_default is None:
            tipo_monitoria_default = _build_tipo_fallback_meta("Novas Monitórias", "novas-monitorias")
        if tipo_passivas_default is None:
            tipo_passivas_default = _build_tipo_fallback_meta("Passivas", "passivas")

        questoes_rows = list(
            QuestaoAnalise.objects.exclude(chave__isnull=True)
            .exclude(chave__exact="")
            .values("id", "chave", "texto_pergunta", "tipo_campo", "tipo_analise_id")
        )
        opcoes_by_chave = {}
        opcoes_seen_by_chave = {}
        for opcao in (
            OpcaoResposta.objects.filter(questao_origem__chave__isnull=False, ativo=True)
            .exclude(questao_origem__chave__exact="")
            .exclude(texto_resposta__isnull=True)
            .exclude(texto_resposta__exact="")
            .values("questao_origem__chave", "texto_resposta")
            .order_by("questao_origem_id", "id")
        ):
            chave = _clean_text(opcao.get("questao_origem__chave"))
            texto_resposta = _clean_text(opcao.get("texto_resposta"))
            if not chave or not texto_resposta:
                continue
            texto_norm = _normalize_answer(texto_resposta)
            if not texto_norm:
                continue
            if chave not in opcoes_by_chave:
                opcoes_by_chave[chave] = []
                opcoes_seen_by_chave[chave] = set()
            if texto_norm in opcoes_seen_by_chave[chave]:
                continue
            opcoes_seen_by_chave[chave].add(texto_norm)
            opcoes_by_chave[chave].append(texto_resposta)

        questao_lookup = {}
        for questao in questoes_rows:
            chave = _clean_text(questao.get("chave"))
            if not chave:
                continue
            questao_lookup[chave] = {
                "texto_pergunta": questao.get("texto_pergunta"),
                "tipo_campo": questao.get("tipo_campo"),
                "tipo_analise_id": _safe_int(questao.get("tipo_analise_id")),
                "opcoes": opcoes_by_chave.get(chave, []),
            }

        processos = (
            ProcessoJudicial.objects.filter(analise_processo__isnull=False)
            .select_related("analise_processo", "analise_processo__updated_by")
            .prefetch_related(Prefetch("carteiras_vinculadas", queryset=Carteira.objects.only("id")))
            .only(
                "id",
                "uf",
                "carteira_id",
                "analise_processo__respostas",
                "analise_processo__updated_at",
                "analise_processo__updated_by__id",
                "analise_processo__updated_by__username",
                "analise_processo__updated_by__first_name",
                "analise_processo__updated_by__last_name",
            )
        )

        process_ids = [processo.id for processo in processos]
        cpf_by_processo = {}
        if process_ids:
            partes = (
                Parte.objects.filter(tipo_polo="PASSIVO", processo_id__in=process_ids)
                .exclude(documento__isnull=True)
                .exclude(documento__exact="")
                .values_list("processo_id", "documento")
                .distinct()
            )
            for processo_id, documento in partes:
                cpf_digits = re.sub(r"\D", "", str(documento or ""))
                if not cpf_digits:
                    continue
                cpf_by_processo.setdefault(processo_id, set()).add(cpf_digits)

        all_ufs = set()
        buckets = {}
        productivity_users = {}
        productivity_daily_all = {}
        productivity_totals = {"analises": 0, "tarefas": 0, "prazos": 0}
        productivity_sem_data = {"analises": 0, "tarefas": 0, "prazos": 0}
        productivity_pending = {"tarefas": 0, "prazos": 0}

        known_users_by_norm = {}
        for user in User.objects.filter(is_active=True).only("id", "username", "first_name", "last_name"):
            display_name = _clean_text(user.get_full_name()) or _clean_text(getattr(user, "username", ""))
            if not display_name:
                continue
            candidate_keys = {display_name, _clean_text(getattr(user, "username", ""))}
            for candidate in candidate_keys:
                norm = _normalize_answer(candidate)
                if not norm:
                    continue
                known_users_by_norm.setdefault(
                    norm,
                    {"id": int(user.id), "label": display_name},
                )

        def _get_bucket(uf_code):
            bucket = buckets.get(uf_code)
            if bucket is None:
                bucket = {
                    "process_ids": set(),
                    "cpfs": set(),
                    "cards_total": 0,
                    "combos": {},
                }
                buckets[uf_code] = bucket
            return bucket

        def _resolve_user_display(user_obj):
            if not user_obj:
                return ""
            return _clean_text(user_obj.get_full_name()) or _clean_text(getattr(user_obj, "username", ""))

        def _resolve_actor_key_label(author_text="", fallback_user=None):
            fallback_id = _safe_int(getattr(fallback_user, "id", None)) if fallback_user else None
            fallback_label = _resolve_user_display(fallback_user) if fallback_user else ""
            normalized_author_text = _clean_text(author_text)
            normalized_key = _normalize_answer(normalized_author_text)

            if normalized_key and normalized_key in known_users_by_norm:
                known_user = known_users_by_norm[normalized_key]
                return f"user:{known_user['id']}", known_user["label"]
            if fallback_id:
                return f"user:{fallback_id}", fallback_label or normalized_author_text or f"Usuário {fallback_id}"
            if normalized_author_text:
                return f"author:{normalized_key or normalized_author_text.lower()}", normalized_author_text
            return "unknown", "Sem usuário"

        def _ensure_productivity_user(user_key, user_label):
            normalized_key = _clean_text(user_key) or "unknown"
            normalized_label = _clean_text(user_label) or "Sem usuário"
            bucket = productivity_users.get(normalized_key)
            if bucket is None:
                bucket = {
                    "user_key": normalized_key,
                    "user_label": normalized_label,
                    "totals": {"analises": 0, "tarefas": 0, "prazos": 0},
                    "pending": {"tarefas": 0, "prazos": 0},
                    "sem_data": {"analises": 0, "tarefas": 0, "prazos": 0},
                    "daily": {},
                    "carteiras": {},
                }
                productivity_users[normalized_key] = bucket
            else:
                if not bucket.get("user_label") and normalized_label:
                    bucket["user_label"] = normalized_label
            return bucket

        def _register_productivity_carteira(user_bucket, carteira_id=None, carteira_nome=""):
            if not user_bucket:
                return
            carteira_id_int = _safe_int(carteira_id)
            if carteira_id_int and carteira_id_int in carteira_lookup:
                label = _clean_text(carteira_lookup.get(carteira_id_int))
            else:
                label = _clean_text(carteira_nome)
            if not label:
                label = "Sem carteira"
            user_bucket["carteiras"][label] = int(user_bucket["carteiras"].get(label, 0)) + 1

        def _register_productivity_event(
            metric_key,
            user_key,
            user_label,
            date_key=None,
            carteira_id=None,
            carteira_nome="",
        ):
            if metric_key not in ("analises", "tarefas", "prazos"):
                return
            user_bucket = _ensure_productivity_user(user_key, user_label)
            _register_productivity_carteira(user_bucket, carteira_id=carteira_id, carteira_nome=carteira_nome)
            user_bucket["totals"][metric_key] += 1
            productivity_totals[metric_key] += 1

            normalized_date = _clean_text(date_key)
            if not normalized_date:
                user_bucket["sem_data"][metric_key] += 1
                productivity_sem_data[metric_key] += 1
                return

            daily_item = user_bucket["daily"].setdefault(
                normalized_date,
                {"date": normalized_date, "analises": 0, "tarefas": 0, "prazos": 0},
            )
            daily_item[metric_key] += 1

            daily_total_item = productivity_daily_all.setdefault(
                normalized_date,
                {"date": normalized_date, "analises": 0, "tarefas": 0, "prazos": 0},
            )
            daily_total_item[metric_key] += 1

        def _process_entry_for_bucket(bucket, entry):
            bucket["cards_total"] += 1
            bucket["process_ids"].add(entry["processo_id"])
            bucket["cpfs"].update(entry["cpfs"])

            combo_key = (
                entry["carteira_id"] or 0,
                entry["tipo_id"] or 0,
                entry["tipo_slug"] or "",
                entry["tipo_nome"] or "",
            )
            combo = bucket["combos"].get(combo_key)
            if combo is None:
                combo = {
                    "carteira_id": entry["carteira_id"],
                    "carteira_nome": entry["carteira_nome"],
                    "tipo_id": entry["tipo_id"],
                    "tipo_nome": entry["tipo_nome"],
                    "tipo_slug": entry["tipo_slug"],
                    "process_ids": set(),
                    "cpfs": set(),
                    "cards": 0,
                    "cards_by_uf": {},
                    "kpis": {
                        "propor_monitoria_sim": 0,
                        "propor_monitoria_nao": 0,
                        "repropor_monitoria_sim": 0,
                        "repropor_monitoria_nao": 0,
                        "recomendou_monitoria": 0,
                        "cumprimento_sentenca_sim": 0,
                        "cumprimento_sentenca_nao": 0,
                        "cumprimento_sentenca_iniciar_cs": 0,
                        "habilitar_sim": 0,
                        "habilitar_nao": 0,
                    },
                    "questions": {},
                }
                bucket["combos"][combo_key] = combo

            combo["cards"] += 1
            combo["process_ids"].add(entry["processo_id"])
            combo["cpfs"].update(entry["cpfs"])
            uf_code = _clean_text(entry.get("uf")).upper() or "SEM_UF"
            combo["cards_by_uf"][uf_code] = combo["cards_by_uf"].get(uf_code, 0) + 1

            respostas_obj = entry["respostas_obj"]
            propor_monitoria = respostas_obj.get("propor_monitoria")
            repropor_monitoria = respostas_obj.get("repropor_monitoria")
            cumprimento_sentenca = respostas_obj.get("cumprimento_de_sentenca")
            habilitacao = respostas_obj.get("habilitacao")

            if _is_yes(propor_monitoria):
                combo["kpis"]["propor_monitoria_sim"] += 1
            elif _is_no(propor_monitoria):
                combo["kpis"]["propor_monitoria_nao"] += 1

            if _is_yes(repropor_monitoria):
                combo["kpis"]["repropor_monitoria_sim"] += 1
            elif _is_no(repropor_monitoria):
                combo["kpis"]["repropor_monitoria_nao"] += 1

            if _is_yes(propor_monitoria) or _is_yes(repropor_monitoria):
                combo["kpis"]["recomendou_monitoria"] += 1

            cumprimento_norm = _normalize_answer(cumprimento_sentenca)
            if _is_yes(cumprimento_sentenca):
                combo["kpis"]["cumprimento_sentenca_sim"] += 1
            elif _is_no(cumprimento_sentenca):
                combo["kpis"]["cumprimento_sentenca_nao"] += 1

            if cumprimento_norm in {
                "iniciar cs",
                "iniciar c.s.",
                "iniciar cumprimento de sentenca",
            }:
                combo["kpis"]["cumprimento_sentenca_iniciar_cs"] += 1

            habilitacao_norm = _normalize_answer(habilitacao)
            if habilitacao_norm.startswith("habilitar"):
                combo["kpis"]["habilitar_sim"] += 1
            elif habilitacao_norm.startswith("nao habilitar"):
                combo["kpis"]["habilitar_nao"] += 1

            for chave, valor in respostas_obj.items():
                if chave in technical_response_keys:
                    continue
                resposta_valor = _clean_text(valor)
                if not resposta_valor or resposta_valor == "---":
                    continue
                question_meta = questao_lookup.get(chave, {})
                question_item = combo["questions"].get(chave)
                if question_item is None:
                    expected_options = list(question_meta.get("opcoes") or [])
                    question_item = {
                        "chave": chave,
                        "pergunta": question_meta.get("texto_pergunta") or chave,
                        "tipo_campo": question_meta.get("tipo_campo") or "",
                        "cards_com_resposta": 0,
                        "cards_com_resposta_by_uf": {},
                        "expected_options": expected_options,
                        "answers": {},
                    }
                    combo["questions"][chave] = question_item
                question_item["cards_com_resposta"] += 1
                question_item["cards_com_resposta_by_uf"][uf_code] = (
                    question_item["cards_com_resposta_by_uf"].get(uf_code, 0) + 1
                )
                answer_key = _normalize_answer(resposta_valor) or resposta_valor
                answer_item = question_item["answers"].get(answer_key)
                if answer_item is None:
                    answer_item = {
                        "valor": resposta_valor,
                        "count": 0,
                        "by_uf": {},
                    }
                    question_item["answers"][answer_key] = answer_item
                answer_item["count"] += 1
                answer_item["by_uf"][uf_code] = answer_item["by_uf"].get(uf_code, 0) + 1

        for processo in processos:
            analise_obj = getattr(processo, "analise_processo", None)
            respostas = getattr(analise_obj, "respostas", None)
            cards = _get_cards_from_respostas(respostas)
            if not cards:
                continue

            vinc_ids = [carteira.id for carteira in processo.carteiras_vinculadas.all()]
            carteira_default = processo.carteira_id or (vinc_ids[0] if vinc_ids else None)
            uf_code = _clean_text(processo.uf).upper() or "SEM_UF"
            all_ufs.add(uf_code)
            cpfs = cpf_by_processo.get(processo.id, set())

            for card in cards:
                if not isinstance(card, dict):
                    continue

                analysis_type = card.get("analysis_type") if isinstance(card.get("analysis_type"), dict) else {}
                respostas_obj = card.get("tipo_de_acao_respostas")
                if not isinstance(respostas_obj, dict):
                    respostas_obj = {}

                card_has_content = _card_has_analysis_content(card)
                card_author_key = ""
                card_author_label = ""
                card_date = ""
                if card_has_content:
                    analysis_author = _clean_text(card.get("analysis_author"))
                    fallback_user = getattr(analise_obj, "updated_by", None)
                    card_author_key, card_author_label = _resolve_actor_key_label(
                        analysis_author,
                        fallback_user=fallback_user,
                    )
                    card_timestamp = (
                        _parse_datetime_value(card.get("saved_at"))
                        or _parse_datetime_value(card.get("updated_at"))
                        or _parse_datetime_value(getattr(analise_obj, "updated_at", None))
                    )
                    card_date = card_timestamp.date().isoformat() if card_timestamp else ""

                tipo_meta = _resolve_tipo_meta(analysis_type, respostas_obj)
                tipo_id = int(tipo_meta["id"]) if isinstance(tipo_meta, dict) and tipo_meta.get("id") else None
                tipo_nome = (tipo_meta or {}).get("nome") or _clean_text(analysis_type.get("nome")) or "[Sem tipo]"
                tipo_slug = (tipo_meta or {}).get("slug") or _clean_text(analysis_type.get("slug")) or "[sem-slug]"

                carteira_card_id = _safe_int(card.get("carteira_id"))
                carteira_id = carteira_card_id
                if not carteira_id:
                    tipo_norm_for_carteira = _normalize_type_text(f"{tipo_slug or ''} {tipo_nome or ''}")
                    if passivas_carteira_id and "passiv" in tipo_norm_for_carteira:
                        carteira_id = passivas_carteira_id
                    else:
                        carteira_id = carteira_default
                if not carteira_id:
                    continue
                carteira_nome = carteira_lookup.get(carteira_id, "[Sem carteira]")
                if card_has_content:
                    _register_productivity_event(
                        "analises",
                        card_author_key,
                        card_author_label,
                        card_date,
                        carteira_id=carteira_id,
                        carteira_nome=carteira_nome,
                    )

                entry = {
                    "processo_id": processo.id,
                    "cpfs": cpfs,
                    "uf": uf_code,
                    "carteira_id": carteira_id,
                    "carteira_nome": carteira_nome,
                    "tipo_id": tipo_id,
                    "tipo_nome": tipo_nome,
                    "tipo_slug": tipo_slug,
                    "respostas_obj": respostas_obj,
                }
                _process_entry_for_bucket(_get_bucket("ALL"), entry)
                _process_entry_for_bucket(_get_bucket(uf_code), entry)

        def _serialize_bucket(bucket):
            combo_items = []
            for combo in bucket["combos"].values():
                cards_total = combo["cards"]
                questions = []
                for question in combo["questions"].values():
                    question_cards = int(question["cards_com_resposta"])
                    answer_map = question.get("answers", {}) or {}
                    expected_options = list(question.get("expected_options") or [])
                    answers = []

                    def _build_answer_payload(label, answer_count, by_uf_map, *, is_sem_resposta=False):
                        answer_count_int = int(answer_count or 0)
                        by_uf_source = by_uf_map or {}
                        by_uf_sorted = sorted(
                            by_uf_source.items(),
                            key=lambda item: (-int(item[1]), item[0]),
                        )
                        pct_base_pergunta = round((answer_count_int * 100.0 / question_cards), 2) if question_cards else 0.0
                        pct_total_analises = round((answer_count_int * 100.0 / cards_total), 2) if cards_total else 0.0
                        return {
                            "valor": label,
                            "count": answer_count_int,
                            "pct": pct_base_pergunta,
                            "pct_base_pergunta": pct_base_pergunta,
                            "pct_total_analises": pct_total_analises,
                            "is_sem_resposta": bool(is_sem_resposta),
                            "by_uf": [
                                {
                                    "uf": uf_code,
                                    "count": int(uf_count),
                                    "pct": round((int(uf_count) * 100.0 / answer_count_int), 2)
                                    if answer_count_int
                                    else 0.0,
                                }
                                for uf_code, uf_count in by_uf_sorted
                            ],
                        }

                    consumed_answer_keys = set()
                    for option_text in expected_options:
                        option_label = _clean_text(option_text)
                        if not option_label:
                            continue
                        option_key = _normalize_answer(option_label)
                        option_data = answer_map.get(option_key)
                        option_count = int((option_data or {}).get("count", 0))
                        option_by_uf = (option_data or {}).get("by_uf", {}) if option_data else {}
                        answers.append(
                            _build_answer_payload(option_label, option_count, option_by_uf)
                        )
                        if option_data is not None:
                            consumed_answer_keys.add(option_key)

                    fallback_answers = []
                    for answer_key, answer_data in answer_map.items():
                        if answer_key in consumed_answer_keys:
                            continue
                        answer_count = int((answer_data or {}).get("count", 0))
                        if answer_count <= 0:
                            continue
                        answer_label = _clean_text((answer_data or {}).get("valor")) or _clean_text(answer_key)
                        fallback_answers.append((answer_label, answer_count, (answer_data or {}).get("by_uf", {}) or {}))

                    fallback_answers.sort(key=lambda item: (-int(item[1]), item[0]))
                    for answer_label, answer_count, answer_by_uf in fallback_answers:
                        answers.append(_build_answer_payload(answer_label, answer_count, answer_by_uf))

                    sem_resposta_count = max(cards_total - question_cards, 0)
                    if sem_resposta_count > 0:
                        sem_resposta_by_uf = {}
                        cards_by_uf = combo.get("cards_by_uf", {}) or {}
                        cards_com_resposta_by_uf = question.get("cards_com_resposta_by_uf", {}) or {}
                        for uf_code, total_cards_uf in cards_by_uf.items():
                            responded_count_uf = int(cards_com_resposta_by_uf.get(uf_code, 0))
                            unanswered_count_uf = max(int(total_cards_uf) - responded_count_uf, 0)
                            if unanswered_count_uf > 0:
                                sem_resposta_by_uf[uf_code] = unanswered_count_uf
                        answers.append(
                            _build_answer_payload(
                                "Sem resposta",
                                sem_resposta_count,
                                sem_resposta_by_uf,
                                is_sem_resposta=True,
                            )
                        )

                    questions.append(
                        {
                            "chave": question["chave"],
                            "pergunta": question["pergunta"],
                            "tipo_campo": question["tipo_campo"],
                            "cards": question_cards,
                            "answers": answers,
                        }
                    )
                questions.sort(key=lambda item: (-item["cards"], item["pergunta"]))

                combo_items.append(
                    {
                        "carteira_id": combo["carteira_id"],
                        "carteira_nome": combo["carteira_nome"],
                        "tipo_id": combo["tipo_id"],
                        "tipo_nome": combo["tipo_nome"],
                        "tipo_slug": combo["tipo_slug"],
                        "cards": cards_total,
                        "processos": len(combo["process_ids"]),
                        "cpfs": len(combo["cpfs"]),
                        "pct_recomendou_monitoria": round(
                            (combo["kpis"]["recomendou_monitoria"] * 100.0 / cards_total), 2
                        )
                        if cards_total
                        else 0.0,
                        "kpis": combo["kpis"],
                        "questions": questions,
                    }
                )
            combo_items.sort(
                key=lambda item: (
                    item["carteira_nome"] or "",
                    item["tipo_nome"] or "",
                    -(item["cards"] or 0),
                )
            )
            return {
                "cards_total": bucket["cards_total"],
                "processos_total": len(bucket["process_ids"]),
                "cpfs_total": len(bucket["cpfs"]),
                "combos": combo_items,
            }

        uf_codes = sorted(all_ufs)
        uf_options = [{"code": "ALL", "label": "Todas as UFs"}] + [
            {"code": uf_code, "label": uf_code} for uf_code in uf_codes
        ]

        serialized_buckets = {uf_code: _serialize_bucket(bucket) for uf_code, bucket in buckets.items()}
        if "ALL" not in serialized_buckets:
            serialized_buckets["ALL"] = {
                "cards_total": 0,
                "processos_total": 0,
                "cpfs_total": 0,
                "combos": [],
            }

        # KPI adicional: peças geradas por tipo (Monitória, Cobrança, Habilitação)
        peticao_type_defs = [
            {"slug": "monitoria_inicial", "label": "Monitória"},
            {"slug": "cobranca_judicial", "label": "Ação de Cobrança"},
            {"slug": "habilitacao", "label": "Habilitação"},
        ]
        peticao_slugs = [item["slug"] for item in peticao_type_defs]

        processo_carteiras = {}
        processo_carteira_rows = (
            ProcessoJudicial.objects.values_list("id", "carteira_id", "carteiras_vinculadas__id").distinct()
        )
        for processo_id, carteira_principal_id, carteira_vinculada_id in processo_carteira_rows:
            bucket = processo_carteiras.setdefault(int(processo_id), set())
            if carteira_principal_id:
                bucket.add(int(carteira_principal_id))
            if carteira_vinculada_id:
                bucket.add(int(carteira_vinculada_id))

        peticao_by_carteira = {
            int(carteira_id): {
                "carteira_id": int(carteira_id),
                "carteira_nome": carteira_nome,
                "pieces": {slug: 0 for slug in peticao_slugs},
                "process_ids": {slug: set() for slug in peticao_slugs},
            }
            for carteira_id, carteira_nome in carteira_lookup.items()
        }
        peticao_totals = {
            slug: {"pieces": 0, "process_ids": set()}
            for slug in peticao_slugs
        }

        arquivo_rows = ProcessoArquivo.objects.values_list("processo_id", "nome", "arquivo")
        for processo_id, nome_arquivo, arquivo_path in arquivo_rows.iterator():
            if not processo_id:
                continue
            tipo_slug = _classify_peticao_kind(nome_arquivo, arquivo_path)
            if not tipo_slug:
                continue

            carteira_ids = processo_carteiras.get(int(processo_id), set())
            if not carteira_ids:
                continue

            for carteira_id in carteira_ids:
                carteira_bucket = peticao_by_carteira.get(carteira_id)
                if carteira_bucket is None:
                    carteira_bucket = {
                        "carteira_id": int(carteira_id),
                        "carteira_nome": carteira_lookup.get(carteira_id, f"Carteira {carteira_id}"),
                        "pieces": {slug: 0 for slug in peticao_slugs},
                        "process_ids": {slug: set() for slug in peticao_slugs},
                    }
                    peticao_by_carteira[carteira_id] = carteira_bucket
                carteira_bucket["pieces"][tipo_slug] += 1
                carteira_bucket["process_ids"][tipo_slug].add(int(processo_id))

            peticao_totals[tipo_slug]["pieces"] += 1
            peticao_totals[tipo_slug]["process_ids"].add(int(processo_id))

        serialized_peticao_by_carteira = []
        for carteira in sorted(peticao_by_carteira.values(), key=lambda item: (item["carteira_nome"] or "").upper()):
            total_pieces = sum(int(carteira["pieces"].get(slug, 0)) for slug in peticao_slugs)
            if total_pieces <= 0:
                continue
            processos_map = {
                slug: len(carteira["process_ids"].get(slug, set()))
                for slug in peticao_slugs
            }
            total_processos = len(set().union(*[carteira["process_ids"].get(slug, set()) for slug in peticao_slugs]))
            serialized_peticao_by_carteira.append(
                {
                    "carteira_id": carteira["carteira_id"],
                    "carteira_nome": carteira["carteira_nome"],
                    "pieces": {slug: int(carteira["pieces"].get(slug, 0)) for slug in peticao_slugs},
                    "processos": processos_map,
                    "total_pieces": int(total_pieces),
                    "total_processos": int(total_processos),
                }
            )

        serialized_peticao_totals = [
            {
                "slug": item["slug"],
                "label": item["label"],
                "pieces": int(peticao_totals[item["slug"]]["pieces"]),
                "processos": len(peticao_totals[item["slug"]]["process_ids"]),
            }
            for item in peticao_type_defs
        ]

        # KPI adicional: cadastros importados com etiqueta de prioridade da planilha
        priority_default_bg = "#f5c242"
        priority_default_fg = "#3e2a00"
        priority_tags = list(
            Etiqueta.objects.filter(
                cor_fundo__iexact=priority_default_bg,
                cor_fonte__iexact=priority_default_fg,
            )
            .values("id", "nome")
            .order_by("nome")
        )
        priority_tag_ids = [int(item["id"]) for item in priority_tags if item.get("id")]
        priority_tag_ids_set = set(priority_tag_ids)
        priority_lookup = {
            int(item["id"]): _clean_text(item.get("nome")) or f"Prioridade {item['id']}"
            for item in priority_tags
            if item.get("id")
        }

        priority_rows_map = {}
        priority_by_priority_map = {}
        priority_by_uf_map = {}
        priority_process_count = 0
        priority_process_analisados = 0

        if priority_tag_ids:
            processos_com_prioridade = (
                ProcessoJudicial.objects.filter(etiquetas__id__in=priority_tag_ids)
                .distinct()
                .select_related("analise_processo")
                .prefetch_related(
                    Prefetch(
                        "etiquetas",
                        queryset=Etiqueta.objects.filter(id__in=priority_tag_ids).only("id", "nome"),
                    )
                )
                .only("id", "uf", "analise_processo__respostas")
            )

            for processo in processos_com_prioridade:
                uf_code = _clean_text(processo.uf).upper() or "SEM_UF"
                respostas = getattr(getattr(processo, "analise_processo", None), "respostas", None)
                processo_analisado = _process_has_analysis_content(respostas)
                priority_process_count += 1
                if processo_analisado:
                    priority_process_analisados += 1

                uf_bucket = priority_by_uf_map.setdefault(
                    uf_code,
                    {"uf": uf_code, "total": 0, "analisados": 0, "pendentes": 0},
                )
                uf_bucket["total"] += 1
                if processo_analisado:
                    uf_bucket["analisados"] += 1
                else:
                    uf_bucket["pendentes"] += 1

                process_priority_ids = set()
                for tag in processo.etiquetas.all():
                    tag_id = int(getattr(tag, "id", 0) or 0)
                    if not tag_id or tag_id not in priority_tag_ids_set or tag_id in process_priority_ids:
                        continue
                    process_priority_ids.add(tag_id)
                    tag_nome = priority_lookup.get(tag_id) or _clean_text(getattr(tag, "nome", "")) or f"Prioridade {tag_id}"

                    row_key = (uf_code, tag_id)
                    row_bucket = priority_rows_map.setdefault(
                        row_key,
                        {
                            "uf": uf_code,
                            "prioridade_id": tag_id,
                            "prioridade_nome": tag_nome,
                            "total": 0,
                            "analisados": 0,
                            "pendentes": 0,
                        },
                    )
                    row_bucket["total"] += 1
                    if processo_analisado:
                        row_bucket["analisados"] += 1
                    else:
                        row_bucket["pendentes"] += 1

                    priority_bucket = priority_by_priority_map.setdefault(
                        tag_id,
                        {
                            "prioridade_id": tag_id,
                            "prioridade_nome": tag_nome,
                            "total": 0,
                            "analisados": 0,
                            "pendentes": 0,
                        },
                    )
                    priority_bucket["total"] += 1
                    if processo_analisado:
                        priority_bucket["analisados"] += 1
                    else:
                        priority_bucket["pendentes"] += 1

        serialized_priority_rows = sorted(
            priority_rows_map.values(),
            key=lambda item: ((item.get("prioridade_nome") or "").upper(), item.get("uf") or ""),
        )
        serialized_priority_by_priority = sorted(
            priority_by_priority_map.values(),
            key=lambda item: ((item.get("prioridade_nome") or "").upper(), int(item.get("prioridade_id") or 0)),
        )
        serialized_priority_by_uf = sorted(
            priority_by_uf_map.values(),
            key=lambda item: item.get("uf") or "",
        )
        serialized_priority_tags = [
            {"id": tag_id, "nome": priority_lookup.get(tag_id) or f"Prioridade {tag_id}"}
            for tag_id in priority_tag_ids
        ]
        priority_totals = {
            "processos": int(priority_process_count),
            "analisados": int(priority_process_analisados),
            "pendentes": int(max(priority_process_count - priority_process_analisados, 0)),
        }
        priority_kpi_data = {
            "tags": serialized_priority_tags,
            "totals": priority_totals,
            "rows": serialized_priority_rows,
            "by_priority": serialized_priority_by_priority,
            "by_uf": serialized_priority_by_uf,
        }

        tarefas_concluidas = (
            Tarefa.objects.filter(concluida=True)
            .select_related("concluido_por", "processo__carteira")
            .only(
                "id",
                "concluido_em",
                "concluido_por__id",
                "concluido_por__username",
                "concluido_por__first_name",
                "concluido_por__last_name",
                "processo_id",
                "processo__carteira_id",
                "processo__carteira__nome",
            )
        )
        for tarefa in tarefas_concluidas.iterator():
            actor_key, actor_label = _resolve_actor_key_label("", fallback_user=getattr(tarefa, "concluido_por", None))
            concluded_at = _parse_datetime_value(getattr(tarefa, "concluido_em", None))
            concluded_date = concluded_at.date().isoformat() if concluded_at else ""
            processo_obj = getattr(tarefa, "processo", None)
            carteira_id = _safe_int(getattr(processo_obj, "carteira_id", None)) if processo_obj else None
            carteira_nome = _clean_text(getattr(getattr(processo_obj, "carteira", None), "nome", "")) if processo_obj else ""
            _register_productivity_event(
                "tarefas",
                actor_key,
                actor_label,
                concluded_date,
                carteira_id=carteira_id,
                carteira_nome=carteira_nome,
            )

        prazos_concluidos = (
            Prazo.objects.filter(concluido=True)
            .select_related("concluido_por", "processo__carteira")
            .only(
                "id",
                "concluido_em",
                "concluido_por__id",
                "concluido_por__username",
                "concluido_por__first_name",
                "concluido_por__last_name",
                "processo_id",
                "processo__carteira_id",
                "processo__carteira__nome",
            )
        )
        for prazo in prazos_concluidos.iterator():
            actor_key, actor_label = _resolve_actor_key_label("", fallback_user=getattr(prazo, "concluido_por", None))
            concluded_at = _parse_datetime_value(getattr(prazo, "concluido_em", None))
            concluded_date = concluded_at.date().isoformat() if concluded_at else ""
            processo_obj = getattr(prazo, "processo", None)
            carteira_id = _safe_int(getattr(processo_obj, "carteira_id", None)) if processo_obj else None
            carteira_nome = _clean_text(getattr(getattr(processo_obj, "carteira", None), "nome", "")) if processo_obj else ""
            _register_productivity_event(
                "prazos",
                actor_key,
                actor_label,
                concluded_date,
                carteira_id=carteira_id,
                carteira_nome=carteira_nome,
            )

        tarefas_pendentes = (
            Tarefa.objects.filter(concluida=False)
            .select_related("responsavel", "processo__carteira")
            .only(
                "id",
                "responsavel__id",
                "responsavel__username",
                "responsavel__first_name",
                "responsavel__last_name",
                "processo_id",
                "processo__carteira_id",
                "processo__carteira__nome",
            )
        )
        for tarefa in tarefas_pendentes.iterator():
            actor_key, actor_label = _resolve_actor_key_label("", fallback_user=getattr(tarefa, "responsavel", None))
            user_bucket = _ensure_productivity_user(actor_key, actor_label)
            processo_obj = getattr(tarefa, "processo", None)
            carteira_id = _safe_int(getattr(processo_obj, "carteira_id", None)) if processo_obj else None
            carteira_nome = _clean_text(getattr(getattr(processo_obj, "carteira", None), "nome", "")) if processo_obj else ""
            _register_productivity_carteira(user_bucket, carteira_id=carteira_id, carteira_nome=carteira_nome)
            user_bucket["pending"]["tarefas"] += 1
            productivity_pending["tarefas"] += 1

        prazos_pendentes = (
            Prazo.objects.filter(concluido=False)
            .select_related("responsavel", "processo__carteira")
            .only(
                "id",
                "responsavel__id",
                "responsavel__username",
                "responsavel__first_name",
                "responsavel__last_name",
                "processo_id",
                "processo__carteira_id",
                "processo__carteira__nome",
            )
        )
        for prazo in prazos_pendentes.iterator():
            actor_key, actor_label = _resolve_actor_key_label("", fallback_user=getattr(prazo, "responsavel", None))
            user_bucket = _ensure_productivity_user(actor_key, actor_label)
            processo_obj = getattr(prazo, "processo", None)
            carteira_id = _safe_int(getattr(processo_obj, "carteira_id", None)) if processo_obj else None
            carteira_nome = _clean_text(getattr(getattr(processo_obj, "carteira", None), "nome", "")) if processo_obj else ""
            _register_productivity_carteira(user_bucket, carteira_id=carteira_id, carteira_nome=carteira_nome)
            user_bucket["pending"]["prazos"] += 1
            productivity_pending["prazos"] += 1

        serialized_productivity_users = []
        for user_bucket in productivity_users.values():
            daily_rows = sorted(
                user_bucket["daily"].values(),
                key=lambda item: item["date"],
            )
            carteira_items = sorted(
                (
                    {"nome": str(nome), "eventos": int(count)}
                    for nome, count in (user_bucket.get("carteiras") or {}).items()
                    if str(nome).strip()
                ),
                key=lambda item: (-int(item.get("eventos") or 0), (item.get("nome") or "").upper()),
            )
            carteira_label = "Sem carteira"
            if carteira_items:
                carteira_label = carteira_items[0]["nome"]
                if len(carteira_items) > 1:
                    carteira_label = f"{carteira_label} (+{len(carteira_items) - 1})"

            totals = {
                "analises": int(user_bucket["totals"]["analises"]),
                "tarefas": int(user_bucket["totals"]["tarefas"]),
                "prazos": int(user_bucket["totals"]["prazos"]),
            }
            totals["total"] = int(totals["analises"] + totals["tarefas"] + totals["prazos"])
            pending = {
                "tarefas": int(user_bucket["pending"]["tarefas"]),
                "prazos": int(user_bucket["pending"]["prazos"]),
            }
            pending["total"] = int(pending["tarefas"] + pending["prazos"])

            sem_data = {
                "analises": int(user_bucket["sem_data"]["analises"]),
                "tarefas": int(user_bucket["sem_data"]["tarefas"]),
                "prazos": int(user_bucket["sem_data"]["prazos"]),
            }
            sem_data["total"] = int(sem_data["analises"] + sem_data["tarefas"] + sem_data["prazos"])

            serialized_productivity_users.append(
                {
                    "user_key": user_bucket["user_key"],
                    "user_label": user_bucket["user_label"],
                    "carteira_label": carteira_label,
                    "carteira_count": len(carteira_items),
                    "carteiras": carteira_items,
                    "totals": totals,
                    "pending": pending,
                    "sem_data": sem_data,
                    "daily": [
                        {
                            "date": row["date"],
                            "analises": int(row.get("analises") or 0),
                            "tarefas": int(row.get("tarefas") or 0),
                            "prazos": int(row.get("prazos") or 0),
                            "total": int((row.get("analises") or 0) + (row.get("tarefas") or 0) + (row.get("prazos") or 0)),
                        }
                        for row in daily_rows
                    ],
                }
            )

        serialized_productivity_users.sort(
            key=lambda item: (
                -int(item.get("totals", {}).get("total") or 0),
                (item.get("user_label") or "").upper(),
            )
        )

        productivity_daily_rows = sorted(
            productivity_daily_all.values(),
            key=lambda item: item["date"],
        )
        serialized_productivity_daily = [
            {
                "date": row["date"],
                "analises": int(row.get("analises") or 0),
                "tarefas": int(row.get("tarefas") or 0),
                "prazos": int(row.get("prazos") or 0),
                "total": int((row.get("analises") or 0) + (row.get("tarefas") or 0) + (row.get("prazos") or 0)),
            }
            for row in productivity_daily_rows
        ]
        productivity_date_min = serialized_productivity_daily[0]["date"] if serialized_productivity_daily else ""
        productivity_date_max = serialized_productivity_daily[-1]["date"] if serialized_productivity_daily else ""
        productivity_totals_payload = {
            "analises": int(productivity_totals["analises"]),
            "tarefas": int(productivity_totals["tarefas"]),
            "prazos": int(productivity_totals["prazos"]),
        }
        productivity_totals_payload["total"] = int(
            productivity_totals_payload["analises"]
            + productivity_totals_payload["tarefas"]
            + productivity_totals_payload["prazos"]
        )
        productivity_sem_data_payload = {
            "analises": int(productivity_sem_data["analises"]),
            "tarefas": int(productivity_sem_data["tarefas"]),
            "prazos": int(productivity_sem_data["prazos"]),
        }
        productivity_sem_data_payload["total"] = int(
            productivity_sem_data_payload["analises"]
            + productivity_sem_data_payload["tarefas"]
            + productivity_sem_data_payload["prazos"]
        )
        productivity_pending_payload = {
            "tarefas": int(productivity_pending["tarefas"]),
            "prazos": int(productivity_pending["prazos"]),
        }
        productivity_pending_payload["total"] = int(
            productivity_pending_payload["tarefas"] + productivity_pending_payload["prazos"]
        )
        productivity_kpi_data = {
            "users": serialized_productivity_users,
            "daily": serialized_productivity_daily,
            "totals": productivity_totals_payload,
            "pending": productivity_pending_payload,
            "sem_data": productivity_sem_data_payload,
            "date_min": productivity_date_min,
            "date_max": productivity_date_max,
        }
        settings_map = get_presence_settings()
        online_presence_enabled_for_user = bool(
            request
            and is_user_supervisor(getattr(request, "user", None))
            and is_online_presence_enabled()
        )
        online_presence_kpi_data = {
            "enabled": online_presence_enabled_for_user,
            "snapshot_url": reverse('admin:contratos_carteira_kpi_online_presence') if online_presence_enabled_for_user else "",
            "heartbeat_seconds": int(settings_map["heartbeat_seconds"]),
            "ttl_seconds": int(settings_map["ttl_seconds"]),
            "idle_seconds": int(settings_map["idle_seconds"]),
        }

        return {
            "ufs": uf_options,
            "buckets": serialized_buckets,
            "process_changelist_url": process_changelist_url,
            "peticao_types": peticao_type_defs,
            "peticao_by_carteira": serialized_peticao_by_carteira,
            "peticao_totals": serialized_peticao_totals,
            "priority_kpi": priority_kpi_data,
            "productivity_kpi": productivity_kpi_data,
            "online_presence_kpi": online_presence_kpi_data,
        }

    def changelist_view(self, request, extra_context=None):
        chart_data = list(self.get_queryset(request).values('nome', 'cor_grafico', 'total_processos', 'valor_total'))
        intersection_data = self._build_carteira_intersections()
        kpi_data = self._build_carteira_kpi_data(request)
        extra_context = extra_context or {}
        extra_context['chart_data'] = json.dumps(chart_data, default=str)
        extra_context['intersection_data'] = json.dumps(intersection_data, default=str)
        extra_context['kpi_data'] = json.dumps(kpi_data, default=str)
        return super().changelist_view(request, extra_context=extra_context)

    class Media:
        css = {
            'all': (
                'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/themes/classic.min.css',
            )
        }
        js = (
            'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/pickr.min.js',
            'admin/js/carteira_color_picker.js',
            'https://cdn.jsdelivr.net/npm/chart.js',
            'admin/js/carteira_charts.js?v=20260219a',
        )

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
    def get_changelist(self, request, **kwargs):
        return ProcessoJudicialChangeList
    class Media:
        js = ('contratos/js/contrato_money_mask.js',)
    list_display = ("uf", "cpf_passivo", "get_polo_passivo", "get_x_separator", "get_polo_ativo",
                    "cnj_with_navigation", "classe_processual", "carteira_com_indicador", "nao_judicializado", "busca_ativa")
    list_display_links = ("cnj_with_navigation",)
    BASE_LIST_FILTERS = [
        LastEditOrderFilter,
        EquipeDelegadoFilter,
        AprovacaoFilter,
        TipoAnaliseConcluidaFilter,
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
    search_fields = (
        "cnj",
        "numeros_cnj__cnj",
        "partes_processuais__nome",
        "partes_processuais__documento",
        "contratos__numero_contrato",
    )
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
                | Q(numeros_cnj__cnj__iregex=rf'.*{digit_pattern}')
            )
            extra = queryset.filter(filters)
            qs = (qs | extra).distinct()
            use_distinct = True
        return qs, use_distinct
    fieldsets = (
        ("Dados do Processo", {"fields": ("cnj", "uf", "valor_causa", "status", "viabilidade", "carteira", "carteiras_vinculadas", "vara", "tribunal", "busca_ativa")}),
    )
    change_form_template = "admin/contratos/processojudicial/change_form_navegacao.html"
    history_template = "admin/contratos/processojudicial/object_history.html"
    change_list_template = "admin/contratos/processojudicial/change_list_mapa.html"
    actions = ['excluir_andamentos_selecionados', 'delegate_processes', 'change_carteira_bulk']

    FILTER_SESSION_KEY = 'processo_last_filters'
    FILTER_SKIP_KEY = 'processo_skip_last_filters'

    def get_list_filter(self, request):
        filters = list(self.BASE_LIST_FILTERS)
        if is_user_supervisor(request.user):
            filters.insert(0, ParaSupervisionarFilter)
        return filters

    def _sanitize_filter_qs(self, qs):
        params = QueryDict(qs, mutable=True)
        for key in (
            'o',
            'p',
            '_changelist_filters',
            '_skip_saved_filters',
            'tab',
            'intersection_carteira_a',
            'intersection_carteira_b',
            'show_counts',
            'kpi_carteira_id',
            'kpi_tipo_id',
            'kpi_question',
            'kpi_answer',
            'kpi_uf',
            'peticao_tipo',
            'peticao_carteira_id',
            'priority_kpi_tag_id',
            'priority_kpi_status',
            'priority_kpi_uf',
            'ord_prescricao',
            'ord_ultima_edicao',
        ):
            params.pop(key, None)
        params.pop('aprovacao', None)
        return params.urlencode()

    def _handle_saved_filters(self, request):
        stored = request.session.get(self.FILTER_SESSION_KEY)
        if stored:
            sanitized_stored = self._sanitize_filter_qs(stored)
            if sanitized_stored != stored:
                if sanitized_stored:
                    request.session[self.FILTER_SESSION_KEY] = sanitized_stored
                else:
                    request.session.pop(self.FILTER_SESSION_KEY, None)
            stored = sanitized_stored or None
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

    def _normalize_show_counts_param(self, request):
        """
        Migra URLs antigas com `show_counts` para o parâmetro nativo `_facets`.
        Evita que `show_counts` vire lookup inválido em versões antigas do changelist.
        """
        if request.method != 'GET' or 'show_counts' not in request.GET:
            return None
        params = request.GET.copy()
        show_counts_value = params.get('show_counts')
        if show_counts_value in {'0', '1'} and '_facets' not in params:
            params['_facets'] = show_counts_value
        params.pop('show_counts', None)
        target_url = request.path
        if params:
            target_url = f"{target_url}?{params.urlencode()}"
        if target_url != request.get_full_path():
            return HttpResponseRedirect(target_url)
        return None

    def _get_filtered_carteira_id_from_params(self, params):
        raw_carteira_id = params.get('carteira') or params.get('carteira__id__exact')
        try:
            carteira_id = int(raw_carteira_id)
        except (TypeError, ValueError):
            return None
        return carteira_id if carteira_id > 0 else None

    def _get_filtered_carteira_id(self, request):
        return self._get_filtered_carteira_id_from_params(request.GET)

    def _get_single_allowed_carteira_id_for_user(self, user):
        allowed_ids = get_user_allowed_carteira_ids(user)
        if allowed_ids is None or len(allowed_ids) != 1:
            return None
        try:
            carteira_id = int(allowed_ids[0])
        except (TypeError, ValueError):
            return None
        return carteira_id if carteira_id > 0 else None

    def _is_passivas_carteira(self, carteira_id):
        if not carteira_id:
            return False
        return Carteira.objects.filter(
            pk=carteira_id,
            nome__iexact='Passivas',
        ).exists()

    def _get_effective_carteira_id_for_prescricao_from_params(self, params, user=None):
        carteira_id = self._get_filtered_carteira_id_from_params(params)
        if carteira_id:
            return carteira_id

        kpi_carteira_id = self._safe_positive_int(params.get('kpi_carteira_id'))
        if kpi_carteira_id:
            return kpi_carteira_id

        peticao_carteira_id = self._safe_positive_int(params.get('peticao_carteira_id'))
        if peticao_carteira_id:
            return peticao_carteira_id

        if user is not None:
            return self._get_single_allowed_carteira_id_for_user(user)
        return None

    def _get_effective_carteira_id_for_prescricao(self, request):
        """
        Resolve a carteira efetiva da listagem para aplicar comportamentos
        automáticos (ex.: incluir prescritos em Passivas), inclusive quando a
        listagem veio de links de KPI que não usam o filtro `carteira`.
        """
        return self._get_effective_carteira_id_for_prescricao_from_params(
            request.GET,
            user=request.user,
        )

    def _should_include_prescritos_for_params(self, params, user=None):
        if params.get('ord_prescricao'):
            return False
        if params.get('nao_judicializado') is not None:
            return False
        carteira_id = self._get_effective_carteira_id_for_prescricao_from_params(params, user=user)
        return self._is_passivas_carteira(carteira_id)

    def _extract_changelist_filters_for_navigation(self, request):
        changelist_filters = request.GET.get('_changelist_filters')
        if changelist_filters:
            changelist_filters = unquote(str(changelist_filters))

        if not changelist_filters and request.GET:
            direct = QueryDict(request.GET.urlencode(), mutable=True)
            for key in ('o', 'p', '_changelist_filters', '_skip_saved_filters', 'tab'):
                direct.pop(key, None)
            if direct.urlencode():
                changelist_filters = direct.urlencode()

        if not changelist_filters:
            referer = (request.META.get('HTTP_REFERER') or '').strip()
            if referer:
                try:
                    parsed = urlparse(referer)
                except ValueError:
                    parsed = None
                if parsed:
                    changelist_path = reverse('admin:contratos_processojudicial_changelist').rstrip('/')
                    referer_path = (parsed.path or '').rstrip('/')
                    if referer_path == changelist_path:
                        ref_params = QueryDict(parsed.query, mutable=True)
                        nested = ref_params.get('_changelist_filters')
                        if nested:
                            changelist_filters = unquote(str(nested))
                        else:
                            for key in ('o', 'p', '_changelist_filters', '_skip_saved_filters', 'tab'):
                                ref_params.pop(key, None)
                            if ref_params.urlencode():
                                changelist_filters = ref_params.urlencode()

        if not changelist_filters:
            saved_filters = request.session.get(self.FILTER_SESSION_KEY)
            if saved_filters and '=' in str(saved_filters):
                changelist_filters = str(saved_filters)

        if not changelist_filters:
            params = QueryDict('', mutable=True)
        else:
            params = QueryDict(str(changelist_filters), mutable=True)

        for key in ('o', 'p', '_changelist_filters', '_skip_saved_filters', 'tab'):
            params.pop(key, None)
        if self._should_include_prescritos_for_params(params, user=request.user):
            params['ord_prescricao'] = 'incluir'
        return params.urlencode()

    def _ensure_passivas_include_prescritos(self, request):
        if request.method != 'GET':
            return None
        params = request.GET.copy()
        if not self._should_include_prescritos_for_params(params, user=request.user):
            return None
        params['ord_prescricao'] = 'incluir'
        target_url = f"{request.path}?{params.urlencode()}"
        if target_url != request.get_full_path():
            return HttpResponseRedirect(target_url)
        return None

    def save_model(self, request, obj, form, change):
        selected_carteira_ids = self._extract_selected_carteira_ids(form, request=request)
        # Snapshot para uso no save_related; evita perda de seleção em cenários
        # onde o POST/M2M chega parcialmente no fluxo do admin.
        obj._selected_carteira_ids_snapshot = set(selected_carteira_ids)
        entries_payload = form.cleaned_data.get('cnj_entries_data')
        # Se o payload não veio no POST (ex.: usuário apenas clicou em "Salvar" sem tocar na UI dos CNJs),
        # não devemos apagar os campos atuais nem os números CNJ existentes.
        if entries_payload in (None, ''):
            self._apply_primary_carteira(obj, selected_carteira_ids)
            super().save_model(request, obj, form, change)
            return
        entries = self._parse_cnj_entries(entries_payload)
        active_entry = self._get_active_entry(entries, form.cleaned_data.get('cnj_active_index'))
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
        self._apply_primary_carteira(obj, selected_carteira_ids)
        super().save_model(request, obj, form, change)
        self._sync_cnj_entries(obj, entries)

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        qs = filter_processos_queryset_for_user(qs, request.user)
        qs = self._apply_intersection_pair_filter(qs, request)
        qs = self._apply_kpi_response_filter(qs, request)
        qs = self._apply_peticao_kpi_filter(qs, request)
        qs = self._apply_priority_kpi_filter(qs, request)
        qs = qs.select_related('carteira').prefetch_related('carteiras_vinculadas')
        order_filter = request.GET.get('ord_ultima_edicao')
        if order_filter not in {'recente', 'antigo'}:
            return qs
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

    @admin.display(description="Carteira", ordering="carteira__nome")
    def carteira_com_indicador(self, obj):
        carteira_names = {}
        primary_name = getattr(getattr(obj, 'carteira', None), 'nome', None)
        if obj.carteira_id:
            carteira_names[int(obj.carteira_id)] = primary_name or f"Carteira {obj.carteira_id}"

        linked_manager = getattr(obj, 'carteiras_vinculadas', None)
        if linked_manager is not None:
            for carteira in linked_manager.all():
                if carteira and getattr(carteira, 'id', None):
                    carteira_names[int(carteira.id)] = carteira.nome

        if not carteira_names:
            return "-"

        display_name = primary_name
        if not display_name:
            display_name = sorted(carteira_names.values(), key=lambda value: str(value).upper())[0]

        if len(carteira_names) <= 1:
            return display_name

        return format_html(
            '{} <span title="Cadastro vinculado a mais de uma carteira">+</span>',
            display_name,
        )

    def _parse_intersection_pair_ids(self, request):
        raw_a = request.GET.get('intersection_carteira_a')
        raw_b = request.GET.get('intersection_carteira_b')
        try:
            carteira_a_id = int(raw_a)
            carteira_b_id = int(raw_b)
        except (TypeError, ValueError):
            return None
        if carteira_a_id <= 0 or carteira_b_id <= 0:
            return None
        if carteira_a_id == carteira_b_id:
            return None
        return tuple(sorted((carteira_a_id, carteira_b_id)))

    def _build_intersection_process_ids(self, carteira_a_id, carteira_b_id):
        pair_ids = {carteira_a_id, carteira_b_id}
        processo_carteiras = {}

        processo_rows = (
            ProcessoJudicial.objects.filter(
                Q(carteira_id__in=pair_ids) | Q(carteiras_vinculadas__id__in=pair_ids)
            )
            .values_list('id', 'carteira_id', 'carteiras_vinculadas__id')
            .distinct()
        )

        for processo_id, carteira_principal_id, carteira_vinculada_id in processo_rows:
            bucket = processo_carteiras.setdefault(processo_id, set())
            if carteira_principal_id in pair_ids:
                bucket.add(carteira_principal_id)
            if carteira_vinculada_id in pair_ids:
                bucket.add(carteira_vinculada_id)

        if not processo_carteiras:
            return set()

        carteira_cpfs = {carteira_a_id: set(), carteira_b_id: set()}
        processo_cpfs = {}

        partes_rows = (
            Parte.objects.filter(tipo_polo='PASSIVO', processo_id__in=processo_carteiras.keys())
            .exclude(documento__isnull=True)
            .exclude(documento__exact='')
            .values_list('processo_id', 'documento')
            .distinct()
        )

        for processo_id, documento in partes_rows:
            cpf_digits = re.sub(r'\D', '', str(documento or ''))
            if not cpf_digits:
                continue
            processo_cpfs.setdefault(processo_id, set()).add(cpf_digits)
            for carteira_id in processo_carteiras.get(processo_id, set()):
                if carteira_id in pair_ids:
                    carteira_cpfs[carteira_id].add(cpf_digits)

        intersection_cpfs = carteira_cpfs.get(carteira_a_id, set()).intersection(
            carteira_cpfs.get(carteira_b_id, set())
        )
        if not intersection_cpfs:
            return set()

        process_ids = {
            processo_id
            for processo_id, cpfs in processo_cpfs.items()
            if cpfs.intersection(intersection_cpfs)
        }
        return process_ids

    def _apply_intersection_pair_filter(self, queryset, request):
        pair_ids = self._parse_intersection_pair_ids(request)
        if not pair_ids:
            return queryset
        process_ids = self._build_intersection_process_ids(*pair_ids)
        if not process_ids:
            return queryset.none()
        return queryset.filter(pk__in=process_ids)

    def _safe_positive_int(self, value):
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    def _normalize_kpi_text(self, value):
        text = str(value or '').strip().lower()
        if not text:
            return ''
        text = unicodedata.normalize('NFKD', text)
        text = ''.join(ch for ch in text if not unicodedata.combining(ch))
        return re.sub(r'\s+', ' ', text).strip()

    def _resolve_kpi_card_carteira_id(
        self,
        *,
        card_carteira_id=None,
        carteira_default=None,
        tipo_slug='',
        tipo_nome='',
        passivas_carteira_id=None,
    ):
        """
        Regra de carteira para KPI por card:
        1) usa carteira_id explícita do card (quando existir);
        2) card do tipo Passivas vai para carteira Passivas;
        3) demais casos usam carteira padrão do processo.
        """
        explicit_id = self._safe_positive_int(card_carteira_id)
        if explicit_id:
            return explicit_id

        tipo_norm = self._normalize_kpi_text(f"{tipo_slug or ''} {tipo_nome or ''}")
        if passivas_carteira_id and 'passiv' in tipo_norm:
            return passivas_carteira_id

        return self._safe_positive_int(carteira_default)

    def _extract_kpi_cards(self, respostas):
        if not isinstance(respostas, dict):
            return []
        saved_cards = respostas.get('saved_processos_vinculados')
        if isinstance(saved_cards, list) and saved_cards:
            return saved_cards
        active_cards = respostas.get('processos_vinculados')
        if isinstance(active_cards, list) and active_cards:
            return active_cards
        return []

    def _kpi_has_filled_value(self, value):
        if value is None:
            return False
        if isinstance(value, str):
            cleaned = value.strip()
            if not cleaned:
                return False
            if cleaned in {'---', '-', '—'}:
                return False
            return True
        if isinstance(value, dict):
            return any(self._kpi_has_filled_value(item) for item in value.values())
        if isinstance(value, (list, tuple, set)):
            return any(self._kpi_has_filled_value(item) for item in value)
        return True

    def _kpi_card_has_analysis_content(self, card):
        if not isinstance(card, dict):
            return False
        if self._kpi_has_filled_value(card.get('observacoes')):
            return True
        respostas_obj = card.get('tipo_de_acao_respostas')
        if not isinstance(respostas_obj, dict):
            return False
        return any(self._kpi_has_filled_value(value) for value in respostas_obj.values())

    def _kpi_process_has_analysis_content(self, processo):
        respostas = getattr(getattr(processo, 'analise_processo', None), 'respostas', None)
        cards = self._extract_kpi_cards(respostas)
        if not cards:
            return False
        return any(self._kpi_card_has_analysis_content(card) for card in cards if isinstance(card, dict))

    def _parse_kpi_response_filter(self, request):
        carteira_id = self._safe_positive_int(request.GET.get('kpi_carteira_id'))
        tipo_id = self._safe_positive_int(request.GET.get('kpi_tipo_id'))
        question_key = str(request.GET.get('kpi_question') or '').strip()
        answer_value = str(request.GET.get('kpi_answer') or '').strip()
        if not carteira_id or not tipo_id or not question_key or not answer_value:
            return None
        uf_code = str(request.GET.get('kpi_uf') or '').strip().upper()
        if uf_code in {'ALL', 'TODAS', 'TODAS AS UFS'}:
            uf_code = ''
        return {
            'carteira_id': carteira_id,
            'tipo_id': tipo_id,
            'question_key': question_key,
            'answer_value': answer_value,
            'answer_norm': self._normalize_kpi_text(answer_value),
            'uf_code': uf_code,
        }

    def _build_kpi_response_process_ids(self, queryset, kpi_filter):
        carteira_id = kpi_filter['carteira_id']
        tipo_id = kpi_filter['tipo_id']
        question_key = kpi_filter['question_key']
        answer_norm = kpi_filter['answer_norm']
        uf_code = kpi_filter['uf_code']
        passivas_carteira_id = (
            Carteira.objects.filter(nome__iexact='Passivas').values_list('id', flat=True).first()
        )

        candidate_qs = queryset.filter(analise_processo__isnull=False)
        if uf_code:
            candidate_qs = candidate_qs.filter(uf__iexact=uf_code)
        candidate_qs = candidate_qs.select_related('analise_processo').prefetch_related(
            Prefetch('carteiras_vinculadas', queryset=Carteira.objects.only('id'))
        ).distinct()

        process_ids = set()
        for processo in candidate_qs:
            respostas = getattr(getattr(processo, 'analise_processo', None), 'respostas', None)
            cards = self._extract_kpi_cards(respostas)
            if not cards:
                continue

            linked_ids = [carteira.id for carteira in processo.carteiras_vinculadas.all()]
            carteira_default = processo.carteira_id or (linked_ids[0] if linked_ids else None)

            matched = False
            for card in cards:
                if not isinstance(card, dict):
                    continue
                analysis_type = card.get('analysis_type') if isinstance(card.get('analysis_type'), dict) else {}
                card_tipo_id = self._safe_positive_int(analysis_type.get('id'))
                if card_tipo_id != tipo_id:
                    continue

                card_carteira_id = self._resolve_kpi_card_carteira_id(
                    card_carteira_id=card.get('carteira_id'),
                    carteira_default=carteira_default,
                    tipo_slug=analysis_type.get('slug'),
                    tipo_nome=analysis_type.get('nome'),
                    passivas_carteira_id=passivas_carteira_id,
                )
                if card_carteira_id != carteira_id:
                    continue

                respostas_obj = card.get('tipo_de_acao_respostas')
                if not isinstance(respostas_obj, dict):
                    continue
                card_answer_norm = self._normalize_kpi_text(respostas_obj.get(question_key))
                if card_answer_norm and card_answer_norm == answer_norm:
                    matched = True
                    break

            if matched:
                process_ids.add(processo.pk)
        return process_ids

    def _apply_kpi_response_filter(self, queryset, request):
        kpi_filter = self._parse_kpi_response_filter(request)
        if not kpi_filter:
            return queryset
        process_ids = self._build_kpi_response_process_ids(queryset, kpi_filter)
        if not process_ids:
            return queryset.none()
        return queryset.filter(pk__in=process_ids)

    def _parse_priority_kpi_filter(self, request):
        tag_id = self._safe_positive_int(request.GET.get('priority_kpi_tag_id'))
        if not tag_id:
            return None
        status = str(request.GET.get('priority_kpi_status') or 'all').strip().lower()
        if status not in {'all', 'analisado', 'pendente'}:
            status = 'all'
        uf_code = str(request.GET.get('priority_kpi_uf') or '').strip().upper()
        if uf_code in {'ALL', 'TODAS', 'TODAS AS UFS'}:
            uf_code = ''
        return {
            'tag_id': tag_id,
            'status': status,
            'uf_code': uf_code,
        }

    def _build_priority_kpi_process_ids(self, queryset, priority_filter):
        tag_id = priority_filter['tag_id']
        status = priority_filter['status']
        uf_code = priority_filter['uf_code']

        candidate_qs = queryset.filter(etiquetas__id=tag_id).distinct().select_related('analise_processo')
        if uf_code:
            candidate_qs = candidate_qs.filter(uf__iexact=uf_code)

        process_ids = set()
        for processo in candidate_qs.iterator():
            analisado = self._kpi_process_has_analysis_content(processo)
            if status == 'analisado' and not analisado:
                continue
            if status == 'pendente' and analisado:
                continue
            process_ids.add(int(processo.pk))
        return process_ids

    def _apply_priority_kpi_filter(self, queryset, request):
        priority_filter = self._parse_priority_kpi_filter(request)
        if not priority_filter:
            return queryset
        process_ids = self._build_priority_kpi_process_ids(queryset, priority_filter)
        if not process_ids:
            return queryset.none()
        return queryset.filter(pk__in=process_ids)

    def _normalize_filename_text(self, value):
        text = str(value or '').strip().lower()
        if not text:
            return ''
        text = unicodedata.normalize('NFKD', text)
        text = ''.join(ch for ch in text if not unicodedata.combining(ch))
        text = text.replace('_', ' ').replace('-', ' ')
        return re.sub(r'\s+', ' ', text).strip()

    def _classify_peticao_kind(self, nome, arquivo_nome):
        joined = f"{self._normalize_filename_text(nome)} {self._normalize_filename_text(arquivo_nome)}".strip()
        if not joined:
            return ''
        if 'monitoria inicial' in joined:
            return 'monitoria_inicial'
        if 'cobranca judicial' in joined:
            return 'cobranca_judicial'
        if 'habilitacao' in joined:
            return 'habilitacao'
        return ''

    def _parse_peticao_kpi_filter(self, request):
        tipo_slug = str(request.GET.get('peticao_tipo') or '').strip().lower()
        allowed = {'monitoria_inicial', 'cobranca_judicial', 'habilitacao'}
        if tipo_slug not in allowed:
            return None
        return {
            'tipo_slug': tipo_slug,
            'carteira_id': self._safe_positive_int(request.GET.get('peticao_carteira_id')),
        }

    def _build_peticao_kpi_process_ids(self, queryset, peticao_filter):
        candidate_qs = queryset
        carteira_id = peticao_filter.get('carteira_id')
        if carteira_id:
            candidate_qs = candidate_qs.filter(
                Q(carteira_id=carteira_id) | Q(carteiras_vinculadas__id=carteira_id)
            )

        candidate_ids = set(candidate_qs.values_list('id', flat=True).distinct())
        if not candidate_ids:
            return set()

        target_tipo = peticao_filter.get('tipo_slug')
        matched_ids = set()
        arquivo_rows = ProcessoArquivo.objects.filter(
            processo_id__in=candidate_ids
        ).values_list('processo_id', 'nome', 'arquivo')
        for processo_id, nome_arquivo, arquivo_path in arquivo_rows.iterator():
            tipo_slug = self._classify_peticao_kind(nome_arquivo, arquivo_path)
            if tipo_slug == target_tipo:
                matched_ids.add(int(processo_id))
        return matched_ids

    def _apply_peticao_kpi_filter(self, queryset, request):
        peticao_filter = self._parse_peticao_kpi_filter(request)
        if not peticao_filter:
            return queryset
        process_ids = self._build_peticao_kpi_process_ids(queryset, peticao_filter)
        if not process_ids:
            return queryset.none()
        return queryset.filter(pk__in=process_ids)

    def _build_changelist_context_badge(self, request):
        pair_ids = self._parse_intersection_pair_ids(request)
        if pair_ids:
            carteiras = {
                item['id']: item['nome']
                for item in Carteira.objects.filter(pk__in=pair_ids).values('id', 'nome')
            }
            nome_a = carteiras.get(pair_ids[0], f"Carteira {pair_ids[0]}")
            nome_b = carteiras.get(pair_ids[1], f"Carteira {pair_ids[1]}")
            return {
                'kind': 'intersection',
                'title': 'Interseção',
                'value': f'{nome_a} + {nome_b}',
                'subtitle': 'Lista filtrada por CPFs em comum.',
            }

        kpi_filter = self._parse_kpi_response_filter(request)
        if kpi_filter:
            carteira_nome = (
                Carteira.objects.filter(pk=kpi_filter['carteira_id'])
                .values_list('nome', flat=True)
                .first()
            ) or f"Carteira {kpi_filter['carteira_id']}"
            tipo_nome = (
                TipoAnaliseObjetiva.objects.filter(pk=kpi_filter['tipo_id'])
                .values_list('nome', flat=True)
                .first()
            ) or f"Tipo {kpi_filter['tipo_id']}"
            pergunta = (
                QuestaoAnalise.objects.filter(chave=kpi_filter['question_key'])
                .values_list('texto_pergunta', flat=True)
                .first()
            ) or kpi_filter['question_key']
            uf_label = kpi_filter['uf_code'] or 'Todas as UFs'
            return {
                'kind': 'kpi',
                'title': 'KPI',
                'value': f'{carteira_nome} · {tipo_nome}',
                'subtitle': f'{pergunta}: {kpi_filter["answer_value"]} ({uf_label})',
            }

        peticao_filter = self._parse_peticao_kpi_filter(request)
        if peticao_filter:
            tipo_label = {
                'monitoria_inicial': 'Monitória',
                'cobranca_judicial': 'Ação de Cobrança',
                'habilitacao': 'Habilitação',
            }.get(peticao_filter['tipo_slug'], peticao_filter['tipo_slug'])
            carteira_id = peticao_filter.get('carteira_id')
            if carteira_id:
                carteira_label = (
                    Carteira.objects.filter(pk=carteira_id)
                    .values_list('nome', flat=True)
                    .first()
                ) or f'Carteira {carteira_id}'
            else:
                carteira_label = 'Todas as carteiras'
            return {
                'kind': 'kpi',
                'title': 'KPI',
                'value': f'Peças geradas · {tipo_label}',
                'subtitle': carteira_label,
            }

        priority_filter = self._parse_priority_kpi_filter(request)
        if priority_filter:
            tag_id = priority_filter['tag_id']
            tag_nome = (
                Etiqueta.objects.filter(pk=tag_id)
                .values_list('nome', flat=True)
                .first()
            ) or f'Prioridade {tag_id}'
            status_label = {
                'all': 'Todos',
                'analisado': 'Analisados',
                'pendente': 'Pendentes',
            }.get(priority_filter['status'], 'Todos')
            uf_label = priority_filter['uf_code'] or 'Todas as UFs'
            return {
                'kind': 'kpi',
                'title': 'KPI',
                'value': f'Importados com Prioridade · {tag_nome}',
                'subtitle': f'{status_label} ({uf_label})',
            }

        carteira_id = self._get_filtered_carteira_id(request)
        if not carteira_id:
            return None

        carteira_nome = (
            Carteira.objects.filter(pk=carteira_id)
            .values_list('nome', flat=True)
            .first()
        )
        if not carteira_nome:
            return None

        return {
            'kind': 'carteira',
            'title': 'Carteira',
            'value': carteira_nome,
            'subtitle': 'Lista filtrada por carteira.',
            'carteira_id': carteira_id,
        }

    def get_actions(self, request):
        actions = super().get_actions(request)
        if not request.user.is_superuser and not is_user_supervisor(request.user):
            actions.pop('change_carteira_bulk', None)
        return actions

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

    def _extract_selected_carteira_ids(self, form, request=None):
        carteira_ids = set()
        selected = form.cleaned_data.get('carteiras_vinculadas')
        if selected is not None:
            if hasattr(selected, 'values_list'):
                carteira_ids.update({int(pk) for pk in selected.values_list('id', flat=True) if pk})
            else:
                for item in selected:
                    pk = getattr(item, 'id', item)
                    try:
                        carteira_ids.add(int(pk))
                    except (TypeError, ValueError):
                        continue

        # Fallback robusto: captura seleção enviada pelo POST (inclui widget customizado em JS).
        if request is not None and hasattr(request, 'POST'):
            for raw in request.POST.getlist('carteiras_vinculadas'):
                try:
                    carteira_ids.add(int(raw))
                except (TypeError, ValueError):
                    continue
            payload = (request.POST.get('carteiras_vinculadas_payload') or '').strip()
            if payload:
                for raw in payload.split(','):
                    try:
                        carteira_ids.add(int(raw))
                    except (TypeError, ValueError):
                        continue

        if hasattr(form, 'data') and hasattr(form.data, 'getlist'):
            for raw in form.data.getlist('carteiras_vinculadas'):
                try:
                    carteira_ids.add(int(raw))
                except (TypeError, ValueError):
                    continue
            payload = (form.data.get('carteiras_vinculadas_payload') or '').strip()
            if payload:
                for raw in payload.split(','):
                    try:
                        carteira_ids.add(int(raw))
                    except (TypeError, ValueError):
                        continue

        return carteira_ids

    def _apply_primary_carteira(self, obj, selected_carteira_ids):
        if not selected_carteira_ids:
            return
        if obj.carteira_id and obj.carteira_id in selected_carteira_ids:
            return
        obj.carteira_id = min(selected_carteira_ids)

    def _cnj_entry_key(self, cnj_value):
        normalized_digits = normalize_cnj_digits(cnj_value)
        if normalized_digits:
            return normalized_digits
        return str(cnj_value or '').strip().upper()

    def _sync_cnj_entries(self, processo, entries):
        existing_entries = list(processo.numeros_cnj.all())
        by_id = {item.pk: item for item in existing_entries}
        by_key = {}
        for item in existing_entries:
            key = self._cnj_entry_key(item.cnj)
            if key and key not in by_key:
                by_key[key] = item

        kept_ids = set()
        used_ids = set()

        for entry_data in entries or []:
            cnj_value = (entry_data.get('cnj') or '').strip()
            if not cnj_value:
                continue

            target = None
            entry_id = entry_data.get('id')
            try:
                entry_id = int(entry_id) if entry_id not in (None, '') else None
            except (TypeError, ValueError):
                entry_id = None

            if entry_id and entry_id in by_id and entry_id not in used_ids:
                target = by_id[entry_id]

            if not target:
                key = self._cnj_entry_key(cnj_value)
                candidate = by_key.get(key)
                if candidate and candidate.pk not in used_ids:
                    target = candidate

            if not target:
                target = ProcessoJudicialNumeroCnj(processo=processo)

            target.cnj = cnj_value
            target.uf = (entry_data.get('uf') or '').strip()
            target.valor_causa = self._decimal_from_string(entry_data.get('valor_causa'))
            target.status_id = entry_data.get('status')
            target.carteira_id = entry_data.get('carteira')
            target.vara = (entry_data.get('vara') or '').strip()
            target.tribunal = (entry_data.get('tribunal') or '').strip()
            target.save()

            kept_ids.add(target.pk)
            used_ids.add(target.pk)
            entry_data['id'] = target.pk

        stale_ids = [item.pk for item in existing_entries if item.pk not in kept_ids]
        if stale_ids:
            processo.numeros_cnj.filter(pk__in=stale_ids).delete()

        self._sync_processo_carteiras(processo, entries)

    def _sync_processo_carteiras(self, processo, entries):
        carteira_ids = set()
        if processo.carteira_id:
            carteira_ids.add(processo.carteira_id)
        for entry_data in entries or []:
            carteira_id = entry_data.get('carteira')
            if not carteira_id:
                continue
            try:
                carteira_ids.add(int(carteira_id))
            except (TypeError, ValueError):
                continue
        if carteira_ids:
            processo.carteiras_vinculadas.add(*carteira_ids)

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
        online_presence_config = {"enabled": False}
        if obj:
            extra_context['valuation_display'] = self.valor_causa_display(obj)
            cnj_entries = self._build_cnj_entries_context(obj)
            extra_context['cnj_entries_json'] = mark_safe(json.dumps(cnj_entries))
            extra_context['cnj_active_index'] = self._determine_active_index(cnj_entries, obj)
            active_idx = extra_context['cnj_active_index']
            extra_context['cnj_active_display'] = cnj_entries[active_idx]['cnj'] if cnj_entries and 0 <= active_idx < len(cnj_entries) else (obj.cnj or '')
            if request.method == 'GET':
                linked_ids = list(obj.carteiras_vinculadas.values_list('id', flat=True))
            else:
                linked_ids = []
            extra_context['carteiras_vinculadas_ids_json'] = mark_safe(json.dumps(linked_ids))
            if is_online_presence_enabled() and request.user.is_authenticated:
                settings_map = get_presence_settings()
                carteira_nome = str(getattr(getattr(obj, 'carteira', None), 'nome', '') or '').strip()
                processo_label = str(obj.cnj or '').strip() or f"Cadastro #{obj.pk}"
                token_payload = {
                    "uid": int(request.user.pk),
                    "pid": int(obj.pk),
                    "processo_label": processo_label,
                    "carteira_id": int(obj.carteira_id or 0),
                    "carteira_label": carteira_nome,
                }
                online_presence_config = {
                    "enabled": True,
                    "endpoint_url": reverse('admin:processo_online_presence_heartbeat', args=[obj.pk]),
                    "heartbeat_seconds": int(settings_map["heartbeat_seconds"]),
                    "token": signing.dumps(token_payload, salt=ONLINE_PRESENCE_TOKEN_SALT),
                }
        else:
            extra_context['cnj_entries_json'] = mark_safe(json.dumps([]))
            extra_context['cnj_active_index'] = 0
            extra_context['cnj_active_display'] = ''
            extra_context['carteiras_vinculadas_ids_json'] = mark_safe(json.dumps([]))
        extra_context['online_presence_config_json'] = mark_safe(json.dumps(online_presence_config))
        
        # Preserva os filtros da changelist para a navegação:
        # 1) _changelist_filters (padrão admin), 2) query direta,
        # 3) referer da changelist, 4) últimos filtros salvos em sessão.
        # Também força ord_prescricao=incluir quando o contexto efetivo for Passivas.
        changelist_filters = self._extract_changelist_filters_for_navigation(request)

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
        
        # Calcula anterior/próximo respeitando os filtros e a ordenação da changelist.
        prev_obj_id = None
        next_obj_id = None
        if obj:
            try:
                ordering = changelist.get_ordering(request, queryset)
            except Exception:
                ordering = None

            if isinstance(ordering, (list, tuple)):
                ordering_fields = list(ordering)
            elif isinstance(ordering, str):
                ordering_fields = [ordering]
            else:
                ordering_fields = []
            if not ordering_fields:
                ordering_fields = ['-pk']

            # Otimização para ordenação simples por pk
            if ordering_fields and all(field in ('pk', '-pk') for field in ordering_fields):
                primary_order = ordering_fields[0]
                if primary_order == '-pk':
                    prev_obj = queryset.filter(pk__gt=obj.pk).order_by('pk').first()
                    next_obj = queryset.filter(pk__lt=obj.pk).order_by('-pk').first()
                else:
                    prev_obj = queryset.filter(pk__lt=obj.pk).order_by('-pk').first()
                    next_obj = queryset.filter(pk__gt=obj.pk).order_by('pk').first()
                prev_obj_id = prev_obj.pk if prev_obj else None
                next_obj_id = next_obj.pk if next_obj else None
            else:
                # Ordem arbitrária: usa RowNumber() window para localizar a posição do objeto no "lote".
                order_by_exprs = []
                for field in ordering_fields:
                    if not field:
                        continue
                    if isinstance(field, str):
                        if field.startswith('-'):
                            order_by_exprs.append(models.F(field[1:]).desc())
                        else:
                            order_by_exprs.append(models.F(field).asc())
                # Tiebreaker estável
                if not any(isinstance(f, str) and f.lstrip('-') == 'pk' for f in ordering_fields):
                    order_by_exprs.append(models.F('pk').asc())

                qs_ranked = queryset.annotate(
                    _nav_rn=Window(
                        expression=RowNumber(),
                        order_by=order_by_exprs,
                    )
                )
                current_rn = qs_ranked.filter(pk=obj.pk).values_list('_nav_rn', flat=True).first()
                if current_rn:
                    prev_obj_id = qs_ranked.filter(_nav_rn=current_rn - 1).values_list('pk', flat=True).first()
                    next_obj_id = qs_ranked.filter(_nav_rn=current_rn + 1).values_list('pk', flat=True).first()

        # Monta as URLs preservando os filtros (via _changelist_filters, do jeito padrão do admin).
        base_url = reverse('admin:contratos_processojudicial_changelist') + "{}"
        if changelist_filters:
            filter_params = f"?_changelist_filters={quote(changelist_filters, safe='')}"
        else:
            filter_params = ""

        extra_context['prev_obj_url'] = base_url.format(f'{prev_obj_id}/change/{filter_params}') if prev_obj_id else None
        extra_context['next_obj_url'] = base_url.format(f'{next_obj_id}/change/{filter_params}') if next_obj_id else None
        if changelist_filters and not next_obj_id:
            extra_context['nav_end_message'] = (
                "Fim da demanda filtrada: não há próximo cadastro neste lote. "
                "Volte à lista e aplique um novo filtro."
            )
        extra_context['delegar_users'] = User.objects.order_by('username')
        extra_context['is_supervisor'] = is_user_supervisor(request.user)
        extra_context['tipos_peticao_api_url'] = reverse('admin:contratos_documentomodelo_tipos_peticao')
        extra_context['tipos_peticao_preview_url'] = reverse('admin:contratos_documentomodelo_tipos_peticao_preview')
        extra_context['tipos_peticao_generate_url'] = reverse('admin:contratos_documentomodelo_tipos_peticao_generate')
        extra_context['csrf_token'] = get_token(request)
        
        return super().change_view(request, object_id, form_url, extra_context=extra_context)

    def _resolve_cnj_entry_from_ref(self, ref_value, by_id, by_key):
        raw = str(ref_value or '').strip()
        if not raw:
            return None
        if raw.startswith('id:'):
            try:
                return by_id.get(int(raw.split(':', 1)[1]))
            except (TypeError, ValueError):
                return None
        if raw.startswith('cnj:'):
            return by_key.get(self._cnj_entry_key(raw.split(':', 1)[1]))
        try:
            return by_id.get(int(raw))
        except (TypeError, ValueError):
            return by_key.get(self._cnj_entry_key(raw))

    def _build_cnj_resolution_context(self, request, processo):
        if not processo or not processo.pk:
            return None

        by_id = {}
        by_key = {}
        for entry in processo.numeros_cnj.all():
            by_id[entry.pk] = entry
            key = self._cnj_entry_key(entry.cnj)
            if key and key not in by_key:
                by_key[key] = entry

        if not by_id:
            return None

        active_entry_obj = None
        entries_payload = request.POST.get('cnj_entries_data')
        if entries_payload:
            parsed_entries = self._parse_cnj_entries(entries_payload)
            try:
                active_index = int(request.POST.get('cnj_active_index'))
            except (TypeError, ValueError):
                active_index = None
            active_entry_payload = self._get_active_entry(parsed_entries, active_index)
            if active_entry_payload:
                active_entry_obj = self._resolve_cnj_entry_from_ref(
                    f"id:{active_entry_payload.get('id')}" if active_entry_payload.get('id') else '',
                    by_id,
                    by_key,
                )
                if not active_entry_obj:
                    active_entry_obj = self._resolve_cnj_entry_from_ref(
                        f"cnj:{active_entry_payload.get('cnj')}",
                        by_id,
                        by_key,
                    )

        if not active_entry_obj and processo.cnj:
            active_entry_obj = by_key.get(self._cnj_entry_key(processo.cnj))
        if not active_entry_obj:
            active_entry_obj = processo.numeros_cnj.order_by('-criado_em', '-id').first() or next(iter(by_id.values()))

        return {"by_id": by_id, "by_key": by_key, "active": active_entry_obj}

    def _assign_inline_numero_cnj(self, request, formset, processo):
        context = self._build_cnj_resolution_context(request, processo)
        if not context:
            return

        by_id = context["by_id"]
        by_key = context["by_key"]
        active_entry = context["active"]

        for inline_form in formset.forms:
            cleaned = getattr(inline_form, 'cleaned_data', None)
            if not cleaned or cleaned.get('DELETE'):
                continue

            current_entry = cleaned.get('numero_cnj')
            if current_entry and getattr(current_entry, 'id', None) in by_id:
                continue

            ref_field_name = f'{inline_form.prefix}-numero_cnj_ref'
            ref_value = request.POST.get(ref_field_name)
            resolved = self._resolve_cnj_entry_from_ref(ref_value, by_id, by_key)
            if not resolved and current_entry:
                resolved = by_key.get(self._cnj_entry_key(getattr(current_entry, 'cnj', '')))
            if not resolved:
                resolved = active_entry
            if not resolved:
                continue

            cleaned['numero_cnj'] = resolved
            inline_form.instance.numero_cnj = resolved

    def _save_tarefa_formset_with_audit(self, request, formset):
        instances = formset.save(commit=False)
        for obj in formset.deleted_objects:
            obj.delete()

        existing_ids = [instance.pk for instance in instances if instance.pk]
        previous_state = {}
        if existing_ids:
            for row in Tarefa.objects.filter(pk__in=existing_ids).values(
                "id",
                "concluida",
                "concluido_em",
                "concluido_por_id",
            ):
                previous_state[int(row["id"])] = row

        now = timezone.now()
        for instance in instances:
            previous = previous_state.get(int(instance.pk)) if instance.pk else None
            was_concluded = bool(previous.get("concluida")) if previous else False
            is_new = instance.pk is None

            if is_new and not instance.criado_por_id:
                instance.criado_por = request.user

            is_concluded = bool(instance.concluida)
            if is_concluded:
                if not was_concluded:
                    if not instance.concluido_em:
                        instance.concluido_em = now
                    if not instance.concluido_por_id:
                        instance.concluido_por = request.user
                else:
                    if not instance.concluido_em:
                        instance.concluido_em = previous.get("concluido_em") or now
                    if not instance.concluido_por_id:
                        previous_user_id = previous.get("concluido_por_id")
                        if previous_user_id:
                            instance.concluido_por_id = int(previous_user_id)
                        else:
                            instance.concluido_por = request.user
            else:
                instance.concluido_em = None
                instance.concluido_por = None

            instance.save()

        formset.save_m2m()

    def _save_prazo_formset_with_audit(self, request, formset):
        instances = formset.save(commit=False)
        for obj in formset.deleted_objects:
            obj.delete()

        existing_ids = [instance.pk for instance in instances if instance.pk]
        previous_state = {}
        if existing_ids:
            for row in Prazo.objects.filter(pk__in=existing_ids).values(
                "id",
                "concluido",
                "concluido_em",
                "concluido_por_id",
            ):
                previous_state[int(row["id"])] = row

        now = timezone.now()
        for instance in instances:
            previous = previous_state.get(int(instance.pk)) if instance.pk else None
            was_concluded = bool(previous.get("concluido")) if previous else False
            is_new = instance.pk is None

            if is_new and not instance.criado_por_id:
                instance.criado_por = request.user

            is_concluded = bool(instance.concluido)
            if is_concluded:
                if not was_concluded:
                    if not instance.concluido_em:
                        instance.concluido_em = now
                    if not instance.concluido_por_id:
                        instance.concluido_por = request.user
                else:
                    if not instance.concluido_em:
                        instance.concluido_em = previous.get("concluido_em") or now
                    if not instance.concluido_por_id:
                        previous_user_id = previous.get("concluido_por_id")
                        if previous_user_id:
                            instance.concluido_por_id = int(previous_user_id)
                        else:
                            instance.concluido_por = request.user
            else:
                instance.concluido_em = None
                instance.concluido_por = None

            instance.save()

        formset.save_m2m()


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
        elif formset.model == Parte:
            self._assign_inline_numero_cnj(request, formset, form.instance)
            return super().save_formset(request, form, formset, change)
        elif formset.model == AndamentoProcessual:
            from contratos.integracoes_escavador.parser import remover_andamentos_duplicados

            self._assign_inline_numero_cnj(request, formset, form.instance)
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
                numero_cnj_obj = cleaned.get('numero_cnj')
                numero_cnj_id = getattr(numero_cnj_obj, 'id', None)
                chave = (numero_cnj_id, data, descricao)
                if chave in seen_keys:
                    cleaned['DELETE'] = True
                else:
                    seen_keys.add(chave)

            return super().save_formset(request, form, formset, change)
        elif formset.model == Tarefa:
            return self._save_tarefa_formset_with_audit(request, formset)
        elif formset.model == Prazo:
            return self._save_prazo_formset_with_audit(request, formset)
        else:
            super().save_formset(request, form, formset, change)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        obj = form.instance
        # Baseia-se no estado já persistido pelo próprio form do Django (M2M)
        # e apenas complementa com payloads/fallbacks do widget customizado.
        persisted_after_super = set(obj.carteiras_vinculadas.values_list('id', flat=True))
        carteira_ids = set(persisted_after_super)
        snapshot_ids = getattr(obj, '_selected_carteira_ids_snapshot', None)
        if snapshot_ids:
            carteira_ids.update(snapshot_ids)
        extracted_ids = self._extract_selected_carteira_ids(form, request=request)
        carteira_ids.update(
            extracted_ids
        )
        numero_carteiras = set(
            obj.numeros_cnj.exclude(carteira_id__isnull=True).values_list('carteira_id', flat=True)
        )
        if obj.carteira_id:
            carteira_ids.add(obj.carteira_id)
        carteira_ids.update(numero_carteiras)
        if carteira_ids:
            obj.carteiras_vinculadas.set(sorted(carteira_ids))
            if not obj.carteira_id:
                obj.carteira_id = min(carteira_ids)
                obj.save(update_fields=['carteira'])
        else:
            obj.carteiras_vinculadas.clear()
        if hasattr(obj, '_selected_carteira_ids_snapshot'):
            delattr(obj, '_selected_carteira_ids_snapshot')


    def changelist_view(self, request, extra_context=None):
        if not is_user_supervisor(request.user) and request.GET.get('para_supervisionar'):
            params = request.GET.copy()
            params.pop('para_supervisionar', None)
            clean_url = request.path
            if params:
                clean_url = f"{clean_url}?{params.urlencode()}"
            return HttpResponseRedirect(clean_url)
        show_counts_redirect = self._normalize_show_counts_param(request)
        if show_counts_redirect:
            return show_counts_redirect
        redirect = self._handle_saved_filters(request)
        if redirect:
            return redirect
        passivas_redirect = self._ensure_passivas_include_prescritos(request)
        if passivas_redirect:
            return passivas_redirect
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
        badge = self._build_changelist_context_badge(request)
        extra_context['changelist_context_badge'] = badge
        if badge and badge.get('kind') == 'carteira':
            extra_context['changelist_carteira_options'] = list(
                Carteira.objects.order_by('nome').values('id', 'nome')
            )
        else:
            extra_context['changelist_carteira_options'] = []

        return super().changelist_view(request, extra_context=extra_context)

    class Media:
        css = {
            'all': (
                'admin/css/admin_tabs.css',
                'admin/css/custom_admin_styles.css?v=20260220a',
                'admin/css/cia_button.css',
                'admin/css/endereco_widget.css',  # <--- Adicionado
            )
        }
        js = (
            'admin/js/vendor/jquery/jquery.min.js',
            'admin/js/jquery.init.js',
            'admin/js/processo_judicial_enhancer.js?v=20260217c',
            'admin/js/processo_online_presence.js?v=20260218a',
            'admin/js/admin_tabs.js',
            'admin/js/processo_judicial_lazy_loader.js?v=20260217c',
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
            path('etiquetas/bulk/', self.admin_site.admin_view(self.etiquetas_bulk_view), name='processo_etiquetas_bulk'),
            path('<path:object_id>/checagem-sistemas/', self.admin_site.admin_view(self.checagem_sistemas_view), name='processo_checagem_sistemas'),
            path('<path:object_id>/online-presence/', self.admin_site.admin_view(self.online_presence_heartbeat_view), name='processo_online_presence_heartbeat'),
            path('etiquetas/criar/', self.admin_site.admin_view(self.criar_etiqueta_view), name='etiqueta_criar'),
            path('delegate-select-user/', self.admin_site.admin_view(self.delegate_select_user_view), name='processo_delegate_select_user'), # NEW PATH
            path('delegate-bulk/', self.admin_site.admin_view(self.delegate_bulk_view), name='processo_delegate_bulk'),
            path('<path:object_id>/atualizar-andamentos/', self.admin_site.admin_view(self.atualizar_andamentos_view), name='processo_atualizar_andamentos'),
            path('<path:object_id>/remover-andamentos-duplicados/', self.admin_site.admin_view(self.remover_andamentos_duplicados_view), name='processo_remover_andamentos_duplicados'),
            path('<path:object_id>/delegar-inline/', self.admin_site.admin_view(self.delegar_inline_view), name='processo_delegate_inline'),
            path('parte/<int:parte_id>/obito-info/', self.admin_site.admin_view(self.obito_info_view), name='parte_obito_info'),
        ]
        return custom_urls + urls

    def online_presence_heartbeat_view(self, request, object_id):
        if request.method != 'POST':
            return JsonResponse({'error': 'Método não permitido.'}, status=405)
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Não autenticado.'}, status=401)
        if not is_online_presence_enabled():
            return JsonResponse({'enabled': False, 'saved': False}, status=503)

        try:
            payload = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Payload inválido.'}, status=400)

        token = str(payload.get('token') or '').strip()
        tab_id = str(payload.get('tab_id') or '').strip()
        if not token or not tab_id:
            return JsonResponse({'error': 'Token e tab_id são obrigatórios.'}, status=400)

        try:
            token_data = signing.loads(
                token,
                salt=ONLINE_PRESENCE_TOKEN_SALT,
                max_age=60 * 60 * 12,
            )
        except signing.SignatureExpired:
            return JsonResponse({'error': 'Token expirado.'}, status=400)
        except signing.BadSignature:
            return JsonResponse({'error': 'Token inválido.'}, status=400)

        token_user_id = int(token_data.get('uid') or 0)
        token_processo_id = int(token_data.get('pid') or 0)
        if token_user_id != int(request.user.pk):
            return JsonResponse({'error': 'Token não pertence ao usuário.'}, status=403)

        try:
            route_object_id = int(object_id)
        except (TypeError, ValueError):
            return JsonResponse({'error': 'Cadastro inválido.'}, status=400)
        if token_processo_id != route_object_id:
            return JsonResponse({'error': 'Token não corresponde ao cadastro.'}, status=400)

        if request.session.session_key is None:
            request.session.save()
        session_key = request.session.session_key or ''

        heartbeat_path = str(payload.get('path') or request.path).strip()
        visible = bool(payload.get('visible', True))
        try:
            last_interaction_ts = int(payload.get('last_interaction_ts'))
        except (TypeError, ValueError):
            last_interaction_ts = None

        user_label = request.user.get_full_name() or request.user.username or f'Usuário {request.user.pk}'
        processo_label = str(token_data.get('processo_label') or '').strip() or f'Cadastro #{route_object_id}'
        carteira_id = int(token_data.get('carteira_id') or 0)
        carteira_label = str(token_data.get('carteira_label') or '').strip()
        saved = record_online_presence(
            user_id=int(request.user.pk),
            user_label=user_label,
            session_key=session_key,
            tab_id=tab_id,
            processo_id=route_object_id,
            processo_label=processo_label,
            carteira_id=carteira_id,
            carteira_label=carteira_label,
            current_path=heartbeat_path,
            is_visible=visible,
            last_interaction_ts=last_interaction_ts,
        )
        return JsonResponse({'enabled': True, 'saved': bool(saved)})

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

    def etiquetas_bulk_view(self, request):
        if not self.has_change_permission(request):
            return JsonResponse({'error': 'Permissão negada.'}, status=403)

        def _parse_ids(value):
            if value is None:
                return []
            if isinstance(value, str):
                value = value.strip()
                if not value:
                    return []
                value = value.split(',')
            if not isinstance(value, (list, tuple)):
                value = [value]
            ids = []
            for item in value:
                try:
                    ids.append(int(item))
                except (TypeError, ValueError):
                    continue
            return ids

        if request.method == 'GET':
            ids_raw = request.GET.get('ids')
            pk_list = _parse_ids(ids_raw)
            if not pk_list:
                return JsonResponse({'error': 'Nenhum processo selecionado.'}, status=400)
            processos = ProcessoJudicial.objects.filter(pk__in=pk_list)
            if processos.count() != len(pk_list):
                return JsonResponse({'error': 'Um ou mais processos não foram encontrados.'}, status=400)

            todas_etiquetas = list(Etiqueta.objects.order_by('ordem', 'nome').values('id', 'nome', 'cor_fundo', 'cor_fonte'))
            etiquetas_ids = None
            for processo in processos:
                ids_set = set(processo.etiquetas.values_list('id', flat=True))
                etiquetas_ids = ids_set if etiquetas_ids is None else (etiquetas_ids & ids_set)
            etiquetas_ids = etiquetas_ids or set()
            etiquetas_processo = list(Etiqueta.objects.filter(id__in=etiquetas_ids).values('id', 'nome', 'cor_fundo', 'cor_fonte'))
            return JsonResponse({'todas_etiquetas': todas_etiquetas, 'etiquetas_processo': etiquetas_processo})

        if request.method != 'POST':
            return JsonResponse({'error': 'Método não permitido'}, status=405)

        try:
            data = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Dados inválidos.'}, status=400)

        pk_list = _parse_ids(data.get('ids'))
        etiqueta_id = data.get('etiqueta_id')
        action = data.get('action')
        if not pk_list:
            return JsonResponse({'error': 'Nenhum processo selecionado.'}, status=400)
        if not etiqueta_id:
            return JsonResponse({'error': 'Etiqueta inválida.'}, status=400)
        etiqueta = get_object_or_404(Etiqueta, pk=etiqueta_id)
        processos = ProcessoJudicial.objects.filter(pk__in=pk_list)
        if action == 'add':
            etiqueta.processojudicial_set.add(*processos)
            return JsonResponse({'status': 'added', 'updated': processos.count()})
        if action == 'remove':
            etiqueta.processojudicial_set.remove(*processos)
            return JsonResponse({'status': 'removed', 'updated': processos.count()})
        return JsonResponse({'error': 'Ação inválida.'}, status=400)

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

    def change_carteira_bulk(self, request, queryset):
        if not request.user.is_superuser and not is_user_supervisor(request.user):
            self.message_user(request, "Ação disponível apenas para Supervisor.", messages.ERROR)
            return None

        selected_ids = request.POST.getlist(ACTION_CHECKBOX_NAME)

        if request.method == 'POST' and request.POST.get('apply'):
            form = CarteiraBulkForm(request.POST)
            if form.is_valid():
                carteira = form.cleaned_data.get('carteira')
                updated = queryset.update(carteira=carteira)
                if carteira:
                    for processo in queryset.only('id'):
                        processo.carteiras_vinculadas.add(carteira)
                carteira_label = carteira.nome if carteira else "Sem carteira"
                self.message_user(
                    request,
                    f"{updated} cadastro(s) atualizado(s) para a carteira: {carteira_label}.",
                    messages.SUCCESS,
                )
                return HttpResponseRedirect(request.get_full_path())
        else:
            form = CarteiraBulkForm()

        context = {
            'title': 'Alterar carteira (em lote)',
            'form': form,
            'opts': self.model._meta,
            'app_label': self.model._meta.app_label,
            'action_name': 'change_carteira_bulk',
            'selected_ids': selected_ids,
            'media': self.media,
        }
        return render(request, 'admin/contratos/processojudicial/change_carteira_bulk.html', context)
    change_carteira_bulk.short_description = "Alterar carteira (Supervisor)"

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "status":
            kwargs["queryset"] = StatusProcessual.objects.filter(ativo=True, ordem__gte=0)
        if db_field.name == 'carteira' and request and request.user and not request.user.is_superuser:
            allowed = get_user_allowed_carteira_ids(request.user)
            if allowed:
                kwargs['queryset'] = Carteira.objects.filter(id__in=allowed).order_by('nome')
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        if db_field.name == 'carteiras_vinculadas' and request and request.user and not request.user.is_superuser:
            allowed = get_user_allowed_carteira_ids(request.user)
            if allowed:
                kwargs['queryset'] = Carteira.objects.filter(id__in=allowed).order_by('nome')
        return super().formfield_for_manytomany(db_field, request, **kwargs)

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

@admin.register(TipoAnaliseObjetiva)
class TipoAnaliseObjetivaAdmin(admin.ModelAdmin):
    list_display = ('nome', 'slug', 'hashtag', 'ativo', 'versao', 'atualizado_em', 'atualizado_por')
    list_filter = ('ativo',)
    search_fields = ('nome', 'slug', 'hashtag')
    list_editable = ('ativo',)
    readonly_fields = ('versao', 'criado_em', 'atualizado_em', 'atualizado_por')
    fields = ('nome', 'slug', 'hashtag', 'ativo', 'versao', 'criado_em', 'atualizado_em', 'atualizado_por')

    def _allowed(self, request):
        user = getattr(request, 'user', None)
        if not user or not getattr(user, 'pk', None):
            return False
        if user.is_superuser or is_user_supervisor(user):
            return True
        return user.has_perms({
            'contratos.view_tipoanaliseobjetiva',
            'contratos.add_tipoanaliseobjetiva',
            'contratos.change_tipoanaliseobjetiva',
            'contratos.delete_tipoanaliseobjetiva',
        })

    def has_module_permission(self, request):
        return self._allowed(request)

    def has_view_permission(self, request, obj=None):
        return self._allowed(request)

    def has_add_permission(self, request):
        return self._allowed(request)

    def has_change_permission(self, request, obj=None):
        return self._allowed(request)

    def has_delete_permission(self, request, obj=None):
        return self._allowed(request)

    def save_model(self, request, obj, form, change):
        obj.atualizado_por = request.user
        super().save_model(request, obj, form, change)
        if change and form.changed_data:
            obj.bump_version(user=request.user)

@admin.register(QuestaoAnalise) # Referência por string
class QuestaoAnaliseAdmin(admin.ModelAdmin):
    list_display = ('texto_pergunta', 'chave', 'tipo_analise', 'tipo_campo', 'ativo', 'is_primeira_questao', 'ordem')
    list_filter = ('tipo_analise', 'tipo_campo', 'ativo', 'is_primeira_questao')
    search_fields = ('texto_pergunta', 'chave', 'tipo_analise__nome')
    list_editable = ('ativo', 'is_primeira_questao', 'ordem')
    inlines = [OpcaoRespostaInline]
    
    fieldsets = (
        (None, {
            "fields": ('tipo_analise', 'texto_pergunta', 'chave', 'tipo_campo', 'ordem', 'ativo')
        }),
        ("Ponto de Partida", {
            "classes": ('collapse',),
            "fields": ('is_primeira_questao',),
            "description": "Marque esta opção para definir esta questão como o início da análise. Só deve haver uma."
        }),
    )

    def _allowed(self, request):
        user = getattr(request, 'user', None)
        if not user or not getattr(user, 'pk', None):
            return False
        if user.is_superuser or is_user_supervisor(user):
            return True
        return user.has_perms({
            'contratos.view_questaoanalise',
            'contratos.add_questaoanalise',
            'contratos.change_questaoanalise',
            'contratos.delete_questaoanalise',
        })

    def has_module_permission(self, request):
        return self._allowed(request)

    def has_view_permission(self, request, obj=None):
        return self._allowed(request)

    def has_add_permission(self, request):
        return self._allowed(request)

    def has_change_permission(self, request, obj=None):
        return self._allowed(request)

    def has_delete_permission(self, request, obj=None):
        return self._allowed(request)

    def save_model(self, request, obj, form, change):
        if obj.tipo_analise_id and not (obj.chave or '').strip():
            base = normalize_label_title(obj.tipo_analise.slug or obj.tipo_analise.nome or 'tipo')
            base_slug = re.sub(r'[^a-z0-9]+', '-', (base or '').lower()).strip('-')[:18] or 'tipo'
            question_slug = re.sub(r'[^a-z0-9]+', '-', (obj.texto_pergunta or '').lower()).strip('-')[:24] or 'pergunta'
            candidate = f"{base_slug}-{question_slug}"[:50].strip('-')
            if not candidate:
                candidate = f"tipo-{obj.tipo_analise_id}"
            unique = candidate
            counter = 2
            while QuestaoAnalise.objects.filter(chave=unique).exclude(pk=obj.pk).exists():
                suffix = f"-{counter}"
                unique = (candidate[: max(1, 50 - len(suffix))] + suffix).strip('-')
                counter += 1
            obj.chave = unique

        super().save_model(request, obj, form, change)
        if obj.is_primeira_questao and obj.tipo_analise_id:
            QuestaoAnalise.objects.filter(
                tipo_analise_id=obj.tipo_analise_id,
                is_primeira_questao=True,
            ).exclude(pk=obj.pk).update(is_primeira_questao=False)
        elif obj.tipo_analise_id:
            has_any_first = QuestaoAnalise.objects.filter(
                tipo_analise_id=obj.tipo_analise_id,
                is_primeira_questao=True,
                ativo=True,
            ).exists()
            if not has_any_first:
                QuestaoAnalise.objects.filter(pk=obj.pk).update(is_primeira_questao=True)

        if obj.tipo_analise_id and (not change or form.changed_data):
            try:
                obj.tipo_analise.bump_version(user=request.user)
            except Exception:
                pass

    def save_formset(self, request, form, formset, change):
        sequence_repaired = False
        try:
            with transaction.atomic():
                super().save_formset(request, form, formset, change)
        except IntegrityError as exc:
            if not self._is_opcaoresposta_pk_sequence_conflict(formset, exc):
                raise
            sequence_repaired = self._repair_model_pk_sequence(OpcaoResposta)
            with transaction.atomic():
                super().save_formset(request, form, formset, change)
            if sequence_repaired:
                messages.warning(
                    request,
                    "Sequência de IDs de Opções de Resposta estava desajustada e foi corrigida automaticamente.",
                )
        try:
            instance = form.instance
            tipo = getattr(instance, 'tipo_analise', None)
            if not tipo:
                return
            has_inline_changes = bool(
                getattr(formset, 'new_objects', None)
                or getattr(formset, 'changed_objects', None)
                or getattr(formset, 'deleted_objects', None)
            )
            if has_inline_changes:
                tipo.bump_version(user=request.user)
        except Exception:
            return

    def _is_opcaoresposta_pk_sequence_conflict(self, formset, exc):
        if getattr(formset, 'model', None) is not OpcaoResposta:
            return False
        message = str(exc or "")
        message_lower = message.lower()
        return (
            "contratos_opcaoresposta_pkey" in message_lower
            and "duplicate key value violates unique constraint" in message_lower
        )

    def _repair_model_pk_sequence(self, model_cls):
        sql_statements = connection.ops.sequence_reset_sql(no_style(), [model_cls]) or []
        if not sql_statements:
            return False
        with connection.cursor() as cursor:
            for sql in sql_statements:
                cursor.execute(sql)
        return True

    def get_changeform_initial_data(self, request):
        initial = super().get_changeform_initial_data(request)
        if request.GET.get('tipo_analise'):
            initial['tipo_analise'] = request.GET.get('tipo_analise')
        for key in ('ativo', 'ordem'):
            if key in request.GET:
                initial[key] = request.GET.get(key)
        if request.GET.get('is_primeira_questao') in ('1', 'true', 'True', 'on', 'SIM', 'sim'):
            initial['is_primeira_questao'] = True
        return initial

    def delete_model(self, request, obj):
        tipo = getattr(obj, 'tipo_analise', None)
        super().delete_model(request, obj)
        if tipo:
            try:
                tipo.bump_version(user=request.user)
            except Exception:
                pass

@admin.register(OpcaoResposta) # Referência por string
class OpcaoRespostaAdmin(admin.ModelAdmin):
    list_display = ('questao_origem', 'texto_resposta', 'proxima_questao', 'ativo')
    list_filter = ('ativo', 'questao_origem__tipo_analise')
    list_editable = ('ativo',)

    def _allowed(self, request):
        user = getattr(request, 'user', None)
        if not user or not getattr(user, 'pk', None):
            return False
        if user.is_superuser or is_user_supervisor(user):
            return True
        return user.has_perms({
            'contratos.view_opcaoresposta',
            'contratos.add_opcaoresposta',
            'contratos.change_opcaoresposta',
            'contratos.delete_opcaoresposta',
        })

    def has_module_permission(self, request):
        return self._allowed(request)

    def has_view_permission(self, request, obj=None):
        return self._allowed(request)

    def has_add_permission(self, request):
        return self._allowed(request)

    def has_change_permission(self, request, obj=None):
        return self._allowed(request)

    def has_delete_permission(self, request, obj=None):
        return self._allowed(request)

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        tipo = getattr(obj.questao_origem, 'tipo_analise', None)
        if tipo and (not change or form.changed_data):
            try:
                tipo.bump_version(user=request.user)
            except Exception:
                pass

    def delete_model(self, request, obj):
        tipo = getattr(obj.questao_origem, 'tipo_analise', None)
        super().delete_model(request, obj)
        if tipo:
            try:
                tipo.bump_version(user=request.user)
            except Exception:
                pass
        
