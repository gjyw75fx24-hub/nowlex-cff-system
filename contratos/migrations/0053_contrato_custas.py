from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0052_processo_numero_cnj'),
    ]

    operations = [
        migrations.AddField(
            model_name='contrato',
            name='custas',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True, verbose_name='Custas'),
        ),
    ]
