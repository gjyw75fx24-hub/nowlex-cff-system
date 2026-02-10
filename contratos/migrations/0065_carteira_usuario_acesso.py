from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0064_tipo_analise_objetiva_e_ativos'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CarteiraUsuarioAcesso',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('criado_em', models.DateTimeField(auto_now_add=True, verbose_name='Criado em')),
                ('carteira', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='usuario_acessos', to='contratos.carteira', verbose_name='Carteira')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='carteira_acessos', to=settings.AUTH_USER_MODEL, verbose_name='Usuário')),
            ],
            options={
                'verbose_name': 'Acesso à Carteira (Usuário)',
                'verbose_name_plural': 'Acessos à Carteira (Usuários)',
                'ordering': ['usuario_id', 'carteira_id'],
                'unique_together': {('usuario', 'carteira')},
            },
        ),
    ]

