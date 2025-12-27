# contratos/views.py

from django.http import JsonResponse, HttpResponse, FileResponse
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_POST, require_GET
from .models import (
    ProcessoJudicial, StatusProcessual, QuestaoAnalise,
    OpcaoResposta, Contrato, ProcessoArquivo, DocumentoModelo
)
from .integracoes_escavador.api import buscar_processo_por_cnj
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from django.db.models import Max
from django.db import transaction
from django.contrib.admin.views.decorators import staff_member_required
from django.urls import reverse
import re
import logging
import requests
from urllib.parse import quote
from contratos.data.decision_tree_config import DECISION_TREE_CONFIG # <--- Nova importação
import copy # Para cópia profunda do dicionário
import json
import tempfile
from pathlib import Path
import subprocess
import threading

# Imports para geração de DOCX
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, RGBColor
from io import BytesIO
from datetime import datetime
import os
from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.text import slugify
from django.utils.timezone import now
from django.db.models import Q


logger = logging.getLogger(__name__)


def _sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', ' ', name or '')
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned or 'arquivo'


def _format_currency_brl(value):
    try:
        amount = Decimal(value or 0)
    except (TypeError, InvalidOperation):
        amount = Decimal('0')
    quantized = amount.quantize(Decimal('0.01'))
    formatted = f'{quantized:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return f'R$ {formatted}'


def _to_decimal(value):
    if isinstance(value, Decimal):
        return value
    if value is None:
        return Decimal('0')
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return Decimal('0')


def _format_cpf(cpf_value):
    digits = re.sub(r'\D', '', str(cpf_value or ''))
    if len(digits) == 11:
        return f'{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}'
    return str(cpf_value or '')


def _extrair_primeiros_nomes(nome, max_nomes=2):
    if not nome:
        return ''
    STOP = {'da', 'de', 'do', 'das', 'dos', 'e', "d’", "d'", 'a', 'o'}
    tokens = [t for t in re.split(r'\s+', nome.strip()) if t]
    out = []
    for tok in tokens:
        if tok.lower() in STOP:
            continue
        out.append(tok)
        if len(out) >= max_nomes:
            break
    return ' '.join(out).strip()


def _formatar_lista_contratos(contratos):
    valores = [str(c.numero_contrato).strip() for c in contratos if getattr(c, 'numero_contrato', None)]
    if not valores:
        return ''
    if len(valores) == 1:
        return valores[0]
    ultimo = valores.pop()
    return f"{', '.join(valores)} e {ultimo}"


def _normalize_digits(value):
    return re.sub(r'\D', '', str(value or ''))


def _parse_contract_ids(values):
    parsed = []
    seen = set()
    for item in values or []:
        if isinstance(item, int):
            contract_id = item
        else:
            digits = _normalize_digits(item)
            if not digits:
                continue
            try:
                contract_id = int(digits)
            except ValueError:
                continue
        if contract_id not in seen:
            seen.add(contract_id)
            parsed.append(contract_id)
    return parsed


def _sanitize_contract_numbers(contracts):
    seen = []
    for contract in contracts:
        number = getattr(contract, 'numero_contrato', None)
        digits = _normalize_digits(number)
        if digits and digits not in seen:
            seen.append(digits)
    return seen


def _format_contracts_label(numbers):
    if not numbers:
        return ''
    if len(numbers) == 1:
        return numbers[0]
    last = numbers[-1]
    return f"{', '.join(numbers[:-1])} e {last}"


def _build_extrato_filename(contracts_label, parte_name, cpf_digits):
    label_part = contracts_label or 'contratos'
    nomes = _extrair_primeiros_nomes(parte_name)
    if not nomes:
        nomes = cpf_digits or 'perfil'
    filename = f"05 - Extrato de Titularidade - {label_part} - {nomes}.pdf"
    return _sanitize_filename(filename)


def _call_nowlex_extrato(cpf_digits, contract_numbers):
    api_key = getattr(settings, 'NOWLEX_JUDICIAL_API_KEY', '') or os.environ.get('NOWLEX_JUDICIAL_API_KEY', '')
    if not api_key:
        raise RuntimeError('Chave NOWLEX_JUDICIAL_API_KEY não configurada.')
    included = ','.join(contract_numbers)
    params = quote(included, safe=',')
    url = f"https://erp-api.nowlex.com/api/judicial/cpf/{cpf_digits}/pdf?include_contracts={params}"
    response = requests.get(url, headers={'X-API-Key': api_key}, timeout=60)
    if not response.ok:
        raise RuntimeError(f"Status {response.status_code}: {response.text}")
    if not response.content:
        raise RuntimeError("Resposta da API sem conteúdo.")
    return response.content


def generate_extrato_titularidade(processo, cpf_value, contratos, parte_name, usuario):
    cpf_digits = _normalize_digits(cpf_value)
    if len(cpf_digits) != 11:
        return {'ok': False, 'error': 'CPF inválido para o extrato.'}
    contract_numbers = _sanitize_contract_numbers(contratos)
    if not contract_numbers:
        return {'ok': False, 'error': 'Nenhum contrato válido para o extrato.'}
    contratos_label = _format_contracts_label(contract_numbers)
    try:
        pdf_bytes = _call_nowlex_extrato(cpf_digits, contract_numbers)
    except Exception as exc:
        logger.error("Falha ao gerar extrato de titularidade: %s", exc, exc_info=True)
        return {'ok': False, 'error': str(exc)}
    filename = _build_extrato_filename(contratos_label, parte_name, cpf_digits)
    pdf_file = ContentFile(pdf_bytes)
    arquivo = ProcessoArquivo(
        processo=processo,
        nome=filename,
        enviado_por=usuario if usuario and usuario.is_authenticated else None,
    )
    arquivo.arquivo.save(filename, pdf_file, save=True)
    return {'ok': True, 'pdf_url': arquivo.arquivo.url}


