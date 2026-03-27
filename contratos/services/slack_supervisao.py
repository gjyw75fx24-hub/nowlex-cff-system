import hashlib
import json
import logging
from datetime import timedelta
import time
from types import SimpleNamespace

import requests
from django.conf import settings
from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone

from contratos.models import AnaliseProcesso, SupervisaoSlackEntrega, UserSlackConfig
from contratos.services.supervisao_resumo import format_date_br

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
SUPERVISION_BATCH_SIZE_PER_TYPE = 5
SLACK_API_TIMEOUT = 30
SLACK_API_RETRY_ATTEMPTS = 3
SLACK_HISTORY_FETCH_LIMIT = 200
LEGACY_PENDING_STATUS_KEYS = {'enviado', 'sent'}


def _describe_slack_api_error(method, error_code):
    normalized_method = str(method or '').strip()
    normalized_error = str(error_code or '').strip()
    if normalized_error != 'missing_scope':
        return normalized_error or 'erro_desconhecido'
    if normalized_method == 'conversations.history':
        return 'missing_scope: o app do Slack precisa do escopo im:history para ler DMs ja enviadas; reinstale o app apos adicionar o escopo'
    if normalized_method == 'conversations.replies':
        return 'missing_scope: o app do Slack precisa do escopo im:history para ler respostas de threads em DMs; reinstale o app apos adicionar o escopo'
    if normalized_method == 'conversations.open':
        return 'missing_scope: o app do Slack precisa do escopo im:write para abrir DMs; reinstale o app apos adicionar o escopo'
    if normalized_method == 'chat.delete':
        return 'missing_scope: o app do Slack precisa do escopo chat:write para apagar mensagens'
    return 'missing_scope: o app do Slack precisa de permissao adicional; reinstale o app apos ajustar os escopos'


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
        except BaseException as exc:
            logger.warning('Falha ao montar entradas de supervisao para Slack do supervisor %s: %s', getattr(supervisor, 'pk', None), exc)
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


def _entry_status_key(entry):
    return str(entry.get('supervisor_status') or '').strip().lower()


def _normalize_delivery_status_key(raw_status, *, fallback=''):
    normalized_status = str(raw_status or '').strip().lower()
    if normalized_status in SUPERVISION_PENDING_STATUSES or normalized_status in SUPERVISION_FINAL_STATUSES:
        return normalized_status
    if normalized_status in LEGACY_PENDING_STATUS_KEYS:
        return 'pendente'
    fallback_status = str(fallback or '').strip().lower()
    if fallback_status in SUPERVISION_PENDING_STATUSES or fallback_status in SUPERVISION_FINAL_STATUSES:
        return fallback_status
    return normalized_status


def _entry_is_pending(entry):
    return _entry_status_key(entry) in SUPERVISION_PENDING_STATUSES


def _entry_is_final(entry):
    return _entry_status_key(entry) in SUPERVISION_FINAL_STATUSES


def _has_slack_message(delivery):
    if not delivery:
        return False
    return bool(str(delivery.slack_channel_id or '').strip() and str(delivery.slack_message_ts or '').strip())


def _entry_queue_sort_key(entry):
    try:
        analise_id = int(entry.get('analise_id') or 0)
    except (TypeError, ValueError):
        analise_id = 0
    try:
        card_index = int(entry.get('card_index') or 0)
    except (TypeError, ValueError):
        card_index = 0
    return (
        str(entry.get('date') or entry.get('original_date') or ''),
        analise_id,
        str(entry.get('card_source') or '').strip(),
        card_index,
    )


def _format_analysis_lines(entry):
    lines = []
    for raw_line in entry.get('analysis_lines') or []:
        text = str(raw_line or '').strip()
        if not text:
            continue
        normalized_text = text.casefold()
        if normalized_text.startswith('contratos para monit') or normalized_text.startswith('selecione os contratos'):
            continue
        if normalized_text.startswith('botão de monit') or normalized_text.startswith('botao de monit'):
            continue
        lines.append(f'• {text}')
    return '\n'.join(lines) if lines else 'Sem resumo procedural.'


def _append_markdown_section(blocks, title, lines):
    prepared_lines = [str(line or '').strip() for line in (lines or []) if str(line or '').strip()]
    if not prepared_lines:
        return
    chunk = []
    for line in prepared_lines:
        candidate = chunk + [line]
        heading = f'*{title}*'
        text = heading + '\n' + '\n'.join(candidate)
        if len(text) > 2900 and chunk:
            blocks.append({
                'type': 'section',
                'text': {'type': 'mrkdwn', 'text': heading + '\n' + '\n'.join(chunk)},
            })
            chunk = [line]
            continue
        chunk = candidate
    if chunk:
        blocks.append({
            'type': 'section',
            'text': {'type': 'mrkdwn', 'text': f'*{title}*\n' + '\n'.join(chunk)},
        })


def _format_checagem_sistemas_lines(entry):
    lines = []
    for section in entry.get('checagem_sistemas_sections') or []:
        title = str(section.get('title') or '').strip()
        items = section.get('items') or []
        if not title or not items:
            continue
        lines.append(f'*{title}*')
        for item in items:
            label = str(item.get('label') or '').strip()
            notes = str(item.get('notes') or '').strip()
            confirmed = bool(item.get('confirmed'))
            link = str(item.get('link') or '').strip()
            parts = []
            if notes:
                parts.append(notes.replace('\r\n', ' ').replace('\n', ' '))
            if confirmed:
                parts.append('Confirmado')
            if link:
                parts.append(f'<{link}|Link>')
            if not label:
                continue
            if parts:
                lines.append(f'• *{label}*: ' + ' | '.join(parts))
            else:
                lines.append(f'• *{label}*')
    return lines


