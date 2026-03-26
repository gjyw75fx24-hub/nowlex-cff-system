from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0092_tarefanotificacao_payload'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='UserSlackConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slack_user_id', models.CharField(blank=True, default='', help_text='ID do membro no Slack, por exemplo U012ABC34.', max_length=32, verbose_name='Slack User ID')),
                ('criado_em', models.DateTimeField(auto_now_add=True, verbose_name='Criado em')),
                ('atualizado_em', models.DateTimeField(auto_now=True, verbose_name='Atualizado em')),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='slack_config', to=settings.AUTH_USER_MODEL, verbose_name='Usuário')),
            ],
            options={
                'verbose_name': 'Configuração Slack do usuário',
                'verbose_name_plural': 'Configurações Slack dos usuários',
                'ordering': ['user__username'],
            },
        ),
        migrations.CreateModel(
            name='SupervisaoSlackEntrega',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('card_id', models.CharField(max_length=120, verbose_name='Card ID')),
                ('card_source', models.CharField(max_length=64, verbose_name='Origem do card')),
                ('card_index', models.PositiveIntegerField(verbose_name='Indice do card')),
                ('slack_user_id', models.CharField(max_length=32, verbose_name='Slack User ID')),
                ('slack_channel_id', models.CharField(blank=True, default='', max_length=64, verbose_name='Slack Channel ID')),
                ('slack_message_ts', models.CharField(blank=True, default='', max_length=64, verbose_name='Slack Message TS')),
                ('slack_thread_ts', models.CharField(blank=True, default='', max_length=64, verbose_name='Slack Thread TS')),
                ('last_status', models.CharField(blank=True, default='', max_length=20, verbose_name='Ultimo status')),
                ('message_hash', models.CharField(blank=True, default='', max_length=64, verbose_name='Hash da mensagem')),
                ('notified_at', models.DateTimeField(blank=True, null=True, verbose_name='Notificado em')),
                ('resolved_at', models.DateTimeField(blank=True, null=True, verbose_name='Resolvido em')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Criado em')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Atualizado em')),
                ('analise', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='slack_entregas_supervisao', to='contratos.analiseprocesso', verbose_name='Análise')),
                ('processo', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='slack_entregas_supervisao', to='contratos.processojudicial', verbose_name='Processo judicial')),
                ('supervisor', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='slack_entregas_supervisao', to=settings.AUTH_USER_MODEL, verbose_name='Supervisor')),
            ],
            options={
                'verbose_name': 'Entrega Slack de supervisão',
                'verbose_name_plural': 'Entregas Slack de supervisão',
                'ordering': ['-updated_at', '-id'],
            },
        ),
        migrations.AddConstraint(
            model_name='supervisaoslackentrega',
            constraint=models.UniqueConstraint(fields=('analise', 'supervisor', 'card_source', 'card_index'), name='uniq_supervisaoslackentrega_card_supervisor'),
        ),
    ]
