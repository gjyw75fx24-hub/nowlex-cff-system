from __future__ import annotations

import datetime
from typing import Iterable

from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.db.models import Q

from contratos.models import (
    Carteira,
    ListaDeTarefas,
    ProcessoJudicial,
    Tarefa,
    TarefaLote,
    TipoAnaliseObjetiva,
)
from contratos.services.passivas_planilha import (
    build_passivas_rows_from_file_bytes,
    import_passivas_rows,
    normalize_cpf,
    normalize_header,
)
from contratos.services.analise_lote_planilha import (
    build_analise_lote_rows_from_file_bytes,
    import_analise_lote_rows,
)


def _filter_rows_by_priority(rows: Iterable, selected_priority_keys: Iterable[str]) -> list:
    selected = {normalize_header(v) for v in (selected_priority_keys or []) if normalize_header(v)}
    if not selected:
        return list(rows)
    return [
        row
        for row in rows
        if normalize_header(getattr(row, "prioridade", "")) in selected
    ]


def _filter_rows_by_cpfs(rows: Iterable, selected_cpfs: Iterable[str]) -> list:
    normalized = {normalize_cpf(v) for v in (selected_cpfs or []) if normalize_cpf(v)}
    if not normalized:
        return list(rows)
    return [row for row in rows if normalize_cpf(getattr(row, "cpf", "")) in normalized]


def _apply_pending_tasks(
    *,
    pending_tarefas: Iterable[dict] | None,
    carteira: Carteira,
    imported_cpfs: Iterable[str],
    user_id: int | None,
) -> tuple[int, int]:
    pending_list = [item for item in (pending_tarefas or []) if isinstance(item, dict)]
    if not pending_list:
        return 0, 0

    imported_set = {normalize_cpf(cpf) for cpf in imported_cpfs if normalize_cpf(cpf)}
    if not imported_set:
        return 0, 0

    carteira_id = getattr(carteira, "id", None)
    if not carteira_id:
        return 0, 0

    processos = (
        ProcessoJudicial.objects.filter(
            Q(carteira=carteira) | Q(carteiras_vinculadas=carteira),
            partes_processuais__documento__in=imported_set,
        )
        .distinct()
        .order_by("id")
        .prefetch_related("partes_processuais")
    )

    cpf_to_processo = {}
    for proc in processos:
        partes_manager = getattr(proc, "partes_processuais", None)
        if not partes_manager:
            continue
        for parte in partes_manager.all():
            doc = normalize_cpf(getattr(parte, "documento", ""))
            if not doc or doc not in imported_set:
                continue
            cpf_to_processo.setdefault(doc, proc)

    user = get_user_model().objects.filter(pk=user_id).first() if user_id else None
    applied_tasks = 0
    applied_tasks_targets = 0

    for item in pending_list:
        cpfs_item = [normalize_cpf(c) for c in (item.get("cpfs") or []) if normalize_cpf(c)]
        payload = item.get("payload") or {}
        if not isinstance(payload, dict):
            continue
        target_cpfs = [c for c in cpfs_item if c in imported_set]
        if not target_cpfs:
            continue

        descricao = (payload.get("descricao") or "").strip()
        data_raw = (payload.get("data") or "").strip()
        if not (descricao and data_raw):
            continue
        try:
            data_dt = datetime.date.fromisoformat(data_raw)
        except Exception:
            continue

        lista_id = payload.get("lista_id") or None
        responsavel_id = payload.get("responsavel_id") or None
        prioridade = (payload.get("prioridade") or "M").strip().upper()[:1] or "M"
        observacoes = (payload.get("observacoes") or "").strip()
        concluida = bool(payload.get("concluida"))
        comentario_texto = (payload.get("comentario_texto") or "").strip()
        if comentario_texto:
            observacoes = (observacoes + "\n\n" if observacoes else "") + f"Comentário: {comentario_texto}"

        lista = ListaDeTarefas.objects.filter(id=lista_id).first() if lista_id else None
        responsavel = get_user_model().objects.filter(id=responsavel_id).first() if responsavel_id else None

        lote = TarefaLote.objects.create(
            descricao=f"Planilha (pendente): {descricao}",
            criado_por=user,
        )

        targets = []
        for cpf in target_cpfs:
            proc = cpf_to_processo.get(cpf)
            if proc:
                targets.append(proc)
        if not targets:
            continue

        applied_tasks_targets += len(targets)
        for proc in targets:
            Tarefa.objects.create(
                processo=proc,
                lote=lote,
                descricao=descricao,
                lista=lista,
                data=data_dt,
                responsavel=responsavel,
                prioridade=prioridade,
                concluida=concluida,
                observacoes=observacoes,
                criado_por=user,
            )
            applied_tasks += 1

    return applied_tasks, applied_tasks_targets