def _format_contract_detail_lines(entry):
    lines = []
    saldo_original_total = str(entry.get('saldo_original_total_text') or '').strip()
    saldo_atualizado_total = str(entry.get('saldo_atualizado_total_text') or '').strip()
    if saldo_original_total and saldo_original_total != '—':
        lines.append(f'Saldo Original (somado): {saldo_original_total}')
    if saldo_atualizado_total and saldo_atualizado_total != '—':
        lines.append(f'Saldo Atualizado (somado): {saldo_atualizado_total}')

    custas = str(entry.get('custas_estimativa_text') or '').strip()
    if custas:
        lines.append(f'Estimativa de Custas (2%): {custas}')

    detail_lines = [str(line or '').strip() for line in (entry.get('contract_detail_lines') or []) if str(line or '').strip()]
    if detail_lines and lines:
        lines.append('Detalhamento por contrato:')
    lines.extend(detail_lines)
    return lines


def _format_files_detail_lines(entry):
    lines = []
    detail_items = entry.get('monitoria_files_detail') or []
    if len(detail_items) > 1:
        summary_items = []
        for summary_item in entry.get('monitoria_files_summary') or []:
            sigla = str(summary_item.get('sigla') or '').strip()
            if not sigla:
                continue
            summary_items.append(f'{sigla} {"OK" if summary_item.get("present") else "FALTA"}')
        if summary_items:
            lines.append('Resumo: ' + ' | '.join(summary_items))
    elif not detail_items:
        summary_items = []
        for summary_item in entry.get('monitoria_files_summary') or []:
            sigla = str(summary_item.get('sigla') or '').strip()
            if not sigla:
                continue
            summary_items.append(f'{sigla} {"OK" if summary_item.get("present") else "FALTA"}')
        if summary_items:
            lines.append('Resumo: ' + ' | '.join(summary_items))

    for detail_item in detail_items:
        line = str(detail_item.get('line') or '').strip()
        if line:
            lines.append(f'• {line}')
    return lines


def _build_pending_decision_hint_lines():
    return [
        'Ao tocar em Aprovar, Reprovar ou Barrar, o Slack abrira um formulario para registrar a devolutiva.',
    ]


def _split_lines(value):
    return [line for line in str(value or '').replace('\r\n', '\n').split('\n') if line.strip()]


def _build_decision_modal_blocks(desired_status, entry=None):
    entry = entry if isinstance(entry, dict) else {}
    existing_note = str(entry.get('supervisor_observacoes') or '').strip()
    if desired_status == 'barrado':
        barrado = entry.get('barrado') if isinstance(entry.get('barrado'), dict) else {}
        barrado_text = str(entry.get('barrado_text') or '').strip()
        blocks = []
        if barrado_text:
            blocks.append({
                'type': 'section',
                'text': {
                    'type': 'mrkdwn',
                    'text': f'*Barramento atual*\n{barrado_text}',
                },
            })
        datepicker = {
            'type': 'datepicker',
            'action_id': 'retorno_picker',
            'placeholder': {'type': 'plain_text', 'text': 'Opcional'},
        }
        current_retorno = str(barrado.get('retorno_em') or '').strip()
        if current_retorno:
            datepicker['initial_date'] = current_retorno
        note_element = {
            'type': 'plain_text_input',
            'action_id': 'devolutiva_input',
            'multiline': True,
            'placeholder': {'type': 'plain_text', 'text': 'Explique o motivo do barramento.'},
        }
        if existing_note:
            note_element['initial_value'] = existing_note[:3000]
        blocks.extend([
            {
                'type': 'input',
                'block_id': 'retorno_block',
                'optional': True,
                'label': {'type': 'plain_text', 'text': 'Retorno em'},
                'element': datepicker,
            },
            {
                'type': 'input',
                'block_id': 'devolutiva_block',
                'optional': False,
                'label': {'type': 'plain_text', 'text': 'Devolutiva do supervisor'},
                'element': note_element,
            },
        ])
        return blocks

    note_element = {
        'type': 'plain_text_input',
        'action_id': 'devolutiva_input',
        'multiline': True,
        'placeholder': {'type': 'plain_text', 'text': 'Escreva a devolutiva do supervisor.'},
    }
    if existing_note:
        note_element['initial_value'] = existing_note[:3000]
    return [{
        'type': 'input',
        'block_id': 'devolutiva_block',
        'optional': desired_status == 'aprovado',
        'label': {'type': 'plain_text', 'text': 'Devolutiva do supervisor'},
        'element': note_element,
    }]


def _format_barrado_lines(entry):
    barrado_text = str(entry.get('barrado_text') or '').strip()
    if not barrado_text:
        return []
    lines = [barrado_text]
    status_key = str(entry.get('supervisor_status') or '').strip().lower()
    note = str(entry.get('supervisor_observacoes') or '').strip()
    if note and status_key not in SUPERVISION_FINAL_STATUSES:
        lines.extend(
            f'Observação: {line.strip()}'
            for line in note.replace('\r\n', '\n').split('\n')
            if line.strip()
        )
    return lines


