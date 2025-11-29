from django import forms
from django.utils.safestring import mark_safe
import json

class EnderecoWidget(forms.Textarea):
    template_name = 'contratos/widgets/endereco_widget.html'

    def get_context(self, name, value, attrs):
        context = super().get_context(name, value, attrs)
        # O valor aqui é a string completa, ex: "A: Rua... - B: 123..."
        context['widget']['value_as_string'] = value or ''
        return context
