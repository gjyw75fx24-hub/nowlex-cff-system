from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0077_andamentoprocessualpendente'),
    ]

    operations = [
        migrations.AddField(
            model_name='contrato',
            name='status',
            field=models.IntegerField(
                blank=True,
                help_text='Status importado da planilha (ex.: 3 = Cancelado).',
                null=True,
                verbose_name='Status',
            ),
        ),
    ]
