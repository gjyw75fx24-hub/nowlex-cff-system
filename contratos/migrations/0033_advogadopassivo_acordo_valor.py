import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0032_remove_advogadopassivo_parte'),
    ]

    operations = [
        migrations.AddField(
            model_name='advogadopassivo',
            name='acordo_status',
            field=models.CharField(blank=True, choices=[('PROPOSTO', 'Proposto'), ('FIRMADO', 'Firmado'), ('RECUSADO', 'Recusado')], max_length=10, verbose_name='Acordo'),
        ),
        migrations.AddField(
            model_name='advogadopassivo',
            name='valor_acordado',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True, verbose_name='Valor Acordado'),
        ),
    ]

