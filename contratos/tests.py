from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from rest_framework.renderers import JSONRenderer

from contratos.api.views import (
    SlackSupervisionDeliveryDeleteAPIView,
    SlackSupervisionDeliveryListAPIView,
    SlackSupervisionDeliveryRefreshAPIView,
    _resolve_supervision_card_contracts,
    _resolve_supervision_entry_date,
)
from contratos.services.slack_supervisao import _save_delivery, _slack_api_post


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
    def test_uses_full_save_directly(self):
        delivery = Mock()
        delivery.pk = 99

        _save_delivery(delivery, update_fields=['message_hash', 'updated_at', 'invalid_field'])

        delivery.save.assert_called_once_with()

    def test_converts_base_exception_from_save_into_runtime_error(self):
        delivery = Mock()
        delivery.pk = 99
        delivery.save.side_effect = SystemExit(1)

        with self.assertRaises(RuntimeError):
            _save_delivery(delivery, update_fields=['message_hash'])


class SlackApiPostTests(SimpleTestCase):
    @patch('contratos.services.slack_supervisao.requests.post')
    def test_converts_base_exception_from_requests_into_runtime_error(self, mocked_post):
        mocked_post.side_effect = SystemExit(1)

        with self.assertRaises(RuntimeError):
            _slack_api_post('chat.postMessage', token='xoxb-test', json_payload={'channel': 'C1'})


class SlackDeliveryViewRendererTests(SimpleTestCase):
    def test_slack_delivery_views_render_only_json(self):
        self.assertEqual(SlackSupervisionDeliveryListAPIView.renderer_classes, [JSONRenderer])
        self.assertEqual(SlackSupervisionDeliveryDeleteAPIView.renderer_classes, [JSONRenderer])
        self.assertEqual(SlackSupervisionDeliveryRefreshAPIView.renderer_classes, [JSONRenderer])
