import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from django.contrib.admin.sites import AdminSite
from django.core.exceptions import PermissionDenied
from django.test import RequestFactory, SimpleTestCase
from rest_framework.renderers import JSONRenderer
from rest_framework.test import APIRequestFactory

from contratos.admin import (
    AnaliseProcessoInline,
    ProcessoJudicialAdmin,
    _resolve_productivity_carteira_fallback_actor,
    slack_supervision_manager_view,
)
from contratos.api.views import (
    BuscarDadosEscavadorView,
    SlackSupervisionInteractionAPIView,
    SlackSupervisionDeliveryDeleteAPIView,
    SlackSupervisionDeliveryListAPIView,
    SlackSupervisionDeliveryRefreshAPIView,
    _aggregate_slack_delivery_results,
    _annotate_slack_delivery_designated_supervisors,
    _build_slack_delivery_entry_payload,
    _build_slack_delivery_summary,
    _build_remote_slack_delivery_key,
    _parse_remote_slack_delivery_key,
    _resolve_supervision_card_contracts,
    _resolve_supervision_entry_date,
    _save_supervision_card,
)
from contratos.models import AnaliseProcesso, ProcessoJudicial
from contratos.services.slack_supervisao import (
    _collect_entries_for_selected_keys,
    _entry_analysis_group_key,
    _supervisor_accepts_entry,
    _insert_delivery,
    _save_delivery,
    _sync_single_delivery,
    _slack_api_post,
    delete_slack_thread,
    delete_supervision_slack_deliveries,
    ensure_supervision_delivery_records,
    fetch_remote_supervision_slack_messages,
    sync_supervision_slack_for_selected_deliveries,
    sync_supervision_slack_for_supervisor,
)


class ResolveSupervisionEntryDateTests(SimpleTestCase):
    def test_custom_supervision_date_takes_precedence(self):
        result = _resolve_supervision_entry_date('2026-04-10', '2026-03-31')
        self.assertEqual(result, date(2026, 4, 10))

    def test_prescricao_date_is_used_when_custom_date_is_missing(self):
        result = _resolve_supervision_entry_date('', '2026-03-31')
        self.assertEqual(result, date(2026, 3, 31))


class SlackSupervisionManagerAdminViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch('contratos.admin.admin.site.each_context', return_value={})
    def test_renders_for_supervisor_developer(self, mocked_each_context):
        request = self.factory.get('/admin/contratos/slack-supervisao/')
        request.user = SimpleNamespace(is_superuser=True)

        response = slack_supervision_manager_view(request)

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Mensagens enviadas ao Slack', response.content)
        mocked_each_context.assert_called_once_with(request)

    def test_blocks_non_supervisor_developer(self):
        request = self.factory.get('/admin/contratos/slack-supervisao/')
        request.user = SimpleNamespace(is_superuser=False, pk=None)

        with self.assertRaises(PermissionDenied):
            slack_supervision_manager_view(request)


class ProductivityCarteiraFallbackTests(SimpleTestCase):
    def test_resolves_passivas_fallback_to_rodrigo(self):
        actor_key, actor_label = _resolve_productivity_carteira_fallback_actor(
            carteira_nome='Passivas',
            known_users_by_norm={
                'rodrigo.junqueira': {'id': 17, 'label': 'Rodrigo.Junqueira'},
            },
        )

        self.assertEqual(actor_key, 'user:17')
        self.assertEqual(actor_label, 'Rodrigo.Junqueira')

    def test_returns_empty_when_carteira_has_no_fallback(self):
        actor_key, actor_label = _resolve_productivity_carteira_fallback_actor(
            carteira_nome='BCSUL',
            known_users_by_norm={
                'rodrigo.junqueira': {'id': 17, 'label': 'Rodrigo.Junqueira'},
            },
        )

        self.assertEqual(actor_key, '')
        self.assertEqual(actor_label, '')


class BuscarDadosEscavadorViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch('contratos.api.views.requests.get')
    def test_handles_null_nested_payloads_without_crashing(self, mocked_get):
        mocked_response = Mock()
        mocked_response.json.return_value = {
            'numero_cnj': '0711144-91.2019.8.07.0001',
            'estado_origem': None,
            'fontes': [
                None,
                {
                    'capa': None,
                    'tribunal': None,
                    'fonte': None,
                    'movimentacoes': [
                        None,
                        {'data': '2026-03-30T10:00:00', 'titulo': 'Andamento de teste'},
                    ],
                    'envolvidos': None,
                },
            ],
            'partes_envolvidas': [
                None,
                {'nome': 'Fulano da Silva', 'polo': 'PASSIVO', 'cpf': '12345678900'},
            ],
        }
        mocked_response.raise_for_status.return_value = None
        mocked_get.return_value = mocked_response

        request = self.factory.get('/api/escavador/0711144-91.2019.8.07.0001/')
        request.user = SimpleNamespace(is_authenticated=True)

        response = BuscarDadosEscavadorView.as_view()(request, '0711144-91.2019.8.07.0001')

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload['status'], 'success')
        self.assertEqual(payload['processo']['numero_cnj'], '0711144-91.2019.8.07.0001')
        self.assertIsNone(payload['processo']['uf'])
        self.assertIsNone(payload['processo']['vara'])
        self.assertIsNone(payload['processo']['tribunal'])
        self.assertIsNone(payload['processo']['valor_causa'])
        self.assertEqual(payload['processo']['status_id'], 'DESCONHECIDO')
        self.assertEqual(payload['partes'][0]['nome'], 'Fulano da Silva')
        self.assertEqual(payload['partes'][0]['documento'], '12345678900')
        self.assertEqual(len(payload['andamentos']), 1)
        self.assertEqual(payload['andamentos'][0]['descricao'], 'Andamento de teste')


class ResolveSupervisionCardContractsTests(SimpleTestCase):
    def _build_analise(self, contracts):
        contracts_qs = Mock()
        contracts_qs.only.return_value = contracts

        contracts_manager = Mock()
        contracts_manager.all.return_value = contracts_qs

        processo = SimpleNamespace(contratos=contracts_manager)
        return SimpleNamespace(processo_judicial_id=1, processo_judicial=processo)

    def test_returns_empty_when_card_has_no_selected_contracts(self):
        contracts = [
            SimpleNamespace(pk=1, id=1, numero_contrato='111', data_prescricao=date(2026, 4, 1), valor_total_devido=None, valor_causa=None),
            SimpleNamespace(pk=2, id=2, numero_contrato='222', data_prescricao=date(2026, 5, 1), valor_total_devido=None, valor_causa=None),
        ]
        analise = self._build_analise(contracts)

        result = _resolve_supervision_card_contracts(analise, {}, respostas={})

        self.assertEqual(result, [])

    def test_returns_only_selected_contracts(self):
        contracts = [
            SimpleNamespace(pk=1, id=1, numero_contrato='111', data_prescricao=date(2026, 4, 1), valor_total_devido=None, valor_causa=None),
            SimpleNamespace(pk=2, id=2, numero_contrato='222', data_prescricao=date(2026, 5, 1), valor_total_devido=None, valor_causa=None),
        ]
        analise = self._build_analise(contracts)

        result = _resolve_supervision_card_contracts(
            analise,
            {'contratos': [2]},
            respostas={},
        )

        self.assertEqual([contract.pk for contract in result], [2])


