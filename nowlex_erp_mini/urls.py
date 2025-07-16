# nowlex_erp_mini/urls.py
from django.contrib import admin
from django.urls import path, include
from contratos import views as contratos_views

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # URL da API definida de forma explícita e única no nível do projeto
    path('api/contratos/buscar-dados-escavador/', contratos_views.buscar_dados_escavador_view, name='api_buscar_dados_escavador'),
    
    # URLs restantes do app (se houver outras no futuro)
    path('', include('contratos.urls')),
]
