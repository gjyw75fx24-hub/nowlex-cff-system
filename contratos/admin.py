from django.contrib import admin
from django.contrib.admin import SimpleListFilter
admin.site.site_header = "CFF SYSTEM"
admin.site.site_title = "Home"
admin.site.index_title = "Bem-vindo à Administração"

from django.utils.safestring import mark_safe
from django import forms
from django.db import models
from django.db import models  # Certifique-se que esse import esteja presente

class TerceiroInteressadoFilter(SimpleListFilter):
    title = "⚠️ Terceiro Interessado"
    parameter_name = "terceiro_interessado"

    def lookups(self, request, model_admin):
        return [
            ("sim", "Com terceiro interessado"),
            ("nao", "Apenas dois polos"),
        ]

    def queryset(self, request, queryset):
        if self.value() == "sim":
            return queryset.annotate(num_partes=models.Count("partes_processuais")).filter(num_partes__gt=2)
        if self.value() == "nao":
            return queryset.annotate(num_partes=models.Count("partes_processuais")).filter(num_partes__lte=2)
        return queryset

from django.urls import reverse
from .models import ProcessoJudicial, Parte, Contrato, StatusProcessual, AndamentoProcessual
from django import forms
from .models import ProcessoJudicial

class ProcessoJudicialForm(forms.ModelForm):
    class Meta:
        model = ProcessoJudicial
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["uf"].widget.attrs.update({
            "id": "id_uf",
            "style": "width: 60px;",
        })


# ──────────────────────────────────────────
# Inlines
# ──────────────────────────────────────────
class AndamentoInline(admin.TabularInline):
    model = AndamentoProcessual
    extra = 0
    readonly_fields = ('data',)
    can_delete = True
    ordering = ('-data',)
    classes = ('dynamic-andamento',)

    formfield_overrides = {
        models.TextField: {"widget": forms.Textarea(attrs={"rows": 2, "cols": 100})},
    }


class ParteInline(admin.StackedInline):
    model = Parte
    extra = 1
    fk_name = "processo"
    classes = ('dynamic-partes',)
    can_delete = True
    fieldsets = (
        (None, {
            "fields": (
                ("tipo_polo", "nome"),
                ("tipo_pessoa", "documento"),
                "endereco",
            )
        }),
    )
    formfield_overrides = {
        models.TextField: {"widget": forms.Textarea(attrs={"rows": 4, "cols": 80})},
    }


class ContratoInline(admin.StackedInline):
    model = Contrato
    extra = 1
    fk_name = "processo"


# ──────────────────────────────────────────
# Admin principal
# ──────────────────────────────────────────
@admin.register(ProcessoJudicial)
class ProcessoJudicialAdmin(admin.ModelAdmin):
    form = ProcessoJudicialForm  # ✅ vincula o form real
    list_display = ("cnj", "get_polo_ativo", "get_x_separator", "get_polo_passivo", "uf", "status", "busca_ativa")
    list_filter = ["busca_ativa", "status", "uf", TerceiroInteressadoFilter]
    search_fields = ("cnj", "partes_processuais__nome",)
    inlines = [ParteInline, ContratoInline, AndamentoInline]
    readonly_fields = ("cnj_busca_online_display",)

    fieldsets = (
        ("Controle e Status", {
            "fields": (
                "status",
                "busca_ativa",
            )
        }),
        ("Dados do Processo", {
            "fields": (
                "cnj",
                "cnj_busca_online_display",
                "uf",  # ✅ Agora é real e salvável
                "vara",
                "tribunal",
                "valor_causa",
            )
        }),
    )


    class Media:
        css = {
            'all': ('admin/css/admin_tabs.css', 'admin/css/custom_admin.css')
        }
        js = (
            'admin/js/processo_judicial_enhancer.js',
            'admin/js/admin_tabs.js',
            'admin/js/input_masks.js',
        )

    @admin.display(description="")
    def get_x_separator(self, obj):
        if obj.partes_processuais.count() > 2:
            return mark_safe('<span title="Mais de dois polos">⚠️</span>')
        return "x"


    @admin.display(description="Polo Ativo")
    def get_polo_ativo(self, obj):
        ativo = obj.partes_processuais.filter(tipo_polo="ATIVO").first()
        return ativo.nome if ativo else "---"

    @admin.display(description="Polo Passivo")
    def get_polo_passivo(self, obj):
        passivo = obj.partes_processuais.filter(tipo_polo="PASSIVO").first()
        return passivo.nome if passivo else "---"

    @admin.display(description="Buscar Dados Online")
    def cnj_busca_online_display(self, obj=None):
        url_busca = "/api/contratos/buscar-dados-escavador/"
        return mark_safe(f'''
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" id="btn_buscar_cnj" class="button" data-url="{url_busca}" disabled>Dados Online</button>
            </div>
            <div id="cnj_feedback" style="margin-top: 5px; font-weight: bold;"></div>
        ''')

    
@admin.register(StatusProcessual)
class StatusProcessualAdmin(admin.ModelAdmin):
    list_display = ("nome", "ordem")
    ordering = ("ordem", "nome")
