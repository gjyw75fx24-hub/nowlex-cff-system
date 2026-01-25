from django.db import migrations, models
import django.db.models.deletion
from django.utils import timezone


def create_existing_entries(apps, schema_editor):
    ProcessoJudicial = apps.get_model('contratos', 'ProcessoJudicial')
    NumeroCnj = apps.get_model('contratos', 'ProcessoJudicialNumeroCnj')
    StatusProcessual = apps.get_model('contratos', 'StatusProcessual')
    Carteira = apps.get_model('contratos', 'Carteira')

    for processo in ProcessoJudicial.objects.filter(cnj__isnull=False).exclude(cnj__exact=''):
        exists = NumeroCnj.objects.filter(processo=processo, cnj=processo.cnj).exists()
        if exists:
            continue
        NumeroCnj.objects.create(
            processo=processo,
            cnj=processo.cnj,
            uf=processo.uf or '',
            valor_causa=processo.valor_causa,
            status=processo.status,
            carteira=processo.carteira,
            vara=processo.vara,
            tribunal=processo.tribunal,
            criado_em=timezone.now(),
            atualizado_em=timezone.now(),
        )


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0051_parte_data_nascimento'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProcessoJudicialNumeroCnj',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('cnj', models.CharField(max_length=30, verbose_name='Número CNJ')),
                ('uf', models.CharField(blank=True, max_length=2, verbose_name='UF')),
                ('valor_causa', models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True, verbose_name='Valor da Causa')),
                ('vara', models.CharField(blank=True, max_length=255, null=True, verbose_name='Vara')),
                ('tribunal', models.CharField(blank=True, max_length=50, verbose_name='Tribunal')),
                ('criado_em', models.DateTimeField(auto_now_add=True, verbose_name='Criado em')),
                ('atualizado_em', models.DateTimeField(auto_now=True, verbose_name='Atualizado em')),
                ('carteira', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='numeros_cnj', to='contratos.carteira', verbose_name='Carteira')),
                ('processo', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='numeros_cnj', to='contratos.processojudicial', verbose_name='Processo Judicial')),
                ('status', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='contratos.statusprocessual', verbose_name='Classe Processual')),
            ],
            options={
                'verbose_name': 'Número CNJ',
                'verbose_name_plural': 'Números CNJ',
                'ordering': ['-criado_em'],
            },
        ),
        migrations.RunPython(create_existing_entries, migrations.RunPython.noop),
    ]
