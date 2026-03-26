import hashlib
import json
import logging
from datetime import timedelta
from types import SimpleNamespace

import requests
from django.conf import settings
from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone

from contratos.models import AnaliseProcesso, SupervisaoSlackEntrega, UserSlackConfig

logger = logging.getLogger(__name__)

SUPERVISOR_GROUP_NAMES = ('Supervisor', 'Supervisor Desenvolvedor')
SUPERVISION_PENDING_STATUSES = {'pendente', 'pre_aprovado'}
SUPERVISION_FINAL_STATUSES = {'aprovado', 'reprovado'}
SUPERVISION_STATUS_LABELS = {
    'pendente': 'Pendente',
    'pre_aprovado': 'Pre-aprovado',
    'aprovado': 'Aprovado',
    'reprovado': 'Reprovado',
}
SLACK_API_TIMEOUT = 30


def _slack_bot_token():
    return str(getattr(settings, 'SLACK_BOT_TOKEN', '') or '').strip()


def _slack_signing_secret():
    return str(getattr(settings, 'SLACK_SIGNING_SECRET', '') or '').strip()


def slack_supervisao_enabled():
    return bool(_slack_bot_token())


def slack_supervisao_interactive_enabled():
    return bool(_slack_bot_token() and _slack_signing_secret())


def _build_public_base_url(request=None):
    request_host = ''
    if request is not None:
        try:
            request_host = request.build_absolute_uri('/').rstrip('/')
        except Exception:
            request_host = ''
    if request_host:
        return request_host

    configured = str(getattr(settings, 'APP_BASE_URL', '') or '').strip().rstrip('/')
    if configured:
        return configured

    allowed_hosts = [
        str(host or '').strip()
        for host in (getattr(settings, 'ALLOWED_HOSTS', None) or [])
        if str(host or '').strip()
    ]
    for host in allowed_hosts:
        if host in {'*', 'localhost', '127.0.0.1'}:
            continue
        return f'https://{host}'

    return 'http://127.0.0.1:8000'


def _build_entry_focus_url(entry, request=None):
    process_id = entry.get('processo_id')
    if not process_id:
        return ''
    base_url = _build_public_base_url(request)
    path = reverse('admin:contratos_processojudicial_change', args=[process_id])
    params = {
        'tab': 'supervisionar',
        'open_agenda': '1',
        'agenda_focus_type': 'S',
        'agenda_focus_date': entry.get('date') or '',
        'agenda_focus_card': entry.get('cardId') or '',
        'agenda_focus_analise_id': entry.get('analise_id') or '',
        'agenda_focus_source': entry.get('card_source') or '',
        'agenda_focus_index': entry.get('card_index') if entry.get('card_index') is not None else '',
    }
    encoded_parts = []
    for key, value in params.items():
        if value in (None, ''):
            continue
        encoded_parts.append(f'{key}={requests.utils.quote(str(value), safe="")}')
    query = '&'.join(encoded_parts)
    return f'{base_url}{path}?{query}' if query else f'{base_url}{path}'


def _collect_supervision_entries_for_supervisor(supervisor, analise_id=None):
    from contratos.api.views import AgendaGeralAPIView

    dummy_request = SimpleNamespace(user=supervisor)
    view = AgendaGeralAPIView()
    collected = []
    for show_completed in (False, True):
        try:
            entries = view._get_supervision_entries(show_completed, dummy_request, target_user=supervisor)
        except Exception as exc:
            logger.exception('Falha ao montar entradas de supervisao para Slack', exc_info=exc)
            return []
        for entry in entries or []:
            if analise_id and int(entry.get('analise_id') or 0) != int(analise_id):
                continue
            collected.append(entry)
    return collected


def _build_entry_key(entry):
    try:
        return (
            int(entry.get('analise_id') or 0),
            str(entry.get('card_source') or '').strip(),
            int(entry.get('card_index') or 0),
        )
    except (TypeError, ValueError):
        return None


def _entry_file_summary(entry):
    items = []
    for summary_item in entry.get('monitoria_files_summary') or []:
        sigla = str(summary_item.get('sigla') or '').strip()
        if not sigla:
            continue
        items.append(f'{sigla} {"OK" if summary_item.get("present") else "FALTA"}')
    return ' | '.join(items) if items else 'Sem checagem de arquivos.'