class SaveSupervisionCardTests(SimpleTestCase):
    @patch('contratos.api.views._trigger_supervision_analysis_sync_async')
    @patch('contratos.api.views.AnaliseProcesso.objects.filter')
    def test_persists_card_with_update_and_triggers_async_sync(self, mocked_filter, mocked_trigger_sync):
        mocked_filter.return_value.update.return_value = 1
        request_user = SimpleNamespace(pk=7)
        analise = SimpleNamespace(
            pk=55,
            respostas={},
            updated_by=None,
            para_supervisionar=False,
            updated_at=None,
            _respostas_requerem_supervisao=lambda: True,
        )

        _save_supervision_card(analise, {'saved_processos_vinculados': []}, request_user=request_user)

        mocked_filter.assert_called_once_with(pk=55)
        mocked_filter.return_value.update.assert_called_once()
        mocked_trigger_sync.assert_called_once_with(55)
        self.assertTrue(analise.para_supervisionar)


class AnaliseProcessoAdminTests(SimpleTestCase):
    def test_inline_hides_extra_form_when_analysis_already_exists(self):
        inline = AnaliseProcessoInline(ProcessoJudicial, AdminSite())
        processo = SimpleNamespace(pk=2241, analise_processo=object())

        result = inline.get_extra(SimpleNamespace(), obj=processo)

        self.assertEqual(result, 0)

    @patch('contratos.admin.AnaliseProcesso.objects.filter')
    def test_save_formset_reuses_existing_analysis_instead_of_inserting_duplicate(self, mocked_filter):
        admin_instance = ProcessoJudicialAdmin(ProcessoJudicial, AdminSite())
        processo = ProcessoJudicial(id=2241)
        request = SimpleNamespace(user=SimpleNamespace(pk=7))
        form = SimpleNamespace(instance=processo)

        existing = AnaliseProcesso(pk=55, processo_judicial=processo, respostas={'saved_processos_vinculados': []})
        existing.save = Mock()
        mocked_filter.return_value.first.return_value = existing

        new_instance = AnaliseProcesso(respostas={'saved_processos_vinculados': [{'slug': 'card-1'}]})
        inline_form = Mock()
        inline_form.has_changed.return_value = True
        inline_form.cleaned_data = {'DELETE': False}
        inline_form.changed_data = ['respostas']
        inline_form.save.return_value = new_instance
        inline_form.save_m2m = Mock()

        formset = SimpleNamespace(model=AnaliseProcesso, forms=[inline_form])

        admin_instance.save_formset(request, form, formset, change=True)

        mocked_filter.assert_called_once_with(processo_judicial_id=2241)
        existing.save.assert_called_once()
        self.assertEqual(formset.new_objects, [])
        self.assertEqual(formset.changed_objects, [(existing, ['respostas'])])

    @patch('contratos.admin.transaction.on_commit')
    @patch('django.contrib.admin.options.ModelAdmin.save_related')
    def test_save_related_defers_slack_sync_until_after_commit(self, mocked_super_save_related, mocked_on_commit):
        admin_instance = ProcessoJudicialAdmin(ProcessoJudicial, AdminSite())
        admin_instance._extract_selected_carteira_ids = Mock(return_value=set())
        admin_instance._sync_supervision_slack_after_admin_save = Mock()

        carteiras_manager = Mock()
        carteiras_manager.values_list.return_value = []
        carteiras_manager.clear = Mock()
        carteiras_manager.set = Mock()

        numeros_cnj_qs = Mock()
        numeros_cnj_qs.values_list.return_value = []
        numeros_cnj_manager = Mock()
        numeros_cnj_manager.exclude.return_value = numeros_cnj_qs

        processo = SimpleNamespace(
            pk=2241,
            carteiras_vinculadas=carteiras_manager,
            numeros_cnj=numeros_cnj_manager,
            carteira_id=None,
        )
        request = SimpleNamespace(user=SimpleNamespace(pk=7))
        form = SimpleNamespace(instance=processo)

        admin_instance.save_related(request, form, formsets=[], change=True)

        mocked_super_save_related.assert_called_once_with(request, form, [], True)
        mocked_on_commit.assert_called_once()
        admin_instance._sync_supervision_slack_after_admin_save.assert_not_called()

        callback = mocked_on_commit.call_args.args[0]
        callback()

        admin_instance._sync_supervision_slack_after_admin_save.assert_called_once_with(request, processo)

    @patch('contratos.admin.get_user_allowed_carteira_ids', return_value=[])
    def test_extract_changelist_filters_ignores_agenda_focus_params(self, _mocked_allowed_ids):
        admin_instance = ProcessoJudicialAdmin(ProcessoJudicial, AdminSite())
        request = RequestFactory().get(
            '/admin/contratos/processojudicial/1717/change/',
            {
                'tab': 'supervisionar',
                'open_agenda': '1',
                'agenda_focus_type': 'S',
                'agenda_focus_date': '2026-05-01',
                'agenda_focus_card': '2054-saved_processos_vinculados-0',
                'agenda_focus_analise_id': '2054',
                'agenda_focus_source': 'saved_processos_vinculados',
                'agenda_focus_index': '0',
                'status__id__exact': '1',
            },
        )
        request.user = SimpleNamespace(is_authenticated=True, is_superuser=True)
        request.session = {}

        filters = admin_instance._extract_changelist_filters_for_navigation(request)

        self.assertEqual(filters, 'status__id__exact=1')


