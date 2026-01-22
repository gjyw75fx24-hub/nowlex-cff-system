from django import forms


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

    def clean(self):
        cleaned = super().clean()
        data_de = cleaned.get('data_de')
        data_ate = cleaned.get('data_ate')
        if data_de and data_ate and data_de > data_ate:
            raise forms.ValidationError("A data inicial deve ser anterior ou igual à data final.")
        return cleaned
