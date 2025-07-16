# contratos/urls.py
from django.urls import path
from . import views

app_name = 'contratos'

# A URL da API foi movida para o urls.py principal do projeto para evitar conflitos.
# Este arquivo agora contém apenas as outras URLs do app.
urlpatterns = [
    path('processos/', views.lista_processos, name='lista_processos'),
    path('processos/<int:pk>/', views.detalhe_processo, name='detalhe_processo'),
]
