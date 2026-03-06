from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("contratos", "0078_contrato_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="pessoa",
            name="obito",
            field=models.BooleanField(default=False, verbose_name="Óbito"),
        ),
        migrations.AddField(
            model_name="pessoa",
            name="obito_data",
            field=models.DateField(blank=True, null=True, verbose_name="Data do Óbito"),
        ),
        migrations.AddField(
            model_name="pessoa",
            name="obito_cidade",
            field=models.CharField(blank=True, max_length=255, verbose_name="Cidade do Óbito"),
        ),
        migrations.AddField(
            model_name="pessoa",
            name="obito_uf",
            field=models.CharField(blank=True, max_length=2, verbose_name="UF do Óbito"),
        ),
        migrations.AddField(
            model_name="pessoa",
            name="obito_idade",
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="Idade no Óbito"),
        ),
    ]
