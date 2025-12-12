# contratos/templatetags/custom_filters.py

from django import template
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

register = template.Library()

@register.filter(name='some')
def some(value, arg):
    """
    Verifica se algum item em uma lista de dicionários tem um atributo verdadeiro.
    Uso: {{ minha_lista|some:"meu_atributo" }}
    """
    if not hasattr(value, '__iter__'):
        return False
    
    # Lógica robusta para verificar o atributo em dicionários ou objetos
    return any(
        (isinstance(item, dict) and item.get(arg)) or 
        (hasattr(item, arg) and getattr(item, arg))
        for item in value
    )


@register.filter(name='brl')
def brl(value):
    """
    Formata número como moeda brasileira: 12.345,67.
    """
    if value in (None, ''):
        return ''
    try:
        quantized = Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return value
    formatted = f"{quantized:,.2f}"
    return formatted.replace(',', 'X').replace('.', ',').replace('X', '.')
