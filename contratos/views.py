# contratos/views.py

from django.http import JsonResponse, HttpResponse, FileResponse
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_POST, require_GET
from .models import ProcessoJudicial, StatusProcessual, QuestaoAnalise, OpcaoResposta, Contrato
from .integracoes_escavador.api import buscar_processo_por_cnj
from decimal import Decimal, InvalidOperation
from django.db.models import Max
from django.db import transaction
from django.contrib.admin.views.decorators import staff_member_required
import re
import logging
from contratos.data.decision_tree_config import DECISION_TREE_CONFIG # <--- Nova importação
import copy # Para cópia profunda do dicionário

# Imports para geração de DOCX
from docx import Document
from io import BytesIO
from datetime import datetime
import os
from django.conf import settings


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

@require_GET
def get_decision_tree_data(request):
    """
    Retorna a estrutura da árvore de decisão (questões e opções) como JSON,
    mesclando a configuração nativa com as do banco de dados.
    """
    # 1. Inicia com a configuração nativa
    # Cria uma cópia profunda para evitar modificar o dicionário original
    current_tree_config = copy.deepcopy(DECISION_TREE_CONFIG)
    
    primeira_questao_chave_db = None

    # 2. Mescla/Sobrescreve com as questões configuradas no banco de dados
    db_questoes = QuestaoAnalise.objects.all().prefetch_related('opcoes')
    for questao_db in db_questoes:
        if not questao_db.chave: # Chave é essencial para mesclar
            continue

        q_data = {
            'id': questao_db.id,
            'texto_pergunta': questao_db.texto_pergunta,
            'chave': questao_db.chave,
            'tipo_campo': questao_db.tipo_campo,
            'is_primeira_questao': questao_db.is_primeira_questao,
            'ordem': questao_db.ordem,
            'opcoes': []
        }

        for opcao_db in questao_db.opcoes.all().order_by('texto_resposta'):
            o_data = {
                'id': opcao_db.id,
                'texto_resposta': opcao_db.texto_resposta,
                'proxima_questao_id': opcao_db.proxima_questao.id if opcao_db.proxima_questao else None,
                'proxima_questao_chave': opcao_db.proxima_questao.chave if opcao_db.proxima_questao and opcao_db.proxima_questao.chave else None,
            }
            q_data['opcoes'].append(o_data)
        
        # Se a questão já existe na config nativa, sobrescreve seus campos
        # e mescla as opções. Caso contrário, adiciona a questão.
        if questao_db.chave in current_tree_config:
            # Sobrescreve atributos da questão
            current_tree_config[questao_db.chave].update({
                'id': q_data['id'],
                'texto_pergunta': q_data['texto_pergunta'],
                'tipo_campo': q_data['tipo_campo'],
                'is_primeira_questao': q_data['is_primeira_questao'],
                'ordem': q_data['ordem'],
            })
            # Substitui as opções pelas do banco de dados
            current_tree_config[questao_db.chave]['opcoes'] = q_data['opcoes']
        else:
            current_tree_config[questao_db.chave] = q_data
        
        if questao_db.is_primeira_questao:
            primeira_questao_chave_db = questao_db.chave
    
    # 3. Determina a chave da primeira questão
    # Prioriza a primeira questão definida no banco de dados
    if primeira_questao_chave_db:
        final_primeira_questao_chave = primeira_questao_chave_db
    else:
        # Se não houver no banco, usa a da configuração nativa
        # Assume que há apenas uma 'is_primeira_questao = True' na config nativa
        for chave, questao_data in current_tree_config.items():
            if questao_data.get("is_primeira_questao"):
                final_primeira_questao_chave = chave
                break
        else: # Se não encontrar nem na nativa
            return JsonResponse({'status': 'error', 'message': 'Nenhuma questão inicial configurada no banco de dados ou na configuração nativa.'}, status=404)

    return JsonResponse({
        'status': 'success',
        'primeira_questao_chave': final_primeira_questao_chave,
        'tree_data': current_tree_config
    })

@require_GET
def get_processo_contratos_api(request, processo_id):
    """
    Retorna uma lista de contratos associados a um Processo Judicial específico como JSON.
    """
    try:
        processo = get_object_or_404(ProcessoJudicial, pk=processo_id)
        contratos = processo.contratos.all().order_by('numero_contrato')
        
        contratos_data = [
            {
                'id': contrato.id,
                'numero_contrato': contrato.numero_contrato or f'Contrato sem número ({contrato.id})',
                'valor_total_devido': str(contrato.valor_total_devido) if contrato.valor_total_devido else None,
            }
            for contrato in contratos
        ]
        
        return JsonResponse({'status': 'success', 'contratos': contratos_data})
    except ProcessoJudicial.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Processo Judicial não encontrado.'}, status=404)
    except Exception as e:
        logger.error(f"Erro ao buscar contratos para processo_id {processo_id}: {e}", exc_info=True)
        return JsonResponse({'status': 'error', 'message': f'Ocorreu um erro interno: {e}'}, status=500)
