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
    path('listas-de-tarefas/', views.ListaDeTarefasAPIView.as_view(), name='listadetarefas_list_create'),
    
    # URL para o botão de busca de dados online de processo
    path('buscar-dados-escavador/<str:numero_cnj>/', views.BuscarDadosEscavadorView.as_view(), name='buscar_dados_escavador'),

    # URLs para o botão CIA
    path('fetch-address/<str:cpf>/', views.FetchAddressAPIView.as_view(), name='fetch_address_api'),
    path('save-manual-address/', views.SaveManualAddressAPIView.as_view(), name='save_manual_address_api'),
]