def _build_supervision_message(entry, *, request=None):
    nome = str(entry.get('nome') or entry.get('parte_nome') or 'Parte não informada').strip()
    cpf = str(entry.get('cpf') or entry.get('documento') or '').strip()
    cpf_status_label = str(entry.get('cpf_status_label') or '').strip() or 'Não informado'
    uf = str(entry.get('uf') or '').strip().upper() or 'UF não informada'
    viabilidade_label = str(entry.get('viabilidade_label') or '').strip() or 'Não informada'
    tipo = str(entry.get('analysis_type_nome') or entry.get('analysis_type_short') or 'Análise').strip()
    date_label = format_date_br(entry.get('date'))
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
    analysis_summary = _format_analysis_lines(entry)
    cnj_label = str(entry.get('cnj_label') or '').strip() or 'Não Judicializado'
    top_text = (
        f'*{nome}*\n'
        f'CPF: {cpf or "Não informado"} | Status CPF: {cpf_status_label} | UF: {uf}\n'
        f'Viabilidade: {viabilidade_label}\n'
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
    ]
    _append_markdown_section(blocks, 'Contratos da análise', _format_contract_detail_lines(entry))
    _append_markdown_section(blocks, 'Checagem de arquivos', _format_files_detail_lines(entry))
    _append_markdown_section(blocks, 'Checagem de sistemas', _format_checagem_sistemas_lines(entry))
    analyst_observation = str(entry.get('analyst_observation') or '').strip()
    if analyst_observation:
        _append_markdown_section(
            blocks,
            'Observação do analista',
            [line for line in analyst_observation.replace('\r\n', '\n').split('\n') if line.strip()],
        )
    _append_markdown_section(blocks, 'Barrar', _format_barrado_lines(entry))
    if note and status_key in SUPERVISION_FINAL_STATUSES:
        note_lines = _split_lines(note)
        if note_author:
            note_lines.append(f'Por: {note_author}')
        _append_markdown_section(blocks, 'Devolutiva', note_lines)
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
        barrado = entry.get('barrado') if isinstance(entry.get('barrado'), dict) else {}
        barrado_active = bool(barrado.get('ativo'))
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
            {
                'type': 'button',
                'text': {
                    'type': 'plain_text',
                    'text': 'Editar barrar' if barrado_active else 'Barrar',
                    'emoji': True,
                },
                'action_id': 'supervision_barrar',
                'value': json.dumps({'metadata': metadata, 'status': 'barrado'}),
            },
        ])
        _append_markdown_section(blocks, 'Devolutiva', _build_pending_decision_hint_lines())
    if action_elements:
        blocks.append({'type': 'actions', 'elements': action_elements})
    fallback_text = (
        f'{title} - {nome} - {cpf or "Sem CPF"} - {tipo} - {status_label}\n'
        f'{analysis_summary}\n'
        f'Arquivos: {_entry_file_summary(entry)}'
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
    last_exc = None
    payload = None
    for attempt in range(1, SLACK_API_RETRY_ATTEMPTS + 1):
        try:
            response = requests.post(
                f'https://slack.com/api/{method}',
                headers=headers,
                json=json_payload,
                data=data_payload,
                timeout=SLACK_API_TIMEOUT,
            )
            payload = response.json()
            break
        except BaseException as exc:
            last_exc = exc
            if attempt >= SLACK_API_RETRY_ATTEMPTS:
                raise RuntimeError(f'Falha ao comunicar com o Slack ({method}).') from exc
            time.sleep(0.5 * attempt)
    if payload is None:
        raise RuntimeError(f'Falha ao comunicar com o Slack ({method}).') from last_exc
    if not payload.get('ok'):
        raise ValueError(_describe_slack_api_error(method, payload.get('error')))
    return payload


def open_slack_dm(slack_user_id):
    payload = _slack_api_post('conversations.open', data_payload={'users': slack_user_id})
    channel = payload.get('channel') or {}
    return str(channel.get('id') or '').strip()


def fetch_slack_conversation_history(channel_id, *, limit=SLACK_HISTORY_FETCH_LIMIT):
    return _slack_api_post(
        'conversations.history',
        data_payload={'channel': channel_id, 'limit': int(limit or SLACK_HISTORY_FETCH_LIMIT)},
    )


def fetch_slack_thread_replies(channel_id, message_ts, *, limit=SLACK_HISTORY_FETCH_LIMIT):
    return _slack_api_post(
        'conversations.replies',
        data_payload={
            'channel': channel_id,
            'ts': str(message_ts or '').strip(),
            'limit': int(limit or SLACK_HISTORY_FETCH_LIMIT),
        },
    )


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


def delete_slack_message(channel_id, message_ts):
    return _slack_api_post(
        'chat.delete',
        json_payload={'channel': channel_id, 'ts': message_ts},
    )


def delete_slack_thread(channel_id, message_ts):
    deleted_count = 0
    child_messages = []
    try:
        replies_payload = fetch_slack_thread_replies(channel_id, message_ts)
        for message in replies_payload.get('messages') or []:
            if not isinstance(message, dict):
                continue
            reply_ts = str(message.get('ts') or '').strip()
            if not reply_ts or reply_ts == str(message_ts or '').strip():
                continue
            child_messages.append(reply_ts)
    except ValueError as exc:
        error_text = str(exc or '').strip()
        if error_text not in {'thread_not_found', 'message_not_found', 'channel_not_found'}:
            raise
    for reply_ts in reversed(child_messages):
        try:
            delete_slack_message(channel_id, reply_ts)
            deleted_count += 1
        except ValueError as exc:
            error_text = str(exc or '').strip()
            if error_text not in {'message_not_found', 'channel_not_found'}:
                raise
    delete_slack_message(channel_id, message_ts)
    return deleted_count + 1


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


def _is_supervision_root_message(message):
    if not isinstance(message, dict):
        return False
    ts = str(message.get('ts') or '').strip()
    thread_ts = str(message.get('thread_ts') or '').strip()
    if thread_ts and ts and thread_ts != ts:
        return False
    text = str(message.get('text') or '').strip()
    normalized_text = text.casefold()
    if normalized_text.startswith('nova supervisão pendente - ') or normalized_text.startswith('supervisão '):
        return True
    blocks = message.get('blocks') or []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        text_obj = block.get('text') or {}
        block_text = str(text_obj.get('text') or '').strip()
        normalized_block_text = block_text.casefold()
        if normalized_block_text.startswith('nova supervisão pendente') or normalized_block_text.startswith('supervisão '):
            return True
    return False


def fetch_remote_supervision_slack_messages(configs, *, existing_refs=None):
    existing = {
        (str(channel_id or '').strip(), str(message_ts or '').strip())
        for channel_id, message_ts in (existing_refs or set())
        if str(channel_id or '').strip() and str(message_ts or '').strip()
    }
    results = []
    errors = []
    for config in configs or []:
        supervisor = getattr(config, 'user', None)
        supervisor_name = (
            str(getattr(supervisor, 'get_full_name', lambda: '')() or '').strip()
            or str(getattr(supervisor, 'username', '') or '').strip()
            or 'Supervisor'
        )
        try:
            channel_id = open_slack_dm(getattr(config, 'slack_user_id', ''))
            if not channel_id:
                continue
            payload = fetch_slack_conversation_history(channel_id)
            for message in payload.get('messages') or []:
                if not _is_supervision_root_message(message):
                    continue
                message_ts = str(message.get('ts') or '').strip()
                if not message_ts:
                    continue
                ref_key = (channel_id, message_ts)
                if ref_key in existing:
                    continue
                existing.add(ref_key)
                results.append({
                    'supervisor': supervisor,
                    'supervisor_name': supervisor_name,
                    'slack_user_id': str(getattr(config, 'slack_user_id', '') or '').strip(),
                    'slack_channel_id': channel_id,
                    'slack_message_ts': message_ts,
                    'message': message,
                })
        except BaseException as exc:
            errors.append({
                'supervisor': supervisor_name,
                'error': str(exc),
            })
            logger.warning(
                'Falha ao listar mensagens remotas Slack supervisor=%s erro=%s',
                getattr(supervisor, 'pk', None),
                exc,
            )
    return results, errors


def open_supervision_decision_modal(trigger_id, *, metadata_json, desired_status, entry=None, slack_user_id):
    api_token = _slack_bot_token()
    if not api_token:
        raise ValueError('SLACK_BOT_TOKEN não configurado.')
    entry = entry if isinstance(entry, dict) else {}
    status_label = 'Barrar' if desired_status == 'barrado' else SUPERVISION_STATUS_LABELS.get(desired_status, desired_status.capitalize())
    nome = str(entry.get('nome') or entry.get('parte_nome') or 'Parte').strip()
    cpf = str(entry.get('cpf') or '').strip()
    blocks = [{
        'type': 'section',
        'text': {
            'type': 'mrkdwn',
            'text': (
                f'*{status_label} supervisão*\n'
                f'{nome} · CPF {cpf or "Não informado"}'
            ),
        },
    }]
    blocks.extend(_build_decision_modal_blocks(desired_status, entry))
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
    barrado_text = str(entry.get('barrado_text') or '').strip()
    if barrado_text:
        lines.append(f'Barrar: {barrado_text}')
    return '\n'.join(lines)


def _save_delivery(delivery, update_fields):
    normalized_fields = {
        str(field_name or '').strip()
        for field_name in (update_fields or [])
        if str(field_name or '').strip()
    }
    if not getattr(delivery, 'pk', None):
        persisted_delivery = _insert_delivery(delivery)
        for attr_name in ('pk', 'created_at', 'updated_at'):
            if hasattr(persisted_delivery, attr_name):
                setattr(delivery, attr_name, getattr(persisted_delivery, attr_name, None))
        return

    current_timestamp = timezone.now()
    update_map = {
        'slack_channel_id': str(delivery.slack_channel_id or '').strip(),
        'slack_message_ts': str(delivery.slack_message_ts or '').strip(),
        'slack_thread_ts': str(delivery.slack_thread_ts or '').strip(),
        'notified_at': delivery.notified_at,
        'resolved_at': delivery.resolved_at,
        'message_hash': str(delivery.message_hash or '').strip(),
        'last_status': str(delivery.last_status or '').strip(),
        'card_id': str(delivery.card_id or '').strip(),
        'slack_user_id': str(delivery.slack_user_id or '').strip(),
        'processo_id': delivery.processo_id,
        'updated_at': current_timestamp,
    }
    if not normalized_fields:
        normalized_fields = set(update_map.keys())
    normalized_fields.add('updated_at')
    update_values = {}
    for field_name in normalized_fields:
        if field_name == 'processo':
            update_values['processo_id'] = delivery.processo_id
            continue
        if field_name in update_map:
            update_values[field_name] = update_map[field_name]
    try:
        updated_rows = SupervisaoSlackEntrega.objects.filter(pk=delivery.pk).update(**update_values)
        if not updated_rows:
            raise RuntimeError('Entrega Slack não encontrada para atualização.')
        delivery.updated_at = current_timestamp
    except BaseException as exc:
        try:
            persisted_delivery = _upsert_delivery(delivery, normalized_fields=normalized_fields, current_timestamp=current_timestamp)
            for attr_name in ('pk', 'created_at', 'updated_at'):
                if hasattr(persisted_delivery, attr_name):
                    setattr(delivery, attr_name, getattr(persisted_delivery, attr_name, None))
            return
        except BaseException:
            pass
        logger.exception(
            'Falha ao persistir entrega Slack delivery_id=%s.',
            getattr(delivery, 'pk', None),
            exc_info=exc,
        )
        raise RuntimeError('Falha ao salvar entrega Slack.') from exc


def _insert_delivery(delivery):
    current_timestamp = timezone.now()
    if not getattr(delivery, 'created_at', None):
        delivery.created_at = current_timestamp
    if not getattr(delivery, 'updated_at', None):
        delivery.updated_at = current_timestamp
    filters = {
        'analise_id': getattr(delivery, 'analise_id', None),
        'supervisor_id': getattr(delivery, 'supervisor_id', None),
        'card_source': str(getattr(delivery, 'card_source', '') or '').strip(),
        'card_index': int(getattr(delivery, 'card_index', 0) or 0),
    }
    try:
        created_items = SupervisaoSlackEntrega.objects.bulk_create([delivery])
        persisted_delivery = created_items[0] if created_items else delivery
        if getattr(persisted_delivery, 'pk', None):
            return persisted_delivery
        existing_delivery = SupervisaoSlackEntrega.objects.filter(**filters).order_by('-pk').first()
        if existing_delivery:
            return existing_delivery
        raise RuntimeError('Entrega Slack criada sem retorno de identificador.')
    except BaseException as exc:
        try:
            return _upsert_delivery(delivery, current_timestamp=current_timestamp)
        except BaseException:
            pass
        existing_delivery = None
        try:
            existing_delivery = SupervisaoSlackEntrega.objects.filter(**filters).order_by('-pk').first()
        except Exception:
            existing_delivery = None
        if existing_delivery:
            return existing_delivery
        logger.exception(
            'Falha ao criar entrega Slack supervisor=%s analise=%s source=%s index=%s.',
            filters['supervisor_id'],
            filters['analise_id'],
            filters['card_source'],
            filters['card_index'],
            exc_info=exc,
        )
        raise RuntimeError('Falha ao criar entrega Slack.') from exc


def _upsert_delivery(delivery, *, normalized_fields=None, current_timestamp=None):
    timestamp = current_timestamp or timezone.now()
    unique_filters = {
        'analise_id': getattr(delivery, 'analise_id', None),
        'supervisor_id': getattr(delivery, 'supervisor_id', None),
        'card_source': str(getattr(delivery, 'card_source', '') or '').strip(),
        'card_index': int(getattr(delivery, 'card_index', 0) or 0),
    }
    if not getattr(delivery, 'created_at', None):
        delivery.created_at = timestamp
    delivery.updated_at = timestamp
    upsert_delivery = SupervisaoSlackEntrega(
        analise_id=unique_filters['analise_id'],
        processo_id=getattr(delivery, 'processo_id', None),
        supervisor_id=unique_filters['supervisor_id'],
        card_id=str(getattr(delivery, 'card_id', '') or '').strip(),
        card_source=unique_filters['card_source'],
        card_index=unique_filters['card_index'],
        slack_user_id=str(getattr(delivery, 'slack_user_id', '') or '').strip(),
        slack_channel_id=str(getattr(delivery, 'slack_channel_id', '') or '').strip(),
        slack_message_ts=str(getattr(delivery, 'slack_message_ts', '') or '').strip(),
        slack_thread_ts=str(getattr(delivery, 'slack_thread_ts', '') or '').strip(),
        last_status=str(getattr(delivery, 'last_status', '') or '').strip(),
        message_hash=str(getattr(delivery, 'message_hash', '') or '').strip(),
        notified_at=getattr(delivery, 'notified_at', None),
        resolved_at=getattr(delivery, 'resolved_at', None),
        created_at=getattr(delivery, 'created_at', timestamp),
        updated_at=timestamp,
    )
    update_fields = [
        field_name for field_name in (
            'processo',
            'card_id',
            'slack_user_id',
            'slack_channel_id',
            'slack_message_ts',
            'slack_thread_ts',
            'last_status',
            'message_hash',
            'notified_at',
            'resolved_at',
            'updated_at',
        )
        if not normalized_fields or field_name in normalized_fields or (field_name == 'updated_at')
    ]
    bulk_update_fields = [
        'processo' if field_name == 'processo' else field_name
        for field_name in update_fields
    ]
    SupervisaoSlackEntrega.objects.bulk_create(
        [upsert_delivery],
        update_conflicts=True,
        update_fields=bulk_update_fields,
        unique_fields=['analise', 'supervisor', 'card_source', 'card_index'],
    )
    persisted_delivery = SupervisaoSlackEntrega.objects.filter(**unique_filters).order_by('-pk').first()
    if persisted_delivery:
        return persisted_delivery
    raise RuntimeError('Falha ao localizar entrega Slack apos upsert.')


def _sync_single_delivery(entry, supervisor, delivery, *, request=None, allow_post=True):
    message = _build_supervision_message(entry, request=request)
    status_key = message['status_key']
    status_changed = status_key != str(delivery.last_status or '').strip().lower()
    has_message = _has_slack_message(delivery)
    queued = False

    if not has_message:
        if allow_post and status_key in SUPERVISION_PENDING_STATUSES:
            channel_id = open_slack_dm(delivery.slack_user_id)
            posted = post_slack_message(channel_id, text=message['text'], blocks=message['blocks'])
            delivery.slack_channel_id = channel_id
            delivery.slack_message_ts = str(posted.get('ts') or '').strip()
            delivery.slack_thread_ts = delivery.slack_message_ts
            delivery.notified_at = timezone.now()
            has_message = _has_slack_message(delivery)
        else:
            queued = status_key in SUPERVISION_PENDING_STATUSES
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
    _save_delivery(
        delivery,
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
    return {
        'sent': _has_slack_message(delivery),
        'queued': queued and not _has_slack_message(delivery),
    }


def _build_supervisor_delivery_context(supervisor, config):
    accepted_entries = []
    for entry in _collect_supervision_entries_for_supervisor(supervisor):
        key = _build_entry_key(entry)
        if not key or not _supervisor_accepts_entry(config, entry):
            continue
        accepted_entries.append(entry)

    if not accepted_entries:
        return [], {}, {}

    analysis_ids = sorted({
        int(entry.get('analise_id') or 0)
        for entry in accepted_entries
        if int(entry.get('analise_id') or 0)
    })
    deliveries = {}
    if analysis_ids:
        deliveries = {
            (delivery.analise_id, delivery.card_source, delivery.card_index): delivery
            for delivery in SupervisaoSlackEntrega.objects.filter(
                supervisor=supervisor,
                analise_id__in=analysis_ids,
            )
        }

    analyses = {
        analise.pk: analise
        for analise in AnaliseProcesso.objects.select_related('processo_judicial').filter(pk__in=analysis_ids)
    }

    for entry in accepted_entries:
        key = _build_entry_key(entry)
        if not key:
            continue
        delivery = deliveries.get(key)
        analise = analyses.get(int(entry.get('analise_id') or 0))
        entry_status_key = _normalize_delivery_status_key(_entry_status_key(entry), fallback='pendente')
        if delivery is None:
            if not analise:
                continue
            delivery = _insert_delivery(SupervisaoSlackEntrega(
                analise=analise,
                processo=analise.processo_judicial,
                supervisor=supervisor,
                card_id=str(entry.get('cardId') or ''),
                card_source=str(entry.get('card_source') or ''),
                card_index=int(entry.get('card_index') or 0),
                slack_user_id=config.slack_user_id,
                last_status=entry_status_key,
            ))
            deliveries[key] = delivery
            continue

        update_fields = []
        has_message = _has_slack_message(delivery)
        new_card_id = str(entry.get('cardId') or delivery.card_id or '')
        if delivery.card_id != new_card_id:
            delivery.card_id = new_card_id
            update_fields.append('card_id')
        if delivery.slack_user_id != config.slack_user_id:
            delivery.slack_user_id = config.slack_user_id
            update_fields.append('slack_user_id')
        if analise and delivery.processo_id != getattr(analise, 'processo_judicial_id', None):
            delivery.processo = analise.processo_judicial
            update_fields.append('processo')
        if not has_message and delivery.last_status != entry_status_key:
            delivery.last_status = entry_status_key
            update_fields.append('last_status')
        if update_fields:
            update_fields.append('updated_at')
            _save_delivery(delivery, update_fields=update_fields)

    entries_by_key = {
        _build_entry_key(entry): entry
        for entry in accepted_entries
        if _build_entry_key(entry)
    }
    return accepted_entries, deliveries, entries_by_key


def _sync_pending_batch_for_type(*, supervisor, analysis_type_slug, accepted_entries, deliveries, request=None):
    pending_entries = [
        entry for entry in accepted_entries
        if _entry_is_pending(entry) and _entry_analysis_type_slug(entry) == analysis_type_slug
    ]
    if not pending_entries:
        return {'sent': False, 'queued_count': 0, 'errors': []}

    pending_entries.sort(key=_entry_queue_sort_key)
    sent_pending = []
    unsent_pending = []
    for entry in pending_entries:
        delivery = deliveries.get(_build_entry_key(entry))
        if not delivery:
            continue
        if _has_slack_message(delivery):
            sent_pending.append((entry, delivery))
        else:
            unsent_pending.append((entry, delivery))

    if sent_pending:
        to_send = sent_pending
        to_queue = unsent_pending
    else:
        to_send = unsent_pending[:SUPERVISION_BATCH_SIZE_PER_TYPE]
        to_queue = unsent_pending[SUPERVISION_BATCH_SIZE_PER_TYPE:]

    sent_any = False
    queued_count = 0
    errors = []

    for entry, delivery in to_send:
        try:
            result = _sync_single_delivery(entry, supervisor, delivery, request=request, allow_post=True)
            sent_any = sent_any or bool(result.get('sent'))
        except BaseException as exc:
            errors.append({
                'supervisor': str(supervisor.get_full_name()).strip() or str(supervisor.username).strip(),
                'error': str(exc),
            })
            logger.warning(
                'Falha ao sincronizar lote pendente Slack supervisor=%s tipo=%s erro=%s',
                supervisor.pk,
                analysis_type_slug,
                exc,
            )

    for entry, delivery in to_queue:
        try:
            result = _sync_single_delivery(entry, supervisor, delivery, request=request, allow_post=False)
            if result.get('queued'):
                queued_count += 1
        except BaseException as exc:
            errors.append({
                'supervisor': str(supervisor.get_full_name()).strip() or str(supervisor.username).strip(),
                'error': str(exc),
            })
            logger.warning(
                'Falha ao enfileirar entrega Slack supervisor=%s tipo=%s erro=%s',
                supervisor.pk,
                analysis_type_slug,
                exc,
            )

    return {
        'sent': sent_any,
        'queued_count': queued_count,
        'errors': errors,
    }


def sync_supervision_slack_for_analysis(analise_id, *, request=None):
    if not slack_supervisao_enabled():
        return {
            'recipients': [],
            'eligible_recipients': [],
            'errors': [],
            'has_pending_entries': False,
            'queued_count': 0,
        }
    try:
        analise = AnaliseProcesso.objects.select_related('processo_judicial').get(pk=analise_id)
    except AnaliseProcesso.DoesNotExist:
        return {
            'recipients': [],
            'eligible_recipients': [],
            'errors': [],
            'has_pending_entries': False,
            'queued_count': 0,
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
            'queued_count': 0,
        }

    recipient_names = set()
    eligible_names = set()
    errors = []
    has_pending_entries = False
    queued_count = 0

    for config in supervisor_configs:
        supervisor = config.user
        try:
            accepted_entries, deliveries, _entries_by_key = _build_supervisor_delivery_context(supervisor, config)
        except BaseException as exc:
            errors.append({
                'supervisor': str(supervisor.get_full_name()).strip() or str(supervisor.username).strip(),
                'error': str(exc),
            })
            logger.exception(
                'Falha ao montar contexto Slack analise=%s supervisor=%s',
                analise.pk,
                supervisor.pk,
                exc_info=exc,
            )
            continue
        current_entries = [
            entry for entry in accepted_entries
            if int(entry.get('analise_id') or 0) == int(analise.pk)
        ]
        if current_entries:
            has_pending_entries = True
            eligible_names.add(
                str(supervisor.get_full_name()).strip() or str(supervisor.username).strip()
            )
        relevant_slugs = {
            _entry_analysis_type_slug(entry)
            for entry in current_entries
            if _entry_analysis_type_slug(entry)
        }

        for entry in current_entries:
            if not _entry_is_final(entry):
                continue
            delivery = deliveries.get(_build_entry_key(entry))
            if not delivery:
                continue
            try:
                result = _sync_single_delivery(entry, supervisor, delivery, request=request, allow_post=False)
                if result.get('sent'):
                    recipient_names.add(
                        str(supervisor.get_full_name()).strip() or str(supervisor.username).strip()
                    )
            except BaseException as exc:
                errors.append({
                    'supervisor': str(supervisor.get_full_name()).strip() or str(supervisor.username).strip(),
                    'error': str(exc),
                })
                logger.warning(
                    'Falha ao sincronizar status final no Slack analise=%s supervisor=%s erro=%s',
                    analise.pk,
                    supervisor.pk,
                    exc,
                )

        for analysis_type_slug in sorted(relevant_slugs):
            result = _sync_pending_batch_for_type(
                supervisor=supervisor,
                analysis_type_slug=analysis_type_slug,
                accepted_entries=accepted_entries,
                deliveries=deliveries,
                request=request,
            )
            if result.get('sent'):
                recipient_names.add(
                    str(supervisor.get_full_name()).strip() or str(supervisor.username).strip()
                )
            queued_count += int(result.get('queued_count') or 0)
            errors.extend(result.get('errors') or [])
    return {
        'recipients': sorted(name for name in recipient_names if name),
        'eligible_recipients': sorted(name for name in eligible_names if name),
        'errors': errors,
        'has_pending_entries': has_pending_entries,
        'queued_count': queued_count,
    }


def sync_supervision_slack_for_supervisor(user_id, *, request=None):
    if not slack_supervisao_enabled():
        return {'recipients': [], 'eligible_recipients': [], 'errors': [], 'queued_count': 0}
    config = (
        UserSlackConfig.objects.select_related('user')
        .filter(user_id=user_id, user__is_active=True)
        .exclude(slack_user_id='')
        .first()
    )
    if not config:
        return {'recipients': [], 'eligible_recipients': [], 'errors': [], 'queued_count': 0}
    supervisor = config.user
    recipient_names = set()
    eligible_names = set()
    errors = []
    queued_count = 0
    try:
        accepted_entries, deliveries, _entries_by_key = _build_supervisor_delivery_context(supervisor, config)
    except BaseException as exc:
        errors.append({
            'supervisor': str(supervisor.get_full_name()).strip() or str(supervisor.username).strip(),
            'error': str(exc),
        })
        logger.exception(
            'Falha ao montar contexto Slack supervisor=%s',
            supervisor.pk,
            exc_info=exc,
        )
        return {
            'recipients': [],
            'eligible_recipients': [],
            'errors': errors,
            'queued_count': 0,
        }

    if accepted_entries:
        eligible_names.add(
            str(supervisor.get_full_name()).strip() or str(supervisor.username).strip()
        )

    for entry in accepted_entries:
        if not _entry_is_final(entry):
            continue
        delivery = deliveries.get(_build_entry_key(entry))
        if not delivery:
            continue
        try:
            result = _sync_single_delivery(entry, supervisor, delivery, request=request, allow_post=False)
            if result.get('sent'):
                recipient_names.add(
                    str(supervisor.get_full_name()).strip() or str(supervisor.username).strip()
                )
        except BaseException as exc:
            errors.append({
                'supervisor': str(supervisor.get_full_name()).strip() or str(supervisor.username).strip(),
                'error': str(exc),
            })
            logger.warning(
                'Falha ao sincronizar status final Slack supervisor=%s erro=%s',
                supervisor.pk,
                exc,
            )

    type_slugs = {
        _entry_analysis_type_slug(entry)
        for entry in accepted_entries
        if _entry_analysis_type_slug(entry) and _entry_is_pending(entry)
    }
    for analysis_type_slug in sorted(type_slugs):
        try:
            result = _sync_pending_batch_for_type(
                supervisor=supervisor,
                analysis_type_slug=analysis_type_slug,
                accepted_entries=accepted_entries,
                deliveries=deliveries,
                request=request,
            )
        except BaseException as exc:
            errors.append({
                'supervisor': str(supervisor.get_full_name()).strip() or str(supervisor.username).strip(),
                'error': str(exc),
            })
            logger.warning(
                'Falha ao sincronizar lote pendente por tipo Slack supervisor=%s tipo=%s erro=%s',
                supervisor.pk,
                analysis_type_slug,
                exc,
            )
            continue
        if result.get('sent'):
            recipient_names.add(
                str(supervisor.get_full_name()).strip() or str(supervisor.username).strip()
            )
        queued_count += int(result.get('queued_count') or 0)
        errors.extend(result.get('errors') or [])
    return {
        'recipients': sorted(name for name in recipient_names if name),
        'eligible_recipients': sorted(name for name in eligible_names if name),
        'errors': errors,
        'queued_count': queued_count,
    }


def ensure_supervision_delivery_records(configs):
    errors = []
    for config in configs or []:
        supervisor = getattr(config, 'user', None)
        if not supervisor:
            continue
        try:
            _build_supervisor_delivery_context(supervisor, config)
        except BaseException as exc:
            errors.append({
                'supervisor': str(supervisor.get_full_name()).strip() or str(supervisor.username).strip(),
                'error': str(exc),
            })
            logger.warning(
                'Falha ao reconciliar entregas Slack supervisor=%s erro=%s',
                getattr(supervisor, 'pk', None),
                exc,
            )
    return errors


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


def delete_supervision_slack_deliveries(deliveries, *, remote_refs=None):
    deleted_ids = []
    deleted_remote_count = 0
    errors = []
    for delivery in deliveries or []:
        if not delivery:
            continue
        try:
            channel_id = str(delivery.slack_channel_id or '').strip()
            message_ts = str(delivery.slack_message_ts or '').strip()
            if channel_id and message_ts:
                try:
                    delete_slack_thread(channel_id, message_ts)
                except ValueError as exc:
                    error_text = str(exc or '').strip()
                    if error_text not in {'message_not_found', 'channel_not_found', 'thread_not_found'}:
                        raise
            elif delivery.notified_at:
                raise RuntimeError('Entrega enviada sem identificadores Slack persistidos.')
            deleted_ids.append(int(delivery.pk))
        except Exception as exc:
            errors.append({
                'delivery_id': int(delivery.pk),
                'error': str(exc),
            })
            logger.warning(
                'Falha ao apagar entrega Slack da supervisao delivery=%s erro=%s',
                delivery.pk,
                exc,
            )
    if deleted_ids:
        SupervisaoSlackEntrega.objects.filter(pk__in=deleted_ids).delete()
    seen_remote = set()
    for ref in remote_refs or []:
        if not isinstance(ref, dict):
            continue
        channel_id = str(ref.get('slack_channel_id') or '').strip()
        message_ts = str(ref.get('slack_message_ts') or '').strip()
        if not channel_id or not message_ts:
            continue
        dedupe_key = (channel_id, message_ts)
        if dedupe_key in seen_remote:
            continue
        seen_remote.add(dedupe_key)
        try:
            try:
                delete_slack_thread(channel_id, message_ts)
            except ValueError as exc:
                error_text = str(exc or '').strip()
                if error_text not in {'message_not_found', 'channel_not_found', 'thread_not_found'}:
                    raise
            deleted_remote_count += 1
        except Exception as exc:
            errors.append({
                'delivery_id': None,
                'error': str(exc),
            })
            logger.warning(
                'Falha ao apagar mensagem remota Slack channel=%s ts=%s erro=%s',
                channel_id,
                message_ts,
                exc,
            )
    return {
        'deleted_ids': deleted_ids,
        'deleted_count': len(deleted_ids) + deleted_remote_count,
        'errors': errors,
    }
