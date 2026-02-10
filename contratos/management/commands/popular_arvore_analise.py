# contratos/management/commands/popular_arvore_analise.py
from django.core.management.base import BaseCommand
from django.db import transaction
from contratos.models import QuestaoAnalise, OpcaoResposta, TipoAnaliseObjetiva
from contratos.data.decision_tree_config import DECISION_TREE_CONFIG

class Command(BaseCommand):
    help = 'Popula o banco de dados com a árvore de decisão a partir da configuração em decision_tree_config.py'

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING('Limpando dados antigos da árvore de decisão (QuestaoAnalise e OpcaoResposta)...'))
        OpcaoResposta.objects.all().delete()
        QuestaoAnalise.objects.all().delete()
        self.stdout.write(self.style.SUCCESS('Dados antigos limpos.'))

        self.stdout.write(self.style.NOTICE('Iniciando a criação de novas questões e opções...'))

        questoes_criadas = {}
        tipo_monitoria, _ = TipoAnaliseObjetiva.objects.get_or_create(
            slug='novas-monitorias',
            defaults={
                'nome': 'Novas Monitórias',
                'hashtag': '#novas-monitorias',
                'ativo': True,
                'versao': 1,
            },
        )

        # Primeira passagem: Criar todos os objetos QuestaoAnalise
        self.stdout.write('Passo 1/2: Criando objetos QuestaoAnalise...')
        for chave, dados_questao in DECISION_TREE_CONFIG.items():
            questao = QuestaoAnalise.objects.create(
                tipo_analise=tipo_monitoria,
                texto_pergunta=dados_questao['texto_pergunta'],
                chave=dados_questao['chave'],
                tipo_campo=dados_questao.get('tipo_campo', 'OPCOES'), # Default para OPCOES
                is_primeira_questao=dados_questao.get('is_primeira_questao', False),
                ordem=dados_questao.get('ordem', 10),
                ativo=True,
            )
            questoes_criadas[chave] = questao
            self.stdout.write(f'  - Criada questão: "{questao.texto_pergunta}"')

        self.stdout.write(self.style.SUCCESS('Todas as questões foram criadas.'))

        # Segunda passagem: Criar as OpcaoResposta e conectar as questões
        self.stdout.write('Passo 2/2: Criando OpcaoResposta e estabelecendo as conexões...')
        for chave, dados_questao in DECISION_TREE_CONFIG.items():
            if not dados_questao.get('opcoes'):
                continue

            questao_origem = questoes_criadas[chave]
            
            for dados_opcao in dados_questao['opcoes']:
                proxima_questao_chave = dados_opcao.get('proxima_questao_chave')
                proxima_questao = None
                if proxima_questao_chave:
                    proxima_questao = questoes_criadas.get(proxima_questao_chave)
                
                OpcaoResposta.objects.create(
                    questao_origem=questao_origem,
                    texto_resposta=dados_opcao['texto_resposta'],
                    proxima_questao=proxima_questao,
                    ativo=True,
                )
                if proxima_questao:
                    self.stdout.write(f'  - Criada opção: "{questao_origem.texto_pergunta}" -> "{dados_opcao["texto_resposta"]}" >> Conecta a: "{proxima_questao.texto_pergunta}"')
                else:
                    self.stdout.write(f'  - Criada opção: "{questao_origem.texto_pergunta}" -> "{dados_opcao["texto_resposta"]}" >> Fim do fluxo.')


        self.stdout.write(self.style.SUCCESS('População da árvore de decisão concluída com sucesso!'))