def _normalize_analysis_slug(value):
    return str(value or '').strip().lower()


def _entry_analysis_type_slug(entry):
    return _normalize_analysis_slug(
        entry.get('analysis_type_slug')
        or entry.get('analysisTypeSlug')
        or ''
    )


def _supervisor_accepts_entry(config, entry):
    allowed_slugs = config.allowed_analysis_type_slugs() if config else []
    if not allowed_slugs:
        return True
    entry_slug = _entry_analysis_type_slug(entry)
    return bool(entry_slug and entry_slug in allowed_slugs)


def _format_analysis_lines(entry):
    lines = []
    for raw_line in entry.get('analysis_lines') or []:
        text = str(raw_line or '').strip()
        if not text:
            continue
        lines.append(f'• {text}')
    return '\n'.join(lines) if lines else 'Sem resumo procedural.'


def _build_supervision_message(entry, *, request=None):
    nome = str(entry.get('nome') or entry.get('parte_nome') or 'Parte não informada').strip()
    cpf = str(entry.get('cpf') or entry.get('documento') or '').strip()
    uf = str(entry.get('uf') or '').strip().upper() or 'UF não informada'
    tipo = str(entry.get('analysis_type_nome') or entry.get('analysis_type_short') or 'Análise').strip()
    date_label = str(entry.get('date') or '').strip()
    status_key = str(entry.get('supervisor_status') or 'pendente').strip().lower()
    status_label = SUPERVISION_STATUS_LABELS.get(status_key, status_key.capitalize() or 'Pendente')
    title = (
        'Nova supervisão pendente'
        if status_key in SUPERVISION_PENDING_STATUSES
        else f'Supervisão {status_label.lower()}'
    )
    analyst = entry.get('analyst') or {}
    analyst_name = (
        str(analyst.get('first_name') or '').strip()
        or str(analyst.get('username') or '').strip()
        or 'Não informado'
    )
    note = str(entry.get('supervisor_observacoes') or '').strip()
    note_author = str(entry.get('supervisor_observacoes_autor') or '').strip()
    focus_url = _build_entry_focus_url(entry, request=request)
    files_summary = _entry_file_summary(entry)
    analysis_summary = _format_analysis_lines(entry)
    cnj_label = str(entry.get('cnj_label') or '').strip() or 'Não Judicializado'
    top_text = (
        f'*{nome}*\n'
        f'CPF: {cpf or "Não informado"} | UF: {uf}\n'
        f'Tipo: {tipo} | Data S: {date_label or "Não informada"}\n'
        f'CNJ: {cnj_label}\n'
        f'Analista: {analyst_name}'
    )
    blocks = [
        {
            'type': 'header',
            'text': {
                'type': 'plain_text',
                'text': title[:150],
                'emoji': True,
            },
        },
        {
            'type': 'section',
            'text': {
                'type': 'mrkdwn',
                'text': top_text[:2900],
            },
        },
        {
            'type': 'section',
            'text': {
                'type': 'mrkdwn',
                'text': f'*Resumo procedural*\n{analysis_summary}'[:2900],
            },
        },
        {
            'type': 'section',
            'text': {
                'type': 'mrkdwn',
                'text': f'*Checagem de arquivos*\n{files_summary}'[:2900],
            },
        },
    ]
    if note and status_key in SUPERVISION_FINAL_STATUSES:
        note_text = f'*Devolutiva*\n{note}'
        if note_author:
            note_text += f'\nPor: {note_author}'
        blocks.append({
            'type': 'section',
            'text': {'type': 'mrkdwn', 'text': note_text[:2900]},
        })
    action_elements = []
    if focus_url:
        action_elements.append({
            'type': 'button',
            'text': {'type': 'plain_text', 'text': 'Abrir na Agenda Geral', 'emoji': True},
            'url': focus_url,
            'action_id': 'open_supervision_agenda',
        })
    if status_key in SUPERVISION_PENDING_STATUSES and slack_supervisao_interactive_enabled():
        metadata = json.dumps({
            'analise_id': entry.get('analise_id'),
            'source': entry.get('card_source'),
            'index': entry.get('card_index'),
            'card_id': entry.get('cardId'),
        }, ensure_ascii=True)
        action_elements.extend([
            {
                'type': 'button',
                'text': {'type': 'plain_text', 'text': 'Aprovar', 'emoji': True},
                'style': 'primary',
                'action_id': 'supervision_approve',
                'value': json.dumps({'metadata': metadata, 'status': 'aprovado'}),
            },
            {
                'type': 'button',
                'text': {'type': 'plain_text', 'text': 'Reprovar', 'emoji': True},
                'style': 'danger',
                'action_id': 'supervision_reprove',
                'value': json.dumps({'metadata': metadata, 'status': 'reprovado'}),
            },
        ])
    if action_elements:
        blocks.append({'type': 'actions', 'elements': action_elements})
    fallback_text = (
        f'{title} - {nome} - {cpf or "Sem CPF"} - {tipo} - {status_label}\n'
        f'{analysis_summary}\n'
        f'Arquivos: {files_summary}'
    )
    message_hash = hashlib.sha256(
        json.dumps({'text': fallback_text, 'blocks': blocks}, ensure_ascii=True, sort_keys=True).encode('utf-8')
    ).hexdigest()
    return {
        'text': fallback_text[:4000],
        'blocks': blocks,
        'hash': message_hash,
        'status_key': status_key,
        'status_label': status_label,
    }


