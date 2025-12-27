import io
import os
import re
import unicodedata
import zipfile

from django.core.files.base import ContentFile
from django.db import transaction
from ..models import (
    ProcessoArquivo,
    TipoPeticao,
    TipoPeticaoAnexoContinua,
    ZipGerado
)


class PreviewError(Exception):
    pass


def build_preview(tipo_id, arquivo_base_id):
    assets = _collect_combo_assets(tipo_id, arquivo_base_id)
    optional_preview = [
        {'id': arquivo.id, 'name': arquivo.nome or os.path.basename(arquivo.arquivo.name)}
        for arquivo in assets['optional_files']
    ]
    per_contract_preview = []
    for entry in assets['per_contract']:
        per_contract_preview.append({
            'contrato': entry['contrato'],
            'a06': entry['preview'].get('a06'),
            'a07': entry['preview'].get('a07'),
            'a08': entry['preview'].get('a08'),
            'a09': entry['preview'].get('a09'),
        })
    return {
        'zip_name': assets['zip_name'],
        'suggestedName': assets['zip_name'],
        'contracts': assets['contracts'],
        'missing': assets['missing'],
        'found': assets['preview_found'],
        'tipo_id': assets['tipo'].id,
        'processo_id': assets['processo'].id,
        'optional': optional_preview,
        'optional_annexes': optional_preview,
        'continuous_annexes': assets['continuous_annexes_preview'],
        'per_contract': per_contract_preview,
        'file01': assets['file01'],
        'file05': assets['file05'],
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
    files_to_zip = assets['zip_entries'].copy()
    existing_ids = {
        _entry_id(entry['arquivo'])
        for entry in files_to_zip
        if entry['arquivo'] is not None
    }
    for arquivo in optional_files:
        arquivo_id = arquivo.id
        if arquivo_id not in existing_ids:
            files_to_zip.append({'arquivo': arquivo, 'label': None})
            existing_ids.add(arquivo_id)

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
                'label': entry.get('label'),
                'name': _get_entry_name(entry)
            }
            for entry in files_to_zip
            if entry.get('arquivo')
        ],
        'missing_count': len(assets['missing']),
        'missing_message': (
            f"Existem {len(assets['missing'])} itens faltantes." if assets['missing'] else ''
        )
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
    files = list(processo.arquivos.all())
    used_ids = {base_file.id}
    missing = []
    optional_files = _find_optional_annexes(files, used_ids)
    continuous_annexes = _get_continuous_annexes(tipo)
    continuous_entries = _build_continuous_entries(continuous_annexes)
    extrato = _find_extrato(files, used_ids)
    if extrato:
        used_ids.add(extrato.id)
    else:
        missing.append("05 - Extrato de Titularidade")
    per_contract = _collect_contract_files(contratos, files, used_ids, missing)
    zip_entries = _build_zip_entries(
        base_file,
        continuous_entries,
        extrato,
        per_contract
    )
    preview_found = _build_preview_found(base_file, continuous_entries, extrato, per_contract)
    zip_name = _build_zip_name(tipo, processo, contratos, _primeiros_nomes_passivo(processo))
    return {
        'tipo': tipo,
        'processo': processo,
        'base_file': base_file,
        'contracts': contratos,
        'zip_name': zip_name,
        'missing': missing,
        'optional_files': optional_files,
        'continuous_annexes': continuous_annexes,
        'continuous_entries': continuous_entries,
        'per_contract': per_contract,
        'zip_entries': zip_entries,
        'preview_found': preview_found,
        'file01': _build_file_preview(base_file),
        'file05': _build_file_preview(extrato),
        'continuous_annexes_preview': [
            {
                'id': annex.id,
                'name': annex.nome or os.path.basename(annex.arquivo.name),
                'label': annex['label']
            }
            for annex in continuous_entries
        ]
    }


def _extract_contracts(nome):
    tokens = re.findall(r'\d{5,}', nome or '')
    unique = sorted(set(tokens), key=lambda x: (len(x), x))
    return unique


