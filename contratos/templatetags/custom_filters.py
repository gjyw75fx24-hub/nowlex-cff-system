# contratos/templatetags/custom_filters.py

from django import template

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
