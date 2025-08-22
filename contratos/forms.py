from django import forms

class AndamentoSearchForm(forms.Form):
    dias_para_tras = forms.IntegerField(
        label="Buscar andamentos dos últimos (dias)",
        required=True,
        initial=365,
        min_value=1,
        widget=forms.NumberInput(attrs={'class': 'form-control', 'style': 'width: 100px;'})
    )
