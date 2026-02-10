# contratos/urls.py
from django.urls import path, include
from . import views

app_name = 'contratos'

urlpatterns = [
    path('', views.lista_processos, name='lista_processos'),
    path('processo/<int:pk>/', views.detalhe_processo, name='detalhe_processo'),
    path('api/analysis-types/', views.get_analysis_types, name='get_analysis_types'),
    path('api/decision-tree/', views.get_decision_tree_data, name='get_decision_tree_data'), # <-- Nova URL
    path('api/processo/<int:processo_id>/contratos/', views.get_processo_contratos_api, name='get_processo_contratos_api'), # <-- Nova URL
    path('processo/<int:processo_id>/gerar-monitoria/', views.generate_monitoria_petition, name='generate_monitoria_petition'),
    path('processo/<int:processo_id>/gerar-cobranca-judicial/', views.generate_cobranca_judicial_petition, name='generate_cobranca_judicial_petition'),
    path('processo/<int:processo_id>/gerar-habilitacao/', views.generate_habilitacao_petition, name='generate_habilitacao_petition'),
    path('processo/<int:processo_id>/gerar-monitoria-docx/', views.generate_monitoria_docx_download, name='generate_monitoria_docx'),
    path('processo/<int:processo_id>/download-monitoria-pdf/', views.download_monitoria_pdf, name='download_monitoria_pdf'),
    path('arquivo/<int:arquivo_id>/view/', views.proxy_arquivo_view, name='proxy_arquivo_view'),
    path('arquivo/<int:arquivo_id>/convert-to-pdf/', views.convert_docx_to_pdf_download, name='convert_docx_to_pdf'),
    path('arquivo/<int:arquivo_id>/convert-to-docx/', views.convert_pdf_to_docx_download, name='convert_pdf_to_docx'),
    path('api/', include('contratos.api.urls', namespace='contratos_api')),
]
