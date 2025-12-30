from django.core.management.base import BaseCommand
from django.utils import timezone
from contratos.models import ProcessoJudicial, BuscaAtivaConfig
from contratos.integracoes_escavador.atualizador import atualizar_processo_do_escavador
import time

class Command(BaseCommand):
    help = 'Busca e atualiza os andamentos de todos os processos judiciais com a "Busca Ativa" habilitada.'

    def handle(self, *args, **options):
        """
        O ponto de entrada principal para o comando.
        """
        config = BuscaAtivaConfig.get_solo()
        now = timezone.localtime()

        if not config.habilitado:
            self.stdout.write(self.style.WARNING('Busca ativa desabilitada. Nada a fazer.'))
            return

        # Se horário configurado ainda não chegou, encerra
        if now.time() < config.horario:
            self.stdout.write(self.style.WARNING(f"Aguardando horário configurado ({config.horario}) para executar."))
            return

        self.stdout.write(self.style.SUCCESS('Iniciando a atualização de processos com busca ativa...'))

        # Filtra apenas os processos que devem ser atualizados
        processos_para_atualizar = ProcessoJudicial.objects.filter(busca_ativa=True)
        
        if not processos_para_atualizar.exists():
            self.stdout.write(self.style.WARNING('Nenhum processo com busca ativa encontrado.'))
            return

        total = processos_para_atualizar.count()
        self.stdout.write(f'Encontrados {total} processos para atualizar.')

        for i, processo in enumerate(processos_para_atualizar):
            self.stdout.write(f'({i+1}/{total}) Atualizando processo: {processo.cnj}...', ending=' ')
            
            resultado = atualizar_processo_do_escavador(processo.cnj)
            
            if resultado:
                _, novos_andamentos = resultado
                if novos_andamentos:
                    self.stdout.write(self.style.SUCCESS('OK'))
                else:
                    self.stdout.write(self.style.WARNING('SEM NOVOS ANDAMENTOS'))
            else:
                self.stdout.write(self.style.ERROR('FALHA'))
            
            # Adiciona uma pausa para não sobrecarregar a API do Escavador
            time.sleep(1) 

        self.stdout.write(self.style.SUCCESS('Atualização de processos concluída.'))
        config.ultima_execucao = now
        config.save(update_fields=['ultima_execucao'])
