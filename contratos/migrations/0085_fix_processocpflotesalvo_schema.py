from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0084_sync_processocpflotesalvo_token'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        "ALTER TABLE contratos_processocpflotesalvo "
                        "ALTER COLUMN token TYPE varchar(32);"
                        "ALTER TABLE contratos_processocpflotesalvo "
                        "ALTER COLUMN nome TYPE varchar(140);"
                    ),
                    reverse_sql=migrations.RunSQL.noop,
                ),
            ],
            state_operations=[],
        ),
    ]
