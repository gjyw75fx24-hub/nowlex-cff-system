from django.db import migrations


_PREPOSITIONS = {
    "a",
    "as",
    "com",
    "da",
    "das",
    "de",
    "do",
    "dos",
    "e",
    "em",
    "na",
    "nas",
    "no",
    "nos",
    "para",
    "por",
}


def _normalize_status_name(value):
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    parts = []
    for index, token in enumerate(text.split()):
        cleaned = token.strip().lower()
        if not cleaned:
            continue
        if index > 0 and cleaned in _PREPOSITIONS:
            parts.append(cleaned)
        else:
            parts.append(cleaned.title())
    return " ".join(parts)


def _build_merged_name(canonical_name, status_id):
    suffix = f" [mesclado {status_id}]"
    base_len = max(1, 100 - len(suffix))
    return canonical_name[:base_len].rstrip() + suffix


def normalize_statusprocessual_names(apps, schema_editor):
    StatusProcessual = apps.get_model("contratos", "StatusProcessual")
    ProcessoJudicial = apps.get_model("contratos", "ProcessoJudicial")
    ProcessoJudicialNumeroCnj = apps.get_model("contratos", "ProcessoJudicialNumeroCnj")

    grouped_statuses = {}
    for status in StatusProcessual.objects.all().order_by("id"):
        canonical_name = _normalize_status_name(getattr(status, "nome", ""))
        if not canonical_name:
            continue
        grouped_statuses.setdefault(canonical_name, []).append(status)

    for canonical_name, statuses in grouped_statuses.items():
        exact_matches = [status for status in statuses if (status.nome or "").strip() == canonical_name]
        primary = exact_matches[0] if exact_matches else statuses[0]

        primary_updates = []
        if primary.nome != canonical_name:
            primary.nome = canonical_name
            primary_updates.append("nome")
        if any(bool(getattr(status, "ativo", False)) for status in statuses) and not primary.ativo:
            primary.ativo = True
            primary_updates.append("ativo")
        if primary_updates:
            primary.save(update_fields=primary_updates)

        for duplicate in statuses:
            if duplicate.pk == primary.pk:
                continue
            ProcessoJudicial.objects.filter(status_id=duplicate.pk).update(status_id=primary.pk)
            ProcessoJudicialNumeroCnj.objects.filter(status_id=duplicate.pk).update(status_id=primary.pk)
            duplicate.nome = _build_merged_name(canonical_name, duplicate.pk)
            duplicate.ativo = False
            duplicate.ordem = 0
            duplicate.save(update_fields=["nome", "ativo", "ordem"])


class Migration(migrations.Migration):

    dependencies = [
        ("contratos", "0095_alter_tarefanotificacao_tipo"),
    ]

    operations = [
        migrations.RunPython(normalize_statusprocessual_names, migrations.RunPython.noop),
    ]