class SaveDeliveryTests(SimpleTestCase):
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects.bulk_create')
    def test_inserts_new_delivery_without_calling_model_save(self, mocked_bulk_create):
        mocked_bulk_create.return_value = [SimpleNamespace(pk=321, created_at=None, updated_at=None)]
        delivery = SimpleNamespace(
            pk=None,
            analise_id=7,
            supervisor_id=5,
            card_source='saved_processos_vinculados',
            card_index=1,
            slack_channel_id='',
            slack_message_ts='',
            slack_thread_ts='',
            notified_at=None,
            resolved_at=None,
            message_hash='',
            last_status='pendente',
            card_id='card-1',
            slack_user_id='U1',
            processo_id=9,
        )

        _save_delivery(delivery, update_fields=['last_status'])

        mocked_bulk_create.assert_called_once()
        self.assertEqual(delivery.pk, 321)

    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects.filter')
    def test_updates_existing_delivery_without_calling_model_save(self, mocked_filter):
        mocked_filter.return_value.update.return_value = 1
        delivery = SimpleNamespace(
            pk=99,
            slack_channel_id='C1',
            slack_message_ts='123.456',
            slack_thread_ts='123.456',
            notified_at=None,
            resolved_at=None,
            message_hash='abc',
            last_status='pendente',
            card_id='card-1',
            slack_user_id='U1',
            processo_id=7,
        )

        _save_delivery(delivery, update_fields=['message_hash', 'slack_message_ts'])

        mocked_filter.assert_called_once_with(pk=99)
        mocked_filter.return_value.update.assert_called_once()

    @patch('contratos.services.slack_supervisao._upsert_delivery')
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects.filter')
    def test_raises_runtime_error_when_update_and_upsert_fail(self, mocked_filter, mocked_upsert):
        mocked_filter.return_value.update.side_effect = SystemExit(1)
        mocked_upsert.side_effect = SystemExit(1)
        delivery = SimpleNamespace(
            pk=99,
            analise_id=7,
            supervisor_id=5,
            card_source='saved_processos_vinculados',
            card_index=1,
            slack_channel_id='C1',
            slack_message_ts='123.456',
            slack_thread_ts='123.456',
            notified_at=None,
            resolved_at=None,
            message_hash='abc',
            last_status='pendente',
            card_id='card-1',
            slack_user_id='U1',
            processo_id=7,
        )

        with self.assertRaises(RuntimeError):
            _save_delivery(delivery, update_fields=['message_hash'])

    @patch('contratos.services.slack_supervisao._upsert_delivery')
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects.bulk_create')
    def test_insert_delivery_falls_back_to_upsert_when_bulk_create_raises_base_exception(self, mocked_bulk_create, mocked_upsert):
        mocked_bulk_create.side_effect = SystemExit(1)
        mocked_upsert.return_value = SimpleNamespace(pk=777, created_at=None, updated_at=None)
        delivery = SimpleNamespace(
            pk=None,
            analise_id=38,
            supervisor_id=2,
            card_source='saved_processos_vinculados',
            card_index=0,
            created_at=None,
            updated_at=None,
        )

        persisted_delivery = _insert_delivery(delivery)

        mocked_bulk_create.assert_called_once()
        mocked_upsert.assert_called_once()
        self.assertEqual(getattr(persisted_delivery, 'pk', None), 777)

    @patch('contratos.services.slack_supervisao._upsert_delivery')
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects.filter')
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects.bulk_create')
    def test_insert_delivery_returns_in_memory_delivery_when_all_persistence_fallbacks_fail(
        self,
        mocked_bulk_create,
        mocked_filter,
        mocked_upsert,
    ):
        mocked_bulk_create.side_effect = SystemExit(1)
        mocked_upsert.side_effect = SystemExit(1)
        mocked_filter.side_effect = SystemExit(1)
        delivery = SimpleNamespace(
            pk=None,
            analise_id=38,
            supervisor_id=2,
            card_source='saved_processos_vinculados',
            card_index=0,
            created_at=None,
            updated_at=None,
        )

        persisted_delivery = _insert_delivery(delivery)

        self.assertIs(persisted_delivery, delivery)
        self.assertIsNone(getattr(persisted_delivery, 'pk', None))

    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects.bulk_create')
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects.filter')
    def test_falls_back_to_upsert_when_update_raises_base_exception(self, mocked_filter, mocked_bulk_create):
        mocked_filter.return_value.update.side_effect = SystemExit(1)
        mocked_filter.return_value.order_by.return_value.first.return_value = SimpleNamespace(pk=99, created_at=None, updated_at=None)
        mocked_bulk_create.return_value = [SimpleNamespace(pk=99, created_at=None, updated_at=None)]
        delivery = SimpleNamespace(
            pk=99,
            analise_id=7,
            supervisor_id=5,
            card_source='saved_processos_vinculados',
            card_index=1,
            slack_channel_id='C1',
            slack_message_ts='123.456',
            slack_thread_ts='123.456',
            notified_at=None,
            resolved_at=None,
            message_hash='abc',
            last_status='pendente',
            card_id='card-1',
            slack_user_id='U1',
            processo_id=9,
            created_at=None,
            updated_at=None,
        )

        _save_delivery(delivery, update_fields=['message_hash', 'slack_message_ts'])

        mocked_bulk_create.assert_called_once()
        self.assertEqual(delivery.pk, 99)


class SlackApiPostTests(SimpleTestCase):
    @patch('contratos.services.slack_supervisao.requests.post')
    def test_converts_base_exception_from_requests_into_runtime_error(self, mocked_post):
        mocked_post.side_effect = SystemExit(1)

        with self.assertRaises(RuntimeError):
            _slack_api_post('chat.postMessage', token='xoxb-test', json_payload={'channel': 'C1'})

    @patch('contratos.services.slack_supervisao.time.sleep')
    @patch('contratos.services.slack_supervisao.requests.post')
    def test_retries_before_succeeding(self, mocked_post, mocked_sleep):
        success_response = Mock()
        success_response.json.return_value = {'ok': True, 'ts': '123.456'}
        mocked_post.side_effect = [SystemExit(1), success_response]

        payload = _slack_api_post('chat.delete', token='xoxb-test', json_payload={'channel': 'C1', 'ts': '123.456'})

        self.assertEqual(payload, {'ok': True, 'ts': '123.456'})
        self.assertEqual(mocked_post.call_count, 2)
        mocked_sleep.assert_called_once()

    @patch('contratos.services.slack_supervisao.requests.post')
    def test_formats_missing_scope_for_history_calls(self, mocked_post):
        response = Mock()
        response.json.return_value = {'ok': False, 'error': 'missing_scope'}
        mocked_post.return_value = response

        with self.assertRaises(ValueError) as ctx:
            _slack_api_post('conversations.history', token='xoxb-test', data_payload={'channel': 'D1'})

        self.assertIn('im:history', str(ctx.exception))


class SlackDeliveryViewRendererTests(SimpleTestCase):
    def test_slack_delivery_views_render_only_json(self):
        self.assertEqual(SlackSupervisionDeliveryListAPIView.renderer_classes, [JSONRenderer])
        self.assertEqual(SlackSupervisionDeliveryDeleteAPIView.renderer_classes, [JSONRenderer])
        self.assertEqual(SlackSupervisionDeliveryRefreshAPIView.renderer_classes, [JSONRenderer])

    @patch('contratos.api.views.is_supervisor_developer_user', return_value=True)
    @patch('contratos.api.views.fetch_remote_supervision_slack_snapshot')
    @patch('contratos.api.views.ensure_supervision_delivery_records')
    @patch('contratos.api.views.SupervisaoSlackEntrega.objects')
    @patch('contratos.api.views.UserSlackConfig.objects')
    def test_list_view_skips_reconcile_by_default(self, mocked_config_objects, mocked_delivery_objects, mocked_reconcile, mocked_fetch_remote, _mocked_is_supervisor_dev):
        mocked_config_objects.select_related.return_value.filter.return_value.exclude.return_value.order_by.return_value = []
        mocked_delivery_objects.annotate.return_value.select_related.return_value.only.return_value.order_by.return_value = []
        mocked_fetch_remote.return_value = {'results': [], 'errors': [], 'seen_refs': set(), 'complete_channels': set()}
        request = APIRequestFactory().get('/api/slack/supervisao/entregas/')
        request.user = SimpleNamespace(is_authenticated=True, is_superuser=False)

        response = SlackSupervisionDeliveryListAPIView().get(request)

        self.assertEqual(response.status_code, 200)
        mocked_reconcile.assert_not_called()

    @patch('contratos.api.views.is_supervisor_developer_user', return_value=True)
    @patch('contratos.api.views.fetch_remote_supervision_slack_snapshot')
    @patch('contratos.api.views.ensure_supervision_delivery_records')
    @patch('contratos.api.views.SupervisaoSlackEntrega.objects')
    @patch('contratos.api.views.UserSlackConfig.objects')
    def test_list_view_clears_stale_local_message_refs_when_remote_dm_is_empty(
        self,
        mocked_config_objects,
        mocked_delivery_objects,
        mocked_reconcile,
        mocked_remote_snapshot,
        _mocked_is_supervisor_dev,
    ):
        mocked_config_objects.select_related.return_value.filter.return_value.exclude.return_value.order_by.return_value = []
        delivery = SimpleNamespace(
            pk=91,
            analise_id=77,
            processo_id=44,
            processo=SimpleNamespace(cnj='0808557-86.2026.8.23.0010'),
            supervisor=SimpleNamespace(pk=5, username='maicon', get_full_name=lambda: 'Maicon Bispo'),
            card_id='card-1',
            card_source='saved_processos_vinculados',
            card_index=0,
            last_status='pendente',
            notified_at=None,
            updated_at=None,
            slack_channel_id='D123',
            slack_message_ts='123.456',
            parte_nome_display='LAFAYETE',
        )
        mocked_delivery_objects.annotate.return_value.select_related.return_value.only.return_value.order_by.return_value = [delivery]
        mocked_remote_snapshot.return_value = {
            'results': [],
            'errors': [],
            'seen_refs': set(),
            'complete_channels': {'D123'},
        }
        request = APIRequestFactory().get('/api/slack/supervisao/entregas/')
        request.user = SimpleNamespace(is_authenticated=True, is_superuser=False)

        response = SlackSupervisionDeliveryListAPIView().get(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['summary']['sent_count'], 0)
        self.assertEqual(response.data['summary']['queued_count'], 1)
        mocked_delivery_objects.filter.return_value.update.assert_called_once()


