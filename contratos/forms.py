from django import forms

from .models import Carteira, TipoAnaliseObjetiva


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


class DemandasAnalisePlanilhaForm(forms.Form):
    arquivo = forms.FileField(
        label="Planilha (.xlsx ou .csv)",
        required=False,
    )

    upload_token = forms.CharField(
        required=False,
        widget=forms.HiddenInput,
    )

    carteira = forms.ModelChoiceField(
        queryset=Carteira.objects.order_by("nome"),
        label="Carteira destino",
        required=True,
        empty_label="Escolha uma carteira",
        widget=forms.Select(attrs={"class": "form-control"}),
    )

    tipo_analise = forms.ModelChoiceField(
        queryset=TipoAnaliseObjetiva.objects.order_by("nome"),
        label="Tipo de Análise",
        required=True,
        empty_label="Escolha um tipo",
        widget=forms.Select(attrs={"class": "form-control"}),
    )

    uf = forms.CharField(
        label="UF (opcional)",
        required=False,
        max_length=2,
        widget=forms.TextInput(attrs={"class": "form-control text-input", "placeholder": "Ex: RS"}),
        help_text="Em branco = importar todas as UFs da planilha.",
    )

    sheet_prefix = forms.CharField(
        label="Aba (prefixo)",
        required=False,
        initial="E - PASSIVAS",
        widget=forms.TextInput(attrs={"class": "form-control text-input"}),
        help_text="Ex.: E - PASSIVAS",
    )

    limit = forms.IntegerField(
        label="Limite (opcional)",
        required=False,
        min_value=0,
        initial=0,
        widget=forms.NumberInput(attrs={"class": "form-control text-input", "style": "width: 120px;"}),
        help_text="0 = sem limite.",
    )

    def clean_uf(self):
        uf = (self.cleaned_data.get("uf") or "").strip().upper()
        if uf and len(uf) != 2:
            raise forms.ValidationError("UF deve ter 2 letras (ex.: RS).")
        return uf

    def clean(self):
        cleaned = super().clean()
        arquivo = cleaned.get("arquivo")
        token = (cleaned.get("upload_token") or "").strip()
        if not arquivo and not token:
            raise forms.ValidationError("Envie a planilha .xlsx/.csv (ou gere a prévia para habilitar o import).")
        return cleaned