def _slack_api_post(method, *, token=None, json_payload=None, data_payload=None):
    api_token = str(token or _slack_bot_token()).strip()
    if not api_token:
        raise ValueError('SLACK_BOT_TOKEN não configurado.')
    headers = {'Authorization': f'Bearer {api_token}'}
    if json_payload is not None:
        headers['Content-Type'] = 'application/json; charset=utf-8'
    response = requests.post(
        f'https://slack.com/api/{method}',
        headers=headers,
        json=json_payload,
        data=data_payload,
        timeout=SLACK_API_TIMEOUT,
    )
    payload = response.json()
    if not payload.get('ok'):
        raise ValueError(str(payload.get('error') or 'erro_desconhecido'))
    return payload


def open_slack_dm(slack_user_id):
    payload = _slack_api_post('conversations.open', data_payload={'users': slack_user_id})
    channel = payload.get('channel') or {}
    return str(channel.get('id') or '').strip()


def post_slack_message(channel_id, *, text, blocks):
    return _slack_api_post(
        'chat.postMessage',
        json_payload={'channel': channel_id, 'text': text, 'blocks': blocks},
    )


def update_slack_message(channel_id, message_ts, *, text, blocks):
    return _slack_api_post(
        'chat.update',
        json_payload={'channel': channel_id, 'ts': message_ts, 'text': text, 'blocks': blocks},
    )


def post_slack_thread_reply(channel_id, thread_ts, text):
    return _slack_api_post(
        'chat.postMessage',
        json_payload={'channel': channel_id, 'thread_ts': thread_ts, 'text': text},
    )


def add_slack_reaction(channel_id, message_ts, reaction_name):
    try:
        _slack_api_post(
            'reactions.add',
            data_payload={'channel': channel_id, 'timestamp': message_ts, 'name': reaction_name},
        )
    except ValueError as exc:
        error_text = str(exc)
        if error_text not in {'already_reacted', 'invalid_name'}:
            raise


