# contratos/views.py

from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_POST
from .models import ProcessoJudicial, StatusProcessual
from .integracoes_escavador.api import buscar_processo_por_cnj
from decimal import Decimal, InvalidOperation
from django.db.models import Max
from django.db import transaction
from django.contrib.admin.views.decorators import staff_member_required
import re
import logging

logger = logging.getLogger(__name__)

@require_POST
def buscar_dados_escavador_view(request):
    """
    View que recebe uma requisição AJAX com um CNJ, busca os dados no Escavador
    e os retorna como JSON para preenchimento do formulário, SEM SALVAR.
    """
    cnj = request.POST.get('cnj')
    if not cnj:
        return JsonResponse({'status': 'error', 'message': 'CNJ não fornecido.'}, status=400)

    try:
        # 1. Buscar os dados brutos da API
        dados_api = buscar_processo_por_cnj(cnj)
        if not dados_api:
            return JsonResponse({
                'status': 'error',
                'message': f'Não foi possível encontrar dados para o CNJ {cnj}.'
            }, status=404)

        # --- Início do Bloco de Processamento Seguro ---
        
        # 2. Preparar os dados para o formulário
        fontes_list = dados_api.get('fontes', [])
        fonte_principal = fontes_list[0] if fontes_list else {}

        # Trata o valor da causa
        valor_causa = Decimal('0.00')
        if fonte_principal:
            valor_causa_raw = fonte_principal.get('capa', {}).get('valor_causa', {}).get('valor_formatado')
            if valor_causa_raw is not None:
                valor_causa_str = str(valor_causa_raw).replace('R$', '').replace('.', '').replace(',', '.').strip()
                if valor_causa_str:
                    valor_causa = Decimal(valor_causa_str)

        # Trata o status (classe processual)
        status_id = None
        status_nome = None
        if fonte_principal:
            nome_classe_processual = fonte_principal.get('capa', {}).get('classe')
            if nome_classe_processual:
                normalized_name = re.sub(r'\s*\(\d+\)$', '', nome_classe_processual).strip()
                
                # get_or_create é atômico e a forma correta de evitar race conditions.
                status, created = StatusProcessual.objects.get_or_create(
                    nome=normalized_name.title(),
                    defaults={'ordem': 0}
                )
                status_id = status.id
                status_nome = status.nome

        # Prepara a lista de partes
        partes_para_formulario = []
        if fonte_principal:
            for parte_api in fonte_principal.get('envolvidos', []):
                tipo_polo_api = parte_api.get('polo', '').upper()
                if tipo_polo_api in ['ATIVO', 'PASSIVO']:
                    partes_para_formulario.append({
                        'tipo_polo': tipo_polo_api,
                        'nome': parte_api.get('nome', 'Nome não informado'),
                        'tipo_pessoa': 'PJ' if parte_api.get('tipo_pessoa', '').upper() == 'JURIDICA' else 'PF',
                        'documento': parte_api.get('cpf') or parte_api.get('cnpj', ''),
                        'endereco': parte_api.get('endereco', ''),
                    })

        # Prepara a lista de andamentos
        andamentos_para_formulario = []
        if fonte_principal:
            for andamento_api in dados_api.get('movimentacoes', []):
                andamentos_para_formulario.append({
                    'data': andamento_api.get('data'),
                    'descricao': andamento_api.get('conteudo'),
                })

        # 3. Montar o dicionário de resposta final
        dados_completos = {
            'status': 'success',
            'message': 'Dados encontrados! Revise e salve o formulário.',
            'processo': {
                'uf': dados_api.get('estado_origem', {}).get('sigla', ''),
                'vara': fonte_principal.get('capa', {}).get('orgao_julgador', ''),
                'tribunal': fonte_principal.get('tribunal', {}).get('nome', ''),
                'valor_causa': f'{valor_causa:.2f}',
                'status_id': status_id,
                'status_nome': status_nome,
            },
            'partes': partes_para_formulario,
            'andamentos': andamentos_para_formulario,
        }
        return JsonResponse(dados_completos)

    except Exception as e:
        # Captura QUALQUER erro durante a busca ou processamento dos dados
        logger.error(f"Erro ao processar CNJ {cnj}: {e}", exc_info=True)
        return JsonResponse({
            'status': 'error',
            'message': f'Ocorreu um erro interno ao processar os dados da API: {e}'
        }, status=500)


@staff_member_required
@require_POST
@transaction.atomic
def merge_status_view(request):
    """
    View para mesclar dois Status Processuais.
    Atualiza todos os Processos Judiciais do status de origem para o de destino.
    """
    try:
        source_id = int(request.POST.get('source_id'))
        target_id = int(request.POST.get('target_id'))

        if source_id == target_id:
            return JsonResponse({'status': 'error', 'message': 'Os status de origem e destino não podem ser os mesmos.'}, status=400)

        source_status = get_object_or_404(StatusProcessual, pk=source_id)
        target_status = get_object_or_404(StatusProcessual, pk=target_id)

        affected_processes_count = ProcessoJudicial.objects.filter(status=source_status).count()
        ProcessoJudicial.objects.filter(status=source_status).update(status=target_status)
        
        source_status.ativo = False
        source_status.save()
        
        message = f'{affected_processes_count} processo(s) foram atualizados. O status "{source_status.nome}" foi mesclado e inativado.'
        return JsonResponse({'status': 'success', 'message': message})

    except (KeyError, ValueError, TypeError):
        return JsonResponse({'status': 'error', 'message': 'Dados inválidos fornecidos.'}, status=400)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f'Ocorreu um erro inesperado: {e}'}, status=500)


def lista_processos(request):
    """
    Busca todos os processos no banco e os envia para o template de lista.
    """
    processos = ProcessoJudicial.objects.all().order_by('-id')
    contexto = {
        'processos': processos
    }
    return render(request, 'contratos/lista_processos.html', contexto)


def detalhe_processo(request, pk):
    """
    Busca um processo específico pelo seu ID (pk) e envia para o template de detalhe.
    """
    processo = get_object_or_404(ProcessoJudicial, pk=pk)
    contratos_do_processo = processo.contratos.all()
    
    contexto = {
        'processo': processo,
        'contratos': contratos_do_processo,
    }
    return render(request, 'contratos/detalhe_processo.html', contexto)