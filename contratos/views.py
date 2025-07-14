# contratos/views.py
from django.shortcuts import render, get_object_or_404
from .models import ProcessoJudicial

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