def _normalize_text(value):
    if not value:
        return ''
    normalized = unicodedata.normalize('NFD', value)
    cleaned = ''.join(ch for ch in normalized if unicodedata.category(ch) != 'Mn')
    return ' '.join(cleaned.split()).strip().lower()


def _get_file_display_name(obj):
    if not obj:
        return ''
    name = getattr(obj, 'nome', None)
    if name:
        return name
    file_field = getattr(obj, 'arquivo', None)
    if file_field:
        return os.path.basename(file_field.name or '')
    return ''


def _entry_id(obj):
    if not obj:
        return None
    return getattr(obj, 'id', None)


def _get_entry_name(entry):
    arquivo = entry.get('arquivo')
    return _get_file_display_name(arquivo)


def _find_optional_annexes(files, used_ids):
    optional = []
    for arquivo in files:
        if arquivo.id in used_ids:
            continue
        name_norm = _normalize_text(arquivo.nome or arquivo.arquivo.name or '')
        if name_norm.startswith('anexo'):
            optional.append(arquivo)
    return optional


def _get_continuous_annexes(tipo):
    return list(tipo.anexos_continuos.order_by('criado_em'))


def _build_continuous_entries(continuous_annexes):
    entries = []
    for index, annex in enumerate(continuous_annexes, start=2):
        index_label = f"{index:02d}"
        name = annex.nome or os.path.basename(annex.arquivo.name)
        entries.append({
            'arquivo': annex,
            'label': f"{index_label} - {name}"
        })
    return entries


def _find_extrato(files, used_ids):
    prefix = '05 - extrato de titularidade'
    target = _normalize_text(prefix)
    candidates = []
    for arquivo in files:
        if arquivo.id in used_ids:
            continue
        name_norm = _normalize_text(arquivo.nome or arquivo.arquivo.name or '')
        if not name_norm.startswith(target):
            continue
        pdf_score = _normalize_text(_get_file_display_name(arquivo)).endswith('.pdf')
        timestamp = arquivo.criado_em.timestamp() if arquivo.criado_em else 0
        candidates.append((arquivo, pdf_score, timestamp))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (-int(item[1]), -item[2]))
    return candidates[0][0]


def _collect_contract_files(contracts, files, used_ids, missing):
    results = []
    for contrato in contracts:
        entry = {
            'contrato': contrato,
            'files': {},
            'preview': {},
            'labels': {
                'a06': f"06 - {contrato} - Contrato",
                'a07': f"07 - {contrato} - Relatório",
                'a08': f"08 - {contrato} - Saldo Devedor (ou Cálculo)",
                'a09': f"09 - {contrato} - TED",
            }
        }
        a06 = _find_by_contract_and_keywords(
            files,
            contrato,
            ['contrato', 'termo de ades', 'termo de adesao'],
            used_ids=used_ids
        )
        if a06:
            entry['files']['a06'] = a06
            entry['preview']['a06'] = _build_file_preview(a06, entry['labels']['a06'])
            used_ids.add(a06.id)
        else:
            missing.append(entry['labels']['a06'])

        a07 = _find_by_contract_and_keywords(
            files,
            contrato,
            ['relatorio', 'relatório'],
            used_ids=used_ids
        )
        if a07:
            entry['files']['a07'] = a07
            entry['preview']['a07'] = _build_file_preview(a07, entry['labels']['a07'])
            used_ids.add(a07.id)
        else:
            missing.append(entry['labels']['a07'])

        a08 = _find_by_contract_and_keywords(
            files,
            contrato,
            ['calculo de saldo devedor', 'cálculo de saldo devedor', 'saldo devedor'],
            used_ids=used_ids
        )
        if not a08:
            a08 = _find_by_contract_and_keywords(
                files,
                contrato,
                [],
                keywords_all=['saldo', 'b6'],
                used_ids=used_ids
            )
        if a08:
            entry['files']['a08'] = a08
            entry['preview']['a08'] = _build_file_preview(a08, entry['labels']['a08'])
            used_ids.add(a08.id)
        else:
            missing.append(entry['labels']['a08'])

        a09 = _find_by_contract_and_keywords(
            files,
            contrato,
            ['ted'],
            used_ids=used_ids
        )
        if a09:
            entry['files']['a09'] = a09
            entry['preview']['a09'] = _build_file_preview(a09, entry['labels']['a09'])
            used_ids.add(a09.id)
        else:
            missing.append(entry['labels']['a09'])

        results.append(entry)
    return results


