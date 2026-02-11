import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from contratos.models import OpcaoResposta, QuestaoAnalise, TipoAnaliseObjetiva


class Command(BaseCommand):
    help = (
        "Exporta um Tipo de Análise Objetiva (com Questões e Opções) para JSON, "
        "para replicar em outros ambientes."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "slug",
            help="Slug do Tipo de Análise (ex.: passivas, novas-monitorias).",
        )
        parser.add_argument(
            "--out",
            default="contratos/fixtures/tipos_analise_objetiva.json",
            help="Caminho do arquivo de saída JSON.",
        )

    def handle(self, *args, **options):
        slug = (options.get("slug") or "").strip()
        out_path = Path(options.get("out") or "").expanduser()
        if not slug:
            raise CommandError("Informe o slug do tipo.")
        if not out_path:
            raise CommandError("Informe --out.")

        try:
            tipo = TipoAnaliseObjetiva.objects.get(slug=slug)
        except TipoAnaliseObjetiva.DoesNotExist as exc:
            raise CommandError(f"Tipo não encontrado: {slug}") from exc

        questoes = (
            QuestaoAnalise.objects.filter(tipo_analise=tipo)
            .prefetch_related("opcoes", "opcoes__proxima_questao")
            .order_by("ordem", "id")
        )

        payload = {
            "tipo": {
                "nome": tipo.nome,
                "slug": tipo.slug,
                "hashtag": tipo.hashtag,
                "ativo": bool(tipo.ativo),
                "versao": int(tipo.versao or 1),
            },
            "questoes": [],
        }

        for questao in questoes:
            opcoes = (
                OpcaoResposta.objects.filter(questao_origem=questao)
                .select_related("proxima_questao")
                .order_by("id")
            )
            payload["questoes"].append(
                {
                    "texto_pergunta": questao.texto_pergunta,
                    "chave": questao.chave,
                    "tipo_campo": questao.tipo_campo,
                    "ordem": int(questao.ordem or 0),
                    "ativo": bool(questao.ativo),
                    "is_primeira_questao": bool(questao.is_primeira_questao),
                    "opcoes": [
                        {
                            "texto_resposta": opcao.texto_resposta,
                            "ativo": bool(opcao.ativo),
                            "proxima_questao_chave": (
                                opcao.proxima_questao.chave
                                if opcao.proxima_questao_id
                                else None
                            ),
                        }
                        for opcao in opcoes
                    ],
                }
            )

        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"Exportado: {slug} -> {out_path}"))

