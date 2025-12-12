from django.apps import AppConfig
from django.contrib import admin

class ContratosConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'contratos'
    verbose_name = 'Menu ADM'

    def ready(self):
        from .models import ProcessoJudicial, StatusProcessual, Carteira
        from .admin import ProcessoJudicialAdmin, StatusProcessualAdmin, CarteiraAdmin

        # Garante que não haja registros duplicados
        if not admin.site.is_registered(ProcessoJudicial):
            admin.site.register(ProcessoJudicial, ProcessoJudicialAdmin)
        if not admin.site.is_registered(StatusProcessual):
            admin.site.register(StatusProcessual, StatusProcessualAdmin)
        if not admin.site.is_registered(Carteira):
            admin.site.register(Carteira, CarteiraAdmin)