def _find_by_contract_and_keywords(files, contract, keywords_any=None, keywords_all=None, used_ids=None):
    candidates = []
    contract_norm = _normalize_text(contract)
    keywords_any_norm = [_normalize_text(kw) for kw in (keywords_any or []) if kw]
    keywords_all_norm = [_normalize_text(kw) for kw in (keywords_all or []) if kw]

    for arquivo in files:
        if arquivo.id in (used_ids or set()):
            continue
        name_norm = _normalize_text(arquivo.nome or arquivo.arquivo.name or '')
        if contract_norm and contract_norm not in name_norm:
            continue
        if keywords_all_norm and not all(kw in name_norm for kw in keywords_all_norm):
            continue
        if keywords_any_norm and not any(kw in name_norm for kw in keywords_any_norm):
            continue
        pdf_score = _get_file_display_name(arquivo).lower().endswith('.pdf')
        match_score = sum(1 for kw in keywords_any_norm if kw in name_norm)
        timestamp = arquivo.criado_em.timestamp() if arquivo.criado_em else 0
        candidates.append((arquivo, pdf_score, match_score, timestamp))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (-int(item[1]), -item[2], -item[3]))
    return candidates[0][0]


def _build_zip_entries(base_file, continuous_entries, extrato, per_contract):
    entries = [{'arquivo': base_file, 'label': None}]
    for annex_entry in continuous_entries:
        entries.append({
            'arquivo': annex_entry['arquivo'],
            'label': annex_entry['label']
        })
    if extrato:
        entries.append({'arquivo': extrato, 'label': "05 - Extrato de Titularidade"})
    for contract_entry in per_contract:
        for key in ['a06', 'a07', 'a08', 'a09']:
            arquivo = contract_entry['files'].get(key)
            label = contract_entry['labels'][key]
            if arquivo:
                entries.append({'arquivo': arquivo, 'label': label})
    return entries


def _build_preview_found(base_file, continuous_entries, extrato, per_contract):
    entries = []
    if base_file:
        entries.append({
            'label': base_file.nome or _get_file_display_name(base_file),
            'arquivo_id': base_file.id,
            'name': _get_file_display_name(base_file)
        })
    if extrato:
        entries.append({
            'label': "05 - Extrato de Titularidade",
            'arquivo_id': extrato.id,
            'name': _get_file_display_name(extrato)
        })
    for contract_entry in per_contract:
        for key in ['a06', 'a07', 'a08', 'a09']:
            preview = contract_entry['preview'].get(key)
            if preview:
                entries.append({
                    'label': contract_entry['labels'][key],
                    'arquivo_id': preview['id'],
                    'name': preview['name']
                })
    return entries


def _build_file_preview(arquivo, label=None):
    if not arquivo:
        return None
    return {
        'id': arquivo.id,
        'name': _get_file_display_name(arquivo),
        'label': label
    }


def _extract_contracts_from_processo(processo):
    contratos = []
    for contrato in processo.contratos.all():
        numero = str(contrato.numero_contrato or '').strip()
        if numero and numero not in contratos:
            contratos.append(numero)
    return contratos


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
    for annex_entry in continuous_entries:
        entries.append({
            'label': annex_entry['label'],
            'arquivo_id': _entry_id(annex_entry['arquivo']),
            'name': _get_file_display_name(annex_entry['arquivo'])
        })
