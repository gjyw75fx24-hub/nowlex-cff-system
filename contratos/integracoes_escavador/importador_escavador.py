from contratos.models import (
    ProcessoJudicial,
    ProcessoJudicialNumeroCnj,
    Parte,
    Advogado,
    StatusProcessual,
    AndamentoProcessual,
)
from contratos.integracoes_escavador.partes import collect_partes_from_escavador_payload
from decimal import Decimal
from datetime import datetime

def importar_dados_escavador(json_data):
    fonte = json_data["fontes"][0]

    # Criar ou localizar status processual
    classe = fonte["capa"].get("classe")
    status, _ = StatusProcessual.objects.get_or_create(nome=classe)

    # Criar processo judicial
    processo, created = ProcessoJudicial.objects.update_or_create(
        cnj=json_data.get("numero_cnj"),
        defaults={
            'uf': json_data.get("estado_origem", {}).get("sigla"),
            'vara': fonte["capa"].get("orgao_julgador"),
            'tribunal': json_data.get("unidade_origem", {}).get("tribunal_sigla") or json_data.get("fontes")[0].get("tribunal", {}).get("sigla"),
            'valor_causa': Decimal(fonte["capa"]["valor_causa"]["valor"]),
            'status': status
        }
    )

    # Limpar dados antigos se o processo já existia
    if not created:
        processo.partes_processuais.all().delete()
        processo.andamentos.all().delete()

    cnj_atual = (json_data.get("numero_cnj") or "").strip()
    numero_cnj_obj = None
    if cnj_atual:
        numero_cnj_obj, _ = ProcessoJudicialNumeroCnj.objects.get_or_create(
            processo=processo,
            cnj=cnj_atual,
            defaults={
                "uf": processo.uf or "",
                "status": status,
                "vara": processo.vara or "",
                "tribunal": processo.tribunal or "",
                "valor_causa": processo.valor_causa,
            },
        )

    # Importar partes (Polo Ativo e Passivo)
    partes_normalizadas = collect_partes_from_escavador_payload(json_data)
    advogados_por_chave = {}
    for envolvido in fonte.get("envolvidos", []):
        key = (str(envolvido.get("nome") or "").strip().casefold(), str(envolvido.get("polo") or "").strip().upper())
        if key[0] and key[1] in {"ATIVO", "PASSIVO"}:
            advogados_por_chave[key] = envolvido.get("advogados", []) or []

    for parte_data in partes_normalizadas:
        parte = Parte.objects.create(
            processo=processo,
            numero_cnj=numero_cnj_obj,
            nome=parte_data.get("nome"),
            tipo_pessoa=parte_data.get("tipo_pessoa") or "",
            documento=parte_data.get("documento"),
            tipo_polo=parte_data.get("tipo_polo"),
        )
        for advogado_data in advogados_por_chave.get((str(parte.nome or "").strip().casefold(), parte.tipo_polo), []):
            oabs = advogado_data.get("oabs", [])
            if isinstance(oabs, dict):
                oabs = [oabs]

            oab = oabs[0] if oabs else {}

            Advogado.objects.create(
                parte=parte,
                nome=advogado_data.get("nome_normalizado"),
                cpf=advogado_data.get("cpf"),
                numero_oab=oab.get("numero"),
                uf_oab=oab.get("uf")
            )

    # Importar andamentos (movimentações)
    for mov in fonte.get("movimentacoes", []):
        AndamentoProcessual.objects.create(
            processo=processo,
            numero_cnj=numero_cnj_obj,
            data=datetime.strptime(mov["data"], "%Y-%m-%d"),
            descricao=mov.get("conteudo"),
            detalhes=mov.get("fonte", {}).get("nome")
        )

    print(f"✅ Processo {processo.cnj} importado com sucesso.")
    return processo
