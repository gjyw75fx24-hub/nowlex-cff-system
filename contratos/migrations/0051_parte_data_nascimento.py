from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0050_carteira_fonte_alias'),
    ]

    operations = [
        migrations.AddField(
            model_name='parte',
            name='data_nascimento',
            field=models.DateField(
                blank=True,
                null=True,
                verbose_name='Data de Nascimento',
            ),
        ),
    ]
