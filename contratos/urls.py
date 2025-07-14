# contratos/urls.py
from django.urls import path
from . import views

app_name = 'contratos'

urlpatterns = [
    path('processos/', views.lista_processos, name='lista_processos'),
    path('processos/<int:pk>/', views.detalhe_processo, name='detalhe_processo'),
]
