import json
import os
import re
from datetime import datetime, date as date_cls, time as time_cls
from decimal import Decimal, InvalidOperation

import requests
from rest_framework import generics, status
from rest_framework.views import APIView
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth.decorators import login_required
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.db.models import Q, Count
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View
from django.http import JsonResponse

from ..models import (
    AnaliseProcesso,
    Carteira,
    Contrato,
    Herdeiro,
    ListaDeTarefas,
    Parte,
    ProcessoArquivo,
    ProcessoJudicial,
    Prazo,
    PrazoMensagem,
    Tarefa,
    TarefaLote,
    TarefaMensagem,
)
from ..services.demandas import DemandasImportError, DemandasImportService
from .serializers import (
    TarefaSerializer,
    PrazoSerializer,
    UserSerializer,
    ListaDeTarefasSerializer,
    TarefaMensagemSerializer,
    PrazoMensagemSerializer,
)
from ..services.nowlex_calc import (
    NowlexCalcError,
    create_calc,
    download_pdf_with_fallback,
    parse_decimal,
)

SUPERVISION_STATUS_SEQUENCE = ['pendente', 'pre_aprovado', 'aprovado', 'reprovado']
SUPERVISION_STATUS_LABELS = {
    'pendente': 'Pendente de Supervisão',
    'pre_aprovado': 'Pré-aprovado',
    'aprovado': 'Aprovado',
    'reprovado': 'Reprovado',
}

def _normalize_decimal_string(value):
    if value is None:
        return ''
    normalized = str(value).strip()
    if not normalized:
        return ''
    normalized = normalized.replace('\u00A0', '')
    normalized = normalized.replace('R$', '')
    normalized = normalized.replace(' ', '')
    has_comma = ',' in normalized
    has_dot = '.' in normalized
    if has_comma and has_dot:
        normalized = normalized.replace('.', '')
        normalized = normalized.replace(',', '.')
    elif has_comma:
        normalized = normalized.replace(',', '.')
    return normalized

def _parse_decimal_value(value):
    normalized = _normalize_decimal_string(value)
    if not normalized:
        return None
    try:
        return Decimal(normalized)
    except (InvalidOperation, TypeError):
        return None

def get_next_supervision_status(current_status):
    normalized = (current_status or 'pendente').lower()
    if normalized not in SUPERVISION_STATUS_SEQUENCE:
        normalized = 'pendente'
    current_index = SUPERVISION_STATUS_SEQUENCE.index(normalized)
    next_index = (current_index + 1) % len(SUPERVISION_STATUS_SEQUENCE)
    return SUPERVISION_STATUS_SEQUENCE[next_index]


