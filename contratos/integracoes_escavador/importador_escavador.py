from contratos.models import ProcessoJudicial, Parte, Advogado, StatusProcessual, AndamentoProcessual
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

    # Mapeamento de tipo_pessoa
    def map_tipo_pessoa(tipo):
        if tipo == "FISICA":
            return "PF"
        if tipo == "JURIDICA":
            return "PJ"
        return ""

    # Importar partes (Polo Ativo e Passivo)
    for envolvido in fonte.get("envolvidos", []):
        if envolvido.get("polo") in ["ATIVO", "PASSIVO"]:
            parte = Parte.objects.create(
                processo=processo,
                nome=envolvido.get("nome"),
                tipo_pessoa=map_tipo_pessoa(envolvido.get("tipo_pessoa")),
                documento=envolvido.get("cpf") or envolvido.get("cnpj"),
                tipo_polo=envolvido.get("polo")
            )
            # Importar advogados da parte
            for advogado_data in envolvido.get("advogados", []):
                # A API pode retornar OABs como lista ou dict
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
            data=datetime.strptime(mov["data"], "%Y-%m-%d"),
            descricao=mov.get("conteudo"),
            detalhes=mov.get("fonte", {}).get("nome")
        )

    print(f"✅ Processo {processo.cnj} importado com sucesso.")
    return processo