from django.contrib import admin
from django.contrib import admin
admin.site.site_header = "CFF SYSTEM"
admin.site.site_title = "Home"
admin.site.index_title = "Bem-vindo à Administração"
from django.utils.safestring import mark_safe
from django import forms
from django.db import models
from .models import ProcessoJudicial, Parte, Contrato, StatusProcessual


# ──────────────────────────────────────────
# Inlines
# ──────────────────────────────────────────
class ParteInline(admin.StackedInline):
    model = Parte
    extra = 1
    fk_name = "processo"
    fieldsets = (
        (
            None,
            {
                "fields": (
                    ("tipo_polo", "nome"),
                    ("tipo_pessoa", "documento"),
                    "endereco",
                )
            },
        ),
    )
    formfield_overrides = {
        models.TextField: {"widget": forms.Textarea(attrs={"rows": 4, "cols": 40})},
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
    list_display = ("cnj", "uf", "get_polo_ativo", "get_polo_passivo", "status")
    search_fields = ("cnj", "partes__nome")
    inlines = [ParteInline, ContratoInline]
    readonly_fields = ("uf_com_botao",)

    fieldsets = (
        (
            None,
            {
                "fields": (
                    "status",
                    "cnj",
                    "uf_com_botao",  # UF: [Botão] [Campo], alinhado
                    "vara",
                    "tribunal",
                    "valor_causa",
                )
            },
        ),
    )

    class Media:
        js = ("admin/js/processo_judicial_enhancer.js",)
        css = {"all": ("admin/css/custom_admin.css",)}

    # ──────────────  Colunas extras  ──────────────
    @admin.display(description="Polo Ativo")
    def get_polo_ativo(self, obj):
        ativo = obj.partes.filter(tipo_polo="ATIVO").first()
        return ativo.nome if ativo else "---"

    @admin.display(description="Polo Passivo")
    def get_polo_passivo(self, obj):
        passivo = obj.partes.filter(tipo_polo="PASSIVO").first()
        return passivo.nome if passivo else "---"

    # ──────────────  Campo UF com botão ao lado  ──────────────
    @admin.display(description="UF")
    def uf_com_botao(self, obj=None):
        valor = obj.uf if obj else ""
        return mark_safe(
            f'''
            <div style="display: flex; align-items: center; gap: 8px;">
                <button id="btn_preencher_uf" type="button" class="button">Preencher UF</button>
                <input type="text" name="uf" maxlength="2" value="{valor}" class="vTextField" style="width: 60px;">
            </div>
            '''
        )


# ──────────────────────────────────────────
# Admin Status Processual
# ──────────────────────────────────────────
@admin.register(StatusProcessual)
class StatusProcessualAdmin(admin.ModelAdmin):
    list_display = ("nome", "ordem")
    ordering = ("ordem", "nome")
