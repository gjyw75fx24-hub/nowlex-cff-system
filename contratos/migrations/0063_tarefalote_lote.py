from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0062_alter_prazo_processo_alter_tarefa_processo'),
    ]

    operations = [
        migrations.CreateModel(
            name='TarefaLote',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('descricao', models.CharField(max_length=255, verbose_name='Descrição')),
                ('criado_em', models.DateTimeField(auto_now_add=True, blank=True, null=True, verbose_name='Criado em')),
                ('criado_por', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tarefas_lotes', to=settings.AUTH_USER_MODEL, verbose_name='Criado por')),
            ],
            options={
                'verbose_name': 'Lote de Tarefas',
                'verbose_name_plural': 'Lotes de Tarefas',
                'ordering': ['-criado_em'],
            },
        ),
        migrations.AddField(
            model_name='tarefa',
            name='lote',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tarefas', to='contratos.tarefalote'),
        ),
    ]
