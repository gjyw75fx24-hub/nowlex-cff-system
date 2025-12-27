import io
import os
import re
import zipfile

from django.core.files.base import ContentFile
from django.db import transaction
from ..models import (
    ComboDocumentoPattern,
    ProcessoArquivo,
    ProcessoJudicial,
    TipoPeticao,
    ZipGerado
)


class PreviewError(Exception):
    pass


def build_preview(tipo_id, arquivo_base_id):
    assets = _collect_combo_assets(tipo_id, arquivo_base_id)
    return {
        'zip_name': assets['zip_name'],
        'contracts': assets['contracts'],
        'missing': assets['missing'],
        'optional': [
            {'id': arquivo.id, 'name': arquivo.nome or arquivo.arquivo.name}
            for arquivo in assets['optional_files']
        ],
        'found': [
            {
                'label': entry['label'],
                'arquivo_id': entry['arquivo'].id,
                'name': entry['arquivo'].nome or entry['arquivo'].arquivo.name
            }
            for entry in assets['found_entries']
        ],
        'tipo_id': assets['tipo'].id,
        'processo_id': assets['processo'].id,
    }


def generate_zip(tipo_id, arquivo_base_id, optional_ids=None):
    assets = _collect_combo_assets(tipo_id, arquivo_base_id)
    tipo = assets['tipo']
    processo = assets['processo']
    base_file = assets['base_file']
    optional_ids_set = set(str(v) for v in (optional_ids or []))
    optional_files = [
        arquivo for arquivo in assets['optional_files']
        if str(arquivo.id) in optional_ids_set
    ]
    files_to_zip = [{'arquivo': base_file, 'label': None}]
    files_to_zip += [
        {'arquivo': entry['arquivo'], 'label': entry['label']}
        for entry in assets['found_entries']
    ]
    existing_ids = {item['arquivo'].id for item in files_to_zip}
    for arquivo in optional_files:
        if arquivo.id not in existing_ids:
            files_to_zip.append({'arquivo': arquivo, 'label': None})
            existing_ids.add(arquivo.id)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, mode='w', compression=zipfile.ZIP_DEFLATED) as zip_file:
        for entry in files_to_zip:
            entry_name = _determine_zip_entry_name(entry)
            try:
                with entry['arquivo'].arquivo.open('rb') as fh:
                    zip_file.writestr(entry_name, fh.read())
            except Exception:
                continue
    zip_buffer.seek(0)

    zip_name = assets['zip_name']
    zip_proc_file = ProcessoArquivo.objects.create(
        processo=processo,
        nome=zip_name
    )
    zip_proc_file.arquivo.save(zip_name, ContentFile(zip_buffer.read()))
    zip_proc_file.save()

    ZipGerado.objects.create(
        tipo_peticao=tipo,
        processo=processo,
        arquivo_base=base_file,
        zip_file=zip_proc_file.arquivo,
        missing=assets['missing'],
        contratos=assets['contracts']
    )

    return {
        'url': zip_proc_file.arquivo.url,
        'arquivo_id': zip_proc_file.id,
        'missing': assets['missing'],
        'ok': True,
        'zip_name': zip_name,
        'entries': [
            {
                'label': entry['label'],
                'name': entry['arquivo'].nome or entry['arquivo'].arquivo.name
            }
            for entry in files_to_zip
        ]
    }


def _collect_combo_assets(tipo_id, arquivo_base_id):
    try:
        tipo = TipoPeticao.objects.get(pk=tipo_id)
    except TipoPeticao.DoesNotExist:
        raise PreviewError("Tipo de petição inválido.")

    try:
        base_file = ProcessoArquivo.objects.select_related('processo').get(pk=arquivo_base_id)
    except ProcessoArquivo.DoesNotExist:
        raise PreviewError("Arquivo-base inválido.")

    processo = base_file.processo
    contratos = _extract_contracts(base_file.nome)
    if not contratos:
        contratos = _extract_contracts_from_processo(processo)
    patterns = list(tipo.combo_patterns.all())
    files = list(processo.arquivos.all())
    used_ids = {base_file.id}
    found_entries = []
    missing = []
    optional_files = []

    for pattern in patterns:
        if pattern.categoria == ComboDocumentoPattern.CATEGORIA_FIXO:
            arquivo = _find_match(files, pattern.keywords, None, used_ids)
            if arquivo:
                used_ids.add(arquivo.id)
                found_entries.append({
                    'label': pattern.label_template,
                    'arquivo': arquivo
                })
            elif pattern.obrigatorio:
                missing.append(pattern.label_template)
        elif pattern.categoria == ComboDocumentoPattern.CATEGORIA_CONTRATO:
            for contrato in contratos:
                label = _render_label(pattern.label_template, pattern.placeholder, contrato)
                arquivo = _find_match(files, pattern.keywords, contrato, used_ids)
                if arquivo:
                    used_ids.add(arquivo.id)
                    found_entries.append({'label': label, 'arquivo': arquivo})
                elif pattern.obrigatorio:
                    missing.append(label)
        else:  # ANEXO
            anexos = _find_all_matches(files, pattern.keywords, None, used_ids)
            for arquivo in anexos:
                optional_files.append(arquivo)
                used_ids.add(arquivo.id)

    zip_name = _build_zip_name(tipo, processo, contratos, _primeiros_nomes_passivo(processo))

    return {
        'tipo': tipo,
        'processo': processo,
        'base_file': base_file,
        'contracts': contratos,
        'zip_name': zip_name,
        'found_entries': found_entries,
        'missing': missing,
        'optional_files': optional_files,
    }