class SlackSupervisionInteractionTests(SimpleTestCase):
    @patch('contratos.api.views.open_supervision_decision_modal')
    def test_block_action_opens_modal_from_embedded_entry_snapshot(self, mocked_open_modal):
        entry_snapshot = {
            'nome': 'Parte Teste',
            'cpf': '12345678900',
            'supervisor_observacoes': 'Texto anterior',
            'barrado_text': '',
            'barrado': {'ativo': False, 'inicio': None, 'retorno_em': None},
        }
        payload = {
            'trigger_id': '1337.42',
            'user': {'id': 'U123'},
            'actions': [{
                'action_id': 'supervision_approve',
                'value': json.dumps({
                    'metadata': json.dumps({
                        'analise_id': 55,
                        'source': 'saved_processos_vinculados',
                        'index': 0,
                        'card_id': 'card-1',
                    }),
                    'status': 'aprovado',
                    'entry': entry_snapshot,
                }),
            }],
        }

        response = SlackSupervisionInteractionAPIView()._handle_block_actions(payload)

        self.assertEqual(response.status_code, 200)
        mocked_open_modal.assert_called_once_with(
            '1337.42',
            metadata_json='{"analise_id": 55, "source": "saved_processos_vinculados", "index": 0, "card_id": "card-1"}',
            desired_status='aprovado',
            entry=entry_snapshot,
            slack_user_id='U123',
            slack_channel_id='',
            slack_message_ts='',
        )

    @patch('contratos.api.views._trigger_supervision_analysis_sync_async')
    @patch('contratos.api.views.update_slack_message')
    @patch('contratos.api.views.build_supervision_processing_message')
    @patch('contratos.api.views._save_supervision_card')
    @patch('contratos.api.views._load_supervision_card')
    @patch('contratos.api.views._get_supervisor_by_slack_user_id')
    def test_view_submission_reads_devolutiva_from_action_key_when_action_id_is_missing(
        self,
        mocked_get_supervisor,
        mocked_load_card,
        mocked_save_card,
        mocked_build_processing,
        mocked_update_message,
        mocked_trigger_sync,
    ):
        supervisor = SimpleNamespace(
            username='maicon',
            get_full_name=lambda: 'Maicon Bispo',
        )
        analise = SimpleNamespace(pk=55)
        respostas = {'saved_processos_vinculados': []}
        card = {}
        mocked_get_supervisor.return_value = supervisor
        mocked_load_card.return_value = (analise, respostas, respostas['saved_processos_vinculados'], card, 0)
        mocked_build_processing.return_value = {
            'text': 'Atualizacao em andamento',
            'blocks': [{'type': 'section', 'text': {'type': 'mrkdwn', 'text': 'Teste'}}],
        }
        payload = {
            'view': {
                'callback_id': 'supervision_decision_modal',
                'private_metadata': json.dumps({
                    'slack_user_id': 'U123',
                    'slack_channel_id': 'D123',
                    'slack_message_ts': '100.000',
                    'status': 'aprovado',
                    'metadata': json.dumps({
                        'analise_id': 55,
                        'source': 'saved_processos_vinculados',
                        'index': 0,
                    }),
                }),
                'state': {
                    'values': {
                        'devolutiva_block': {
                            'devolutiva_input': {
                                'type': 'plain_text_input',
                                'value': 'Testando supervisão via Slack',
                            },
                        },
                    },
                },
            },
        }

        response = SlackSupervisionInteractionAPIView()._handle_view_submission(payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'response_action': 'clear'})
        self.assertEqual(card['supervisor_status'], 'aprovado')
        self.assertEqual(card['supervisor_status_autor'], 'Maicon Bispo')
        self.assertEqual(card['supervisor_observacoes'], 'Testando supervisão via Slack')
        self.assertEqual(card['supervisor_observacoes_autor'], 'Maicon Bispo')
        mocked_save_card.assert_called_once_with(analise, respostas, request_user=supervisor, trigger_sync=False)
        mocked_build_processing.assert_called_once_with(
            desired_status='aprovado',
            actor_name='Maicon Bispo',
            note='Testando supervisão via Slack',
        )
        mocked_update_message.assert_called_once_with(
            'D123',
            '100.000',
            text='Atualizacao em andamento',
            blocks=[{'type': 'section', 'text': {'type': 'mrkdwn', 'text': 'Teste'}}],
        )
        mocked_trigger_sync.assert_called_once_with(55)


class SlackSingleDeliverySyncTests(SimpleTestCase):
    @patch('contratos.services.slack_supervisao._save_delivery')
    @patch('contratos.services.slack_supervisao.add_slack_reaction')
    @patch('contratos.services.slack_supervisao.post_slack_thread_reply')
    @patch('contratos.services.slack_supervisao.post_slack_message')
    @patch('contratos.services.slack_supervisao.open_slack_dm')
    @patch('contratos.services.slack_supervisao.update_slack_message')
    @patch('contratos.services.slack_supervisao._build_supervision_message')
    def test_reposts_pending_delivery_when_local_message_ref_is_stale(
        self,
        mocked_build_message,
        mocked_update_message,
        mocked_open_dm,
        mocked_post_message,
        mocked_post_thread_reply,
        mocked_add_reaction,
        mocked_save_delivery,
    ):
        mocked_build_message.return_value = {
            'status_key': 'pendente',
            'hash': 'same-hash',
            'text': 'Supervisão pendente',
            'blocks': [{'type': 'section'}],
        }
        mocked_update_message.side_effect = ValueError('message_not_found')
        mocked_open_dm.return_value = 'D456'
        mocked_post_message.return_value = {'ts': '200.000'}
        delivery = SimpleNamespace(
            slack_user_id='U123',
            slack_channel_id='D123',
            slack_message_ts='100.000',
            slack_thread_ts='100.000',
            message_hash='same-hash',
            last_status='pendente',
            card_id='card-1',
            notified_at='old',
            resolved_at=None,
        )
        entry = {
            'cardId': 'card-1',
            'supervisor_status': 'pendente',
        }

        result = _sync_single_delivery(entry, SimpleNamespace(), delivery, allow_post=True)

        self.assertEqual(result, {'sent': True, 'queued': False})
        mocked_update_message.assert_called_once_with(
            'D123',
            '100.000',
            text='Supervisão pendente',
            blocks=[{'type': 'section'}],
        )
        mocked_open_dm.assert_called_once_with('U123')
        mocked_post_message.assert_called_once_with(
            'D456',
            text='Supervisão pendente',
            blocks=[{'type': 'section'}],
        )
        self.assertEqual(delivery.slack_channel_id, 'D456')
        self.assertEqual(delivery.slack_message_ts, '200.000')
        self.assertEqual(delivery.slack_thread_ts, '200.000')
        mocked_post_thread_reply.assert_not_called()
        mocked_add_reaction.assert_not_called()
        mocked_save_delivery.assert_called_once()

    @patch('contratos.services.slack_supervisao._save_delivery')
    @patch('contratos.services.slack_supervisao.add_slack_reaction')
    @patch('contratos.services.slack_supervisao.post_slack_thread_reply')
    @patch('contratos.services.slack_supervisao.update_slack_message')
    @patch('contratos.services.slack_supervisao._build_supervision_message')
    def test_posts_thread_reply_when_final_message_changes_to_include_note(
        self,
        mocked_build_message,
        mocked_update_message,
        mocked_post_thread_reply,
        mocked_add_reaction,
        mocked_save_delivery,
    ):
        mocked_build_message.return_value = {
            'status_key': 'aprovado',
            'hash': 'new-hash',
            'text': 'Supervisão aprovada',
            'blocks': [],
        }
        delivery = SimpleNamespace(
            slack_user_id='U123',
            slack_channel_id='D123',
            slack_message_ts='100.000',
            slack_thread_ts='100.000',
            message_hash='old-hash',
            last_status='aprovado',
            card_id='card-1',
            notified_at=None,
            resolved_at=None,
        )
        entry = {
            'cardId': 'card-1',
            'supervisor_status': 'aprovado',
            'supervisor_status_autor': 'Maicon Bispo',
            'supervisor_observacoes': 'Testando supervisão via Slack',
            'supervisor_observacoes_autor': 'Maicon Bispo',
        }

        result = _sync_single_delivery(entry, SimpleNamespace(), delivery, allow_post=False)

        self.assertEqual(result, {'sent': True, 'queued': False})
        mocked_update_message.assert_called_once_with(
            'D123',
            '100.000',
            text='Supervisão aprovada',
            blocks=[],
        )
        mocked_post_thread_reply.assert_called_once()
        self.assertIn('Status: Aprovado', mocked_post_thread_reply.call_args.args[2])
        self.assertIn('Testando supervisão via Slack', mocked_post_thread_reply.call_args.args[2])
        mocked_add_reaction.assert_not_called()
        mocked_save_delivery.assert_called_once()


