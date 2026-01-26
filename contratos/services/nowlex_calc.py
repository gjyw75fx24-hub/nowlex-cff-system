import logging
from decimal import Decimal, InvalidOperation
from urllib.parse import quote

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class NowlexCalcError(Exception):
    """Erro genérico para falhas na integração com o NowLex Calc."""
    pass


def _get_headers(content_type='application/json'):
    api_key = getattr(settings, 'NOWLEX_CALC_API_KEY', '')
    if not api_key:
        raise NowlexCalcError('Chave NOWLEX_CALC_API_KEY não configurada.')
    headers = {
        'X-API-Key': api_key,
        'Accept': content_type,
    }
    if content_type == 'application/json':
        headers['Content-Type'] = 'application/json'
    return headers


def _build_url(path):
    base = getattr(settings, 'NOWLEX_CALC_API_BASE', 'https://calc.nowlex.com')
    return f"{base.rstrip('/')}{path}"


def _add_optional_payload(payload):
    mapping = {
        'NOWLEX_CALC_DATA_CORRENTE_MES': 'data_corrente_mes',
        'NOWLEX_CALC_DATA_CORRENTE_ANO': 'data_corrente_ano',
        'NOWLEX_CALC_INDICE': 'indice',
        'NOWLEX_CALC_OBSERVATIONS': 'observations',
    }
    for attr, key in mapping.items():
        value = getattr(settings, attr, None)
        if value:
            payload[key] = value


def create_calc(contract_number: str) -> dict:
    if not contract_number:
        raise NowlexCalcError('Número de contrato inválido.')
    payload = {'contract_number': contract_number}
    _add_optional_payload(payload)
    url = _build_url('/api/calculos/criar-por-contrato')
    try:
        resp = requests.post(url, json=payload, headers=_get_headers(), timeout=60)
    except requests.RequestException as exc:
        logger.exception('Erro ao criar cálculo NowLex: %s', exc)
        raise NowlexCalcError(f'Falha de conexão com NowLex Calc: {exc}')
    if resp.status_code < 200 or resp.status_code >= 300:
        try:
            payload = resp.json()
        except ValueError:
            raise NowlexCalcError(f'HTTP {resp.status_code} ao criar cálculo: {resp.text}')
        if isinstance(payload, dict) and (payload.get('error_code') == 'CONTRACT_NOT_FOUND'):
            raise NowlexCalcError('Contrato não existente na base.')
        message = payload.get('message') or payload.get('error')
        raise NowlexCalcError(f'HTTP {resp.status_code} ao criar cálculo: {message or resp.text}')
    try:
        body = resp.json()
    except ValueError:
        raise NowlexCalcError('Resposta inválida ao criar cálculo (JSON esperado).')
    if not body.get('success') or 'data' not in body:
        if body.get('error_code') == 'CONTRACT_NOT_FOUND':
            raise NowlexCalcError('Contrato não existente na base.')
        message = body.get('message') or body.get('error') or 'Resposta sem sucesso do NowLex Calc.'
        raise NowlexCalcError(message)
    return body['data']


def get_latest_calc_id(contract_number: str) -> str | None:
    if not contract_number:
        return None
    quoted = quote(str(contract_number), safe='')
    url = _build_url(f'/api/calc-atual/contrato/{quoted}')
    try:
        resp = requests.get(url, headers=_get_headers(), timeout=30)
    except requests.RequestException as exc:
        logger.warning('Falha ao buscar cálculo mais recente: %s', exc)
        return None
    if resp.status_code < 200 or resp.status_code >= 300:
        logger.warning('HTTP %s em /calc-atual para %s', resp.status_code, contract_number)
        return None
    try:
        payload = resp.json()
    except ValueError:
        return None
    if isinstance(payload, dict):
        cid = payload.get('id')
        if not cid:
            cid = payload.get('data', {}).get('id')
        return str(cid) if cid is not None else None
    return None


def download_pdf(calc_id: str) -> bytes:
    if not calc_id:
        raise NowlexCalcError('Nenhum calc_id fornecido para baixar o PDF.')
    quoted = quote(str(calc_id), safe='')
    url = _build_url(f'/api/calcs/id/{quoted}/pdf')
    headers = _get_headers('application/pdf,*/*')
    try:
        resp = requests.get(url, headers=headers, timeout=80)
    except requests.RequestException as exc:
        logger.exception('Erro ao baixar PDF do NowLex Calc: %s', exc)
        raise NowlexCalcError(f'Falha de conexão ao baixar PDF: {exc}')
    if resp.status_code < 200 or resp.status_code >= 300:
        raise NowlexCalcError(f'HTTP {resp.status_code} ao baixar PDF: {resp.text}')
    content = resp.content or b''
    preview = content.lstrip(b'\n\r\t ')
    if not preview.startswith(b'%PDF') and b'%PDF-' not in preview[:10]:
        raise NowlexCalcError('Conteúdo retornado não parece ser um PDF.')
    return content


def download_pdf_with_fallback(calc_id: str, contract_number: str) -> bytes:
    last_error = None
    if calc_id:
        try:
            return download_pdf(calc_id)
        except NowlexCalcError as exc:
            last_error = exc
    latest_id = get_latest_calc_id(contract_number)
    if latest_id:
        try:
            return download_pdf(latest_id)
        except NowlexCalcError as exc:
            last_error = exc
    raise last_error or NowlexCalcError('Não foi possível baixar o PDF.')


def parse_decimal(value) -> Decimal | None:
    if value in (None, ''):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None
