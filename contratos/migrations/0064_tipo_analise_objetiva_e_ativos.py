from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def create_default_tipo_analise(apps, schema_editor):
    TipoAnaliseObjetiva = apps.get_model('contratos', 'TipoAnaliseObjetiva')
    QuestaoAnalise = apps.get_model('contratos', 'QuestaoAnalise')

    default_tipo, _ = TipoAnaliseObjetiva.objects.get_or_create(
        slug='novas-monitorias',
        defaults={
            'nome': 'Novas Monitórias',
            'hashtag': '#novas-monitorias',
            'ativo': True,
            'versao': 1,
        },
    )

    QuestaoAnalise.objects.filter(tipo_analise__isnull=True).update(tipo_analise=default_tipo)


class Migration(migrations.Migration):

    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
        ('contratos', '0063_tarefalote_lote'),
    ]

    operations = [
        migrations.CreateModel(
            name='TipoAnaliseObjetiva',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nome', models.CharField(max_length=120, unique=True, verbose_name='Nome')),
                ('slug', models.SlugField(blank=True, help_text='Identificador interno usado na seleção do tipo de análise.', max_length=140, unique=True, verbose_name='Slug')),
                ('hashtag', models.CharField(blank=True, help_text='Usado nas Observações (ex.: #causa-passiva). Se vazio, será gerado automaticamente.', max_length=160, verbose_name='Hashtag')),
                ('ativo', models.BooleanField(default=True, verbose_name='Ativo')),
                ('versao', models.PositiveIntegerField(default=1, verbose_name='Versão')),
                ('criado_em', models.DateTimeField(auto_now_add=True, verbose_name='Criado em')),
                ('atualizado_em', models.DateTimeField(auto_now=True, verbose_name='Atualizado em')),
                ('atualizado_por', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tipos_analise_atualizados', to=settings.AUTH_USER_MODEL, verbose_name='Atualizado por')),
            ],
            options={
                'verbose_name': 'Tipo de Análise Objetiva',
                'verbose_name_plural': 'Tipos de Análise Objetiva',
                'ordering': ['nome'],
            },
        ),
        migrations.AddField(
            model_name='opcaoresposta',
            name='ativo',
            field=models.BooleanField(default=True, verbose_name='Ativo'),
        ),
        migrations.AddField(
            model_name='questaoanalise',
            name='ativo',
            field=models.BooleanField(default=True, verbose_name='Ativo'),
        ),
        migrations.AddField(
            model_name='questaoanalise',
            name='tipo_analise',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='questoes', to='contratos.tipoanaliseobjetiva', verbose_name='Tipo de Análise'),
        ),
        migrations.RunPython(create_default_tipo_analise, migrations.RunPython.noop),
    ]