def _find_match(files, keywords, contract, used_ids):
    candidates = []
    for arquivo in files:
        if arquivo.id in used_ids:
            continue
        name = (arquivo.nome or arquivo.arquivo.name or '').lower()
        if contract and contract not in name:
            continue
        if all((kw or '').lower() in name for kw in keywords):
            candidates.append((arquivo, name))
    if not candidates:
        return None
    prioritized = [item for item in candidates if item[1].endswith('.pdf')]
    if prioritized:
        return prioritized[0][0]
    return candidates[0][0]


def _find_all_matches(files, keywords, contract, used_ids):
    found = []
    for arquivo in files:
        if arquivo.id in used_ids:
            continue
        name = (arquivo.nome or arquivo.arquivo.name or '').lower()
        if contract and contract not in name:
            continue
        if all((kw or '').lower() in name for kw in keywords):
            found.append(arquivo)
    return found


def _extract_contracts(nome):
    tokens = re.findall(r'\d{5,}', nome or '')
    unique = sorted(set(tokens), key=lambda x: (len(x), x))
    return unique


def _extract_contracts_from_processo(processo):
    contratos = []
    for contrato in processo.contratos.all():
        numero = str(contrato.numero_contrato or '').strip()
        if numero and numero not in contratos:
            contratos.append(numero)
    return contratos


def _render_label(template, placeholder, contrato):
    if not contrato:
        return template
    if placeholder and placeholder in template:
        return template.replace(placeholder, contrato)
    return f"{template} - {contrato}"


def _build_zip_name(tipo, processo, contratos, parte_nome):
    tipo_rotulo = tipo.nome.upper()
    label_contratos = _formatar_lista_contratos(contratos)
    base = f"PROTOCOLO - {tipo_rotulo}"
    if label_contratos:
        base = f"{base} - {label_contratos}"
    if parte_nome:
        base = f"{base} - {parte_nome}"
    uf_prefix = (processo.uf or '').strip().upper()
    prefixes = [uf_prefix] if len(uf_prefix) == 2 else []
    prefix = f"{prefixes[0]} - " if prefixes else ""
    return f"{prefix}{base}.zip"


def _formatar_lista_contratos(contratos):
    if not contratos:
        return ''
    lista = [str(c).strip() for c in contratos if str(c).strip()]
    if not lista:
        return ''
    if len(lista) == 1:
        return lista[0]
    return ', '.join(lista[:-1]) + ' e ' + lista[-1]


def _primeiros_nomes_passivo(processo):
    partes = processo.partes_processuais.filter(tipo_polo='PASSIVO').order_by('id')
    if not partes.exists():
        partes = processo.partes_processuais.order_by('id')
    if not partes.exists():
        return ''
    nome = partes.first().nome
    particles = {'da', 'de', 'do', 'das', 'dos', 'e', "d'", 'd’'}
    tokens = [t for t in nome.split() if t.lower() not in particles]
    if not tokens:
        return nome
    if len(tokens) == 1:
        return tokens[0]
    return f"{tokens[0]} {tokens[1]}"


def _determine_zip_entry_name(entry):
    arquivo = entry['arquivo']
    label = entry.get('label')
    base = label or arquivo.nome or os.path.basename(arquivo.arquivo.name)
    ext = os.path.splitext(base)[1] or '.pdf'
    if not base.lower().endswith(ext.lower()):
        base = f"{base}{ext}"
    return base