def _iter_container_paragraphs(container):
    for paragraph in container.paragraphs:
        yield paragraph
    for table in getattr(container, 'tables', []):
        for row in table.rows:
            for cell in row.cells:
                yield from _iter_container_paragraphs(cell)


def _bold_keywords_in_document(document, keywords):
    upper_keywords = [kw.upper() for kw in keywords]
    for paragraph in _iter_container_paragraphs(document):
        for run in paragraph.runs:
            run_text_upper = run.text.upper()
            if any(kw in run_text_upper for kw in upper_keywords):
                run.font.bold = True
                run.font.name = 'Times New Roman'


def _set_run_shading(run, fill_color):
    if not fill_color:
        return
    rPr = run._element.get_or_add_rPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill_color)
    rPr.append(shd)


def _parse_placeholder_segments(text):
    if not text:
        return []
    pattern = re.compile(r'\[(lg|n|a|ag|m)\]')
    segments = []
    state = {
        'bold': False,
        'blue_font': False,
        'highlight_blue': False,
        'highlight_line': False,
        'line_highlight_open': False,
        'uppercase': False,
    }
    last_index = 0

    def _snapshot():
        return {
            'bold': state['bold'],
            'blue_font': state['blue_font'],
            'highlight_blue': state['highlight_blue'],
            'highlight_line': state['highlight_line'],
            'uppercase': state['uppercase'],
        }

    for match in pattern.finditer(text):
        if match.start() > last_index:
            segments.append((text[last_index:match.start()], _snapshot()))
        token = match.group(1)
        if token == 'n':
            state['bold'] = not state['bold']
            if not state['bold'] and state['line_highlight_open']:
                state['highlight_line'] = False
                state['line_highlight_open'] = False
        elif token == 'lg':
            state['highlight_line'] = True
            state['line_highlight_open'] = True
        elif token == 'a':
            state['blue_font'] = not state['blue_font']
        elif token == 'ag':
            state['highlight_blue'] = not state['highlight_blue']
        elif token == 'm':
            state['uppercase'] = not state['uppercase']
        last_index = match.end()

    if last_index < len(text):
        segments.append((text[last_index:], _snapshot()))
    return [seg for seg in segments if seg[0]]


def _apply_placeholder_styles(document):
    markers = ['[n]', '[a]', '[ag]', '[lg]', '[m]']
    highlight_fill = 'DCE7FB'
    blue_rgb = RGBColor(0x33, 0x3A, 0xF1)

    for paragraph in _iter_container_paragraphs(document):
        source_text = paragraph.text
        if not source_text or not any(marker in source_text for marker in markers):
            continue
        segments = _parse_placeholder_segments(source_text)
        if not segments:
            continue
        for run in paragraph.runs:
            run.text = ''
        for text_segment, style in segments:
            run_text = text_segment.upper() if style['uppercase'] else text_segment
            run = paragraph.add_run(run_text)
            run.font.name = 'Times New Roman'
            run.font.bold = style['bold']
            run.font.color.rgb = blue_rgb if (style['blue_font'] or style['highlight_blue']) else None
            if style['highlight_line'] or style['highlight_blue']:
                _set_run_shading(run, highlight_fill)


def _load_template_document(slug, fallback_path):
    template = DocumentoModelo.objects.filter(slug=slug).first()
    if not template:
        label = dict(DocumentoModelo.SlugChoices.choices).get(slug, '')
        if label:
            template = DocumentoModelo.objects.filter(nome__iexact=label).order_by('-atualizado_em').first()
    if template:
        try:
            with template.arquivo.open('rb') as handle:
                data = BytesIO(handle.read())
            data.seek(0)
            return Document(data)
        except (ValueError, FileNotFoundError):
            template = None
    if fallback_path and os.path.exists(fallback_path):
        return Document(fallback_path)
    raise FileNotFoundError(
        f"Template de documento não encontrado (slug={slug}). "
        "Envie o arquivo via Documentos Modelo ou coloque o fallback local."
    )


