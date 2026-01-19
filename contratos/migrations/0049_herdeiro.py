from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0048_prazo_data_limite_origem_tarefa_data_origem'),
    ]

    operations = [
        migrations.CreateModel(
            name='Herdeiro',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('cpf_falecido', models.CharField(db_index=True, max_length=20, verbose_name='CPF falecido')),
                ('nome_completo', models.CharField(max_length=255, verbose_name='Nome completo')),
                ('cpf', models.CharField(blank=True, max_length=20, null=True, verbose_name='CPF')),
                ('rg', models.CharField(blank=True, max_length=20, null=True, verbose_name='RG')),
                ('grau_parentesco', models.CharField(blank=True, max_length=80, null=True, verbose_name='Grau de parentesco')),
                ('herdeiro_citado', models.BooleanField(default=False, verbose_name='Herdeiro citado')),
                ('endereco', models.TextField(blank=True, null=True, verbose_name='Endereço')),
                ('criado_em', models.DateTimeField(auto_now_add=True, verbose_name='Criado em')),
                ('atualizado_em', models.DateTimeField(auto_now=True, verbose_name='Atualizado em')),
            ],
            options={
                'verbose_name': 'Herdeiro',
                'verbose_name_plural': 'Herdeiros',
                'ordering': ['-herdeiro_citado', 'id'],
            },
        ),
    ]
