import contratos.models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contratos', '0083_fix_processocpflotesalvo_atualizado_em'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        "ALTER TABLE contratos_processocpflotesalvo "
                        "ADD COLUMN IF NOT EXISTS token varchar(32);"
                        "UPDATE contratos_processocpflotesalvo "
                        "SET token = md5(random()::text || clock_timestamp()::text || id::text) "
                        "WHERE token IS NULL OR btrim(token) = '';"
                        "ALTER TABLE contratos_processocpflotesalvo "
                        "ALTER COLUMN token SET NOT NULL;"
                        "CREATE UNIQUE INDEX IF NOT EXISTS "
                        "contratos_processocpflotesalvo_token_uniq "
                        "ON contratos_processocpflotesalvo (token);"
                    ),
                    reverse_sql=migrations.RunSQL.noop,
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name='processocpflotesalvo',
                    name='token',
                    field=models.CharField(
                        default=contratos.models._generate_processo_cpf_lote_token,
                        editable=False,
                        max_length=32,
                        unique=True,
                        verbose_name='Token',
                    ),
                ),
            ],
        ),
    ]
