from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0093_userslackconfig_supervisaoslackentrega'),
    ]

    operations = [
        migrations.AddField(
            model_name='userslackconfig',
            name='analysis_type_slugs',
            field=models.JSONField(
                blank=True,
                default=list,
                help_text='Slugs dos tipos de análise que este supervisor recebe no Slack. Em branco = todos.',
                verbose_name='Tipos de análise para supervisão no Slack',
            ),
        ),
    ]
