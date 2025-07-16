# contratos/views.py

from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_POST
from .models import ProcessoJudicial, StatusProcessual
from .integracoes_escavador.api import buscar_processo_por_cnj
from decimal import Decimal, InvalidOperation

@require_POST
def buscar_dados_escavador_view(request ):
    """
    View que recebe uma requisição AJAX com um CNJ, busca os dados no Escavador
    e os retorna como JSON para preenchimento do formulário, SEM SALVAR.
    """
    cnj = request.POST.get('cnj')
    if not cnj:
        return JsonResponse({'status': 'error', 'message': 'CNJ não fornecido.'}, status=400)

    # 1. Buscar os dados brutos da API com tratamento de exceção
    try:
        dados_api = buscar_processo_por_cnj(cnj)
    except Exception as e:
        # Captura erros na comunicação com a API (ex: timeout, erro 500 da API)
        return JsonResponse({
            'status': 'error',
            'message': f'Ocorreu um erro ao buscar os dados do Escavador: {e}'
        }, status=500)

    if not dados_api:
        return JsonResponse({
            'status': 'error',
            'message': f'Não foi possível encontrar dados para o CNJ {cnj}.'
        }, status=404)

    # 2. Preparar os dados para o formulário
    
    # Trata o valor da causa com robustez
    valor_causa = Decimal('0.00') # Valor padrão
    try:
        # Acessa a primeira fonte para obter os dados da capa
        fonte_principal = dados_api.get('fontes', [{}])[0]
        valor_causa_raw = fonte_principal.get('capa', {}).get('valor_causa', {}).get('valor_formatado')
        
        if valor_causa_raw is not None:
            # Garante que é string, remove "R$", pontos de milhar e troca vírgula por ponto
            valor_causa_str = str(valor_causa_raw).replace('R$', '').replace('.', '').replace(',', '.').strip()
            if valor_causa_str: # Garante que não está vazia após a limpeza
                valor_causa = Decimal(valor_causa_str)
    except (InvalidOperation, TypeError, ValueError, IndexError):
        # Se houver qualquer erro na conversão ou se a lista de fontes for vazia, mantém o valor padrão de 0.00
        valor_causa = Decimal('0.00')

    # Trata o status (classe processual)
    status_id = None
    # A classe está dentro da capa da fonte principal
    if 'fonte_principal' in locals() and fonte_principal:
        nome_classe_processual = fonte_principal.get('capa', {}).get('classe')
        if nome_classe_processual:
            status, _ = StatusProcessual.objects.get_or_create(
                nome=nome_classe_processual,
                defaults={'ordem': 0} # Define uma ordem padrão se o status for novo
            )
            status_id = status.id

    # 3. Preparar a lista de partes para o formulário
    partes_para_formulario = []
    # Os envolvidos estão dentro de cada fonte
    if 'fonte_principal' in locals() and fonte_principal:
        partes_envolvidas_api = fonte_principal.get('envolvidos', [])
        for parte_api in partes_envolvidas_api:
            tipo_polo_api = parte_api.get('polo', '').upper()
            
            # Mapeia os polos de forma mais clara
            if tipo_polo_api == 'ATIVO':
                tipo_polo = 'ATIVO'
            elif tipo_polo_api == 'PASSIVO':
                tipo_polo = 'PASSIVO'
            else:
                continue # Ignora partes sem polo definido (ex: JUIZ, ADVOGADO, NENHUM)

            documento = parte_api.get('cpf') or parte_api.get('cnpj', '')
            tipo_pessoa = 'PJ' if parte_api.get('tipo_pessoa', '').upper() == 'JURIDICA' else 'PF'

            partes_para_formulario.append({
                'tipo_polo': tipo_polo,
                'nome': parte_api.get('nome', 'Nome não informado'),
                'tipo_pessoa': tipo_pessoa,
                'documento': documento,
                'endereco': parte_api.get('endereco', ''), # O JSON de exemplo não tem endereço, mas mantemos a lógica
            })

    # 4. Preparar a lista de andamentos
    andamentos_para_formulario = []
    # As movimentações também estão dentro de cada fonte
    if 'fonte_principal' in locals() and fonte_principal:
        movimentacoes_api = fonte_principal.get('movimentacoes', []) # O JSON de exemplo não tem, mas é bom ter
        for andamento_api in movimentacoes_api:
            andamentos_para_formulario.append({
                'data': andamento_api.get('data'),
                'descricao': andamento_api.get('conteudo'),
            })

    # 5. Montar o dicionário de resposta final
    dados_completos = {
        'status': 'success',
        'message': 'Dados encontrados! Revise e salve o formulário.',
        'processo': {
            'uf': dados_api.get('estado_origem', {}).get('sigla', ''),
            'vara': fonte_principal.get('capa', {}).get('orgao_julgador', '') if 'fonte_principal' in locals() else '',
            'tribunal': fonte_principal.get('tribunal', {}).get('nome', '') if 'fonte_principal' in locals() else '',
            'valor_causa': f'{valor_causa:.2f}',
            'status_id': status_id,
        },
        'partes': partes_para_formulario,
        'andamentos': andamentos_para_formulario,
    }
    
    return JsonResponse(dados_completos)


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