def _build_docx_bytes_common(processo, polo_passivo, contratos_monitoria):
    dados = {}
    dados['PARTE CONTRÁRIA'] = polo_passivo.nome
    dados['CPF'] = polo_passivo.documento

    endereco_parts = parse_endereco(polo_passivo.endereco)
    dados['A'] = endereco_parts.get('A', '')
    dados['B'] = endereco_parts.get('B', '')
    dados['C'] = endereco_parts.get('C', '')
    dados['D'] = endereco_parts.get('D', '')
    dados['E'] = endereco_parts.get('E', '')
    dados['F'] = endereco_parts.get('F', '')
    dados['G'] = endereco_parts.get('G', '')
    dados['H'] = endereco_parts.get('H', '')

    dados['E_FORO'] = processo.vara
    dados['H_FORO'] = processo.uf

    dados['CONTRATO'] = ", ".join([c.numero_contrato for c in contratos_monitoria if c.numero_contrato])

    contrato_total = sum(
        (_to_decimal(contrato.valor_causa) for contrato in contratos_monitoria),
        Decimal('0')
    ) if contratos_monitoria else Decimal('0')
    total_valor_causa = contrato_total
    if total_valor_causa == Decimal('0'):
        total_valor_causa = _to_decimal(processo.valor_causa)

    dados['VALOR DA CAUSA'] = _format_currency_brl(total_valor_causa)
    dados['VALOR DA CAUSA POR EXTENSO'] = number_to_words_pt_br(total_valor_causa)

    dados['DATA DE HOJE'] = datetime.now().strftime("%d de %B de %Y").replace(
        'January', 'janeiro').replace('February', 'fevereiro').replace('March', 'março').replace(
        'April', 'abril').replace('May', 'maio').replace('June', 'junho').replace(
        'July', 'julho').replace('August', 'agosto').replace('September', 'setembro').replace(
        'October', 'outubro').replace('November', 'novembro').replace('December', 'dezembro')

    fallback_path = os.path.join(
        settings.BASE_DIR,
        'contratos', 'documents', 'Base de Minutas Oficiais Modelo',
        '1 - Base - Inicial Monitoria - B6.docx'
    )
    document = _load_template_document(DocumentoModelo.SlugChoices.MONITORIA_INICIAL, fallback_path)

    # Ajusta posição do rodapé para evitar cortes no PDF (mantém margens do template)
    for section in document.sections:
        try:
            # mantém margens originais do template, apenas sobe o rodapé
            section.footer_distance = Cm(1.5)
        except Exception:
            pass

    for p in document.paragraphs:
        for key, value in dados.items():
            if key == 'E_FORO' and '[E]/[H]' in p.text:
                p.text = p.text.replace('[E]/[H]', f"{dados.get('E_FORO', '')}/{dados.get('H_FORO', '')}")
            p.text = p.text.replace(f'[{key}]', str(value))

    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    for key, value in dados.items():
                        if key == 'E_FORO' and '[E]/[H]' in p.text:
                            p.text = p.text.replace('[E]/[H]', f"{dados.get('E_FORO', '')}/{dados.get('H_FORO', '')}")
                        p.text = p.text.replace(f'[{key}]', str(value))

    _apply_placeholder_styles(document)
    _bold_keywords_in_document(document, ['EXCELENTÍSSIMO(A)'])

    file_stream = BytesIO()
    document.save(file_stream)
    file_stream.seek(0)
    return file_stream.getvalue()


def _build_monitoria_base_filename(polo_passivo, contratos_monitoria):
    contratos_labels = [
        (c.numero_contrato or f"contrato-{c.id}") for c in contratos_monitoria
    ]
    if not contratos_labels:
        contratos_labels = ['contratos']
    contratos_segment = " - ".join(contratos_labels)
    nome_parte = polo_passivo.nome or "parte"
    base = f"01 - Monitoria Inicial - {contratos_segment} - {nome_parte}"
    return _sanitize_filename(base)


def _get_total_contrato_value(contratos, processo):
    total = Decimal('0')
    for contrato in contratos:
        valor = contrato.valor_total_devido if contrato.valor_total_devido is not None else contrato.valor_causa
        if valor is not None:
            total += valor
    if total == Decimal('0') and processo.valor_causa is not None:
        total = processo.valor_causa
    return total


def _build_cobranca_base_filename(polo_passivo, contratos):
    label = _formatar_lista_contratos(contratos) or 'contratos'
    nome_parte = _extrair_primeiros_nomes(polo_passivo.nome or '', 2) or 'parte'
    base = f"01 - Cobranca Judicial - {label} - {nome_parte}"
    return _sanitize_filename(base)


def _convert_docx_to_pdf_bytes(docx_bytes):
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            docx_path = tmpdir_path / "input.docx"
            pdf_path = tmpdir_path / "input.pdf"
            docx_path.write_bytes(docx_bytes)
            cmd = [
                "soffice",
                "--headless",
                "--nologo",
                "--nodefault",
                "--norestore",
                "--nofirststartwizard",
                "--convert-to",
                "pdf:writer_pdf_Export",
                "--outdir",
                str(tmpdir_path),
                str(docx_path),
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=90)
            if result.returncode != 0:
                logger.error(
                    "Falha na conversão para PDF (soffice): rc=%s stdout=%s stderr=%s",
                    result.returncode,
                    result.stdout.decode(errors="ignore"),
                    result.stderr.decode(errors="ignore"),
                )
                return None
            if pdf_path.exists():
                return pdf_path.read_bytes()
    except Exception as exc:
        logger.error("Erro ao converter DOCX para PDF: %s", exc, exc_info=True)
    return None


def _build_cobranca_docx_bytes(processo, polo_passivo, contratos):
    contratos = sorted(contratos, key=lambda c: (c.numero_contrato or '', c.id))
    dados = {
        'PARTE CONTRÁRIA': (polo_passivo.nome or '').upper(),
        'CPF': _format_cpf(polo_passivo.documento),
    }

    endereco_parts = parse_endereco(polo_passivo.endereco)
    for key in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']:
        dados[key] = endereco_parts.get(key, '') or ''

    dados['E_FORO'] = processo.vara or ''
    dados['H_FORO'] = processo.uf or ''
    dados['UF'] = processo.uf or ''
    dados['CONTRATO'] = _formatar_lista_contratos(contratos)

    total_valor = _get_total_contrato_value(contratos, processo)
    dados['VALOR'] = _format_currency_brl(total_valor)
    valor_extenso = number_to_words_pt_br(total_valor)
    dados['VALOR POR EXTENSO'] = valor_extenso
    dados['VALOR DA CAUSA'] = dados['VALOR']
    dados['VALOR DA CAUSA POR EXTENSO'] = valor_extenso
    dados['DATA DE HOJE'] = datetime.now().strftime("%d/%m/%Y")

    fallback_path = os.path.join(
        settings.BASE_DIR,
        'contratos', 'documents', 'Base de Minutas Oficiais Modelo',
        '4 - Modelo da Ação de Cobrança.docx'
    )
    document = _load_template_document(DocumentoModelo.SlugChoices.COBRANCA_JUDICIAL, fallback_path)
    for section in document.sections:
        try:
            section.footer_distance = Cm(1.5)
        except Exception:
            pass

    for p in document.paragraphs:
        for key, value in dados.items():
            if key == 'E_FORO' and '[E]/[H]' in p.text:
                p.text = p.text.replace('[E]/[H]', f"{dados.get('E_FORO', '')}/{dados.get('H_FORO', '')}")
            p.text = p.text.replace(f'[{key}]', str(value))

    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    for key, value in dados.items():
                        if key == 'E_FORO' and '[E]/[H]' in p.text:
                            p.text = p.text.replace('[E]/[H]', f"{dados.get('E_FORO', '')}/{dados.get('H_FORO', '')}")
                        p.text = p.text.replace(f'[{key}]', str(value))

    _apply_placeholder_styles(document)
    _bold_keywords_in_document(document, ['EXCELENTÍSSIMO(A)'])

    stream = BytesIO()
    document.save(stream)
    stream.seek(0)
    return stream.getvalue()