def run_passivas_planilha_import_job(
    *,
    storage_path: str,
    upload_name: str,
    carteira_id: int,
    tipo_analise_id: int,
    sheet_prefix: str = "",
    uf: str = "",
    limit: int = 0,
    selected_cpfs: Iterable[str] | None = None,
    consider_priority: bool = False,
    selected_priority_keys: Iterable[str] | None = None,
    pending_tarefas: Iterable[dict] | None = None,
    user_id: int | None = None,
) -> dict:
    file_bytes = b""
    if storage_path:
        with default_storage.open(storage_path, "rb") as fp:
            file_bytes = fp.read()

    parsed_all = build_passivas_rows_from_file_bytes(
        file_bytes,
        upload_name=upload_name,
        sheet_prefix=sheet_prefix or "E - PASSIVAS",
        uf_filter=uf or "",
        limit=int(limit or 0),
    )

    parsed = parsed_all
    if consider_priority and selected_priority_keys:
        parsed = _filter_rows_by_priority(parsed, selected_priority_keys)

    if selected_cpfs:
        parsed = _filter_rows_by_cpfs(parsed, selected_cpfs)

    carteira = Carteira.objects.filter(pk=carteira_id).first()
    tipo_analise = TipoAnaliseObjetiva.objects.filter(pk=tipo_analise_id).first()
    if not carteira or not tipo_analise:
        raise ValueError("Carteira ou Tipo de Análise não encontrado.")

    user = get_user_model().objects.filter(pk=user_id).first() if user_id else None
    result = import_passivas_rows(
        parsed,
        carteira=carteira,
        tipo_analise=tipo_analise,
        dry_run=False,
        user=user,
    )

    imported_cpfs = [getattr(r, "cpf", "") for r in parsed if getattr(r, "cpf", "")]
    applied_tasks, applied_tasks_targets = _apply_pending_tasks(
        pending_tarefas=pending_tarefas,
        carteira=carteira,
        imported_cpfs=imported_cpfs,
        user_id=user_id,
    )

    try:
        if storage_path and default_storage.exists(storage_path):
            default_storage.delete(storage_path)
    except Exception:
        pass

    return {
        "created_cadastros": result.created_cadastros,
        "updated_cadastros": result.updated_cadastros,
        "created_cnjs": result.created_cnjs,
        "updated_cnjs": result.updated_cnjs,
        "created_cards": result.created_cards,
        "updated_cards": result.updated_cards,
        "reused_priority_tags": result.reused_priority_tags,
        "standardized_priority_tags": result.standardized_priority_tags,
        "skipped_rows": result.skipped_rows,
        "errors": result.errors,
        "rows": len(parsed_all),
        "rows_imported": len(parsed),
        "applied_tasks": applied_tasks,
        "applied_tasks_targets": applied_tasks_targets,
    }


def run_analise_lote_planilha_import_job(
    *,
    storage_path: str,
    upload_name: str,
    carteira_id: int,
    tipo_analise_id: int,
    analista_id: int,
    sheet_prefix: str = "",
    uf: str = "",
    limit: int = 0,
    selected_row_ids: Iterable[str] | None = None,
    user_id: int | None = None,
) -> dict:
    file_bytes = b""
    if storage_path:
        with default_storage.open(storage_path, "rb") as fp:
            file_bytes = fp.read()

    parsed_all = build_analise_lote_rows_from_file_bytes(
        file_bytes,
        upload_name=upload_name,
        sheet_prefix=sheet_prefix or "",
        uf_filter=uf or "",
        limit=int(limit or 0),
    )

    carteira = Carteira.objects.filter(pk=carteira_id).first()
    tipo_analise = TipoAnaliseObjetiva.objects.filter(pk=tipo_analise_id).first()
    analista = get_user_model().objects.filter(pk=analista_id).first()
    acting_user = get_user_model().objects.filter(pk=user_id).first() if user_id else None
    if not carteira or not tipo_analise or not analista:
        raise ValueError("Carteira, Tipo de Análise ou Analista não encontrado.")

    result = import_analise_lote_rows(
        parsed_all,
        carteira=carteira,
        tipo_analise=tipo_analise,
        analista=analista,
        acting_user=acting_user,
        selected_row_ids=selected_row_ids,
    )

    try:
        if storage_path and default_storage.exists(storage_path):
            default_storage.delete(storage_path)
    except Exception:
        pass

    return {
        "created_cadastros": 0,
        "updated_cadastros": result.updated_processos,
        "created_cnjs": result.created_cnjs,
        "updated_cnjs": result.updated_cnjs,
        "created_cards": result.created_cards,
        "updated_cards": result.updated_cards,
        "reused_priority_tags": 0,
        "standardized_priority_tags": 0,
        "skipped_rows": result.skipped_rows,
        "errors": result.errors,
        "rows": len(parsed_all),
        "rows_imported": result.matched_rows,
        "applied_tasks": 0,
        "applied_tasks_targets": 0,
    }
