from django.contrib import admin
admin.site.site_header = "CFF SYSTEM"
admin.site.site_title = "Home"
admin.site.index_title = "Bem-vindo à Administração"

from django.utils.safestring import mark_safe
from django import forms
from django.db import models
from django.urls import reverse
from .models import ProcessoJudicial, Parte, Contrato, StatusProcessual, AndamentoProcessual


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
    list_display = ("cnj", "get_polo_ativo", "get_x_separator", "get_polo_passivo", "uf", "status", "busca_ativa")
    list_filter = ("busca_ativa", "status", "uf")
    search_fields = ("cnj", "partes_processuais__nome",)
    inlines = [ParteInline, ContratoInline, AndamentoInline]
    readonly_fields = ("cnj_busca_online_display", "uf_com_botao")

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
                "uf_com_botao",
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

    @admin.display(description="UF")
    def uf_com_botao(self, obj=None):
        valor_uf = obj.uf if obj else ""
        return mark_safe(f'''
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" class="button" onclick="preencherUF()">Preencher UF</button>
                <input id="id_uf" type="text" name="uf" maxlength="2" value="{valor_uf}" class="vTextField" style="width: 60px;">
            </div>
            <script>
                function preencherUF() {{
                    const cnjInput = document.getElementById('id_cnj');
                    const ufInput = document.getElementById('id_uf');
                    const tribunalInput = document.getElementById('id_tribunal');
                    if (!cnjInput || !ufInput) {{
                        alert("Campos CNJ ou UF não encontrados.");
                        return;
                    }}
                    const cnj = cnjInput.value.trim();
                    let codUF = null;

                    if (cnj.includes(".")) {{
                        const partes = cnj.split(".");
                        if (partes.length >= 4) {{
                            codUF = `${{partes[2]}}.${{partes[3]}}`;
                        }}
                    }} else if (/^\d{{20}}$/.test(cnj)) {{
                        const j = cnj.substr(13, 1);
                        const tr = cnj.substr(14, 2);
                        codUF = `${{j}}.${{tr}}`;
                    }}

                    const mapaUF = {{
                        "8.01": "AC", "8.02": "AL", "8.03": "AP", "8.04": "AM", "8.05": "BA",
                        "8.06": "CE", "8.07": "DF", "8.08": "ES", "8.09": "GO", "8.10": "MA",
                        "8.11": "MT", "8.12": "MS", "8.13": "MG", "8.14": "PA", "8.15": "PB",
                        "8.16": "PR", "8.17": "PE", "8.18": "PI", "8.19": "RJ", "8.20": "RN",
                        "8.21": "RS", "8.22": "RO", "8.23": "RR", "8.24": "SC", "8.25": "SE",
                        "8.26": "SP", "8.27": "TO"
                    }};
                    
                    const uf = mapaUF[codUF];
                    if (uf) {{
                        ufInput.value = uf;
                        if (tribunalInput) tribunalInput.value = "TJ" + uf;
                    }} else {{
                        alert("Não foi possível extrair a UF a partir do CNJ informado. Verifique o número.");
                    }}
                }}
            </script>
        ''')


@admin.register(StatusProcessual)
class StatusProcessualAdmin(admin.ModelAdmin):
    list_display = ("nome", "ordem")
    ordering = ("ordem", "nome")
