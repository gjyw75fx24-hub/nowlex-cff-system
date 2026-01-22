from django import forms

from .models import Carteira


class AndamentoSearchForm(forms.Form):
    dias_para_tras = forms.IntegerField(
        label="Buscar andamentos dos últimos (dias)",
        required=True,
        initial=365,
        min_value=1,
        widget=forms.NumberInput(attrs={'class': 'form-control', 'style': 'width: 100px;'})
    )


class DemandasAnaliseForm(forms.Form):
    data_de = forms.DateField(
        label="Data de prescrição (de)",
        required=True,
        widget=forms.DateInput(attrs={
            'class': 'form-control text-input',
            'type': 'date',
        })
    )
    data_ate = forms.DateField(
        label="Data de prescrição (até)",
        required=True,
        widget=forms.DateInput(attrs={
            'class': 'form-control text-input',
            'type': 'date',
        })
    )
    preview_only = forms.BooleanField(
        label="Mostrar pré-visualização antes de importar",
        required=False,
        initial=True,
        widget=forms.CheckboxInput(attrs={'class': 'form-check-input'})
    )

    carteira = forms.ModelChoiceField(
        queryset=Carteira.objects.order_by('nome'),
        label="Carteira",
        required=True,
        empty_label="Escolha uma carteira",
        widget=forms.Select(attrs={'class': 'form-control'})
    )

    def clean(self):
        cleaned = super().clean()
        data_de = cleaned.get('data_de')
        data_ate = cleaned.get('data_ate')
        if data_de and data_ate and data_de > data_ate:
            raise forms.ValidationError("A data inicial deve ser anterior ou igual à data final.")
        return cleaned
