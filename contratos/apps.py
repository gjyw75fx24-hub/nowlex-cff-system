# contratos/apps.py
from django.apps import AppConfig

class ContratosConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'contratos'
    # 👇 ADICIONE ESTA LINHA PARA MUDAR O TÍTULO
    verbose_name = 'Consultas'
