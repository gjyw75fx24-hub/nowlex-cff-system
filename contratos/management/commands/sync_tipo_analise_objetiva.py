import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from contratos.models import OpcaoResposta, QuestaoAnalise, TipoAnaliseObjetiva


class Command(BaseCommand):
    help = (
        "Cria/atualiza um Tipo de Análise Objetiva a partir de um JSON exportado "
        "(inclui Questões e Opções), de forma idempotente."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            required=True,
            help="Arquivo JSON (gerado por export_tipo_analise_objetiva).",
        )
        parser.add_argument(
            "--bump-version",
            action="store_true",
            help="Incrementa a versão do tipo quando houver qualquer alteração.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        file_path = Path(options.get("file") or "").expanduser()
        if not file_path.exists():
            raise CommandError(f"Arquivo não encontrado: {file_path}")

        data = json.loads(file_path.read_text(encoding="utf-8") or "{}")
        tipo_data = data.get("tipo") or {}
        questoes_data = data.get("questoes") or []

        slug = (tipo_data.get("slug") or "").strip()
        nome = (tipo_data.get("nome") or "").strip()
        if not slug or not nome:
            raise CommandError("JSON inválido: tipo.slug e tipo.nome são obrigatórios.")

        hashtag = (tipo_data.get("hashtag") or "").strip()
        ativo = bool(tipo_data.get("ativo", True))

        tipo, created = TipoAnaliseObjetiva.objects.get_or_create(
            slug=slug,
            defaults={
                "nome": nome,
                "hashtag": hashtag,
                "ativo": ativo,
                "versao": int(tipo_data.get("versao") or 1),
            },
        )

        changed = False
        if tipo.nome != nome:
            tipo.nome = nome
            changed = True
        if hashtag and tipo.hashtag != hashtag:
            tipo.hashtag = hashtag
            changed = True
        if tipo.ativo != ativo:
            tipo.ativo = ativo
            changed = True

        tipo.save()

        # Upsert Questões
        questoes_by_chave = {
            q.chave: q for q in QuestaoAnalise.objects.filter(tipo_analise=tipo)
        }
        incoming_chaves = set()

        for qd in questoes_data:
            chave = (qd.get("chave") or "").strip()
            if not chave:
                raise CommandError("JSON inválido: toda questão deve ter 'chave'.")
            incoming_chaves.add(chave)
            defaults = {
                "tipo_analise": tipo,
                "texto_pergunta": qd.get("texto_pergunta") or "",
                "tipo_campo": qd.get("tipo_campo") or "OPCOES",
                "ordem": int(qd.get("ordem") or 0),
                "ativo": bool(qd.get("ativo", True)),
                "is_primeira_questao": bool(qd.get("is_primeira_questao", False)),
            }
            questao = questoes_by_chave.get(chave)
            if questao is None:
                questao = QuestaoAnalise.objects.create(chave=chave, **defaults)
                questoes_by_chave[chave] = questao
                changed = True
            else:
                for field, value in defaults.items():
                    if getattr(questao, field) != value:
                        setattr(questao, field, value)
                        changed = True
                questao.save()

        # Desativar questões que existiam mas não estão no JSON (não apaga)
        for chave, questao in list(questoes_by_chave.items()):
            if chave in incoming_chaves:
                continue
            if questao.ativo:
                questao.ativo = False
                questao.is_primeira_questao = False
                questao.save(update_fields=["ativo", "is_primeira_questao"])
                changed = True

        # Garantir apenas uma primeira questão ativa
        primeiras = list(
            QuestaoAnalise.objects.filter(tipo_analise=tipo, is_primeira_questao=True, ativo=True).order_by("ordem", "id")
        )
        if len(primeiras) > 1:
            keep = primeiras[0]
            QuestaoAnalise.objects.filter(
                tipo_analise=tipo,
                is_primeira_questao=True,
                ativo=True,
            ).exclude(pk=keep.pk).update(is_primeira_questao=False)
            changed = True

        # Upsert Opções (primeira passagem sem proxima_questao, depois resolve)
        pending_next = []  # (opcao, proxima_chave)
        for qd in questoes_data:
            chave = qd["chave"]
            questao = questoes_by_chave.get(chave)
            if questao is None:
                continue
            desired = qd.get("opcoes") or []
            desired_texts = []
            for od in desired:
                texto = (od.get("texto_resposta") or "").strip()
                if not texto:
                    continue
                desired_texts.append(texto)
                opcao, opt_created = OpcaoResposta.objects.get_or_create(
                    questao_origem=questao,
                    texto_resposta=texto,
                    defaults={"ativo": bool(od.get("ativo", True)), "proxima_questao": None},
                )
                if opt_created:
                    changed = True
                else:
                    ativo_od = bool(od.get("ativo", True))
                    if opcao.ativo != ativo_od:
                        opcao.ativo = ativo_od
                        changed = True
                    opcao.save()
                pending_next.append((opcao, (od.get("proxima_questao_chave") or "").strip() or None))

            # Desativar opções que não estão mais no JSON (não apaga)
            for opcao in OpcaoResposta.objects.filter(questao_origem=questao):
                if opcao.texto_resposta in desired_texts:
                    continue
                if opcao.ativo:
                    opcao.ativo = False
                    opcao.proxima_questao = None
                    opcao.save(update_fields=["ativo", "proxima_questao"])
                    changed = True

        # Resolver proxima_questao
        for opcao, prox_chave in pending_next:
            prox_obj = questoes_by_chave.get(prox_chave) if prox_chave else None
            if opcao.proxima_questao_id != (prox_obj.id if prox_obj else None):
                opcao.proxima_questao = prox_obj
                opcao.save(update_fields=["proxima_questao"])
                changed = True

        if options.get("bump_version") and changed:
            tipo.versao = int(tipo.versao or 0) + 1
            tipo.save(update_fields=["versao"])

        action = "criado" if created else "sincronizado"
        self.stdout.write(self.style.SUCCESS(f"Tipo '{slug}' {action}. Alterações: {'sim' if changed else 'não'}"))