class SlackDeliveryPayloadTests(SimpleTestCase):
    def test_uses_card_analysis_type_from_analysis_response(self):
        delivery = SimpleNamespace(
            pk=1,
            analise_id=77,
            processo_id=44,
            processo=SimpleNamespace(cnj='0808557-86.2026.8.23.0010'),
            supervisor=SimpleNamespace(pk=5, username='maicon', get_full_name=lambda: 'Maicon Bispo'),
            analise=SimpleNamespace(respostas={
                'saved_processos_vinculados': [{
                    'analysis_type': {'nome': 'Esteira 3', 'slug': 'esteira_3'},
                }],
            }),
            card_id='card-1',
            card_source='saved_processos_vinculados',
            card_index=0,
            last_status='pendente',
            notified_at=None,
            updated_at=None,
            slack_channel_id='',
            slack_message_ts='',
            parte_nome_display='LAFAYETE',
        )

        payload = _build_slack_delivery_entry_payload(delivery, delivery.supervisor)

        self.assertEqual(payload['analysis_type_name'], 'Esteira 3')
        self.assertEqual(payload['analysis_type_slug'], 'esteira_3')

    def test_normalizes_legacy_sent_status_without_message_into_pending_queue(self):
        supervisor = SimpleNamespace(
            pk=5,
            username='maicon',
            get_full_name=lambda: 'Maicon Bispo',
        )
        delivery = SimpleNamespace(
            pk=1,
            analise_id=77,
            processo_id=44,
            processo=SimpleNamespace(cnj='0808557-86.2026.8.23.0010'),
            supervisor=supervisor,
            card_id='card-1',
            card_source='saved_processos_vinculados',
            card_index=0,
            last_status='enviado',
            notified_at=None,
            updated_at=None,
            slack_channel_id='',
            slack_message_ts='',
            parte_nome_display='LAFAYETE',
        )

        payload = _build_slack_delivery_entry_payload(delivery, supervisor)
        summary = _build_slack_delivery_summary([payload])

        self.assertEqual(payload['status_key'], 'pendente')
        self.assertEqual(payload['last_status'], 'pendente')
        self.assertEqual(payload['dispatch_state'], 'queued')
        self.assertEqual(summary['sent_count'], 0)
        self.assertEqual(summary['pending_count'], 1)
        self.assertEqual(summary['queued_count'], 1)

    def test_counts_sent_pending_message_only_as_sent(self):
        summary = _build_slack_delivery_summary([{
            'has_message': True,
            'is_pending': True,
            'is_responded': False,
            'dispatch_state': 'sent',
        }])

        self.assertEqual(summary['sent_count'], 1)
        self.assertEqual(summary['pending_count'], 0)
        self.assertEqual(summary['queued_count'], 0)

    def test_aggregates_duplicate_card_rows_across_supervisors(self):
        results = _aggregate_slack_delivery_results([
            {
                'id': 1,
                'delivery_key': '1',
                'analise_id': 55,
                'processo_id': 88,
                'card_source': 'saved_processos_vinculados',
                'card_index': 0,
                'status_key': 'pendente',
                'dispatch_state': 'queued',
                'has_message': False,
                'queue_position': 3,
                'supervisor_name': 'Daniella.Lisboa',
                'supervisor_names': ['Daniella.Lisboa'],
            },
            {
                'id': 2,
                'delivery_key': '2',
                'analise_id': 55,
                'processo_id': 88,
                'card_source': 'saved_processos_vinculados',
                'card_index': 0,
                'status_key': 'pendente',
                'dispatch_state': 'queued',
                'has_message': False,
                'queue_position': 21,
                'supervisor_name': 'Maicon.Bispo',
                'supervisor_names': ['Maicon.Bispo'],
            },
        ])

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['delivery_ids'], [1, 2])
        self.assertEqual(results[0]['supervisor_name'], '')
        self.assertEqual(results[0]['supervisor_names'], ['Daniella.Lisboa', 'Maicon.Bispo'])
        self.assertEqual(results[0]['queue_position'], 0)

    def test_annotates_designated_supervisors_even_with_single_local_delivery(self):
        results = [{
            'id': 1,
            'delivery_key': '1',
            'analise_id': 1413,
            'processo_id': 4860,
            'card_source': 'saved_processos_vinculados',
            'card_index': 0,
            'status_key': 'pendente',
            'dispatch_state': 'queued',
            'has_message': False,
            'analysis_type_slug': 'novas-monitorias',
            'analysis_type_name': 'Novas Monitórias',
            'analysis_type_short': 'NM',
            'supervisor_name': 'Maicon.Bispo',
            'supervisor_names': ['Maicon.Bispo'],
        }]
        configs = [
            SimpleNamespace(
                user=SimpleNamespace(username='Maicon.Bispo', get_full_name=lambda: 'Maicon.Bispo'),
                allowed_analysis_type_slugs=lambda: ['esteira_3', 'novas-monitorias', 'passivas'],
            ),
            SimpleNamespace(
                user=SimpleNamespace(username='Daniella.Lisboa', get_full_name=lambda: 'Daniella.Lisboa'),
                allowed_analysis_type_slugs=lambda: ['novas-monitorias'],
            ),
        ]

        _annotate_slack_delivery_designated_supervisors(results, configs)

        self.assertEqual(results[0]['supervisor_name'], '')
        self.assertEqual(results[0]['supervisor_names'], ['Daniella.Lisboa', 'Maicon.Bispo'])


