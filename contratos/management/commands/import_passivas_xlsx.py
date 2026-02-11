from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from contratos.models import Carteira, TipoAnaliseObjetiva
from contratos.services.passivas_planilha import build_passivas_rows_from_xlsx_bytes, import_passivas_rows


class Command(BaseCommand):
    help = (
        "Importa a planilha 'E - PASSIVAS' para o sistema, criando/atualizando cadastros "
        "na carteira Passivas e salvando cards de análise (idempotente por CPF+CNJ)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            default="E - PASSIVAS - Modelo.xlsx",
            help="Caminho do XLSX (template).",
        )
        parser.add_argument(
            "--sheet",
            default="E - PASSIVAS",
            help="Prefixo do nome da aba a importar.",
        )
        parser.add_argument(
            "--carteira",
            default="Passivas",
            help="Nome da Carteira destino (cria se não existir).",
        )
        parser.add_argument(
            "--tipo-analise-slug",
            default="passivas",
            help="Slug do Tipo de Análise Objetiva (ex.: passivas).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Não grava no banco (apenas simula e mostra estatísticas).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Limita o número de linhas processadas (0 = sem limite).",
        )

    def handle(self, *args, **options):
        file_path = Path(options.get("file") or "").expanduser()
        if not file_path.exists():
            raise CommandError(f"Arquivo não encontrado: {file_path}")
        file_bytes = file_path.read_bytes()
        parsed = build_passivas_rows_from_xlsx_bytes(
            file_bytes,
            sheet_prefix=(options.get("sheet") or "E - PASSIVAS"),
            limit=int(options.get("limit") or 0),
        )

        if not parsed:
            self.stdout.write(self.style.WARNING("Nenhuma linha válida encontrada."))
            return

        carteira_nome = (options.get("carteira") or "").strip()
        carteira, _ = Carteira.objects.get_or_create(nome=carteira_nome)

        tipo_slug = (options.get("tipo_analise_slug") or "").strip()
        try:
            tipo_analise = TipoAnaliseObjetiva.objects.get(slug=tipo_slug)
        except TipoAnaliseObjetiva.DoesNotExist as exc:
            raise CommandError(f"Tipo de Análise não encontrado: slug='{tipo_slug}'") from exc
        dry_run = bool(options.get("dry_run"))
        import_result = import_passivas_rows(
            parsed,
            carteira=carteira,
            tipo_analise=tipo_analise,
            dry_run=dry_run,
        )
        self.stdout.write(
            self.style.SUCCESS(
                "Import concluído. "
                f"cadastros: +{import_result.created_cadastros}/~{import_result.updated_cadastros}, "
                f"cnjs: +{import_result.created_cnjs}/~{import_result.updated_cnjs}, "
                f"cards: +{import_result.created_cards}/~{import_result.updated_cards}. "
                f"{'(dry-run, sem gravar)' if dry_run else ''}"
            )
        )
