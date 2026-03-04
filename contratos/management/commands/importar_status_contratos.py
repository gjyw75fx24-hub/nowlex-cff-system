import csv
import io
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from contratos.models import Contrato
from contratos.services.passivas_planilha import (
    load_xlsx_sheet_rows_from_bytes,
    normalize_header,
    _decode_csv_bytes,
)


def _normalize_digits(value):
    return re.sub(r"\D", "", str(value or ""))


def _parse_status(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    match = re.search(r"\d+", raw)
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def _pick_header_key(headers, candidates):
    normalized = [normalize_header(cand) for cand in candidates]
    for cand in normalized:
        for header in headers:
            if header == cand or header.startswith(cand):
                return header
    return ""


def _load_rows_from_xlsx(file_bytes, sheet_prefix):
    cols, raw_rows = load_xlsx_sheet_rows_from_bytes(file_bytes, sheet_prefix or "")
    if not raw_rows:
        return []
    header_row = raw_rows[0]
    headers = [normalize_header(header_row.get(col, "")) for col in cols]
    rows = []
    for row in raw_rows[1:]:
        record = {}
        for col, header in zip(cols, headers):
            if not header:
                continue
            record[header] = row.get(col, "")
        if record:
            rows.append(record)
    return rows


def _load_rows_from_csv(file_bytes):
    text = _decode_csv_bytes(file_bytes)
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        record = {}
        for key, value in row.items():
            if key is None:
                continue
            header = normalize_header(key)
            if not header:
                continue
            record[header] = value
        if record:
            rows.append(record)
    return rows


class Command(BaseCommand):
    help = (
        "Importa status de contratos a partir de planilha (XLSX/CSV). "
        "Requer coluna 'contrato' e 'status'."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            default="erp_contratos_status3_CANCELADOS.xlsx",
            help="Caminho da planilha (xlsx/csv).",
        )
        parser.add_argument(
            "--sheet",
            default="",
            help="Prefixo do nome da aba (XLSX). Vazio = primeira aba.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Apenas simula, sem gravar no banco.",
        )
        parser.add_argument(
            "--somente-cancelados",
            action="store_true",
            help="Atualiza apenas status=3.",
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
        ext = file_path.suffix.lower()
        if ext == ".csv":
            rows = _load_rows_from_csv(file_bytes)
        else:
            rows = _load_rows_from_xlsx(file_bytes, options.get("sheet") or "")

        if not rows:
            self.stdout.write(self.style.WARNING("Nenhuma linha válida encontrada."))
            return

        headers = set()
        for row in rows:
            headers.update(row.keys())

        contrato_key = _pick_header_key(headers, ["CONTRATO", "NUMERO CONTRATO", "N CONTRATO", "Nº CONTRATO", "NR CONTRATO"])
        status_key = _pick_header_key(headers, ["STATUS", "STATUS CONTRATO", "STATUS DO CONTRATO"])
        cpf_key = _pick_header_key(headers, ["CPF", "CPF TITULAR", "CPF DO TITULAR"])

        if not contrato_key or not status_key:
            raise CommandError(
                f"Colunas obrigatórias não encontradas. Headers detectados: {sorted(headers)}"
            )

        limit = int(options.get("limit") or 0)
        if limit > 0:
            rows = rows[:limit]

        contratos = list(
            Contrato.objects.all().only("id", "numero_contrato", "documento_titular", "status")
        )
        by_raw = {}
        by_digits = {}
        for contrato in contratos:
            raw = str(contrato.numero_contrato or "").strip()
            if raw:
                by_raw.setdefault(raw, []).append(contrato)
            digits = _normalize_digits(raw)
            if digits:
                by_digits.setdefault(digits, []).append(contrato)

        total_rows = 0
        matched_rows = 0
        not_found = 0
        updated = {}
        duplicates = 0
        only_cancelados = bool(options.get("somente_cancelados"))

        for row in rows:
            total_rows += 1
            raw_contrato = str(row.get(contrato_key, "") or "").strip()
            if not raw_contrato:
                continue
            status_value = _parse_status(row.get(status_key))
            if status_value is None:
                continue
            if only_cancelados and status_value != 3:
                continue

            cpf_digits = _normalize_digits(row.get(cpf_key) if cpf_key else "")
            digits = _normalize_digits(raw_contrato)

            candidates = by_raw.get(raw_contrato) or by_digits.get(digits) or []
            if cpf_digits and candidates:
                filtered = [
                    c for c in candidates
                    if _normalize_digits(c.documento_titular) == cpf_digits
                ]
                if filtered:
                    candidates = filtered

            if not candidates:
                not_found += 1
                continue

            matched_rows += 1
            if len(candidates) > 1:
                duplicates += 1
            for contrato in candidates:
                if contrato.status != status_value:
                    contrato.status = status_value
                    updated[contrato.id] = contrato

        if options.get("dry_run"):
            self.stdout.write(
                self.style.WARNING(
                    "Dry-run: nenhuma alteração persistida."
                )
            )
        else:
            to_update = list(updated.values())
            if to_update:
                for idx in range(0, len(to_update), 500):
                    Contrato.objects.bulk_update(to_update[idx:idx + 500], ["status"])

        self.stdout.write(
            self.style.SUCCESS(
                "Import concluído. "
                f"linhas={total_rows}, encontrados={matched_rows}, "
                f"não_encontrados={not_found}, "
                f"duplicados={duplicates}, "
                f"atualizados={len(updated)}."
                f"{' (dry-run)' if options.get('dry_run') else ''}"
            )
        )
