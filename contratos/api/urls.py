from django.urls import path
from . import views

app_name = 'contratos_api'

urlpatterns = [
    path('processo/<int:processo_id>/agenda/', views.AgendaAPIView.as_view(), name='agenda_list'),
    path('processo/<int:processo_id>/tarefas/', views.TarefaCreateAPIView.as_view(), name='tarefa_create'),
    path('processo/<int:processo_id>/prazos/', views.PrazoCreateAPIView.as_view(), name='prazo_create'),
    path('users/', views.UserSearchAPIView.as_view(), name='user_search'),
    path('agenda/users/', views.AgendaUsersAPIView.as_view(), name='agenda_users'),
    path('agenda/geral/', views.AgendaGeralAPIView.as_view(), name='agenda_geral'),
    path('agenda/supervision/status/', views.AgendaSupervisionStatusAPIView.as_view(), name='agenda_supervision_status'),
    path('agenda/supervision/barrado/', views.AgendaSupervisionBarradoAPIView.as_view(), name='agenda_supervision_barrado'),
    path('tarefas/<int:tarefa_id>/comentarios/', views.TarefaComentarioListCreateAPIView.as_view(), name='tarefa_comentarios'),
    path('agenda/tarefa/<int:pk>/update-date/', views.AgendaTarefaUpdateDateAPIView.as_view(), name='agenda_tarefa_update_date'),
    path('agenda/prazo/<int:pk>/update-date/', views.AgendaPrazoUpdateDateAPIView.as_view(), name='agenda_prazo_update_date'),
    path('listas-de-tarefas/', views.ListaDeTarefasAPIView.as_view(), name='listadetarefas_list_create'),
    path('herdeiros/', views.HerdeiroAPIView.as_view(), name='herdeiros'),
    
    # URL para o botão de busca de dados online de processo
    path('buscar-dados-escavador/<str:numero_cnj>/', views.BuscarDadosEscavadorView.as_view(), name='buscar_dados_escavador'),

    # URLs para o botão CIA
    path('fetch-address/<str:cpf>/', views.FetchAddressAPIView.as_view(), name='fetch_address_api'),
    path('save-manual-address/', views.SaveManualAddressAPIView.as_view(), name='save_manual_address_api'),
    path('demandas/cpf/<str:cpf>/', views.BuscarDadosDemandasCpfView.as_view(), name='buscar_demandas_cpf'),
    path('demandas/cpf/preview/', views.DemandasCpfPreviewView.as_view(), name='demandas_cpf_preview'),
    path('demandas/cpf/import/', views.DemandasCpfImportView.as_view(), name='demandas_cpf_import'),
    path('demandas/cpf/preview', views.DemandasCpfPreviewView.as_view(), name='demandas_cpf_preview_noslash'),
    path('demandas/cpf/import', views.DemandasCpfImportView.as_view(), name='demandas_cpf_import_noslash'),
    path('processo/<int:processo_id>/nowlex-valor-causa/', views.ProcessoNowlexValorCausaAPIView.as_view(), name='processo_nowlex_valor_causa'),
]