def _only_digits(value):
    return re.sub(r'\D', '', str(value or ''))


def _fetch_extrato_titularidade(processo, polo_passivo, contratos, user):
    api_key = getattr(settings, 'JUDICIAL_API_KEY', None)
    if not api_key:
        return None

    cpf_digits = _only_digits(polo_passivo.documento)
    if len(cpf_digits) != 11:
        logger.warning("CPF inválido para extrato de titularidade: %s", polo_passivo.documento)
        return None

    contratos_numeros = [
        _only_digits(contrato.numero_contrato) for contrato in contratos
        if _only_digits(contrato.numero_contrato)
    ]
    if not contratos_numeros:
        return None

    include_param = quote(','.join(contratos_numeros))
    url = f'https://erp-api.nowlex.com/api/judicial/cpf/{cpf_digits}/pdf?include_contracts={include_param}'
    headers = {'X-API-Key': api_key}
    try:
        response = requests.get(url, headers=headers, timeout=20)
        response.raise_for_status()
        contratos_label = _formatar_lista_contratos(contratos) or 'contratos'
        nome_parte = _extrair_primeiros_nomes(polo_passivo.nome or '', 2) or 'parte'
        file_name = f"05 - Extrato de Titularidade - {contratos_label} - {nome_parte}.pdf"

        arquivo_extrato = ProcessoArquivo(
            processo=processo,
            nome=file_name,
            enviado_por=user if user and user.is_authenticated else None,
        )
        arquivo_extrato.arquivo.save(_sanitize_filename(file_name), ContentFile(response.content), save=True)
        return arquivo_extrato.arquivo.url
    except requests.RequestException as exc:
        logger.warning("Erro ao buscar extrato de titularidade: %s", exc)
    except Exception as exc:
        logger.warning("Erro ao salvar extrato de titularidade: %s", exc, exc_info=True)
    return None

@require_POST
def buscar_dados_escavador_view(request):
    """
    View que recebe uma requisição AJAX com um CNJ, busca os dados no Escavador
    e os retorna como JSON para preenchimento do formulário, SEM SALVAR.
    """
    cnj = request.POST.get('cnj')
    if not cnj:
        return JsonResponse({'status': 'error', 'message': 'CNJ não fornecido.'}, status=400)

    try:
        # 1. Buscar os dados brutos da API
        dados_api = buscar_processo_por_cnj(cnj)
        if not dados_api:
            return JsonResponse({
                'status': 'error',
                'message': f'Não foi possível encontrar dados para o CNJ {cnj}.'
            }, status=404)

        # --- Início do Bloco de Processamento Seguro ---
        
        # 2. Preparar os dados para o formulário
        fontes_list = dados_api.get('fontes', [])
        fonte_principal = fontes_list[0] if fontes_list else {}

        # Trata o valor da causa
        valor_causa = Decimal('0.00')
        if fonte_principal:
            valor_causa_raw = fonte_principal.get('capa', {}).get('valor_causa', {}).get('valor_formatado')
            if valor_causa_raw is not None:
                valor_causa_str = str(valor_causa_raw).replace('R$', '').replace('.', '').replace(',', '.').strip()
                if valor_causa_str:
                    valor_causa = Decimal(valor_causa_str)

        # Trata o status (classe processual)
        status_id = None
        status_nome = None
        if fonte_principal:
            nome_classe_processual = fonte_principal.get('capa', {}).get('classe')
            if nome_classe_processual:
                normalized_name = re.sub(r'\s*\(\d+\)$', '', nome_classe_processual).strip()
                
                # get_or_create é atômico e a forma correta de evitar race conditions.
                status, created = StatusProcessual.objects.get_or_create(
                    nome=normalized_name.title(),
                    defaults={'ordem': 0}
                )
                status_id = status.id
                status_nome = status.nome

        # Prepara a lista de partes
        partes_para_formulario = []
        if fonte_principal:
            for parte_api in fonte_principal.get('envolvidos', []):
                tipo_polo_api = parte_api.get('polo', '').upper()
                if tipo_polo_api in ['ATIVO', 'PASSIVO']:
                    partes_para_formulario.append({
                        'tipo_polo': tipo_polo_api,
                        'nome': parte_api.get('nome', 'Nome não informado'),
                        'tipo_pessoa': 'PJ' if parte_api.get('tipo_pessoa', '').upper() == 'JURIDICA' else 'PF',
                        'documento': parte_api.get('cpf') or parte_api.get('cnpj', ''),
                        'endereco': parte_api.get('endereco', ''),
                    })

        # Prepara a lista de andamentos
        andamentos_para_formulario = []
        if fonte_principal:
            for andamento_api in dados_api.get('movimentacoes', []):
                andamentos_para_formulario.append({
                    'data': andamento_api.get('data'),
                    'descricao': andamento_api.get('conteudo'),
                })

        # 3. Montar o dicionário de resposta final
        dados_completos = {
            'status': 'success',
            'message': 'Dados encontrados! Revise e salve o formulário.',
            'processo': {
                'uf': dados_api.get('estado_origem', {}).get('sigla', ''),
                'vara': fonte_principal.get('capa', {}).get('orgao_julgador', ''),
                'tribunal': fonte_principal.get('tribunal', {}).get('nome', ''),
                'valor_causa': f'{valor_causa:.2f}',
                'status_id': status_id,
                'status_nome': status_nome,
            },
            'partes': partes_para_formulario,
            'andamentos': andamentos_para_formulario,
        }
        return JsonResponse(dados_completos)

    except Exception as e:
        # Captura QUALQUER erro durante a busca ou processamento dos dados
        logger.error(f"Erro ao processar CNJ {cnj}: {e}", exc_info=True)
        return JsonResponse({
            'status': 'error',
            'message': f'Ocorreu um erro interno ao processar os dados da API: {e}'
        }, status=500)


