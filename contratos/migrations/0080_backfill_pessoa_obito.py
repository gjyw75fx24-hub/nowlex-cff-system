import re
from django.db import migrations


def _normalize_documento(value):
    return re.sub(r"\D", "", str(value or ""))


def forwards(apps, schema_editor):
    Parte = apps.get_model("contratos", "Parte")
    Pessoa = apps.get_model("contratos", "Pessoa")

    partes = (
        Parte.objects.filter(obito=True)
        .exclude(documento__isnull=True)
        .exclude(documento__exact="")
    )
    for parte in partes.iterator():
        doc_norm = _normalize_documento(parte.documento)
        if not doc_norm:
            continue
        pessoa = getattr(parte, "pessoa", None)
        if pessoa is None:
            pessoa = Pessoa.objects.filter(documento_normalizado=doc_norm).first()
        if pessoa is None:
            pessoa = Pessoa(
                documento=parte.documento,
                documento_normalizado=doc_norm,
                nome=parte.nome or "",
                tipo_pessoa=parte.tipo_pessoa or "",
            )
        updates = []
        if not getattr(pessoa, "obito", False):
            pessoa.obito = True
            updates.append("obito")
        if getattr(parte, "obito_data", None) and not getattr(pessoa, "obito_data", None):
            pessoa.obito_data = parte.obito_data
            updates.append("obito_data")
        if getattr(parte, "obito_cidade", "") and not getattr(pessoa, "obito_cidade", ""):
            pessoa.obito_cidade = parte.obito_cidade
            updates.append("obito_cidade")
        if getattr(parte, "obito_uf", "") and not getattr(pessoa, "obito_uf", ""):
            pessoa.obito_uf = parte.obito_uf
            updates.append("obito_uf")
        if getattr(parte, "obito_idade", None) is not None and getattr(pessoa, "obito_idade", None) is None:
            pessoa.obito_idade = parte.obito_idade
            updates.append("obito_idade")

        if pessoa.pk:
            if updates:
                pessoa.save(update_fields=updates)
        else:
            pessoa.save()

        if parte.pessoa_id != pessoa.pk:
            parte.pessoa_id = pessoa.pk
            parte.save(update_fields=["pessoa"])

        Parte.objects.filter(pessoa=pessoa).update(
            obito=True,
            obito_data=pessoa.obito_data,
            obito_cidade=pessoa.obito_cidade,
            obito_uf=pessoa.obito_uf,
            obito_idade=pessoa.obito_idade,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("contratos", "0079_pessoa_obito_fields"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
