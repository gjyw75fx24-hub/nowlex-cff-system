from __future__ import annotations

from typing import Iterable, Optional

from django.contrib.auth.models import AnonymousUser
from django.db import models

from .models import CarteiraUsuarioAcesso


def get_user_allowed_carteira_ids(user) -> Optional[list[int]]:
    """
    Retorna lista de IDs de Carteira permitidas para o usuário.

    Convenções:
    - superuser: None (sem restrição)
    - usuário sem carteiras vinculadas: [] (sem restrição por compatibilidade)
    """
    if not user or isinstance(user, AnonymousUser):
        return []
    if getattr(user, 'is_superuser', False):
        return None
    if not getattr(user, 'is_authenticated', False):
        return []
    ids = list(
        CarteiraUsuarioAcesso.objects.filter(usuario=user).values_list('carteira_id', flat=True)
    )
    return ids


def filter_processos_queryset_for_user(queryset, user):
    """
    Aplica filtro de carteira no queryset de ProcessoJudicial baseado no usuário.
    """
    allowed = get_user_allowed_carteira_ids(user)
    if allowed is None:
        return queryset
    if not allowed:
        return queryset
    return queryset.filter(
        models.Q(carteira_id__in=allowed)
        | models.Q(carteiras_vinculadas__id__in=allowed)
    ).distinct()


def filter_tarefas_queryset_for_user(queryset, user):
    allowed = get_user_allowed_carteira_ids(user)
    if allowed is None:
        return queryset
    if not allowed:
        return queryset
    return queryset.filter(
        models.Q(processo__isnull=True)
        | models.Q(processo__carteira_id__in=allowed)
        | models.Q(processo__carteiras_vinculadas__id__in=allowed)
    ).distinct()
