from django.core.management.base import BaseCommand
from rq import Worker

from contratos.queue import PASSIVAS_IMPORT_QUEUE, get_queue_connection


class Command(BaseCommand):
    help = "Inicia o worker RQ para importação de planilhas Passivas."

    def handle(self, *args, **options):
        connection = get_queue_connection()
        self.stdout.write(
            self.style.SUCCESS(
                f"Worker iniciado para a fila: {PASSIVAS_IMPORT_QUEUE}"
            )
        )
        Worker([PASSIVAS_IMPORT_QUEUE], connection=connection).work()
