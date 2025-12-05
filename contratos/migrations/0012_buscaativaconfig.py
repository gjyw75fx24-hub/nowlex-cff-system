from django.db import migrations, models
import datetime


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0011_etiqueta_processojudicial_etiquetas_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='BuscaAtivaConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('horario', models.TimeField(default=datetime.time(3, 0), verbose_name='Horário diário')),
                ('habilitado', models.BooleanField(default=True, verbose_name='Busca ativa habilitada')),
                ('ultima_execucao', models.DateTimeField(blank=True, null=True, verbose_name='Última execução')),
            ],
            options={
                'verbose_name': 'Configuração de Busca Ativa',
                'verbose_name_plural': 'Configuração de Busca Ativa',
            },
        ),
    ]