class SlackDeliveryReconcileTests(SimpleTestCase):
    @patch('contratos.services.slack_supervisao._prune_stale_pending_delivery_records')
    @patch('contratos.services.slack_supervisao._build_supervisor_delivery_context')
    def test_reconciles_delivery_records_for_each_supervisor_config(self, mocked_builder, mocked_prune):
        config_a = SimpleNamespace(user=SimpleNamespace(pk=1, username='u1', get_full_name=lambda: 'U1'))
        config_b = SimpleNamespace(user=SimpleNamespace(pk=2, username='u2', get_full_name=lambda: 'U2'))
        mocked_builder.return_value = ([], {}, {})

        errors = ensure_supervision_delivery_records([config_a, config_b])

        self.assertEqual(errors, [])
        self.assertEqual(mocked_builder.call_count, 2)
        self.assertEqual(mocked_prune.call_count, 2)
        mocked_builder.assert_any_call(config_a.user, config_a, include_completed=False)
        mocked_builder.assert_any_call(config_b.user, config_b, include_completed=False)
        mocked_prune.assert_any_call(config_a.user, [])
        mocked_prune.assert_any_call(config_b.user, [])


class SlackSupervisorRefreshTests(SimpleTestCase):
    @patch('contratos.services.slack_supervisao._collect_supervision_entries_for_supervisor')
    def test_collect_selected_entries_tries_multiple_supervisors_until_finding_card(
        self,
        mocked_collect_entries_for_supervisor,
    ):
        supervisor_a = SimpleNamespace(pk=2, username='a')
        supervisor_b = SimpleNamespace(pk=3, username='b')
        selected_key = (55, 'saved_processos_vinculados', 0)
        entry = {
            'analise_id': 55,
            'card_source': 'saved_processos_vinculados',
            'card_index': 0,
        }

        mocked_collect_entries_for_supervisor.side_effect = [
            [],
            [entry],
        ]

        result = _collect_entries_for_selected_keys({selected_key}, [supervisor_a, supervisor_b])

        self.assertEqual(result, {selected_key: entry})
        mocked_collect_entries_for_supervisor.assert_has_calls([
            call(supervisor_a, include_completed=True),
            call(supervisor_b, include_completed=True),
        ])

    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects')
    @patch('contratos.services.slack_supervisao._build_supervisor_delivery_context')
    @patch('contratos.services.slack_supervisao.UserSlackConfig.objects')
    def test_refresh_builds_pending_only_context_before_sending(
        self,
        mocked_config_objects,
        mocked_builder,
        mocked_delivery_objects,
    ):
        supervisor = SimpleNamespace(
            pk=2,
            username='Maicon.Bispo',
            get_full_name=lambda: 'Maicon Bispo',
        )
        config = SimpleNamespace(
            user=supervisor,
            user_id=2,
            slack_user_id='U2',
            allowed_analysis_type_slugs=lambda: [],
        )
        mocked_config_objects.select_related.return_value.filter.return_value.exclude.return_value.first.return_value = config
        mocked_builder.return_value = ([], {}, {})
        mocked_delivery_objects.filter.return_value.exclude.return_value.exclude.return_value.exclude.return_value.select_related.return_value = []

        result = sync_supervision_slack_for_supervisor(2)

        self.assertEqual(result['errors'], [])
        mocked_builder.assert_called_once_with(supervisor, config, include_completed=False)

    @patch('contratos.services.slack_supervisao._sync_single_delivery')
    @patch('contratos.services.slack_supervisao._ensure_delivery_for_entry')
    @patch('contratos.services.slack_supervisao._load_deliveries_for_supervisor_entries')
    @patch('contratos.services.slack_supervisao._load_analyses_for_entries')
    @patch('contratos.services.slack_supervisao._collect_entries_for_selected_keys')
    @patch('contratos.services.slack_supervisao.UserSlackConfig.objects')
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects')
    def test_selected_refresh_syncs_only_selected_deliveries(
        self,
        mocked_delivery_objects,
        mocked_config_objects,
        mocked_collect_entries,
        mocked_load_analyses,
        mocked_load_deliveries,
        mocked_ensure_delivery,
        mocked_sync_single,
    ):
        supervisor = SimpleNamespace(
            pk=2,
            username='Maicon.Bispo',
            get_full_name=lambda: 'Maicon Bispo',
        )
        config = SimpleNamespace(user=supervisor, user_id=2, allowed_analysis_type_slugs=lambda: [])
        selected_delivery = SimpleNamespace(
            pk=41,
            supervisor_id=2,
            supervisor=supervisor,
            analise_id=55,
            card_source='saved_processos_vinculados',
            card_index=0,
            slack_channel_id='',
            slack_message_ts='',
        )
        mocked_delivery_objects.select_related.return_value.filter.return_value.order_by.return_value = [selected_delivery]
        mocked_config_objects.select_related.return_value.filter.return_value.exclude.return_value = [config]
        entry = {
            'analise_id': 55,
            'card_source': 'saved_processos_vinculados',
            'card_index': 0,
            'supervisor_status': 'pendente',
            'analysis_type_slug': 'esteira_3',
        }
        mocked_collect_entries.return_value = {(55, 'saved_processos_vinculados', 0): entry}
        mocked_load_analyses.return_value = {55: SimpleNamespace(pk=55, processo_judicial=None, processo_judicial_id=None)}
        mocked_load_deliveries.return_value = {(55, 'saved_processos_vinculados', 0): selected_delivery}
        mocked_sync_single.return_value = {'sent': True, 'queued': False}

        result = sync_supervision_slack_for_selected_deliveries([41])

        self.assertEqual(result['errors'], [])
        self.assertEqual(result['recipients'], ['Maicon Bispo'])
        mocked_collect_entries.assert_called_once()
        self.assertEqual(mocked_collect_entries.call_args.args[0], {(55, 'saved_processos_vinculados', 0)})
        mocked_load_deliveries.assert_called_once_with(supervisor, [entry])
        mocked_ensure_delivery.assert_not_called()
        mocked_sync_single.assert_called_once_with(
            entry,
            supervisor,
            selected_delivery,
            request=None,
            allow_post=True,
        )

    @patch('contratos.services.slack_supervisao._sync_single_delivery')
    @patch('contratos.services.slack_supervisao._ensure_delivery_for_entry')
    @patch('contratos.services.slack_supervisao._load_deliveries_for_supervisor_entries')
    @patch('contratos.services.slack_supervisao._load_analyses_for_entries')
    @patch('contratos.services.slack_supervisao._collect_entries_for_selected_keys')
    @patch('contratos.api.views.is_supervisor_user', return_value=True)
    @patch('contratos.services.slack_supervisao.UserSlackConfig.objects')
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects')
    def test_selected_refresh_supports_selection_keys_without_local_delivery_id(
        self,
        mocked_delivery_objects,
        mocked_config_objects,
        _mocked_is_supervisor_user,
        mocked_collect_entries,
        mocked_load_analyses,
        mocked_load_deliveries,
        mocked_ensure_delivery,
        mocked_sync_single,
    ):
        supervisor = SimpleNamespace(
            pk=2,
            username='Maicon.Bispo',
            get_full_name=lambda: 'Maicon Bispo',
        )
        config = SimpleNamespace(user=supervisor, user_id=2, allowed_analysis_type_slugs=lambda: [])
        delivery = SimpleNamespace(
            pk=41,
            supervisor_id=2,
            supervisor=supervisor,
            analise_id=55,
            card_source='saved_processos_vinculados',
            card_index=0,
            slack_channel_id='',
            slack_message_ts='',
        )
        mocked_delivery_objects.select_related.return_value.filter.return_value.order_by.return_value = []
        mocked_config_objects.select_related.return_value.filter.return_value.exclude.return_value = [config]
        entry = {
            'analise_id': 55,
            'card_source': 'saved_processos_vinculados',
            'card_index': 0,
            'supervisor_status': 'pendente',
            'analysis_type_slug': 'esteira_3',
        }
        mocked_collect_entries.return_value = {(55, 'saved_processos_vinculados', 0): entry}
        mocked_load_analyses.return_value = {55: SimpleNamespace(pk=55, processo_judicial=None, processo_judicial_id=None)}
        mocked_load_deliveries.return_value = {(55, 'saved_processos_vinculados', 0): delivery}
        mocked_sync_single.return_value = {'sent': True, 'queued': False}
        request = SimpleNamespace(user=supervisor)

        result = sync_supervision_slack_for_selected_deliveries(
            [],
            request=request,
            selection_keys=['55|saved_processos_vinculados|0'],
        )

        self.assertEqual(result['errors'], [])
        self.assertEqual(result['recipients'], ['Maicon Bispo'])
        mocked_collect_entries.assert_called_once()
        self.assertEqual(mocked_collect_entries.call_args.args[0], {(55, 'saved_processos_vinculados', 0)})
        mocked_load_deliveries.assert_called_once_with(supervisor, [entry])
        mocked_ensure_delivery.assert_not_called()
        mocked_sync_single.assert_called_once_with(
            entry,
            supervisor,
            delivery,
            request=request,
            allow_post=True,
        )

    @patch('contratos.services.slack_supervisao._sync_single_delivery')
    @patch('contratos.services.slack_supervisao._ensure_delivery_for_entry')
    @patch('contratos.services.slack_supervisao._load_deliveries_for_supervisor_entries')
    @patch('contratos.services.slack_supervisao._load_analyses_for_entries')
    @patch('contratos.services.slack_supervisao._collect_entries_for_selected_keys')
    @patch('contratos.services.slack_supervisao.UserSlackConfig.objects')
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects')
    def test_selected_refresh_syncs_selected_card_for_all_eligible_supervisors(
        self,
        mocked_delivery_objects,
        mocked_config_objects,
        mocked_collect_entries,
        mocked_load_analyses,
        mocked_load_deliveries,
        mocked_ensure_delivery,
        mocked_sync_single,
    ):
        supervisor_a = SimpleNamespace(
            pk=2,
            username='supervisor.a',
            get_full_name=lambda: 'Supervisor A',
        )
        supervisor_b = SimpleNamespace(
            pk=3,
            username='supervisor.b',
            get_full_name=lambda: 'Supervisor B',
        )
        config_a = SimpleNamespace(
            user=supervisor_a,
            user_id=2,
            slack_user_id='UA',
            allowed_analysis_type_slugs=lambda: [],
        )
        config_b = SimpleNamespace(
            user=supervisor_b,
            user_id=3,
            slack_user_id='UB',
            allowed_analysis_type_slugs=lambda: [],
        )
        selected_delivery = SimpleNamespace(
            pk=41,
            supervisor_id=2,
            supervisor=supervisor_a,
            analise_id=55,
            card_source='saved_processos_vinculados',
            card_index=0,
            slack_channel_id='',
            slack_message_ts='',
        )
        delivery_b = SimpleNamespace(
            pk=42,
            supervisor_id=3,
            supervisor=supervisor_b,
            analise_id=55,
            card_source='saved_processos_vinculados',
            card_index=0,
            slack_channel_id='',
            slack_message_ts='',
        )
        mocked_delivery_objects.select_related.return_value.filter.return_value.order_by.return_value = [selected_delivery]
        mocked_config_objects.select_related.return_value.filter.return_value.exclude.return_value = [config_a, config_b]
        selected_key = (55, 'saved_processos_vinculados', 0)
        entry_a = {
            'analise_id': 55,
            'card_source': 'saved_processos_vinculados',
            'card_index': 0,
            'supervisor_status': 'pendente',
            'analysis_type_slug': 'novas-monitorias',
        }
        mocked_collect_entries.return_value = {selected_key: entry_a}
        mocked_load_analyses.return_value = {55: SimpleNamespace(pk=55, processo_judicial=None, processo_judicial_id=None)}

        def load_deliveries(supervisor, entries):
            self.assertEqual(entries, [entry_a])
            if supervisor.pk == supervisor_a.pk:
                return {selected_key: selected_delivery}
            if supervisor.pk == supervisor_b.pk:
                return {selected_key: delivery_b}
            return {}

        mocked_load_deliveries.side_effect = load_deliveries
        mocked_sync_single.return_value = {'sent': True, 'queued': False}

        result = sync_supervision_slack_for_selected_deliveries([41])

        self.assertEqual(result['errors'], [])
        self.assertEqual(result['recipients'], ['Supervisor A', 'Supervisor B'])
        self.assertEqual(result['eligible_recipients'], ['Supervisor A', 'Supervisor B'])
        mocked_collect_entries.assert_called_once()
        self.assertEqual(mocked_load_deliveries.call_count, 2)
        mocked_ensure_delivery.assert_not_called()
        self.assertEqual(mocked_sync_single.call_count, 2)
        mocked_sync_single.assert_any_call(
            entry_a,
            supervisor_a,
            selected_delivery,
            request=None,
            allow_post=True,
        )
        mocked_sync_single.assert_any_call(
            entry_a,
            supervisor_b,
            delivery_b,
            request=None,
            allow_post=True,
        )

    @patch('contratos.services.slack_supervisao._sync_single_delivery')
    @patch('contratos.services.slack_supervisao._ensure_delivery_for_entry')
    @patch('contratos.services.slack_supervisao._load_deliveries_for_supervisor_entries')
    @patch('contratos.services.slack_supervisao._load_analyses_for_entries')
    @patch('contratos.services.slack_supervisao._collect_entries_for_selected_keys')
    @patch('contratos.services.slack_supervisao.UserSlackConfig.objects')
    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects')
    def test_selected_refresh_creates_missing_delivery_for_second_supervisor(
        self,
        mocked_delivery_objects,
        mocked_config_objects,
        mocked_collect_entries,
        mocked_load_analyses,
        mocked_load_deliveries,
        mocked_ensure_delivery,
        mocked_sync_single,
    ):
        supervisor_a = SimpleNamespace(pk=2, username='a', get_full_name=lambda: 'Supervisor A')
        supervisor_b = SimpleNamespace(pk=3, username='b', get_full_name=lambda: 'Supervisor B')
        config_a = SimpleNamespace(user=supervisor_a, user_id=2, slack_user_id='UA', allowed_analysis_type_slugs=lambda: ['novas-monitorias'])
        config_b = SimpleNamespace(user=supervisor_b, user_id=3, slack_user_id='UB', allowed_analysis_type_slugs=lambda: ['novas-monitorias'])
        selected_delivery = SimpleNamespace(
            pk=41,
            supervisor_id=2,
            supervisor=supervisor_a,
            analise_id=55,
            card_source='saved_processos_vinculados',
            card_index=0,
            slack_channel_id='',
            slack_message_ts='',
        )
        created_delivery_b = SimpleNamespace(
            pk=42,
            supervisor_id=3,
            supervisor=supervisor_b,
            analise_id=55,
            card_source='saved_processos_vinculados',
            card_index=0,
            slack_channel_id='',
            slack_message_ts='',
        )
        mocked_delivery_objects.select_related.return_value.filter.return_value.order_by.return_value = [selected_delivery]
        mocked_config_objects.select_related.return_value.filter.return_value.exclude.return_value = [config_a, config_b]
        selected_key = (55, 'saved_processos_vinculados', 0)
        entry = {
            'analise_id': 55,
            'card_source': 'saved_processos_vinculados',
            'card_index': 0,
            'supervisor_status': 'pendente',
            'analysis_type_slug': 'novas-monitorias',
        }
        mocked_collect_entries.return_value = {selected_key: entry}
        mocked_load_analyses.return_value = {55: SimpleNamespace(pk=55, processo_judicial=None, processo_judicial_id=None)}

        def load_deliveries(supervisor, entries):
            self.assertEqual(entries, [entry])
            if supervisor.pk == supervisor_a.pk:
                return {selected_key: selected_delivery}
            return {}

        def ensure_delivery(supervisor, config, entry_payload, deliveries_by_key=None, analyses_by_id=None):
            self.assertEqual(supervisor.pk, supervisor_b.pk)
            self.assertEqual(entry_payload, entry)
            deliveries_by_key[selected_key] = created_delivery_b
            return created_delivery_b

        mocked_load_deliveries.side_effect = load_deliveries
        mocked_ensure_delivery.side_effect = ensure_delivery
        mocked_sync_single.return_value = {'sent': True, 'queued': False}

        result = sync_supervision_slack_for_selected_deliveries([41])

        self.assertEqual(result['errors'], [])
        self.assertEqual(result['recipients'], ['Supervisor A', 'Supervisor B'])
        mocked_ensure_delivery.assert_called_once()
        mocked_sync_single.assert_any_call(entry, supervisor_a, selected_delivery, request=None, allow_post=True)
        mocked_sync_single.assert_any_call(entry, supervisor_b, created_delivery_b, request=None, allow_post=True)