@staff_member_required
@require_POST
@transaction.atomic
def merge_status_view(request):
    """
    View para mesclar dois Status Processuais.
    Atualiza todos os Processos Judiciais do status de origem para o de destino.
    """
    try:
        source_id = int(request.POST.get('source_id'))
        target_id = int(request.POST.get('target_id'))

        if source_id == target_id:
            return JsonResponse({'status': 'error', 'message': 'Os status de origem e destino não podem ser os mesmos.'}, status=400)

        source_status = get_object_or_404(StatusProcessual, pk=source_id)
        target_status = get_object_or_404(StatusProcessual, pk=target_id)

        affected_processes_count = ProcessoJudicial.objects.filter(status=source_status).count()
        ProcessoJudicial.objects.filter(status=source_status).update(status=target_status)
        
        source_status.ativo = False
        source_status.save()
        
        message = f'{affected_processes_count} processo(s) foram atualizados. O status "{source_status.nome}" foi mesclado e inativado.'
        return JsonResponse({'status': 'success', 'message': message})

    except (KeyError, ValueError, TypeError):
        return JsonResponse({'status': 'error', 'message': 'Dados inválidos fornecidos.'}, status=400)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f'Ocorreu um erro inesperado: {e}'}, status=500)


def lista_processos(request):
    """
    Busca todos os processos no banco e os envia para o template de lista.
    """
    processos = ProcessoJudicial.objects.all().order_by('-id')
    contexto = {
        'processos': processos
    }
    return render(request, 'contratos/lista_processos.html', contexto)


def detalhe_processo(request, pk):
    """
    Busca um processo específico pelo seu ID (pk) e envia para o template de detalhe.
    """
    processo = get_object_or_404(ProcessoJudicial, pk=pk)
    contratos_do_processo = processo.contratos.all()
    
    contexto = {
        'processo': processo,
        'contratos': contratos_do_processo,
    }
    return render(request, 'contratos/detalhe_processo.html', contexto)

@require_GET
def get_decision_tree_data(request):
    """
    Retorna a estrutura da árvore de decisão (questões e opções) como JSON,
    mesclando a configuração nativa com as do banco de dados.
    """
    # 1. Inicia com a configuração nativa
    # Cria uma cópia profunda para evitar modificar o dicionário original
    current_tree_config = copy.deepcopy(DECISION_TREE_CONFIG)
    
    primeira_questao_chave_db = None

    # 2. Mescla/Sobrescreve com as questões configuradas no banco de dados
    db_questoes = QuestaoAnalise.objects.all().prefetch_related('opcoes')
    for questao_db in db_questoes:
        if not questao_db.chave: # Chave é essencial para mesclar
            continue

        q_data = {
            'id': questao_db.id,
            'texto_pergunta': questao_db.texto_pergunta,
            'chave': questao_db.chave,
            'tipo_campo': questao_db.tipo_campo,
            'is_primeira_questao': questao_db.is_primeira_questao,
            'ordem': questao_db.ordem,
            'opcoes': []
        }

        for opcao_db in questao_db.opcoes.all().order_by('texto_resposta'):
            o_data = {
                'id': opcao_db.id,
                'texto_resposta': opcao_db.texto_resposta,
                'proxima_questao_id': opcao_db.proxima_questao.id if opcao_db.proxima_questao else None,
                'proxima_questao_chave': opcao_db.proxima_questao.chave if opcao_db.proxima_questao and opcao_db.proxima_questao.chave else None,
            }
            q_data['opcoes'].append(o_data)
        
        # Se a questão já existe na config nativa, sobrescreve seus campos
        # e mescla as opções. Caso contrário, adiciona a questão.
        if questao_db.chave in current_tree_config:
            # Sobrescreve atributos da questão
            current_tree_config[questao_db.chave].update({
                'id': q_data['id'],
                'texto_pergunta': q_data['texto_pergunta'],
                'tipo_campo': q_data['tipo_campo'],
                'is_primeira_questao': q_data['is_primeira_questao'],
                'ordem': q_data['ordem'],
            })
            # Substitui as opções pelas do banco de dados
            current_tree_config[questao_db.chave]['opcoes'] = q_data['opcoes']
        else:
            current_tree_config[questao_db.chave] = q_data
        
        if questao_db.is_primeira_questao:
            primeira_questao_chave_db = questao_db.chave
    
    # 3. Determina a chave da primeira questão
    # Prioriza a primeira questão definida no banco de dados
    if primeira_questao_chave_db:
        final_primeira_questao_chave = primeira_questao_chave_db
    else:
        # Se não houver no banco, usa a da configuração nativa
        # Assume que há apenas uma 'is_primeira_questao = True' na config nativa
        for chave, questao_data in current_tree_config.items():
            if questao_data.get("is_primeira_questao"):
                final_primeira_questao_chave = chave
                break
        else: # Se não encontrar nem na nativa
            return JsonResponse({'status': 'error', 'message': 'Nenhuma questão inicial configurada no banco de dados ou na configuração nativa.'}, status=404)

    return JsonResponse({
        'status': 'success',
        'primeira_questao_chave': final_primeira_questao_chave,
        'tree_data': current_tree_config
    })