def open_supervision_decision_modal(trigger_id, *, metadata_json, desired_status, entry, slack_user_id):
    api_token = _slack_bot_token()
    if not api_token:
        raise ValueError('SLACK_BOT_TOKEN não configurado.')
    status_label = SUPERVISION_STATUS_LABELS.get(desired_status, desired_status.capitalize())
    nome = str(entry.get('nome') or 'Parte').strip()
    cpf = str(entry.get('cpf') or '').strip()
    blocks = [
        {
            'type': 'section',
            'text': {
                'type': 'mrkdwn',
                'text': (
                    f'*{status_label} supervisão*\n'
                    f'{nome} · CPF {cpf or "Não informado"}'
                ),
            },
        },
        {
            'type': 'input',
            'block_id': 'devolutiva_block',
            'optional': True,
            'label': {'type': 'plain_text', 'text': 'Devolutiva'},
            'element': {
                'type': 'plain_text_input',
                'action_id': 'devolutiva_input',
                'multiline': True,
                'placeholder': {'type': 'plain_text', 'text': 'Escreva a devolutiva do supervisor.'},
            },
        },
    ]
    return _slack_api_post(
        'views.open',
        token=api_token,
        json_payload={
            'trigger_id': trigger_id,
            'view': {
                'type': 'modal',
                'callback_id': 'supervision_decision_modal',
                'private_metadata': json.dumps({
                    'metadata': metadata_json,
                    'status': desired_status,
                    'slack_user_id': slack_user_id,
                }),
                'title': {'type': 'plain_text', 'text': 'Supervisão'},
                'submit': {'type': 'plain_text', 'text': status_label},
                'close': {'type': 'plain_text', 'text': 'Cancelar'},
                'blocks': blocks,
            },
        },
    )


def _thread_update_text(entry, actor_name, status_key):
    status_label = SUPERVISION_STATUS_LABELS.get(status_key, status_key.capitalize())
    timestamp_label = timezone.localtime().strftime('%d/%m/%Y às %H:%M')
    note = str(entry.get('supervisor_observacoes') or '').strip()
    lines = [
        f'*Status atualizado no sistema*',
        f'Supervisor: {actor_name}',
        f'Status: {status_label}',
        f'Atualizado em: {timestamp_label}',
    ]
    if note:
        lines.append(f'Devolutiva: {note}')
    return '\n'.join(lines)


def _sync_single_delivery(entry, supervisor, delivery, *, request=None):
    message = _build_supervision_message(entry, request=request)
    status_key = message['status_key']
    status_changed = status_key != str(delivery.last_status or '').strip().lower()

    if not delivery.slack_channel_id or not delivery.slack_message_ts:
        channel_id = open_slack_dm(delivery.slack_user_id)
        posted = post_slack_message(channel_id, text=message['text'], blocks=message['blocks'])
        delivery.slack_channel_id = channel_id
        delivery.slack_message_ts = str(posted.get('ts') or '').strip()
        delivery.slack_thread_ts = delivery.slack_message_ts
        delivery.notified_at = timezone.now()
    elif message['hash'] != str(delivery.message_hash or ''):
        update_slack_message(
            delivery.slack_channel_id,
            delivery.slack_message_ts,
            text=message['text'],
            blocks=message['blocks'],
        )

    if status_key in SUPERVISION_FINAL_STATUSES and status_changed and delivery.slack_channel_id and delivery.slack_thread_ts:
        actor_name = (
            str(entry.get('supervisor_status_autor') or '').strip()
            or str(entry.get('supervisor_observacoes_autor') or '').strip()
            or 'Supervisor'
        )
        post_slack_thread_reply(
            delivery.slack_channel_id,
            delivery.slack_thread_ts,
            _thread_update_text(entry, actor_name, status_key),
        )
        add_slack_reaction(
            delivery.slack_channel_id,
            delivery.slack_message_ts,
            'white_check_mark' if status_key == 'aprovado' else 'x',
        )
        delivery.resolved_at = timezone.now()
    elif status_key in SUPERVISION_PENDING_STATUSES:
        delivery.resolved_at = None

    delivery.message_hash = message['hash']
    delivery.last_status = status_key
    delivery.card_id = str(entry.get('cardId') or delivery.card_id or '')
    delivery.save(
        update_fields=[
            'slack_channel_id',
            'slack_message_ts',
            'slack_thread_ts',
            'notified_at',
            'resolved_at',
            'message_hash',
            'last_status',
            'card_id',
            'updated_at',
        ],
    )


