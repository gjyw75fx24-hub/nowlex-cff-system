# nowlex_erp_mini/urls.py
from django.contrib import admin
from django.urls import path, include
from contratos import views as contratos_views

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # URLs do app de contratos (incluindo a API)
    path('', include('contratos.urls')),
]
