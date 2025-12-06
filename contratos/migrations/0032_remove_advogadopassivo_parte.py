from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0031_advogadopassivo'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='advogadopassivo',
            name='parte',
        ),
    ]

