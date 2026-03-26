from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.utils import timezone

CHECAGEM_SISTEMAS_SECTIONS = [
    {
        'title': 'LITISPENDÊNCIA',
        'questions': [
            {'key': 'juridico_isj', 'label': 'JURÍDICO ISJ'},
            {'key': 'judicase', 'label': 'JUDICASE'},
            {'key': 'jusbr', 'label': 'JUS.BR'},
            {'key': 'tribunal', 'label': 'TRIBUNAL'},
        ],
    },
    {
        'title': 'ÓBITO',
        'questions': [
            {'key': 'nowlex', 'label': 'NOWLEX'},
            {'key': 'censec', 'label': 'CENSEC'},
            {'key': 'qualificacao_herdeiros', 'label': 'QUALIFICAÇÃO HERDEIROS'},
            {'key': 'cert_obt', 'label': 'CERT OBT'},
        ],
    },
    {
        'title': 'ADV. ANALISTA',
        'questions': [
            {'key': 'google', 'label': 'GOOGLE'},
            {'key': 'transparencia', 'label': 'TRANSPARÊNCIA'},
            {'key': 'cargo', 'label': 'CARGO'},
        ],
    },
]

MONITORIA_FILE_TYPES = [
    ('a06', 'C', 'Contrato'),
    ('a08', 'SD', 'Saldo Devedor'),
    ('a07', 'R', 'Relatório'),
    ('a09', 'T', 'TED'),
]


def _coerce_decimal(value):
    if value in (None, ''):
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def format_currency_brl(value):
    decimal_value = _coerce_decimal(value)
    if decimal_value is None:
        return '—'
    quantized = decimal_value.quantize(Decimal('0.01'))
    rendered = f'{quantized:,.2f}'
    rendered = rendered.replace(',', 'X').replace('.', ',').replace('X', '.')
    return f'R$ {rendered}'


def format_date_br(value):
    if value in (None, ''):
        return ''
    if isinstance(value, datetime):
        if timezone.is_aware(value):
            value = timezone.localtime(value)
        return value.strftime('%d/%m/%Y')
    if isinstance(value, date):
        return value.strftime('%d/%m/%Y')
    raw_value = str(value).strip()
    if not raw_value:
        return ''
    for parser in (datetime.fromisoformat, date.fromisoformat):
        try:
            parsed = parser(raw_value)
        except ValueError:
            continue
        if isinstance(parsed, datetime):
            if timezone.is_aware(parsed):
                parsed = timezone.localtime(parsed)
            return parsed.strftime('%d/%m/%Y')
        return parsed.strftime('%d/%m/%Y')
    return raw_value


def build_contract_detail_items(contracts):
    items = []
    for contract in contracts or []:
        numero_contrato = str(getattr(contract, 'numero_contrato', '') or '').strip() or f'ID {contract.pk}'
        saldo_devedor = getattr(contract, 'valor_total_devido', None)
        saldo_atualizado = getattr(contract, 'valor_causa', None)
        prescricao_date = getattr(contract, 'data_prescricao', None)
        line = (
            f'{numero_contrato} - (SD {format_currency_brl(saldo_devedor)} - '
            f'SA {format_currency_brl(saldo_atualizado)} - '
            f'P {format_date_br(prescricao_date) or "—"})'
        )
        items.append({
            'numero_contrato': numero_contrato,
            'saldo_devedor': float(saldo_devedor) if saldo_devedor is not None else None,
            'saldo_atualizado': float(saldo_atualizado) if saldo_atualizado is not None else None,
            'prescricao_date': prescricao_date.isoformat() if isinstance(prescricao_date, date) else (
                str(prescricao_date or '').strip() or None
            ),
            'line': line,
        })
    return items


def resolve_custas_estimativa(card_custas_total, valor_total_causa):
    explicit_value = _coerce_decimal(card_custas_total)
    if explicit_value is not None:
        return explicit_value.quantize(Decimal('0.01'))
    total_causa = _coerce_decimal(valor_total_causa)
    if total_causa is None:
        return None
    return (total_causa * Decimal('0.02')).quantize(Decimal('0.01'))


def build_monitoria_files_detail(per_contract_presence):
    details = []
    for entry in per_contract_presence or []:
        contrato = str(entry.get('contrato') or '').strip()
        present_map = entry.get('present') or {}
        labels = []
        for key, sigla, _label in MONITORIA_FILE_TYPES:
            labels.append(f'{sigla} {"OK" if present_map.get(key) else "FALTA"}')
        details.append({
            'contrato': contrato,
            'line': f'{contrato}: ' + ' | '.join(labels),
            'statuses': [
                {
                    'key': key,
                    'sigla': sigla,
                    'label': label,
                    'present': bool(present_map.get(key)),
                }
                for key, sigla, label in MONITORIA_FILE_TYPES
            ],
        })
    return details


def build_checagem_sistemas_sections(payload):
    if not isinstance(payload, dict):
        payload = {}
    questions = payload.get('questions')
    if not isinstance(questions, dict):
        questions = {}

    sections = []
    for section in CHECAGEM_SISTEMAS_SECTIONS:
        items = []
        for question in section.get('questions') or []:
            state = questions.get(question['key'])
            if not isinstance(state, dict):
                continue
            label = str(state.get('label') or question['label']).strip() or question['label']
            notes = str(state.get('notes') or '').strip()
            link = str(state.get('link') or '').strip()
            confirmed = bool(state.get('confirmed'))
            if not any((notes, link, confirmed)):
                continue
            items.append({
                'key': question['key'],
                'label': label,
                'notes': notes,
                'link': link,
                'confirmed': confirmed,
            })
        if items:
            sections.append({
                'title': section['title'],
                'items': items,
            })
    return sections


def build_barrado_text(barrado):
    if not isinstance(barrado, dict):
        barrado = {}
    ativo = bool(barrado.get('ativo'))
    inicio = format_date_br(barrado.get('inicio'))
    retorno_em = format_date_br(barrado.get('retorno_em'))
    if not any((ativo, inicio, retorno_em)):
        return ''
    parts = []
    parts.append('Ativo' if ativo else 'Inativo')
    if inicio:
        parts.append(f'Início: {inicio}')
    if retorno_em:
        parts.append(f'Retorno em: {retorno_em}')
    return ' | '.join(parts)
