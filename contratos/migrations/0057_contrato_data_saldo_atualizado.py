from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("contratos", "0056_parte_obito_idade"),
    ]

    operations = [
        migrations.AddField(
            model_name="contrato",
            name="data_saldo_atualizado",
            field=models.DateField(blank=True, null=True, verbose_name="Data saldo atualizado"),
        ),
    ]