class SlackAnalysisGroupingTests(SimpleTestCase):
    def test_supervisor_accepts_entry_with_normalized_slug_variants(self):
        config = SimpleNamespace(
            allowed_analysis_type_slugs=lambda: ['esteira-3'],
        )

        accepted = _supervisor_accepts_entry(config, {
            'analysis_type_slug': 'esteira_3',
            'analysis_type_nome': 'Esteira 3',
        })

        self.assertTrue(accepted)

    def test_group_key_falls_back_to_name_when_slug_is_missing(self):
        key = _entry_analysis_group_key({
            'analysis_type_nome': 'Novas Monitorias',
            'analysis_type_slug': '',
        })

        self.assertEqual(key, 'novas monitorias')

    def test_group_key_falls_back_to_card_source_when_type_metadata_is_missing(self):
        key = _entry_analysis_group_key({
            'card_source': 'saved_processos_vinculados',
        })

        self.assertEqual(key, 'saved_processos_vinculados')


class SlackRemoteDeliveryKeyTests(SimpleTestCase):
    def test_builds_and_parses_remote_delivery_key(self):
        key = _build_remote_slack_delivery_key('D123', '1743072809.123456')
        self.assertEqual(key, 'remote:D123:1743072809.123456')
        self.assertEqual(
            _parse_remote_slack_delivery_key(key),
            {
                'slack_channel_id': 'D123',
                'slack_message_ts': '1743072809.123456',
                'message_kind': 'root',
            },
        )

    def test_builds_and_parses_remote_reply_delivery_key(self):
        key = _build_remote_slack_delivery_key('D123', '1743072809.123456', message_kind='thread_reply_orphan')
        self.assertEqual(key, 'remote_reply:D123:1743072809.123456')
        self.assertEqual(
            _parse_remote_slack_delivery_key(key),
            {
                'slack_channel_id': 'D123',
                'slack_message_ts': '1743072809.123456',
                'message_kind': 'thread_reply_orphan',
            },
        )