# ==============================================================================
# FUNÇÕES E VIEWS PARA GERAÇÃO DA PEÇA MONITÓRIA
# ==============================================================================
from docx import Document
from io import BytesIO
from datetime import datetime
import os
from django.conf import settings

# Helper para parsear o endereço
def parse_endereco(endereco_str):
    parts = {
        'A': '', 'B': '', 'C': '', 'D': '', 'E': '',
        'F': '', 'G': '', 'H': ''
    }
    if not endereco_str:
        return parts

    # Expressão regular para capturar CHAVE: VALOR
    # Garante que o valor pode conter hífens e espaços
    matches = re.findall(r'([A-H]):\s*([^:]+?)(?=\s*-\s*[A-H]:|\s*$)', endereco_str)
    
    for key, value in matches:
        value = value.strip()
        # Limpa 'None' e 'null' da string, que podem vir de campos vazios
        if value.lower() == 'none' or value.lower() == 'null':
            value = ''
        parts[key.strip()] = value
    return parts

# Helper para converter número para extenso (simplificado)
# Para uma solução robusta, usar uma biblioteca ou implementar mais completo.
def number_to_words_pt_br(num):
    if not isinstance(num, (int, float, Decimal)):
        return str(num) # Retorna como string se não for número

    num_str = str(int(num)) # Lida apenas com a parte inteira para simplificar

    unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
    dezena = ['', 'dez', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
    dez_a_dezenove = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
    centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']

    if num == 0: return 'zero'

    def _num_to_words_chunk(n):
        s = ''
        n = int(n)
        
        if n >= 100:
            if n == 100:
                s += 'cem'
            else:
                s += centenas[n // 100]
            n %= 100
            if n > 0: s += ' e '
        
        if n >= 20 or n < 10:
            s += dezena[n // 10]
            n %= 10
            if n > 0 and (s != '' or (n // 10) > 0): s += ' e '
        
        if n > 0:
            s += unidades[n]
        
        return s

    def _process_triplet(triplet, scale):
        triplet = int(triplet)
        if triplet == 0: return ''
        words = _num_to_words_chunk(triplet)
        
        if scale == 1: # Mil
            if words == 'um': return 'mil'
            return words + ' mil'
        elif scale == 2: # Milhão
            if words == 'um': return 'um milhão'
            return words + ' milhões'
        # Adicione mais escalas conforme necessário (bilhões, trilhões)
        return words

    words_list = []
    
    # Processar parte inteira
    inteiro = int(num)
    if inteiro == 0:
        words_list.append('zero')
    else:
        chunks = []
        temp_int = inteiro
        while temp_int > 0:
            chunks.append(temp_int % 1000)
            temp_int //= 1000
        
        for i, chunk in enumerate(chunks):
            if chunk > 0:
                words_list.insert(0, _process_triplet(chunk, i))
    
    result = ' '.join(filter(None, words_list)) # Remove strings vazias e junta
    
    # Processar parte decimal (centavos)
    decimal_part = round((num - inteiro) * 100)
    if decimal_part > 0:
        if inteiro == 0:
            result = _num_to_words_chunk(decimal_part) + ' centavos'
        else:
            result += ' e ' + _num_to_words_chunk(decimal_part) + ' centavos'
    
    return result.capitalize()

@require_POST
def generate_monitoria_petition(request, processo_id=None):
    # aceita tanto o ID vindo na URL quanto no POST (fallback)
    processo_id = processo_id or request.POST.get('processo_id')
    
    try:
        processo_id_int = int(processo_id)
    except (TypeError, ValueError):
        return HttpResponse("ID do processo inválido.", status=400)

    try:
        processo = get_object_or_404(ProcessoJudicial, pk=processo_id_int)
        analise = processo.analise_processo  # OneToOneField
    except ProcessoJudicial.DoesNotExist:
        return HttpResponse("Processo Judicial não encontrado.", status=404)
    except Exception as e:
        logger.error(f"Erro ao buscar análise do processo {processo_id_int}: {e}", exc_info=True)
        return HttpResponse(f"Erro ao buscar dados do processo: {e}", status=500)

    # Buscar a parte passiva
    polo_passivo = processo.partes_processuais.filter(tipo_polo='PASSIVO').first()
    if not polo_passivo:
        return HttpResponse("Polo passivo não encontrado para este processo.", status=404)
    
    # Buscar contratos selecionados para monitória (POST tem prioridade)
    contratos_para_monitoria_ids = []
    try:
        posted_json = request.POST.get('contratos_para_monitoria')
        if posted_json:
            contratos_para_monitoria_ids = json.loads(posted_json)
    except (TypeError, json.JSONDecodeError):
        contratos_para_monitoria_ids = []

    if not contratos_para_monitoria_ids:
        contratos_para_monitoria_ids = analise.respostas.get('contratos_para_monitoria', [])

    contratos_monitoria = Contrato.objects.filter(id__in=contratos_para_monitoria_ids)

    if not contratos_monitoria.exists():
        return HttpResponse("Nenhum contrato selecionado para monitória na análise deste processo.", status=404)

    # Mapeamento de dados
    dados = {}
    dados['PARTE CONTRÁRIA'] = polo_passivo.nome
    dados['CPF'] = polo_passivo.documento # Pode ser CPF ou CNPJ

    # Parsear endereço
    endereco_parts = parse_endereco(polo_passivo.endereco)
    dados['A'] = endereco_parts.get('A', '') # Logradouro
    dados['B'] = endereco_parts.get('B', '') # Número
    dados['C'] = endereco_parts.get('C', '') # Complemento
    dados['D'] = endereco_parts.get('D', '') # Bairro
    dados['E'] = endereco_parts.get('E', '') # Cidade
    dados['F'] = endereco_parts.get('F', '') # Estado por extenso (ex: Rondônia)
    dados['G'] = endereco_parts.get('G', '') # CEP
    dados['H'] = endereco_parts.get('H', '') # UF (ex: RO)

    # Outros dados do processo
    dados['E_FORO'] = processo.vara # Ex: COMARCA DE PORTO VELHO
    dados['H_FORO'] = processo.uf # Ex: RO

    # Contratos
    # Assume que [CONTRATO] espera uma lista de números de contrato separados por vírgula
    dados['CONTRATO'] = ", ".join([c.numero_contrato for c in contratos_monitoria if c.numero_contrato])
    
    # Calcular Valor da Causa
    total_valor_causa = sum(contrato.valor_causa for contrato in contratos_monitoria if contrato.valor_causa is not None)
    dados['VALOR DA CAUSA'] = f'{total_valor_causa:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.') # Formato BR
    dados['VALOR DA CAUSA POR EXTENSO'] = number_to_words_pt_br(total_valor_causa)

    # Data de Hoje
    dados['DATA DE HOJE'] = datetime.now().strftime("%d de %B de %Y").replace(
        'January', 'janeiro').replace('February', 'fevereiro').replace('March', 'março').replace(
        'April', 'abril').replace('May', 'maio').replace('June', 'junho').replace(
        'July', 'julho').replace('August', 'agosto').replace('September', 'setembro').replace(
        'October', 'outubro').replace('November', 'novembro').replace('December', 'dezembro')


    # Caminho para o template DOCX
    template_path = os.path.join(
        settings.BASE_DIR, 
        'contratos', 'documents', 'Base de Minutas Oficiais Modelo', 
        '1 - Base - Inicial Monitoria - B6.docx'
    )

    if not os.path.exists(template_path):
        return HttpResponse(f"Arquivo de template não encontrado em: {template_path}", status=500)

    try:
        document = Document(template_path)

        for p in document.paragraphs:
            for key, value in dados.items():
                # Substituir [E]/[H] que está no mesmo parágrafo
                if key == 'E_FORO' and '[E]/[H]' in p.text:
                    p.text = p.text.replace('[E]/[H]', f"{dados.get('E_FORO', '')}/{dados.get('H_FORO', '')}")
                # Substituir outros placeholders
                p.text = p.text.replace(f'[{key}]', str(value))
        
        # Iterar sobre tabelas, se houver
        for table in document.tables:
            for row in table.rows:
                for cell in row.cells:
                    for p in cell.paragraphs:
                        for key, value in dados.items():
                            if key == 'E_FORO' and '[E]/[H]' in p.text:
                                p.text = p.text.replace('[E]/[H]', f"{dados.get('E_FORO', '')}/{dados.get('H_FORO', '')}")
                            p.text = p.text.replace(f'[{key}]', str(value))


        # Salvar o documento em um buffer de memória
        file_stream = BytesIO()
        document.save(file_stream)
        file_stream.seek(0)

        # Retornar o documento como uma resposta de download
        filename = f"Petição_Monitoria_{polo_passivo.nome}_{datetime.now().strftime('%Y%m%d')}.docx"
        response = FileResponse(file_stream, content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    except Exception as e:
        logger.error(f"Erro ao gerar a petição para o processo {processo_id}: {e}", exc_info=True)
        return HttpResponse(f"Erro ao gerar a petição: {e}", status=500)
