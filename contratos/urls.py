# contratos/urls.py
from django.urls import path, include
from . import views

app_name = 'contratos'

urlpatterns = [
    path('', views.lista_processos, name='lista_processos'),
    path('processo/<int:pk>/', views.detalhe_processo, name='detalhe_processo'),
    path('api/decision-tree/', views.get_decision_tree_data, name='get_decision_tree_data'), # <-- Nova URL
    path('api/processo/<int:processo_id>/contratos/', views.get_processo_contratos_api, name='get_processo_contratos_api'), # <-- Nova URL
    path('processo/<int:processo_id>/gerar-monitoria/', views.generate_monitoria_petition, name='generate_monitoria_petition'),
    path('processo/<int:processo_id>/gerar-monitoria-docx/', views.generate_monitoria_docx_download, name='generate_monitoria_docx'),
    path('processo/<int:processo_id>/download-monitoria-pdf/', views.download_monitoria_pdf, name='download_monitoria_pdf'),
    path('api/', include('contratos.api.urls', namespace='contratos_api')),
]
