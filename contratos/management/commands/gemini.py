from django.core.management.base import BaseCommand
from contratos.gemini_client import ask_gemini


class Command(BaseCommand):
    help = "Envia um prompt para o Gemini e exibe a resposta"

    def add_arguments(self, parser):
        parser.add_argument("prompt", nargs="+", help="Texto a enviar ao Gemini")

    def handle(self, *args, **options):
        prompt = " ".join(options["prompt"])
        self.stdout.write(self.style.WARNING("Enviando prompt ao Gemini...\n"))

        try:
            resposta = ask_gemini(prompt)
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Erro: {e}"))
            return

        self.stdout.write(self.style.SUCCESS("Resposta:\n"))
        self.stdout.write(resposta)