class SlackRemoteMessageFetchTests(SimpleTestCase):
    @patch('contratos.services.slack_supervisao.fetch_slack_conversation_history')
    @patch('contratos.services.slack_supervisao.open_slack_dm')
    def test_collects_orphan_thread_reply_using_root_thread_ts(self, mocked_open_dm, mocked_fetch_history):
        mocked_open_dm.return_value = 'D123'
        mocked_fetch_history.return_value = {
            'messages': [
                {
                    'ts': '200.002',
                    'thread_ts': '200.000',
                    'text': '*Status atualizado no sistema*\nSupervisor: Maicon\nStatus: Aprovado',
                },
            ],
        }
        config = SimpleNamespace(
            slack_user_id='U123',
            user=SimpleNamespace(pk=7, username='maicon', get_full_name=lambda: 'Maicon Bispo'),
        )

        results, errors = fetch_remote_supervision_slack_messages([config])

        self.assertEqual(errors, [])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['slack_channel_id'], 'D123')
        self.assertEqual(results[0]['slack_message_ts'], '200.002')
        self.assertEqual(results[0]['slack_root_ts'], '200.000')
        self.assertEqual(results[0]['message_kind'], 'thread_reply_orphan')


class DeleteSlackDeliveriesTests(SimpleTestCase):
    @patch('contratos.services.slack_supervisao.delete_slack_message')
    def test_delete_remote_orphan_reply_uses_reply_ts_directly(self, mocked_delete_message):
        result = delete_supervision_slack_deliveries(
            [],
            remote_refs=[{
                'slack_channel_id': 'D123',
                'slack_message_ts': '200.002',
                'message_kind': 'thread_reply_orphan',
            }],
        )

        mocked_delete_message.assert_called_once_with('D123', '200.002')
        self.assertEqual(result['deleted_remote_count'], 1)

    @patch('contratos.services.slack_supervisao.fetch_slack_thread_replies')
    def test_delete_slack_thread_reports_when_root_was_already_deleted(self, mocked_fetch_replies):
        mocked_fetch_replies.side_effect = ValueError('thread_not_found')

        with self.assertRaises(RuntimeError):
            delete_slack_thread('D123', '100.000')

    @patch('contratos.services.slack_supervisao.delete_slack_message')
    @patch('contratos.services.slack_supervisao.fetch_slack_thread_replies')
    def test_delete_slack_thread_deletes_child_replies_before_root(self, mocked_fetch_replies, mocked_delete_message):
        mocked_fetch_replies.return_value = {
            'messages': [
                {'ts': '100.000', 'thread_ts': '100.000'},
                {'ts': '100.002', 'thread_ts': '100.000'},
                {'ts': '100.003', 'thread_ts': '100.000'},
            ],
        }

        deleted_count = delete_slack_thread('D123', '100.000')

        self.assertEqual(deleted_count, 3)
        self.assertEqual(
            mocked_delete_message.call_args_list,
            [
                call('D123', '100.003'),
                call('D123', '100.002'),
                call('D123', '100.000'),
            ],
        )

    def test_does_not_delete_local_record_when_sent_message_has_no_identifiers(self):
        delivery = SimpleNamespace(
            pk=1,
            slack_channel_id='',
            slack_message_ts='',
            notified_at=date(2026, 3, 27),
        )

        result = delete_supervision_slack_deliveries([delivery])

        self.assertEqual(result['deleted_count'], 0)
        self.assertEqual(len(result['errors']), 1)