def sync_supervision_slack_for_analysis(analise_id, *, request=None):
    if not slack_supervisao_enabled():
        return {
            'recipients': [],
            'eligible_recipients': [],
            'errors': [],
            'has_pending_entries': False,
        }
    try:
        analise = AnaliseProcesso.objects.select_related('processo_judicial').get(pk=analise_id)
    except AnaliseProcesso.DoesNotExist:
        return {
            'recipients': [],
            'eligible_recipients': [],
            'errors': [],
            'has_pending_entries': False,
        }

    supervisor_configs = list(
        UserSlackConfig.objects.select_related('user')
        .filter(
            user__is_active=True,
            user__groups__name__in=SUPERVISOR_GROUP_NAMES,
        )
        .exclude(slack_user_id='')
        .distinct()
    )
    if not supervisor_configs:
        return {
            'recipients': [],
            'eligible_recipients': [],
            'errors': [],
            'has_pending_entries': False,
        }

    recipient_names = set()
    eligible_names = set()
    errors = []
    has_pending_entries = False

    for config in supervisor_configs:
        supervisor = config.user
        entries = _collect_supervision_entries_for_supervisor(supervisor, analise_id=analise.pk)
        entry_map = {
            _build_entry_key(entry): entry
            for entry in entries
            if _build_entry_key(entry) and _supervisor_accepts_entry(config, entry)
        }
        if entry_map:
            has_pending_entries = True
            eligible_names.add(
                str(supervisor.get_full_name()).strip() or str(supervisor.username).strip()
            )
        deliveries = {
            (delivery.analise_id, delivery.card_source, delivery.card_index): delivery
            for delivery in SupervisaoSlackEntrega.objects.filter(analise=analise, supervisor=supervisor)
        }

        for key, entry in entry_map.items():
            if not key:
                continue
            delivery = deliveries.get(key)
            if delivery is None:
                delivery = SupervisaoSlackEntrega.objects.create(
                    analise=analise,
                    processo=analise.processo_judicial,
                    supervisor=supervisor,
                    card_id=str(entry.get('cardId') or ''),
                    card_source=str(entry.get('card_source') or ''),
                    card_index=int(entry.get('card_index') or 0),
                    slack_user_id=config.slack_user_id,
                )
            elif delivery.slack_user_id != config.slack_user_id:
                delivery.slack_user_id = config.slack_user_id
                delivery.save(update_fields=['slack_user_id', 'updated_at'])

            try:
                _sync_single_delivery(entry, supervisor, delivery, request=request)
                recipient_names.add(
                    str(supervisor.get_full_name()).strip() or str(supervisor.username).strip()
                )
            except Exception as exc:
                errors.append({
                    'supervisor': str(supervisor.get_full_name()).strip() or str(supervisor.username).strip(),
                    'error': str(exc),
                })
                logger.exception(
                    'Falha ao sincronizar entrega Slack da supervisao analise=%s supervisor=%s',
                    analise.pk,
                    supervisor.pk,
                    exc_info=exc,
                )
    return {
        'recipients': sorted(name for name in recipient_names if name),
        'eligible_recipients': sorted(name for name in eligible_names if name),
        'errors': errors,
        'has_pending_entries': has_pending_entries,
    }


def sync_supervision_slack_for_supervisor(user_id, *, request=None):
    if not slack_supervisao_enabled():
        return {'recipients': []}
    config = (
        UserSlackConfig.objects.select_related('user')
        .filter(user_id=user_id, user__is_active=True)
        .exclude(slack_user_id='')
        .first()
    )
    if not config:
        return {'recipients': []}
    supervisor = config.user
    entries = _collect_supervision_entries_for_supervisor(supervisor)
    for entry in entries:
        if not _supervisor_accepts_entry(config, entry):
            continue
        if str(entry.get('supervisor_status') or '').strip().lower() not in SUPERVISION_PENDING_STATUSES:
            continue
        analise_id = entry.get('analise_id')
        if analise_id:
            sync_supervision_slack_for_analysis(analise_id, request=request)
    return {
        'recipients': [str(supervisor.get_full_name()).strip() or str(supervisor.username).strip()],
    }


def get_supervision_entry_for_card(*, supervisor, analise_id, source, index):
    entries = _collect_supervision_entries_for_supervisor(supervisor, analise_id=analise_id)
    for entry in entries:
        if str(entry.get('card_source') or '') != str(source or ''):
            continue
        try:
            entry_index = int(entry.get('card_index'))
        except (TypeError, ValueError):
            continue
        if entry_index == int(index):
            return entry
    return None
