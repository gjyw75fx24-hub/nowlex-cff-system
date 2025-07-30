# contratos/urls.py
from django.urls import path, include
from . import views

app_name = 'contratos'

urlpatterns = [
    path('', views.lista_processos, name='lista_processos'),
    path('processo/<int:pk>/', views.detalhe_processo, name='detalhe_processo'),
    path('api/', include('contratos.api.urls', namespace='contratos_api')),
]
