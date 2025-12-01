# contratos/data/decision_tree_config.py

DECISION_TREE_CONFIG = {
    "judicializado_pela_massa": {
        "texto_pergunta": "JUDICIALIZADO PELA MASSA",
        "chave": "judicializado_pela_massa",
        "tipo_campo": "OPCOES",
        "is_primeira_questao": True,
        "ordem": 10,
        "opcoes": [
            {"texto_resposta": "SIM - EM ANDAMENTO", "proxima_questao_chave": "processos_vinculados"},
            {"texto_resposta": "SIM - EXTINTO", "proxima_questao_chave": "processos_vinculados"},
            {"texto_resposta": "NÃO", "proxima_questao_chave": None},
        ]
    },
    "processos_vinculados": {
        "texto_pergunta": "PROCESSOS VINCULADOS",
        "chave": "processos_vinculados",
        "tipo_campo": "PROCESSO_VINCULADO",
        "is_primeira_questao": False,
        "ordem": 20,
        "opcoes": [] # Não tem opções no dropdown, é uma interface de cards
    },
    "tipo_de_acao": {
        "texto_pergunta": "TIPO DE AÇÃO",
        "chave": "tipo_de_acao",
        "tipo_campo": "OPCOES",
        "is_primeira_questao": False,
        "ordem": 30,
        "opcoes": [
            {"texto_resposta": "MONITÓRIA", "proxima_questao_chave": "julgamento"},
            {"texto_resposta": "EXIBIÇÃO DE DOCUMENTOS", "proxima_questao_chave": None},
            {"texto_resposta": "REVISIONAL", "proxima_questao_chave": None},
        ]
    },
    "julgamento": {
        "texto_pergunta": "JULGAMENTO",
        "chave": "julgamento",
        "tipo_campo": "OPCOES",
        "is_primeira_questao": False,
        "ordem": 40,
        "opcoes": [
            {"texto_resposta": "COM MÉRITO", "proxima_questao_chave": "procedencia"},
            {"texto_resposta": "SEM MÉRITO", "proxima_questao_chave": "bloco_reproposicao_wrapper"}, # Aponta para o wrapper do bloco
        ]
    },
    "procedencia": {
        "texto_pergunta": "PROCEDÊNCIA",
        "chave": "procedencia",
        "tipo_campo": "OPCOES",
        "is_primeira_questao": False,
        "ordem": 50,
        "opcoes": [
            {"texto_resposta": "INTEGRAL", "proxima_questao_chave": "transitado"},
            {"texto_resposta": "PARCIAL", "proxima_questao_chave": "transitado"},
            {"texto_resposta": "IMPROCEDENTE", "proxima_questao_chave": "transitado"},
        ]
    },
    "transitado": {
        "texto_pergunta": "TRANSITADO",
        "chave": "transitado",
        "tipo_campo": "OPCOES",
        "is_primeira_questao": False,
        "ordem": 60,
        "opcoes": [
            {"texto_resposta": "SIM", "proxima_questao_chave": "data_de_transito"},
            {"texto_resposta": "NÃO", "proxima_questao_chave": "fase_recursal"},
        ]
    },
    "data_de_transito": {
        "texto_pergunta": "DATA DE TRÂNSITO",
        "chave": "data_de_transito",
        "tipo_campo": "DATA",
        "is_primeira_questao": False,
        "ordem": 70,
        "opcoes": [],
        "proxima_questao_chave": "cumprimento_de_sentenca"
    },
    "fase_recursal": {
        "texto_pergunta": "FASE RECURSAL",
        "chave": "fase_recursal",
        "tipo_campo": "OPCOES",
        "is_primeira_questao": False,
        "ordem": 75,
        "opcoes": [
            {"texto_resposta": "SIM", "proxima_questao_chave": "cumprimento_de_sentenca"}, # Adicionado para garantir o fluxo
            {"texto_resposta": "NÃO", "proxima_questao_chave": "cumprimento_de_sentenca"}, # Adicionado para garantir o fluxo
        ]
    },
    "cumprimento_de_sentenca": {
        "texto_pergunta": "CUMPRIMENTO DE SENTENÇA",
        "chave": "cumprimento_de_sentenca",
        "tipo_campo": "OPCOES",
        "is_primeira_questao": False,
        "ordem": 80,
        "opcoes": [
            {"texto_resposta": "SIM", "proxima_questao_chave": "habilitacao"},
            {"texto_resposta": "NÃO", "proxima_questao_chave": None},
            {"texto_resposta": "INICIAR CS", "proxima_questao_chave": None}, # Esta opção terá lógica JS para desabilitar
        ]
    },
    "habilitacao": {
        "texto_pergunta": "HABILITAÇÃO",
        "chave": "habilitacao",
        "tipo_campo": "OPCOES",
        "is_primeira_questao": False,
        "ordem": 90,
        "opcoes": [
            {"texto_resposta": "HABILITAR EM CS!", "proxima_questao_chave": None},
            {"texto_resposta": "NÃO HABILITAR EM CS - ÔNUS", "proxima_questao_chave": None},
            {"texto_resposta": "B6 - HABILITADA EM CS", "proxima_questao_chave": None},
            {"texto_resposta": "B6 - HABILITANDO EM CS", "proxima_questao_chave": None},
        ]
    },
    # Wrapper para o bloco de reproposição, para que ele possa ser referenciado como uma "próxima questão"
    "bloco_reproposicao_wrapper": {
        "texto_pergunta": "BLOCO REPROPOSIÇÃO",
        "chave": "bloco_reproposicao_wrapper",
        "tipo_campo": "BLOCO_INDICADOR", # Um novo tipo para o JS renderizar o bloco real
        "is_primeira_questao": False,
        "ordem": 100,
        "opcoes": [], # Não tem opções, apenas indica que um bloco virá
        "proxima_questao_chave": "repropor_monitoria" # Aponta para o primeiro campo real do bloco
    },
    # Campos reais do bloco de reproposição
    "repropor_monitoria": {
        "texto_pergunta": "REPROPOR MONITÓRIA?",
        "chave": "repropor_monitoria",
        "tipo_campo": "OPCOES",
        "is_primeira_questao": False,
        "ordem": 110,
        "opcoes": [
            {"texto_resposta": "SIM", "proxima_questao_chave": "lote"}, # Se SIM, mostra LOTE
            {"texto_resposta": "NÃO", "proxima_questao_chave": None},
            {"texto_resposta": "VERIFICAR", "proxima_questao_chave": None},
        ]
    },
    "lote": {
        "texto_pergunta": "LOTE",
        "chave": "lote",
        "tipo_campo": "TEXTO",
        "is_primeira_questao": False,
        "ordem": 120,
        "opcoes": [],
        "proxima_questao_chave": "observacoes_reproposicao" # Após lote, mostra observações
    },
    "observacoes_reproposicao": {
        "texto_pergunta": "OBSERVAÇÕES",
        "chave": "observacoes_reproposicao",
        "tipo_campo": "TEXTO_LONGO",
        "is_primeira_questao": False,
        "ordem": 130,
        "opcoes": [],
    }
}