class AgendaAPIView(APIView):
    """
    API para buscar todas as tarefas e prazos de um processo.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, processo_id):
        try:
            processo = ProcessoJudicial.objects.get(pk=processo_id)
            tarefas = Tarefa.objects.filter(processo=processo)
            prazos = Prazo.objects.filter(processo=processo)
            
            tarefas_data = TarefaSerializer(tarefas, many=True).data
            prazos_data = PrazoSerializer(prazos, many=True).data
            
            # Combina e ordena por data
            agenda_items = sorted(
                tarefas_data + prazos_data, 
                key=lambda x: x.get('data') or x.get('data_limite')
            )
            
            return Response(agenda_items)
        except ProcessoJudicial.DoesNotExist:
            return Response({"error": "Processo não encontrado."}, status=status.HTTP_404_NOT_FOUND)

class AgendaGeralAPIView(APIView):
    """
    Retorna todas as tarefas e prazos para a Agenda Geral.
    """
    permission_classes = [IsAuthenticated]
    renderer_classes = [JSONRenderer]
    DEFAULT_PAGE_SIZE = 200
    MAX_PAGE_SIZE = 500

    def get(self, request):
        status_param = (request.query_params.get('status') or '').lower()
        show_completed = status_param in ['completed', 'concluidos', 'concluida', 'concluido']
        tarefa_filter = {'concluida': True} if show_completed else {'concluida': False}
        prazo_filter = {'concluido': True} if show_completed else {'concluido': False}

        tarefas = (
            Tarefa.objects
            .select_related('processo', 'responsavel', 'lista')
            .filter(**tarefa_filter)
        )
        prazos = (
            Prazo.objects
            .select_related('processo', 'responsavel')
            .filter(**prazo_filter)
        )

        processo_ids = set(
            list(tarefas.values_list('processo_id', flat=True))
            + list(prazos.values_list('processo_id', flat=True))
        )
        processo_meta = {}
        if processo_ids:
            processos = (
                ProcessoJudicial.objects
                .filter(id__in=processo_ids)
                .prefetch_related('partes_processuais')
            )
            for processo in processos:
                partes_qs = processo.partes_processuais.order_by('tipo_polo', 'id')
                parte_passiva = partes_qs.filter(tipo_polo='PASSIVO').first() or partes_qs.first()
                parte_nome = parte_passiva.nome if parte_passiva else ''
                parte_documento = parte_passiva.documento if parte_passiva else ''
                processo_meta[processo.id] = {
                    'nome': parte_nome,
                    'cpf': parte_documento,
                }

        tarefas_data = TarefaSerializer(tarefas, many=True).data
        for item in tarefas_data:
            item['type'] = 'T'
            raw_date = item.get('data')
            if hasattr(raw_date, 'isoformat'):
                raw_date = raw_date.isoformat()
            item['date'] = (raw_date or '')[:10]
            raw_origin = item.get('data_origem')
            if hasattr(raw_origin, 'isoformat'):
                raw_origin = raw_origin.isoformat()
            item['original_date'] = (raw_origin or '')[:10]
            meta = processo_meta.get(item.get('processo_id')) or {}
            if meta:
                item['nome'] = meta.get('nome', '')
                item['parte_nome'] = meta.get('nome', '')
                item['cpf'] = meta.get('cpf', '')
                item['parte_cpf'] = meta.get('cpf', '')
                item['documento'] = meta.get('cpf', '')

        prazos_data = PrazoSerializer(prazos, many=True).data
        for item in prazos_data:
            item['type'] = 'P'
            raw_limit = item.get('data_limite')
            date_str = ''
            if isinstance(raw_limit, str):
                match = re.match(r'^(\d{4}-\d{2}-\d{2})', raw_limit)
                if match:
                    date_str = match.group(1)
                else:
                    try:
                        dt = timezone.datetime.fromisoformat(raw_limit.replace('Z', '+00:00'))
                        if timezone.is_naive(dt):
                            dt = timezone.make_aware(dt, timezone.get_default_timezone())
                        date_str = timezone.localtime(dt, timezone.get_default_timezone()).date().isoformat()
                    except Exception:
                        date_str = (raw_limit or '')[:10]
            elif hasattr(raw_limit, 'date'):
                try:
                    date_str = raw_limit.date().isoformat()
                except Exception:
                    date_str = (raw_limit.date().isoformat() if hasattr(raw_limit, 'date') else '')
            item['date'] = date_str
            item['title'] = item.get('titulo')
            raw_origin = item.get('data_limite_origem')
            if hasattr(raw_origin, 'isoformat'):
                raw_origin = raw_origin.isoformat()
            item['original_date'] = (raw_origin or '')[:10]
            meta = processo_meta.get(item.get('processo_id')) or {}
            if meta:
                item['nome'] = meta.get('nome', '')
                item['parte_nome'] = meta.get('nome', '')
                item['cpf'] = meta.get('cpf', '')
                item['parte_cpf'] = meta.get('cpf', '')
                item['documento'] = meta.get('cpf', '')

        supervision_entries = self._get_supervision_entries(show_completed, request)
        agenda_items = sorted(
            tarefas_data + prazos_data + supervision_entries,
            key=lambda x: x.get('date') or ''
        )

        total_items = len(agenda_items)
        try:
            page = int(request.query_params.get('page', 1))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.query_params.get('page_size', self.DEFAULT_PAGE_SIZE))
        except (TypeError, ValueError):
            page_size = self.DEFAULT_PAGE_SIZE
        page = max(1, page)
        page_size = max(10, min(page_size, self.MAX_PAGE_SIZE))
        start = (page - 1) * page_size
        end = start + page_size
        paginated_entries = agenda_items[start:end]

        payload = {
            'entries': paginated_entries,
            'page': page,
            'page_size': page_size,
            'total_entries': total_items,
        }
        return JsonResponse(payload, json_dumps_params={'ensure_ascii': False})

    def _supervision_status_labels(self):
        return SUPERVISION_STATUS_LABELS

    def _build_analysis_result_lines(self, card_info, contract_lookup=None):
        status = card_info.get('status', 'pendente')
        labels = self._supervision_status_labels()
        lines = [f"Status: {labels.get(status, status.capitalize())}"]
        card = card_info.get('card') or {}
        responses = card.get('tipo_de_acao_respostas') or {}
        if not isinstance(responses, dict):
            responses = {}
        fallback = card
        contract_lookup = contract_lookup or {}
        response_labels = {
            'judicializado_pela_massa': 'Judicializado pela massa',
            'tipo_de_acao': 'Tipo de ação',
            'julgamento': 'Julgamento',
            'transitado': 'Transitado',
            'procedencia': 'Procedência',
            'data_de_transito': 'Data de trânsito',
            'cumprimento_de_sentenca': 'Cumprimento de sentença',
            'propor_monitoria': 'Propor monitória',
            'repropor_monitoria': 'Repropor monitória',
            'contratos_para_monitoria': 'Contratos para monitória',
            'ativar_botao_monitoria': 'Botão de monitória',
        }
        ordered_fields = [
            'judicializado_pela_massa',
            'tipo_de_acao',
            'julgamento',
            'transitado',
            'procedencia',
            'data_de_transito',
            'cumprimento_de_sentenca',
            'propor_monitoria',
            'contratos_para_monitoria',
            'repropor_monitoria',
            'ativar_botao_monitoria',
        ]

        def value_is_empty(value):
            if value is None or value == '':
                return True
            if isinstance(value, (list, tuple)) and not value:
                return True
            return False

        def format_simple_value(value):
            if value is None or value == '':
                return None
            if isinstance(value, bool):
                return 'Sim' if value else 'Não'
            if isinstance(value, (int, float, Decimal)):
                return str(value)
            if isinstance(value, (datetime, date_cls, time_cls)):
                try:
                    return value.isoformat()
                except Exception:
                    return str(value)
            if isinstance(value, dict):
                try:
                    return json.dumps(value, ensure_ascii=False)
                except Exception:
                    return str(value)
            return str(value)

        def resolve_contract_label(item):
            candidate_id = None
            raw_candidate = None
            if isinstance(item, dict):
                raw_candidate = item.get('id') or item.get('pk')
            else:
                raw_candidate = item
            try:
                candidate_id = int(raw_candidate)
            except (TypeError, ValueError):
                candidate_id = None
            if contract_lookup and candidate_id is not None:
                contract = contract_lookup.get(candidate_id)
                if contract and getattr(contract, 'numero_contrato', None):
                    return str(contract.numero_contrato)
            if isinstance(item, dict):
                label = item.get('numero_contrato')
                if label:
                    return str(label)
            return format_simple_value(item)

        def format_value(key, value):
            if value_is_empty(value):
                return None
            if key == 'contratos_para_monitoria':
                iter_items = value if isinstance(value, (list, tuple)) else [value]
                formatted = [
                    label
                    for label in (resolve_contract_label(item) for item in iter_items)
                    if label
                ]
                return ', '.join(formatted) if formatted else None
            if isinstance(value, (list, tuple)):
                formatted_items = [
                    item
                    for item in (format_simple_value(entry) for entry in value)
                    if item
                ]
                return ', '.join(formatted_items) if formatted_items else None
            return format_simple_value(value)

        def humanize_label(key):
            parts = key.split('_') if key else []
            return ' '.join(part.capitalize() for part in parts if part)

        processed_keys = set()

        def add_line(key, label=None):
            if not key:
                return
            value = responses.get(key)
            if value_is_empty(value):
                value = fallback.get(key)
            formatted = format_value(key, value)
            if not formatted:
                return
            label_text = label or response_labels.get(key) or humanize_label(key)
            lines.append(f"{label_text}: {formatted}")
            processed_keys.add(key)

        for field in ordered_fields:
            add_line(field, response_labels.get(field))

        remaining_keys = sorted(k for k in responses.keys() if k not in processed_keys)
        for key in remaining_keys:
            add_line(key)

        return lines

    def _serialize_user(self, user):
        if not user or not getattr(user, 'is_authenticated', False):
            return None
        return {
            'id': user.id,
            'username': user.username,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'pending_tasks': 0,
            'pending_prazos': 0,
            'completed_tasks': 0,
            'completed_prazos': 0,
        }

    def _get_supervision_entries(self, show_completed, request):
        pending_statuses = {'pendente', 'pre_aprovado'}
        completed_statuses = {'aprovado', 'reprovado'}
        target_statuses = completed_statuses if show_completed else pending_statuses

        viability_labels = {
            ProcessoJudicial.VIABILIDADE_VIAVEL: 'Viável',
            ProcessoJudicial.VIABILIDADE_INVIAVEL: 'Inviável',
            ProcessoJudicial.VIABILIDADE_INCONCLUSIVO: 'Inconclusivo',
        }

        cards_data = []
        contract_ids = set()
        seen_keys = set()

        for analise in AnaliseProcesso.objects.select_related('processo_judicial', 'updated_by'):
            respostas = analise.respostas or {}
            if not isinstance(respostas, dict):
                continue
            for source in ('saved_processos_vinculados', 'processos_vinculados'):
                raw_cards = respostas.get(source) or []
                if not isinstance(raw_cards, list):
                    continue
                for idx, card in enumerate(raw_cards):
                    if not isinstance(card, dict):
                        continue
                    if not card.get('supervisionado'):
                        continue
                    status = (card.get('supervisor_status') or 'pendente').lower()
                    if status not in target_statuses:
                        continue
                    contract_values = card.get('contratos')
                    if not isinstance(contract_values, (list, tuple)):
                        contract_values = []
                    if not contract_values:
                        tipo_respostas = card.get('tipo_de_acao_respostas') or {}
                        if isinstance(tipo_respostas, dict):
                            contract_values = tipo_respostas.get('contratos_para_monitoria') or []
                    parsed_ids = set()
                    for raw_contract in contract_values or []:
                        try:
                            parsed_ids.add(int(raw_contract))
                        except (TypeError, ValueError):
                            continue
                    if not parsed_ids:
                        continue
                    card_key_id = f"{analise.pk}-{source}-{idx}"
                    key = (
                        analise.pk,
                        source,
                        idx,
                        status,
                        card_key_id,
                    )
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    contract_ids.update(parsed_ids)
                    cards_data.append({
                        'analise': analise,
                        'card': card,
                        'contract_ids': parsed_ids,
                        'source': source,
                        'index': idx,
                        'status': status,
                        'card_key_id': card_key_id,
                    })

        if not cards_data:
            return []

        contracts = Contrato.objects.filter(id__in=contract_ids).only('id', 'numero_contrato', 'valor_causa', 'data_prescricao')
        contract_map = {contract.id: contract for contract in contracts}
        today = timezone.localdate()

        entries = []
        for card_info in cards_data:
            valid_contracts = [
                contract_map.get(cid)
                for cid in card_info['contract_ids']
                if contract_map.get(cid)
            ]
            valid_contracts = [c for c in valid_contracts if c.data_prescricao]
            if not valid_contracts:
                continue
            prescricao_date = min(c.data_prescricao for c in valid_contracts if c.data_prescricao)
            if not prescricao_date:
                continue
            analise = card_info['analise']
            processo = analise.processo_judicial
            cnj_label = (
                card_info['card'].get('cnj') or
                (processo.cnj if processo else '') or
                'CNJ não informado'
            )
            parte_passiva = None
            if processo:
                partes_qs = processo.partes_processuais.order_by('tipo_polo', 'id')
                parte_passiva = partes_qs.filter(tipo_polo='PASSIVO').first() or partes_qs.first()
            parte_nome = parte_passiva.nome if parte_passiva else ''
            parte_documento = parte_passiva.documento if parte_passiva else ''
            contrato_labels = [
                c.numero_contrato or f"ID {c.pk}"
                for c in valid_contracts
            ]
            detail_text = f"{cnj_label} — {', '.join(contrato_labels)}"
            valor_total_causa = sum((c.valor_causa or Decimal('0.00')) for c in valid_contracts)
            valor_total_causa = float(valor_total_causa)
            responsavel_user = analise.updated_by if analise.updated_by else request.user
            responsavel = self._serialize_user(responsavel_user)
            active = prescricao_date >= today
            status_label = self._supervision_status_labels().get(card_info['status'], card_info['status'].capitalize())
            viabilidade_value = (processo.viabilidade or '').strip().upper() if processo else ''
            viabilidade_label = viability_labels.get(viabilidade_value, 'Viabilidade')
            card = card_info.get('card')
            if not isinstance(card, dict):
                card = {}
            entries.append({
                'type': 'S',
                'id': f"s-{analise.pk}-{card_info['source']}-{card_info['index']}",
                'label': 'S',
                'description': detail_text,
                'detail': detail_text,
                'date': prescricao_date.isoformat(),
                'original_date': prescricao_date.isoformat(),
                'prescricao_date': prescricao_date.isoformat(),
                'contract_numbers': contrato_labels,
                'valor_causa': valor_total_causa,
                'status_label': status_label,
                'viabilidade': viabilidade_value,
                'viabilidade_label': viabilidade_label,
                'cnj_label': cnj_label,
                'cardId': card_info.get('card_key_id') or f"supervision-{analise.pk}-{card_info['source']}-{card_info['index']}",
                'analysis_lines': self._build_analysis_result_lines(card_info, contract_map),
                'admin_url': (reverse('admin:contratos_processojudicial_change', args=[processo.pk]) + '?tab=supervisionar') if processo else '',
                'processo_id': processo.pk if processo else None,
                'responsavel': responsavel,
                'expired': not active,
                'active': active,
                'analise_id': analise.pk,
                'card_source': card_info['source'],
                'card_index': card_info['index'],
                'supervisor_status': card_info['status'],
                'barrado': card.get('barrado') if isinstance(card.get('barrado'), dict) else {},
                'nome': parte_nome,
                'parte_nome': parte_nome,
                'cpf': parte_documento,
                'parte_cpf': parte_documento,
                'documento': parte_documento,
            })

        return entries


class AgendaSupervisionStatusAPIView(APIView):
    """
    Permite alternar o status de supervisão diretamente da Agenda Geral.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        analise_id = data.get('analise_id')
        source = data.get('source')
        index = data.get('index')
        if not analise_id or not source or index is None:
            return Response({'detail': 'analise_id, source e index são obrigatórios.'}, status=status.HTTP_400_BAD_REQUEST)
        if source not in ('processos_vinculados', 'saved_processos_vinculados'):
            return Response({'detail': 'source inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            analise = AnaliseProcesso.objects.get(pk=analise_id)
        except AnaliseProcesso.DoesNotExist:
            return Response({'detail': 'Análise não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        respostas = analise.respostas or {}
        cards = respostas.get(source)
        try:
            entry_index = int(index)
        except (TypeError, ValueError):
            return Response({'detail': 'index inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(cards, list) or not (0 <= entry_index < len(cards)):
            return Response({'detail': 'Cartão não encontrado.'}, status=status.HTTP_400_BAD_REQUEST)
        card = cards[entry_index]
        if not isinstance(card, dict):
            return Response({'detail': 'Cartão inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        current_status = (card.get('supervisor_status') or 'pendente').lower()
        new_status = get_next_supervision_status(current_status)
        card['supervisor_status'] = new_status
        analise.respostas = respostas
        analise.updated_by = request.user
        analise.save(update_fields=['respostas', 'updated_by'])
        return Response({
            'supervisor_status': new_status,
            'status_label': SUPERVISION_STATUS_LABELS.get(new_status, new_status.capitalize()),
        })


class AgendaSupervisionBarradoAPIView(APIView):
    """
    Atualiza o estado do bloqueio (barrado) de uma análise diretamente a partir da Agenda Geral.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        analise_id = data.get('analise_id')
        source = data.get('source')
        index = data.get('index')
        if not analise_id or not source or index is None:
            return Response({'detail': 'analise_id, source e index são obrigatórios.'}, status=status.HTTP_400_BAD_REQUEST)
        if source not in ('processos_vinculados', 'saved_processos_vinculados'):
            return Response({'detail': 'source inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            analise = AnaliseProcesso.objects.get(pk=analise_id)
        except AnaliseProcesso.DoesNotExist:
            return Response({'detail': 'Análise não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        respostas = analise.respostas or {}
        cards = respostas.get(source)
        try:
            entry_index = int(index)
        except (TypeError, ValueError):
            return Response({'detail': 'index inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(cards, list) or not (0 <= entry_index < len(cards)):
            return Response({'detail': 'Cartão não encontrado.'}, status=status.HTTP_400_BAD_REQUEST)
        card = cards[entry_index]
        if not isinstance(card, dict):
            return Response({'detail': 'Cartão inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        barrado = card.get('barrado')
        if not isinstance(barrado, dict):
            barrado = {}
        barrado.setdefault('ativo', False)
        barrado.setdefault('inicio', None)
        barrado.setdefault('retorno_em', None)
        toggle_active = data.get('toggle_active')
        retorno_em = data.get('retorno_em') if 'retorno_em' in data else None
        today_str = timezone.localdate().isoformat()
        if toggle_active is not None:
            ativo_value = bool(toggle_active)
            barrado['ativo'] = ativo_value
            if ativo_value and not barrado.get('inicio'):
                barrado['inicio'] = today_str
            if not ativo_value:
                barrado['retorno_em'] = None
        if 'retorno_em' in data:
            barrado['retorno_em'] = retorno_em or None
            if barrado['retorno_em']:
                barrado['ativo'] = True
                if not barrado.get('inicio'):
                    barrado['inicio'] = today_str
            else:
                barrado['ativo'] = False
        card['barrado'] = barrado
        analise.respostas = respostas
        analise.updated_by = request.user
        analise.save(update_fields=['respostas', 'updated_by'])
        return Response({'barrado': barrado})


class TarefaComentarioListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get_tarefa(self, tarefa_id):
        return get_object_or_404(Tarefa, pk=tarefa_id)

    def get(self, request, tarefa_id):
        tarefa = self.get_tarefa(tarefa_id)
        serializer = TarefaMensagemSerializer(
            tarefa.mensagens.order_by('-criado_em'),
            many=True,
            context={'request': request},
        )
        return Response(serializer.data)

    def post(self, request, tarefa_id):
        tarefa = self.get_tarefa(tarefa_id)
        texto = (request.data.get('texto') or '').strip()
        arquivo = request.FILES.get('arquivo')
        if not texto and not arquivo:
            return Response(
                {'detail': 'É necessário informar texto ou arquivo.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        comentario = TarefaMensagem.objects.create(
            tarefa=tarefa,
            autor=request.user,
            texto=texto,
        )
        if arquivo:
            processo_arquivo = ProcessoArquivo.objects.create(
                processo=tarefa.processo,
                tarefa=tarefa,
                mensagem=comentario,
                enviado_por=request.user,
                arquivo=arquivo,
            )
            processo_arquivo.save()
        serializer = TarefaMensagemSerializer(comentario, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class PrazoComentarioListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get_prazo(self, prazo_id):
        return get_object_or_404(Prazo, pk=prazo_id)

    def get(self, request, prazo_id):
        prazo = self.get_prazo(prazo_id)
        serializer = PrazoMensagemSerializer(
            prazo.mensagens.order_by('-criado_em'),
            many=True,
            context={'request': request},
        )
        return Response(serializer.data)

    def post(self, request, prazo_id):
        prazo = self.get_prazo(prazo_id)
        texto = (request.data.get('texto') or '').strip()
        arquivo = request.FILES.get('arquivo')
        if not texto and not arquivo:
            return Response(
                {'detail': 'É necessário informar texto ou arquivo.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        comentario = PrazoMensagem.objects.create(
            prazo=prazo,
            autor=request.user,
            texto=texto,
        )
        if arquivo:
            processo_arquivo = ProcessoArquivo.objects.create(
                processo=prazo.processo,
                prazo=prazo,
                prazo_mensagem=comentario,
                enviado_por=request.user,
                arquivo=arquivo,
            )
            processo_arquivo.save()
        serializer = PrazoMensagemSerializer(comentario, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)

class TarefaCreateAPIView(generics.CreateAPIView):
    """
    API para criar uma nova tarefa para um processo.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = TarefaSerializer

    def perform_create(self, serializer):
        processo = get_object_or_404(ProcessoJudicial, pk=self.kwargs.get('processo_id'))
        serializer.save(processo=processo)

class PrazoCreateAPIView(generics.CreateAPIView):
    """
    API para criar um novo prazo para um processo.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = PrazoSerializer

    def perform_create(self, serializer):
        processo = get_object_or_404(ProcessoJudicial, pk=self.kwargs.get('processo_id'))
        serializer.save(processo=processo)

def _bulk_payload_from_request(request):
    payload_raw = request.data.get('payload') if hasattr(request, 'data') else None
    if payload_raw:
        try:
            payload = json.loads(payload_raw)
        except json.JSONDecodeError:
            payload = {}
    else:
        payload = request.data if isinstance(request.data, dict) else {}
    return payload or {}

def _coerce_id_list(value):
    if value is None:
        return []
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return []
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = value.split(',')
    if not isinstance(value, (list, tuple)):
        value = [value]
    ids = []
    for item in value:
        try:
            ids.append(int(item))
        except (TypeError, ValueError):
            continue
    # remover duplicados preservando ordem
    seen = set()
    unique = []
    for item in ids:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique

def _parse_date_value(value):
    if not value:
        return None
    if isinstance(value, date_cls):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).date()
        except ValueError:
            try:
                return datetime.strptime(value, '%Y-%m-%d').date()
            except ValueError:
                return None
    return None

def _parse_datetime_value(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    else:
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_default_timezone())
    return dt

class TarefaBulkCreateAPIView(APIView):
    """
    API para criar tarefas em lote (com ou sem processos selecionados).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = _bulk_payload_from_request(request)
        processo_ids = _coerce_id_list(payload.get('processo_ids'))
        descricao = (payload.get('descricao') or '').strip()
        data = _parse_date_value(payload.get('data'))
        responsavel_id = payload.get('responsavel_id') or None
        lista_id = payload.get('lista_id') or None
        prioridade = (payload.get('prioridade') or 'M').strip().upper()[:1] or 'M'
        observacoes = (payload.get('observacoes') or '').strip()
        concluida = bool(payload.get('concluida'))
        comentario_texto = (payload.get('comentario_texto') or '').strip()
        arquivo = request.FILES.get('arquivo')

        if not descricao:
            return Response({'detail': 'Informe a descrição da tarefa.'}, status=status.HTTP_400_BAD_REQUEST)
        if not data:
            return Response({'detail': 'Informe a data da tarefa.'}, status=status.HTTP_400_BAD_REQUEST)
        if not processo_ids and not responsavel_id:
            return Response({'detail': 'Selecione um responsável para criar tarefa geral.'}, status=status.HTTP_400_BAD_REQUEST)
        if arquivo and not processo_ids:
            return Response({'detail': 'Anexo exige pelo menos um processo selecionado.'}, status=status.HTTP_400_BAD_REQUEST)

        processos = ProcessoJudicial.objects.filter(id__in=processo_ids) if processo_ids else []
        processo_map = {proc.id: proc for proc in processos}
        if processo_ids and len(processo_map) != len(processo_ids):
            return Response({'detail': 'Um ou mais processos não foram encontrados.'}, status=status.HTTP_400_BAD_REQUEST)

        responsavel = User.objects.filter(id=responsavel_id).first() if responsavel_id else None
        lista = ListaDeTarefas.objects.filter(id=lista_id).first() if lista_id else None

        lote = TarefaLote.objects.create(
            descricao=descricao,
            criado_por=request.user,
        )

        created_tasks = []
        targets = processo_ids if processo_ids else [None]
        for processo_id in targets:
            processo = processo_map.get(processo_id) if processo_id else None
            tarefa = Tarefa.objects.create(
                processo=processo,
                lote=lote,
                descricao=descricao,
                lista=lista,
                data=data,
                responsavel=responsavel,
                prioridade=prioridade,
                concluida=concluida,
                observacoes=observacoes,
                criado_por=request.user,
            )
            created_tasks.append(tarefa)
            if comentario_texto or arquivo:
                comentario = TarefaMensagem.objects.create(
                    tarefa=tarefa,
                    autor=request.user,
                    texto=comentario_texto or '',
                )
                if arquivo and processo:
                    arquivo.seek(0)
                    ProcessoArquivo.objects.create(
                        processo=processo,
                        tarefa=tarefa,
                        mensagem=comentario,
                        enviado_por=request.user,
                        arquivo=arquivo,
                    )

        return Response({
            'created': len(created_tasks),
            'ids': [task.id for task in created_tasks],
        }, status=status.HTTP_201_CREATED)

class TarefaBulkHistoryAPIView(APIView):
    """
    Lista lotes de tarefas criadas em lote para o usuário atual.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        lotes = TarefaLote.objects.all()
        if not request.user.is_superuser:
            lotes = lotes.filter(criado_por=request.user)
        lotes = (
            lotes.annotate(
                total=Count('tarefas', distinct=True),
                concluidas=Count('tarefas', filter=Q(tarefas__concluida=True), distinct=True),
            )
            .order_by('-criado_em')[:50]
        )
        data = []
        for lote in lotes:
            data.append({
                'id': lote.id,
                'descricao': lote.descricao,
                'criado_em': lote.criado_em.isoformat() if lote.criado_em else None,
                'total': lote.total,
                'concluidas': lote.concluidas,
            })
        return Response(data)

class TarefaBulkHistoryActionAPIView(APIView):
    """
    Ações em lote para tarefas criadas em lote (concluir ou excluir).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = _bulk_payload_from_request(request)
        action = (payload.get('action') or '').strip().lower()
        lote_ids = _coerce_id_list(payload.get('ids'))
        if not lote_ids:
            return Response({'detail': 'Selecione ao menos um lote.'}, status=status.HTTP_400_BAD_REQUEST)

        lotes = TarefaLote.objects.filter(id__in=lote_ids)
        if not request.user.is_superuser:
            lotes = lotes.filter(criado_por=request.user)
        allowed_ids = list(lotes.values_list('id', flat=True))
        if not allowed_ids:
            return Response({'detail': 'Nenhum lote encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        tarefas_qs = Tarefa.objects.filter(lote_id__in=allowed_ids)
        if action in ('concluir', 'concluida', 'concluidas', 'finalizar'):
            updated = tarefas_qs.update(concluida=True)
            return Response({'updated': updated, 'action': 'concluir'})
        if action in ('delete', 'deletar', 'excluir', 'remover'):
            deleted = tarefas_qs.count()
            tarefas_qs.delete()
            lotes.filter(id__in=allowed_ids).delete()
            return Response({'deleted': deleted, 'action': 'delete'})

        return Response({'detail': 'Ação inválida.'}, status=status.HTTP_400_BAD_REQUEST)

class PrazoBulkCreateAPIView(APIView):
    """
    API para criar prazos em lote (com ou sem processos selecionados).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = _bulk_payload_from_request(request)
        processo_ids = _coerce_id_list(payload.get('processo_ids'))
        titulo = (payload.get('titulo') or '').strip()
        data_limite = _parse_datetime_value(payload.get('data_limite'))
        alerta_valor = payload.get('alerta_valor')
        alerta_unidade = (payload.get('alerta_unidade') or 'D').strip().upper()[:1] or 'D'
        responsavel_id = payload.get('responsavel_id') or None
        observacoes = (payload.get('observacoes') or '').strip()
        concluido = bool(payload.get('concluido'))
        comentario_texto = (payload.get('comentario_texto') or '').strip()
        arquivo = request.FILES.get('arquivo')

        if not titulo:
            return Response({'detail': 'Informe o título do prazo.'}, status=status.HTTP_400_BAD_REQUEST)
        if not data_limite:
            return Response({'detail': 'Informe a data do prazo.'}, status=status.HTTP_400_BAD_REQUEST)
        if not processo_ids and not responsavel_id:
            return Response({'detail': 'Selecione um responsável para criar prazo geral.'}, status=status.HTTP_400_BAD_REQUEST)
        if arquivo and not processo_ids:
            return Response({'detail': 'Anexo exige pelo menos um processo selecionado.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            alerta_valor = int(alerta_valor) if alerta_valor is not None else 1
        except (TypeError, ValueError):
            alerta_valor = 1

        processos = ProcessoJudicial.objects.filter(id__in=processo_ids) if processo_ids else []
        processo_map = {proc.id: proc for proc in processos}
        if processo_ids and len(processo_map) != len(processo_ids):
            return Response({'detail': 'Um ou mais processos não foram encontrados.'}, status=status.HTTP_400_BAD_REQUEST)

        responsavel = User.objects.filter(id=responsavel_id).first() if responsavel_id else None

        created_prazos = []
        targets = processo_ids if processo_ids else [None]
        for processo_id in targets:
            processo = processo_map.get(processo_id) if processo_id else None
            prazo = Prazo.objects.create(
                processo=processo,
                titulo=titulo,
                data_limite=data_limite,
                alerta_valor=alerta_valor,
                alerta_unidade=alerta_unidade,
                responsavel=responsavel,
                observacoes=observacoes,
                concluido=concluido,
            )
            created_prazos.append(prazo)
            if comentario_texto or arquivo:
                comentario = PrazoMensagem.objects.create(
                    prazo=prazo,
                    autor=request.user,
                    texto=comentario_texto or '',
                )
                if arquivo and processo:
                    arquivo.seek(0)
                    ProcessoArquivo.objects.create(
                        processo=processo,
                        prazo=prazo,
                        prazo_mensagem=comentario,
                        enviado_por=request.user,
                        arquivo=arquivo,
                    )

        return Response({
            'created': len(created_prazos),
            'ids': [prazo.id for prazo in created_prazos],
        }, status=status.HTTP_201_CREATED)

class UserSearchAPIView(generics.ListAPIView):
    """
    API para buscar usuários (responsáveis) por nome.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_queryset(self):
        query = self.request.query_params.get('q', '')
        if query:
            return User.objects.filter(
                Q(username__icontains=query) | 
                Q(first_name__icontains=query) | 
                Q(last_name__icontains=query)
            ).distinct()[:10]
        return User.objects.none()


class AgendaUsersAPIView(APIView):
    """
    Lista os usuários ativos para a seleção na Agenda Geral.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        users = (
            User.objects.filter(is_active=True)
            .annotate(
                pending_tasks=Count(
                    'tarefas_responsaveis',
                    filter=Q(tarefas_responsaveis__concluida=False),
                    distinct=True,
                ),
                pending_prazos=Count(
                    'prazos_responsaveis',
                    filter=Q(prazos_responsaveis__concluido=False),
                    distinct=True,
                ),
                completed_tasks=Count(
                    'tarefas_responsaveis',
                    filter=Q(tarefas_responsaveis__concluida=True),
                    distinct=True,
                ),
                completed_prazos=Count(
                    'prazos_responsaveis',
                    filter=Q(prazos_responsaveis__concluido=True),
                    distinct=True,
                ),
            )
            .order_by('first_name', 'last_name', 'username')[:40]
        )
        serializer = UserSerializer(users, many=True)
        return Response(serializer.data)

class HerdeiroAPIView(APIView):
    """
    API para listar e salvar herdeiros vinculados ao CPF com óbito.
    """
    permission_classes = [IsAuthenticated]

    def _serialize(self, herdeiros):
        return [
            {
                'id': herdeiro.id,
                'nome_completo': herdeiro.nome_completo,
                'cpf': herdeiro.cpf,
                'rg': herdeiro.rg,
                'grau_parentesco': herdeiro.grau_parentesco,
                'herdeiro_citado': herdeiro.herdeiro_citado,
                'endereco': herdeiro.endereco,
            }
            for herdeiro in herdeiros
        ]

    def get(self, request):
        cpf_raw = (request.query_params.get('cpf_falecido') or '').strip()
        if not cpf_raw:
            return Response({'error': 'cpf_falecido é obrigatório'}, status=status.HTTP_400_BAD_REQUEST)
        cpf = re.sub(r'\\D', '', cpf_raw)
        if not cpf:
            return Response({'error': 'cpf_falecido inválido'}, status=status.HTTP_400_BAD_REQUEST)
        herdeiros = Herdeiro.objects.filter(cpf_falecido=cpf).order_by('-herdeiro_citado', 'id')
        parte_id = request.query_params.get('parte_id')
        processo_id = request.query_params.get('processo_id')
        processo = None
        if processo_id:
            try:
                processo = ProcessoJudicial.objects.get(pk=processo_id)
            except ProcessoJudicial.DoesNotExist:
                processo = None
        if parte_id:
            try:
                parte = Parte.objects.select_related('processo').get(pk=parte_id)
                processo = parte.processo
            except Parte.DoesNotExist:
                processo = None
        if processo is None:
            parte = Parte.objects.select_related('processo').filter(
                documento__in=[cpf, cpf_raw], tipo_polo='PASSIVO'
            ).order_by('-id').first()
            processo = parte.processo if parte else None
        return Response({
            'cpf_falecido': cpf,
            'herdeiros': self._serialize(herdeiros),
            'heranca_valor': str(processo.heranca_valor) if processo and processo.heranca_valor is not None else '',
            'heranca_descricao': processo.heranca_descricao if processo and processo.heranca_descricao else '',
        })

    def post(self, request):
        cpf_raw = (request.data.get('cpf_falecido') or '').strip()
        if not cpf_raw:
            return Response({'error': 'cpf_falecido é obrigatório'}, status=status.HTTP_400_BAD_REQUEST)
        cpf = re.sub(r'\\D', '', cpf_raw)
        if not cpf:
            return Response({'error': 'cpf_falecido inválido'}, status=status.HTTP_400_BAD_REQUEST)
        heranca_only = bool(request.data.get('heranca_only'))
        incoming = request.data.get('herdeiros', None)
        if incoming is None:
            incoming = []
        if not isinstance(incoming, list):
            return Response({'error': 'herdeiros deve ser uma lista'}, status=status.HTTP_400_BAD_REQUEST)

        parte_id = request.data.get('parte_id')
        processo_id = request.data.get('processo_id')
        processo = None
        if processo_id:
            try:
                processo = ProcessoJudicial.objects.get(pk=processo_id)
            except ProcessoJudicial.DoesNotExist:
                processo = None
        if parte_id:
            try:
                parte = Parte.objects.select_related('processo').get(pk=parte_id)
                processo = parte.processo
            except Parte.DoesNotExist:
                processo = None
        if processo is None:
            parte = Parte.objects.select_related('processo').filter(
                documento__in=[cpf, cpf_raw], tipo_polo='PASSIVO'
            ).order_by('-id').first()
            processo = parte.processo if parte else None

        if not heranca_only:
            Herdeiro.objects.filter(cpf_falecido=cpf).delete()
            cited_set = False
            for item in incoming:
                nome = (item.get('nome_completo') or '').strip()
                cpf_herdeiro = (item.get('cpf') or '').strip()
                rg = (item.get('rg') or '').strip()
                grau = (item.get('grau_parentesco') or '').strip()
                endereco = (item.get('endereco') or '').strip()
                if not any([nome, cpf_herdeiro, rg, grau, endereco]):
                    continue
                citado = bool(item.get('herdeiro_citado')) and not cited_set
                if citado:
                    cited_set = True
                Herdeiro.objects.create(
                    cpf_falecido=cpf,
                    nome_completo=nome,
                    cpf=cpf_herdeiro or None,
                    rg=rg or None,
                    grau_parentesco=grau or None,
                    herdeiro_citado=citado,
                    endereco=endereco or None,
                )
        if processo is not None:
            heranca_valor = _parse_decimal_value(request.data.get('heranca_valor'))
            heranca_descricao = (request.data.get('heranca_descricao') or '').strip()
            processo.heranca_valor = heranca_valor
            processo.heranca_descricao = heranca_descricao or None
            processo.save(update_fields=['heranca_valor', 'heranca_descricao'])
        herdeiros = Herdeiro.objects.filter(cpf_falecido=cpf).order_by('-herdeiro_citado', 'id')
        return Response({
            'cpf_falecido': cpf,
            'herdeiros': self._serialize(herdeiros),
            'heranca_valor': str(processo.heranca_valor) if processo and processo.heranca_valor is not None else '',
            'heranca_descricao': processo.heranca_descricao if processo and processo.heranca_descricao else '',
        })

class AgendaTarefaUpdateDateAPIView(APIView):
    """
    Atualiza a data de uma tarefa específica (drag&drop).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        new_date = request.data.get('date')
        if not new_date:
            return Response({'error': 'date é obrigatório'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            tarefa = Tarefa.objects.get(pk=pk)
        except Tarefa.DoesNotExist:
            return Response({'error': 'Tarefa não encontrada'}, status=status.HTTP_404_NOT_FOUND)
        if tarefa.data_origem is None:
            tarefa.data_origem = tarefa.data
        tarefa.data = new_date
        update_fields = ['data', 'data_origem'] if tarefa.data_origem is not None else ['data']
        tarefa.save(update_fields=update_fields)
        return Response({
            'status': 'ok',
            'id': tarefa.id,
            'data': tarefa.data,
            'data_origem': tarefa.data_origem,
        })

class AgendaPrazoUpdateDateAPIView(APIView):
    """
    Atualiza a data de um prazo específico (drag&drop).
    Preserva a hora atual de data_limite se houver.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        new_date_raw = request.data.get('date')
        if not new_date_raw:
            return Response({'error': 'date é obrigatório'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            prazo = Prazo.objects.get(pk=pk)
        except Prazo.DoesNotExist:
            return Response({'error': 'Prazo não encontrado'}, status=status.HTTP_404_NOT_FOUND)
        current_dt = prazo.data_limite or timezone.now()
        if prazo.data_limite_origem is None:
            if isinstance(current_dt, timezone.datetime):
                current_local = timezone.localtime(current_dt, timezone.get_default_timezone()) if timezone.is_aware(current_dt) else current_dt
                prazo.data_limite_origem = current_local.date()
            else:
                prazo.data_limite_origem = current_dt.date() if hasattr(current_dt, 'date') else None
        parsed_date = None
        try:
            # Tenta yyyy-mm-dd
            parsed_date = date_cls.fromisoformat(str(new_date_raw))
        except Exception:
            try:
                parsed_date = timezone.datetime.fromisoformat(str(new_date_raw)).date()
            except Exception:
                return Response({'error': 'Formato de data inválido'}, status=status.HTTP_400_BAD_REQUEST)
        # Preserva a hora, mas sempre no fuso default para evitar "voltar" um dia
        local_tz = timezone.get_default_timezone()
        if isinstance(current_dt, timezone.datetime):
            current_local = timezone.localtime(current_dt, local_tz) if timezone.is_aware(current_dt) else current_dt
            updated_dt = timezone.datetime(
                parsed_date.year,
                parsed_date.month,
                parsed_date.day,
                current_local.hour,
                current_local.minute,
                current_local.second,
                current_local.microsecond,
            )
            updated_dt = timezone.make_aware(updated_dt, local_tz)
        else:
            updated_dt = timezone.make_aware(
                timezone.datetime.combine(parsed_date, time_cls()),
                local_tz
            )
        prazo.data_limite = updated_dt
        update_fields = ['data_limite', 'data_limite_origem'] if prazo.data_limite_origem is not None else ['data_limite']
        prazo.save(update_fields=update_fields)
        return Response({
            'status': 'ok',
            'id': prazo.id,
            'data_limite': prazo.data_limite,
            'data_limite_origem': prazo.data_limite_origem,
        })

class ListaDeTarefasAPIView(generics.ListCreateAPIView):
    """
    API para listar e criar Listas de Tarefas.
    """
    permission_classes = [IsAuthenticated]
    queryset = ListaDeTarefas.objects.all()
    serializer_class = ListaDeTarefasSerializer

# --- NOVAS VIEWS PARA O BOTÃO CIA ---

# Funções auxiliares movidas para o escopo do módulo para reutilização
def _format_cep(v):
    d = re.sub(r'\D', '', str(v or ''))
    if len(d) == 8:
        return f"{d[:5]}-{d[5:]}"
    return d or ''

def _uf_to_nome(uf_sigla):
    UFS = {
        'AC':'Acre', 'AL':'Alagoas', 'AP':'Amapá', 'AM':'Amazonas', 'BA':'Bahia', 'CE':'Ceará', 'DF':'Distrito Federal',
        'ES':'Espírito Santo', 'GO':'Goiás', 'MA':'Maranhão', 'MT':'Mato Grosso', 'MS':'Mato Grosso do Sul', 'MG':'Minas Gerais',
        'PA':'Pará', 'PB':'Paraíba', 'PR':'Paraná', 'PE':'Pernambuco', 'PI':'Piauí', 'RJ':'Rio de Janeiro', 'RN':'Rio Grande do Norte',
        'RS':'Rio Grande do Sul', 'RO':'Rondônia', 'RR':'Roraima', 'SC':'Santa Catarina', 'SP':'São Paulo', 'SE':'Sergipe', 'TO':'Tocantins'
    }
    return UFS.get(uf_sigla.upper(), '')

def _clean_street_name(rua, num):
    s = str(rua or '').strip()
    n = str(num or '').strip()
    if not s:
        return ''
    if n:
        s = re.sub(r'\s*,\s*' + re.escape(n) + r'(\b.*)?$', '', s, flags=re.IGNORECASE)
        s = re.sub(r'\s+' + re.escape(n) + r'(\b.*)?$', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s*,\s*\d[\w\s\-\/]*$', '', s)
    s = re.sub(r'\s+\d[\w\-\/]*$', '', s)
    return s.strip()

def _montar_texto_endereco(m):
    return (
        f"A: {m.get('A', '')} - "
        f"B: {m.get('B', '')} - "
        f"C: {m.get('C', '')} - "
        f"D: {m.get('D', '')} - "
        f"E: {m.get('E', '')} - "
        f"F: {m.get('F', '')} - "
        f"G: {m.get('G', '')} - "
        f"H: {m.get('H', '')}"
    )

@method_decorator(login_required, name='dispatch')
class FetchAddressAPIView(View):
    """
    Busca o endereço na API externa usando o CPF.
    """
    def get(self, request, cpf):
        api_key = os.getenv('END_API_KEY')
        if not api_key:
            return JsonResponse({'error': 'A chave da API não está configurada no servidor.'}, status=500)

        url = f'https://nowlex-mini-erp-api.onrender.com/api/clientes/cpf/{cpf}?contracts=true'
        headers = {'X-API-Key': api_key}
        
        try:
            res = requests.get(url, headers=headers, timeout=10)
            res.raise_for_status()

            payload = res.json()
            d = payload.get('data', {})

            rua_raw = d.get('endereco_rua', '')
            num = d.get('endereco_numero', '')
            uf = (d.get('endereco_uf', '') or '').upper()
            cep = _format_cep(d.get('endereco_cep', ''))
            
            map_data = {
                'A': _clean_street_name(rua_raw, num),
                'B': num,
                'C': d.get('endereco_complemento', ''),
                'D': d.get('endereco_bairro', ''),
                'E': d.get('endereco_cidade', ''),
                'F': _uf_to_nome(uf),
                'G': cep,
                'H': uf
            }

            endereco_formatado = _montar_texto_endereco(map_data)
            return JsonResponse({'endereco_formatado': endereco_formatado})

        except requests.exceptions.HTTPError as e:
            if e.response.status_code in [401, 403]:
                return JsonResponse({'error': 'Acesso negado pela API de endereços.'}, status=403)
            if e.response.status_code == 404:
                return JsonResponse({'error': 'CPF não encontrado na API de endereços.'}, status=404)
            return JsonResponse({'error': f'Erro na API externa: {e.response.status_code}'}, status=500)
        except requests.exceptions.RequestException as e:
            return JsonResponse({'error': f'Erro de conexão com a API de endereços: {e}'}, status=500)

@method_decorator(login_required, name='dispatch')
class SaveManualAddressAPIView(View):
    """
    Salva o endereço fornecido manualmente e replica para outros processos com o mesmo CPF.
    """
    def post(self, request, *args, **kwargs):
        try:
            data = json.loads(request.body)
            cpf = data.get('cpf', '').replace('.', '').replace('-', '')
            if not cpf:
                return JsonResponse({'error': 'CPF não fornecido.'}, status=400)

            # Limpa e formata os dados do formulário
            uf = (data.get('H', '') or '').upper()[:2]
            cep = _format_cep(data.get('G', ''))

            map_data = {
                'A': data.get('A', ''),
                'B': data.get('B', ''),
                'C': data.get('C', ''),
                'D': data.get('D', ''),
                'E': data.get('E', ''),
                'F': data.get('F', ''),
                'G': cep,
                'H': uf
            }
            
            endereco_formatado = _montar_texto_endereco(map_data)

            # Encontra os IDs dos processos que têm uma parte com o CPF fornecido
            processos_ids = Parte.objects.filter(documento=cpf).values_list('processo_id', flat=True).distinct()
            
            # Atualiza todos os processos encontrados
            updated_count = ProcessoJudicial.objects.filter(id__in=processos_ids).update(endereco=endereco_formatado)

            if updated_count > 0:
                message = f'Endereço atualizado para {updated_count} processo(s) com este CPF.'
            else:
                message = 'Endereço salvo. Nenhum processo encontrado com este CPF para replicação.'

            return JsonResponse({'message': message, 'endereco_formatado': endereco_formatado})
        
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Dados inválidos.'}, status=400)
        except Exception as e:
            return JsonResponse({'error': f'Ocorreu um erro interno: {e}'}, status=500)


@method_decorator(login_required, name='dispatch')
class BuscarDadosDemandasCpfView(View):
    """
    Busca cadastro e contratos na base de Demandas usando CPF.
    """
    def get(self, request, cpf):
        cpf_clean = re.sub(r'\D', '', str(cpf or ''))
        if len(cpf_clean) < 11:
            return JsonResponse({'error': 'CPF inválido.'}, status=400)

        carteira_id = request.GET.get('carteira_id')
        alias = DemandasImportService.SOURCE_ALIAS
        if carteira_id:
            carteira = Carteira.objects.filter(pk=carteira_id).first()
            if carteira and carteira.fonte_alias:
                alias = carteira.fonte_alias

        service = DemandasImportService(db_alias=alias)
        try:
            data = service.fetch_cadastro_by_cpf(cpf_clean)
        except DemandasImportError as exc:
            return JsonResponse({'error': str(exc)}, status=500)

        if not data:
            return JsonResponse({'error': 'CPF não encontrado na base de demandas.'}, status=404)

        return JsonResponse({'status': 'success', 'data': data})


@method_decorator(login_required, name='dispatch')
class DemandasCpfPreviewView(View):
    """
    Preview de CPFs (lote) usando a base de Demandas.
    """
    def post(self, request, *args, **kwargs):
        try:
            payload = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Dados inválidos.'}, status=400)

        cpfs = payload.get('cpfs') or []
        if not isinstance(cpfs, list) or not cpfs:
            return JsonResponse({'error': 'Informe ao menos um CPF.'}, status=400)

        carteira_id = payload.get('carteira_id')
        alias = DemandasImportService.SOURCE_ALIAS
        carteira = None
        if carteira_id:
            carteira = Carteira.objects.filter(pk=carteira_id).first()
            if carteira and carteira.fonte_alias:
                alias = carteira.fonte_alias

        service = DemandasImportService(db_alias=alias)
        try:
            rows, total = service.build_preview_for_cpfs(cpfs)
        except DemandasImportError as exc:
            return JsonResponse({'error': str(exc)}, status=500)

        return JsonResponse({
            'status': 'success',
            'rows': rows,
            'total_aberto': str(total),
        })


@method_decorator(login_required, name='dispatch')
class DemandasCpfImportView(View):
    """
    Importa CPFs em lote usando base de Demandas e aplica etiqueta.
    """
    def post(self, request, *args, **kwargs):
        try:
            payload = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Dados inválidos.'}, status=400)

        cpfs = payload.get('cpfs') or []
        etiqueta_nome = (payload.get('etiqueta_nome') or '').strip()
        carteira_id = payload.get('carteira_id')

        if not isinstance(cpfs, list) or not cpfs:
            return JsonResponse({'error': 'Informe ao menos um CPF.'}, status=400)
        if not etiqueta_nome:
            return JsonResponse({'error': 'Informe um nome para o Lote/Etiqueta.'}, status=400)

        alias = DemandasImportService.SOURCE_ALIAS
        carteira = None
        if carteira_id:
            carteira = Carteira.objects.filter(pk=carteira_id).first()
            if carteira and carteira.fonte_alias:
                alias = carteira.fonte_alias

        service = DemandasImportService(db_alias=alias)
        try:
            result = service.import_cpfs(cpfs, etiqueta_nome, carteira)
        except DemandasImportError as exc:
            return JsonResponse({'error': str(exc)}, status=500)

        return JsonResponse({
            'status': 'success',
            'imported': result.get('imported', 0),
            'skipped': result.get('skipped', 0),
        })


@method_decorator(login_required, name='dispatch')
class BuscarDadosEscavadorView(View):
    """
    Busca os dados de um processo na API do Escavador usando o número CNJ.
    """
    def get(self, request, numero_cnj):
        api_key = os.getenv('ESCAVADOR_API_TOKEN')
        if not api_key:
            return JsonResponse({'status': 'error', 'message': 'A chave da API do Escavador não está configurada no servidor.'}, status=500)

        url = f'https://api.escavador.com/api/v2/processos/numero_cnj/{numero_cnj}'
        headers = {'Authorization': f'Bearer {api_key}'}
        
        try:
            res = requests.get(url, headers=headers, timeout=15)
            res.raise_for_status()
            
            escavador_data = res.json()

            processo_data = {}
            partes_data = []
            andamentos_data = []

            if escavador_data:
                primeira_fonte = escavador_data.get('fontes', [{}])[0]
                capa_fonte = primeira_fonte.get('capa', {})
                tribunal_fonte = primeira_fonte.get('tribunal', {})

                processo_data = {
                    'numero_cnj': escavador_data.get('numero_cnj'),
                    'uf': escavador_data.get('estado_origem', {}).get('sigla'),
                    'vara': capa_fonte.get('orgao_julgador'),
                    'tribunal': tribunal_fonte.get('sigla'),
                    'valor_causa': capa_fonte.get('valor_causa', {}).get('valor'),
                    'status_id': capa_fonte.get('classe') or 'DESCONHECIDO',
                    'status_nome': capa_fonte.get('classe') or 'DESCONHECIDO',
                }

                # Utiliza um dicionário para desduplicar as partes pelo nome
                partes_encontradas = {}

                for fonte in escavador_data.get('fontes', []):
                    for envolvido in fonte.get('envolvidos', []):
                        polo_escavador = envolvido.get('polo', '').upper()
                        nome_envolvido = envolvido.get('nome')

                        # Se o envolvido não tem nome, ou já foi adicionado, pula
                        if not nome_envolvido or nome_envolvido in partes_encontradas:
                            continue

                        # Mapeia polo ATIVO ou PASSIVO. Ignora outros por enquanto para evitar ruído.
                        tipo_polo_django = None
                        if polo_escavador == 'ATIVO':
                            tipo_polo_django = 'ATIVO'
                        elif polo_escavador == 'PASSIVO':
                            tipo_polo_django = 'PASSIVO'

                        if tipo_polo_django:
                            documento = envolvido.get('cpf') or envolvido.get('cnpj')
                            
                            partes_encontradas[nome_envolvido] = {
                                'nome': nome_envolvido,
                                'tipo_polo': tipo_polo_django,
                                'tipo_pessoa': envolvido.get('tipo_pessoa'),
                                'documento': documento,
                                'endereco': ''
                            }
                
                partes_data = list(partes_encontradas.values())

                # Andamentos processuais
                andamentos_data = []
                for fonte in escavador_data.get('fontes', []):
                    fonte_nome = fonte.get('fonte', {}).get('nome')
                    for mov in fonte.get('movimentacoes', []):
                        data_raw = mov.get('data')
                        data_iso = None
                        if data_raw:
                            try:
                                data_iso = datetime.fromisoformat(data_raw).isoformat()
                            except ValueError:
                                # Mantém o valor bruto caso o formato seja diferente
                                data_iso = data_raw

                        andamentos_data.append({
                            'data': data_iso,
                            'descricao': mov.get('conteudo') or mov.get('titulo'),
                            'detalhes': fonte_nome,
                        })

            return JsonResponse({
                'status': 'success',
                'message': 'Dados obtidos com sucesso!',
                'processo': processo_data,
                'partes': partes_data,
                'andamentos': andamentos_data
            })

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                return JsonResponse({'status': 'error', 'message': 'Processo não encontrado no Escavador.'}, status=404)
            return JsonResponse({'status': 'error', 'message': f'Erro na API do Escavador: {e.response.status_code}'}, status=500)
        except requests.exceptions.RequestException as e:
            return JsonResponse({'status': 'error', 'message': f'Erro de conexão com a API do Escavador: {e}'}, status=500)


@method_decorator(staff_member_required, name='dispatch')
class ProcessoNowlexValorCausaAPIView(View):
    """
    Aciona os endpoints do NowLex Calc para atualizar o valor da causa e, opcionalmente,
    baixar o PDF do saldo devedor e salvar nos Arquivos do processo.
    """
    def post(self, request, processo_id):
        try:
            payload = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'JSON inválido.'}, status=400)

        contrato_id = payload.get('contrato_id')
        if contrato_id is None:
            return JsonResponse({'error': 'Contrato não informado.'}, status=400)
        try:
            contrato_id = int(contrato_id)
        except (TypeError, ValueError):
            return JsonResponse({'error': 'Contrato inválido.'}, status=400)

        action = (payload.get('action') or 'valor').lower()
        gerar_pdf = action == 'valor_pdf'

        processo = get_object_or_404(ProcessoJudicial, pk=processo_id)
        contrato = get_object_or_404(Contrato, pk=contrato_id, processo=processo)
        contrato_numero = re.sub(r'\D', '', str(contrato.numero_contrato or ''))
        if not contrato_numero:
            return JsonResponse({'error': 'Número de contrato inválido.'}, status=400)

        try:
            calc_data = create_calc(contrato_numero)
        except NowlexCalcError as exc:
            return JsonResponse({'error': str(exc)}, status=502)

        valor_bruto = (
            calc_data.get('total_amount')
            or calc_data.get('total')
            or calc_data.get('valor')
            or calc_data.get('valor_causa')
        )
        valor_decimal = parse_decimal(valor_bruto)
        if valor_decimal is None:
            return JsonResponse({'error': 'O valor retornado é inválido.'}, status=502)

        contrato.valor_causa = valor_decimal
        contrato.save(update_fields=['valor_causa'])
        if processo.valor_causa != valor_decimal:
            processo.valor_causa = valor_decimal
            processo.save(update_fields=['valor_causa'])

        response = {
            'valor_causa': str(valor_decimal),
            'pdf_saved': False,
            'message': 'Valor da causa atualizado.',
        }

        if gerar_pdf:
            calc_id = (
                calc_data.get('calc_id')
                or calc_data.get('id')
                or calc_data.get('calcId')
            )
            try:
                pdf_bytes = download_pdf_with_fallback(calc_id, contrato_numero)
            except NowlexCalcError as exc:
                return JsonResponse({'error': str(exc)}, status=502)

            nome_arquivo = f"{contrato_numero} - Saldo devedor.pdf"
            arquivo = ProcessoArquivo(
                processo=processo,
                enviado_por=request.user if request.user.is_authenticated else None,
                nome=nome_arquivo,
            )
            arquivo.arquivo.save(nome_arquivo, ContentFile(pdf_bytes), save=False)
            arquivo.save()

            response.update({
                'pdf_saved': True,
                'arquivo_id': arquivo.pk,
                'arquivo_url': arquivo.arquivo.url,
            })

        return JsonResponse(response)
