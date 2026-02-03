from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0057_contrato_data_saldo_atualizado'),
    ]

    operations = [
        migrations.AddField(
            model_name='tarefa',
            name='criado_em',
            field=models.DateTimeField(auto_now_add=True, blank=True, null=True, verbose_name='Criado em'),
        ),
        migrations.AddField(
            model_name='tarefa',
            name='criado_por',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='tarefas_criadas',
                to=settings.AUTH_USER_MODEL,
                verbose_name='Criado por',
            ),
        ),
    ]