@require_GET
def get_processo_contratos_api(request, processo_id):
    """
    Retorna uma lista de contratos associados a um Processo Judicial específico como JSON.
    """
    try:
        processo = get_object_or_404(ProcessoJudicial, pk=processo_id)
        contratos = processo.contratos.all().order_by('numero_contrato')
        
        contratos_data = [
            {
                'id': contrato.id,
                'numero_contrato': contrato.numero_contrato or f'Contrato sem número ({contrato.id})',
                'valor_total_devido': str(contrato.valor_total_devido) if contrato.valor_total_devido else None,
            }
            for contrato in contratos
        ]
        
        return JsonResponse({'status': 'success', 'contratos': contratos_data})
    except ProcessoJudicial.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Processo Judicial não encontrado.'}, status=404)
    except Exception as e:
        logger.error(f"Erro ao buscar contratos para processo_id {processo_id}: {e}", exc_info=True)
        return JsonResponse({'status': 'error', 'message': f'Ocorreu um erro interno: {e}'}, status=500)
# ==============================================================================
# FUNÇÕES E VIEWS PARA GERAÇÃO DA PEÇA MONITÓRIA
# ==============================================================================
from docx import Document
from io import BytesIO
from datetime import datetime
import os
from django.conf import settings

# Helper para parsear o endereço
def parse_endereco(endereco_str):
    parts = {
        'A': '', 'B': '', 'C': '', 'D': '', 'E': '',
        'F': '', 'G': '', 'H': ''
    }
    if not endereco_str:
        return parts

    # Expressão regular para capturar CHAVE: VALOR
    # Garante que o valor pode conter hífens e espaços
    matches = re.findall(r'([A-H]):\s*([^:]+?)(?=\s*-\s*[A-H]:|\s*$)', endereco_str)
    
    for key, value in matches:
        value = value.strip()
        # Limpa 'None' e 'null' da string, que podem vir de campos vazios
        if value.lower() == 'none' or value.lower() == 'null':
            value = ''
        parts[key.strip()] = value
    return parts

