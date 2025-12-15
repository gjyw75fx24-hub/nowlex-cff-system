from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('contratos', '0039_analiseprocesso_para_supervisionar'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name='processojudicial',
                    name='soma_contratos',
                    field=models.DecimalField(
                        max_digits=14,
                        decimal_places=2,
                        default=0,
                        editable=False,
                        verbose_name='Soma dos Contratos'
                    ),
                ),
            ],
        ),
    ]
