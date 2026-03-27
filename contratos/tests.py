from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from rest_framework.renderers import JSONRenderer

from contratos.api.views import (
    SlackSupervisionDeliveryDeleteAPIView,
    SlackSupervisionDeliveryListAPIView,
    SlackSupervisionDeliveryRefreshAPIView,
    _build_slack_delivery_entry_payload,
    _build_slack_delivery_summary,
    _build_remote_slack_delivery_key,
    _parse_remote_slack_delivery_key,
    _resolve_supervision_card_contracts,
    _resolve_supervision_entry_date,
)
from contratos.services.slack_supervisao import _save_delivery, _slack_api_post
from contratos.services.slack_supervisao import delete_supervision_slack_deliveries, ensure_supervision_delivery_records


class ResolveSupervisionEntryDateTests(SimpleTestCase):
    def test_custom_supervision_date_takes_precedence(self):
        result = _resolve_supervision_entry_date('2026-04-10', '2026-03-31')
        self.assertEqual(result, date(2026, 4, 10))

    def test_prescricao_date_is_used_when_custom_date_is_missing(self):
        result = _resolve_supervision_entry_date('', '2026-03-31')
        self.assertEqual(result, date(2026, 3, 31))


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

    @patch('contratos.services.slack_supervisao.SupervisaoSlackEntrega.objects.filter')
    def test_converts_base_exception_from_update_into_runtime_error(self, mocked_filter):
        mocked_filter.return_value.update.side_effect = SystemExit(1)
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

        with self.assertRaises(RuntimeError):
            _save_delivery(delivery, update_fields=['message_hash'])

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


class SlackDeliveryPayloadTests(SimpleTestCase):
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


class SlackDeliveryReconcileTests(SimpleTestCase):
    @patch('contratos.services.slack_supervisao._build_supervisor_delivery_context')
    def test_reconciles_delivery_records_for_each_supervisor_config(self, mocked_builder):
        config_a = SimpleNamespace(user=SimpleNamespace(pk=1, username='u1', get_full_name=lambda: 'U1'))
        config_b = SimpleNamespace(user=SimpleNamespace(pk=2, username='u2', get_full_name=lambda: 'U2'))

        errors = ensure_supervision_delivery_records([config_a, config_b])

        self.assertEqual(errors, [])
        self.assertEqual(mocked_builder.call_count, 2)


class SlackRemoteDeliveryKeyTests(SimpleTestCase):
    def test_builds_and_parses_remote_delivery_key(self):
        key = _build_remote_slack_delivery_key('D123', '1743072809.123456')
        self.assertEqual(key, 'remote:D123:1743072809.123456')
        self.assertEqual(
            _parse_remote_slack_delivery_key(key),
            {
                'slack_channel_id': 'D123',
                'slack_message_ts': '1743072809.123456',
            },
        )


class DeleteSlackDeliveriesTests(SimpleTestCase):
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