# Helper para converter número para extenso (simplificado)
# Para uma solução robusta, usar uma biblioteca ou implementar mais completo.
def number_to_words_pt_br(num):
    try:
        num_decimal = num if isinstance(num, Decimal) else Decimal(str(num))
    except (InvalidOperation, ValueError, TypeError):
        return str(num)

    unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
    dezena = ['', 'dez', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
    dez_a_dezenove = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
    centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']

    def _num_to_words_chunk(n):
        s = ''
        n = int(n)

        if n >= 100:
            if n == 100:
                s += 'cem'
            else:
                s += centenas[n // 100]
            n %= 100
            if n > 0:
                s += ' e '

        if 10 <= n < 20:
            s += dez_a_dezenove[n - 10]
            return s

        if n >= 20:
            s += dezena[n // 10]
            n %= 10
            if n > 0:
                s += ' e '

        if n > 0:
            s += unidades[n]

        return s

    def _process_triplet(triplet, scale):
        triplet = int(triplet)
        if triplet == 0:
            return ''
        words = _num_to_words_chunk(triplet)

        if scale == 1:  # Mil
            return 'mil' if words == 'um' else f"{words} mil"
        if scale == 2:  # Milhão
            return 'um milhão' if words == 'um' else f"{words} milhões"
        return words

    inteiro = int(num_decimal)
    words_list = []
    if inteiro == 0:
        words_list.append('zero')
    else:
        chunks = []
        temp_int = inteiro
        while temp_int > 0:
            chunks.append(temp_int % 1000)
            temp_int //= 1000

        for idx, chunk in enumerate(chunks):
            if chunk > 0:
                words_list.insert(0, _process_triplet(chunk, idx))

    inteiro_words = ' '.join(filter(None, words_list)) or 'zero'
    inteiro_phrase = f"{inteiro_words} reais"

    decimal_part = int(((num_decimal - inteiro) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    if decimal_part > 0:
        centavos_text = _num_to_words_chunk(decimal_part).strip()
        centavos_phrase = f"{centavos_text} centavos" if centavos_text else 'centavos'
        inteiro_phrase = f"{inteiro_phrase} e {centavos_phrase}"

    return inteiro_phrase.capitalize()

@require_POST
def generate_monitoria_petition(request, processo_id=None):
    # aceita tanto o ID vindo na URL quanto no POST (fallback)
    processo_id = processo_id or request.POST.get('processo_id')
    
    try:
        processo_id_int = int(processo_id)
    except (TypeError, ValueError):
        return HttpResponse("ID do processo inválido.", status=400)

    try:
        processo = get_object_or_404(ProcessoJudicial, pk=processo_id_int)
        analise = processo.analise_processo  # OneToOneField
    except ProcessoJudicial.DoesNotExist:
        return HttpResponse("Processo Judicial não encontrado.", status=404)
    except Exception as e:
        logger.error(f"Erro ao buscar análise do processo {processo_id_int}: {e}", exc_info=True)
        return HttpResponse(f"Erro ao buscar dados do processo: {e}", status=500)

    # Buscar a parte passiva
    polo_passivo = processo.partes_processuais.filter(tipo_polo='PASSIVO').first()
    if not polo_passivo:
        return HttpResponse("Polo passivo não encontrado para este processo.", status=404)
    
    # Buscar contratos selecionados para monitória (POST tem prioridade)
    contratos_para_monitoria_ids = []
    try:
        posted_json = request.POST.get('contratos_para_monitoria')
        if posted_json:
            contratos_para_monitoria_ids = json.loads(posted_json)
    except (TypeError, json.JSONDecodeError):
        contratos_para_monitoria_ids = []

    if not contratos_para_monitoria_ids:
        contratos_para_monitoria_ids = analise.respostas.get('contratos_para_monitoria', [])

    contratos_para_monitoria_ids = _parse_contract_ids(contratos_para_monitoria_ids)

    contratos_monitoria = Contrato.objects.filter(id__in=contratos_para_monitoria_ids)

    if not contratos_monitoria.exists():
        return HttpResponse("Nenhum contrato selecionado para monitória na análise deste processo.", status=404)

    try:
        docx_bytes = _build_docx_bytes_common(processo, polo_passivo, contratos_monitoria)
        base_filename = _build_monitoria_base_filename(polo_passivo, contratos_monitoria)
        pdf_bytes = _convert_docx_to_pdf_bytes(docx_bytes)
        if not pdf_bytes:
            return HttpResponse("Não foi possível converter o DOCX para PDF. Verifique o conversor.", status=500)

        pdf_name = f"{base_filename}.pdf"
        pdf_file = ContentFile(pdf_bytes)
        try:
            arquivo_pdf = ProcessoArquivo(
                processo=processo,
                nome=pdf_name,
                enviado_por=request.user if request.user.is_authenticated else None,
            )
            arquivo_pdf.arquivo.save(pdf_name, pdf_file, save=True)
            pdf_url = arquivo_pdf.arquivo.url
        except Exception as exc:
            logger.error("Erro ao salvar PDF da monitória: %s", exc, exc_info=True)
            return HttpResponse("Falha ao salvar o PDF gerado nos Arquivos.", status=500)

        monitoria_info = {
            "ok": True,
            "pdf_url": pdf_url,
            "pdf_pending": False,
            "docx_download_url": request.build_absolute_uri(
                reverse('contratos:generate_monitoria_docx', kwargs={'processo_id': processo_id_int})
            ),
        }
        extrato_result = generate_extrato_titularidade(
            processo=processo,
            cpf_value=polo_passivo.documento,
            contratos=contratos_monitoria,
            parte_name=polo_passivo.nome,
            usuario=request.user if request.user.is_authenticated else None
        )
        dest_path = os.path.dirname(arquivo_pdf.arquivo.name or '')

        response_payload = {
            "status": "success",
            "message": "Petição gerada (PDF salvo em Arquivos).",
            "monitoria": monitoria_info,
            "extrato": extrato_result,
            "dest_path": dest_path,
        }
        return JsonResponse(response_payload)

    except Exception as e:
        logger.error(f"Erro ao gerar a petição para o processo {processo_id}: {e}", exc_info=True)
        return HttpResponse(f"Erro ao gerar a petição: {e}", status=500)


@require_POST
def generate_cobranca_judicial_petition(request, processo_id=None):
    processo_id = processo_id or request.POST.get('processo_id')
    
    try:
        processo_id_int = int(processo_id)
    except (TypeError, ValueError):
        return HttpResponse("ID do processo inválido.", status=400)

    try:
        processo = get_object_or_404(ProcessoJudicial, pk=processo_id_int)
        analise = processo.analise_processo
    except ProcessoJudicial.DoesNotExist:
        return HttpResponse("Processo Judicial não encontrado.", status=404)
    except Exception as e:
        logger.error(f"Erro ao buscar análise do processo {processo_id_int}: {e}", exc_info=True)
        return HttpResponse(f"Erro ao buscar dados do processo: {e}", status=500)

    polo_passivo = processo.partes_processuais.filter(tipo_polo='PASSIVO').first()
    if not polo_passivo:
        return HttpResponse("Polo passivo não encontrado para este processo.", status=404)

    contratos_para_cobranca_ids = []
    try:
        posted_json = request.POST.get('contratos_para_monitoria')
        if posted_json:
            contratos_para_cobranca_ids = json.loads(posted_json)
    except (TypeError, json.JSONDecodeError):
        contratos_para_cobranca_ids = []

    contratos_queryset = processo.contratos.all()
    if contratos_para_cobranca_ids:
        contratos_queryset = contratos_queryset.filter(id__in=contratos_para_cobranca_ids)
    else:
        fallback_ids = getattr(analise, 'respostas', {}).get('contratos_para_monitoria', [])
        if fallback_ids:
            contratos_queryset = contratos_queryset.filter(id__in=fallback_ids)

    contratos_lista = list(contratos_queryset)
    if not contratos_lista:
        return HttpResponse("Nenhum contrato disponível para gerar a cobrança judicial.", status=404)

    if not polo_passivo.endereco:
        return HttpResponse("Endereço da parte passiva não informado.", status=400)

    extrato_result = None
    try:
        docx_bytes = _build_cobranca_docx_bytes(processo, polo_passivo, contratos_lista)
        base_filename = _build_cobranca_base_filename(polo_passivo, contratos_lista)
        pdf_bytes = _convert_docx_to_pdf_bytes(docx_bytes)
        if not pdf_bytes:
            return HttpResponse("Não foi possível converter o DOCX para PDF. Verifique o conversor.", status=500)

        pdf_name = f"{base_filename}.pdf"
        pdf_file = ContentFile(pdf_bytes)
        arquivo_pdf = ProcessoArquivo(
            processo=processo,
            nome=pdf_name,
            enviado_por=request.user if request.user.is_authenticated else None,
        )
        arquivo_pdf.arquivo.save(pdf_name, pdf_file, save=True)
        pdf_url = arquivo_pdf.arquivo.url
    except FileNotFoundError as fe:
        logger.error("Template de cobrança não encontrado: %s", fe)
        return HttpResponse(str(fe), status=500)
    except Exception as exc:
        logger.error(f"Erro ao gerar petição de cobrança para o processo {processo_id}: {exc}", exc_info=True)
        return HttpResponse(f"Erro ao gerar a petição de cobrança: {exc}", status=500)

    extrato_result = generate_extrato_titularidade(
        processo=processo,
        cpf_value=polo_passivo.documento,
        contratos=contratos_lista,
        parte_name=polo_passivo.nome,
        usuario=request.user if request.user.is_authenticated else None
    )

    response_payload = {
        "status": "success",
        "message": "Petição de cobrança gerada (PDF salvo em Arquivos).",
        "pdf_url": pdf_url,
        "extrato": extrato_result
    }
    if extrato_result and isinstance(extrato_result, dict):
        pdf_url_extrato = extrato_result.get("pdf_url")
        if pdf_url_extrato:
            response_payload["extrato_url"] = pdf_url_extrato
        response_payload["message"] += " Extrato de titularidade salvo."

    return JsonResponse(response_payload)


@require_POST
def generate_monitoria_docx_download(request, processo_id=None):
    processo_id = processo_id or request.POST.get('processo_id')
    try:
        processo_id_int = int(processo_id)
    except (TypeError, ValueError):
        return HttpResponse("ID do processo inválido.", status=400)

    try:
        processo = get_object_or_404(ProcessoJudicial, pk=processo_id_int)
        analise = processo.analise_processo
    except ProcessoJudicial.DoesNotExist:
        return HttpResponse("Processo Judicial não encontrado.", status=404)
    except Exception as e:
        logger.error(f"Erro ao buscar análise do processo {processo_id_int}: {e}", exc_info=True)
        return HttpResponse(f"Erro ao buscar dados do processo: {e}", status=500)

    polo_passivo = processo.partes_processuais.filter(tipo_polo='PASSIVO').first()
    if not polo_passivo:
        return HttpResponse("Polo passivo não encontrado para este processo.", status=404)

    contratos_para_monitoria_ids = []
    try:
        posted_json = request.POST.get('contratos_para_monitoria')
        if posted_json:
            contratos_para_monitoria_ids = json.loads(posted_json)
    except (TypeError, json.JSONDecodeError):
        contratos_para_monitoria_ids = []

    if not contratos_para_monitoria_ids:
        contratos_para_monitoria_ids = analise.respostas.get('contratos_para_monitoria', [])

    contratos_monitoria = Contrato.objects.filter(id__in=contratos_para_monitoria_ids)
    if not contratos_monitoria.exists():
        return HttpResponse("Nenhum contrato selecionado para monitória na análise deste processo.", status=404)

    try:
        docx_bytes = _build_docx_bytes_common(processo, polo_passivo, contratos_monitoria)
        base_filename = _build_monitoria_base_filename(polo_passivo, contratos_monitoria)
        filename = f"{base_filename}.docx"

        return FileResponse(
            BytesIO(docx_bytes),
            content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            as_attachment=True,
            filename=filename,
        )
    except FileNotFoundError as fe:
        return HttpResponse(str(fe), status=500)
    except Exception as e:
        logger.error(f"Erro ao gerar DOCX editável para processo {processo_id}: {e}", exc_info=True)
        return HttpResponse(f"Erro ao gerar DOCX editável: {e}", status=500)


@require_GET
def download_monitoria_pdf(request, processo_id=None):
    """
    Download do PDF da monitória com Content-Disposition amigável,
    usando o nome padronizado (substitui underscores por espaços).
    """
    try:
        processo_id_int = int(processo_id or 0)
    except (TypeError, ValueError):
        return HttpResponse("ID do processo inválido.", status=400)

    arquivo_pdf = (
        ProcessoArquivo.objects
        .filter(processo_id=processo_id_int, arquivo__iendswith='.pdf')
        .order_by('-criado_em')
        .first()
    )
    if not arquivo_pdf or not arquivo_pdf.arquivo:
        return HttpResponse("PDF da monitória não encontrado para este processo.", status=404)

    try:
        arquivo_pdf.arquivo.open('rb')
        filename = arquivo_pdf.nome or os.path.basename(arquivo_pdf.arquivo.name)
        # reforça nome legível removendo underscores (storage padrão os adiciona)
        filename = filename.replace('_', ' ')
        return FileResponse(
            arquivo_pdf.arquivo,
            as_attachment=True,
            filename=filename,
            content_type='application/pdf'
        )
    except Exception as exc:
        logger.error("Erro ao preparar download do PDF da monitória: %s", exc, exc_info=True)
        return HttpResponse("Erro ao preparar download do PDF.", status=500)
