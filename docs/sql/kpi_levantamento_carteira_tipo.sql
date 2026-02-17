-- KPI LEVANTAMENTO: CARTEIRA X TIPO DE ANALISE X RESPOSTAS
--
-- Objetivo:
-- 1) Consolidar os cards de analise salvos por processo.
-- 2) Mostrar, por carteira e tipo, quais perguntas/respostas sao contabilizaveis.
-- 3) Gerar recortes de KPI para monitoria, habilitacao e cumprimento de sentenca.
-- 4) Validar qualidade dos dados antes de fechar os KPIs.
--
-- Como usar no TablePlus:
-- - Rode primeiro o BLOCO [0] para criar a view temporaria.
-- - Em seguida rode os blocos [1]...[8] separadamente.
-- - A view temporaria existe apenas durante a sessao aberta.


-- =========================================================
-- [0] BASE CONSOLIDADA (prefere cards salvos: saved_processos_vinculados)
-- =========================================================
DROP VIEW IF EXISTS tmp_kpi_cards_base;

CREATE TEMP VIEW tmp_kpi_cards_base AS
WITH analises AS (
    SELECT
        ap.id AS analise_id,
        ap.processo_judicial_id,
        ap.respostas,
        CASE
            WHEN jsonb_typeof(ap.respostas->'saved_processos_vinculados') = 'array'
                 AND jsonb_array_length(ap.respostas->'saved_processos_vinculados') > 0
                THEN 'saved'
            ELSE 'active'
        END AS preferred_source
    FROM contratos_analiseprocesso ap
),
raw_cards AS (
    SELECT
        a.analise_id,
        a.processo_judicial_id,
        src.source,
        src.card_index,
        src.card,
        CASE
            WHEN (src.card->'analysis_type'->>'id') ~ '^[0-9]+$'
                THEN (src.card->'analysis_type'->>'id')::int
            ELSE NULL
        END AS tipo_id_card,
        CASE
            WHEN (src.card->>'carteira_id') ~ '^[0-9]+$'
                THEN (src.card->>'carteira_id')::int
            ELSE NULL
        END AS carteira_id_card
    FROM analises a
    CROSS JOIN LATERAL (
        SELECT
            'saved'::text AS source,
            e.ordinality::int - 1 AS card_index,
            e.value AS card
        FROM jsonb_array_elements(COALESCE(a.respostas->'saved_processos_vinculados', '[]'::jsonb)) WITH ORDINALITY AS e(value, ordinality)
        WHERE a.preferred_source = 'saved'

        UNION ALL

        SELECT
            'active'::text AS source,
            e.ordinality::int - 1 AS card_index,
            e.value AS card
        FROM jsonb_array_elements(COALESCE(a.respostas->'processos_vinculados', '[]'::jsonb)) WITH ORDINALITY AS e(value, ordinality)
        WHERE a.preferred_source = 'active'
    ) src
    WHERE jsonb_typeof(src.card) = 'object'
)
SELECT
    rc.analise_id,
    rc.processo_judicial_id,
    rc.source,
    rc.card_index,
    NULLIF(BTRIM(rc.card->>'cnj'), '') AS cnj_card,

    rc.tipo_id_card,
    COALESCE(NULLIF(BTRIM(rc.card->'analysis_type'->>'nome'), ''), tipo.nome, '[Sem tipo]') AS tipo_nome,
    COALESCE(NULLIF(BTRIM(rc.card->'analysis_type'->>'slug'), ''), tipo.slug, '[sem-slug]') AS tipo_slug,
    CASE
        WHEN (rc.card->'analysis_type'->>'versao') ~ '^[0-9]+$'
            THEN (rc.card->'analysis_type'->>'versao')::int
        ELSE NULL
    END AS tipo_versao_card,

    COALESCE(rc.carteira_id_card, pj.carteira_id, linked.any_carteira_id) AS carteira_id_resolved,
    COALESCE(carteira.nome, '[Sem carteira]') AS carteira_nome,

    CASE
        WHEN jsonb_typeof(rc.card->'tipo_de_acao_respostas') = 'object'
            THEN rc.card->'tipo_de_acao_respostas'
        ELSE '{}'::jsonb
    END AS respostas_obj,

    rc.card AS card_json,

    NULLIF(REGEXP_REPLACE(COALESCE(passivo.documento, ''), '\\D', '', 'g'), '') AS cpf_digits
FROM raw_cards rc
JOIN contratos_processojudicial pj
    ON pj.id = rc.processo_judicial_id
LEFT JOIN LATERAL (
    SELECT MIN(v.carteira_id) AS any_carteira_id
    FROM contratos_processojudicial_carteiras_vinculadas v
    WHERE v.processojudicial_id = pj.id
) linked ON TRUE
LEFT JOIN contratos_carteira carteira
    ON carteira.id = COALESCE(rc.carteira_id_card, pj.carteira_id, linked.any_carteira_id)
LEFT JOIN contratos_tipoanaliseobjetiva tipo
    ON tipo.id = rc.tipo_id_card
LEFT JOIN LATERAL (
    SELECT pa.documento
    FROM contratos_parte pa
    WHERE pa.processo_id = pj.id
    ORDER BY CASE WHEN pa.tipo_polo = 'PASSIVO' THEN 0 ELSE 1 END, pa.id
    LIMIT 1
) passivo ON TRUE;


-- =========================================================
-- [1] VISAO MACRO: CARTEIRA X TIPO
-- =========================================================
SELECT
    carteira_nome,
    tipo_nome,
    tipo_slug,
    COUNT(*) AS cards,
    COUNT(DISTINCT processo_judicial_id) AS processos,
    COUNT(DISTINCT cpf_digits) AS cpfs_unicos
FROM tmp_kpi_cards_base
GROUP BY carteira_nome, tipo_nome, tipo_slug
ORDER BY carteira_nome, tipo_nome;


-- =========================================================
-- [2] QUAIS PERGUNTAS TEM DADO (contabilizaveis)
-- =========================================================
WITH respostas AS (
    SELECT
        b.*,
        kv.key AS pergunta_chave,
        NULLIF(BTRIM(kv.value), '') AS resposta_valor
    FROM tmp_kpi_cards_base b
    CROSS JOIN LATERAL jsonb_each_text(b.respostas_obj) kv
    WHERE NULLIF(BTRIM(kv.value), '') IS NOT NULL
      AND NULLIF(BTRIM(kv.value), '') <> '---'
)
SELECT
    r.carteira_nome,
    r.tipo_nome,
    r.tipo_slug,
    r.pergunta_chave,
    COALESCE(q.texto_pergunta, '[Pergunta nao encontrada]') AS pergunta_texto,
    COALESCE(q.tipo_campo, '[sem-tipo-campo]') AS tipo_campo,
    COUNT(*) AS respostas,
    COUNT(DISTINCT r.processo_judicial_id) AS processos,
    COUNT(DISTINCT r.cpf_digits) AS cpfs_unicos
FROM respostas r
LEFT JOIN contratos_questaoanalise q
    ON q.chave = r.pergunta_chave
GROUP BY
    r.carteira_nome,
    r.tipo_nome,
    r.tipo_slug,
    r.pergunta_chave,
    q.texto_pergunta,
    q.tipo_campo
ORDER BY
    r.carteira_nome,
    r.tipo_nome,
    r.pergunta_chave;


-- =========================================================
-- [3] DISTRIBUICAO DE RESPOSTAS (por pergunta)
-- =========================================================
WITH respostas AS (
    SELECT
        b.*,
        kv.key AS pergunta_chave,
        NULLIF(BTRIM(kv.value), '') AS resposta_valor
    FROM tmp_kpi_cards_base b
    CROSS JOIN LATERAL jsonb_each_text(b.respostas_obj) kv
    WHERE NULLIF(BTRIM(kv.value), '') IS NOT NULL
      AND NULLIF(BTRIM(kv.value), '') <> '---'
),
agg AS (
    SELECT
        r.carteira_nome,
        r.tipo_nome,
        r.tipo_slug,
        r.pergunta_chave,
        COALESCE(q.texto_pergunta, '[Pergunta nao encontrada]') AS pergunta_texto,
        r.resposta_valor,
        COUNT(*) AS cards,
        COUNT(DISTINCT r.processo_judicial_id) AS processos,
        COUNT(DISTINCT r.cpf_digits) AS cpfs_unicos
    FROM respostas r
    LEFT JOIN contratos_questaoanalise q
        ON q.chave = r.pergunta_chave
    GROUP BY
        r.carteira_nome,
        r.tipo_nome,
        r.tipo_slug,
        r.pergunta_chave,
        q.texto_pergunta,
        r.resposta_valor
)
SELECT
    a.*,
    ROUND(
        100.0 * a.cards
        / NULLIF(SUM(a.cards) OVER (
            PARTITION BY a.carteira_nome, a.tipo_nome, a.pergunta_chave
        ), 0),
        2
    ) AS pct_dentro_da_pergunta
FROM agg a
ORDER BY
    a.carteira_nome,
    a.tipo_nome,
    a.pergunta_chave,
    a.cards DESC,
    a.resposta_valor;


-- =========================================================
-- [4] RECORTE KPI (MONITORIA, HABILITACAO, CUMPRIMENTO DE SENTENCA)
--
-- Ajuste fino apos validar os textos reais das respostas.
-- =========================================================
WITH base AS (
    SELECT
        b.*,
        LOWER(BTRIM(COALESCE(b.respostas_obj->>'propor_monitoria', ''))) AS propor_monitoria,
        LOWER(BTRIM(COALESCE(b.respostas_obj->>'repropor_monitoria', ''))) AS repropor_monitoria,
        LOWER(BTRIM(COALESCE(b.respostas_obj->>'cumprimento_de_sentenca', ''))) AS cumprimento_de_sentenca,
        LOWER(BTRIM(COALESCE(b.respostas_obj->>'habilitacao', ''))) AS habilitacao_raw
    FROM tmp_kpi_cards_base b
),
norm AS (
    SELECT
        base.*,
        LOWER(TRANSLATE(
            base.habilitacao_raw,
            'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
            'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
        )) AS habilitacao_norm
    FROM base
)
SELECT
    n.carteira_nome,
    n.tipo_nome,
    n.tipo_slug,
    COUNT(*) AS cards_total,

    -- MONITORIA
    COUNT(*) FILTER (
        WHERE n.propor_monitoria = 'sim'
    ) AS propor_monitoria_sim,

    COUNT(*) FILTER (
        WHERE n.propor_monitoria IN ('nao', 'não', 'n')
    ) AS propor_monitoria_nao,

    COUNT(*) FILTER (
        WHERE n.repropor_monitoria = 'sim'
    ) AS repropor_monitoria_sim,

    COUNT(*) FILTER (
        WHERE n.repropor_monitoria IN ('nao', 'não', 'n')
    ) AS repropor_monitoria_nao,

    COUNT(*) FILTER (
        WHERE n.propor_monitoria = 'sim' OR n.repropor_monitoria = 'sim'
    ) AS recomendou_monitoria,

    ROUND(
        100.0 * COUNT(*) FILTER (
            WHERE n.propor_monitoria = 'sim' OR n.repropor_monitoria = 'sim'
        ) / NULLIF(COUNT(*), 0),
        2
    ) AS pct_recomendou_monitoria,

    -- CUMPRIMENTO DE SENTENCA (inclui opcao "INICIAR CS")
    COUNT(*) FILTER (
        WHERE n.cumprimento_de_sentenca IN ('sim', 's')
    ) AS cumprimento_sentenca_sim,

    COUNT(*) FILTER (
        WHERE n.cumprimento_de_sentenca IN ('nao', 'não', 'n')
    ) AS cumprimento_sentenca_nao,

    COUNT(*) FILTER (
        WHERE n.cumprimento_de_sentenca IN ('iniciar cs', 'iniciar c.s.', 'iniciar cumprimento de sentenca')
    ) AS cumprimento_sentenca_iniciar_cs,

    -- HABILITACAO (detalhado)
    COUNT(*) FILTER (
        WHERE n.habilitacao_norm LIKE 'habilitar%'
    ) AS habilitar_sim,

    COUNT(*) FILTER (
        WHERE n.habilitacao_norm LIKE 'nao habilitar%'
           OR n.habilitacao_norm LIKE 'não habilitar%'
    ) AS habilitar_nao,

    COUNT(*) FILTER (
        WHERE n.habilitacao_norm LIKE 'b6 - habilitada%'
    ) AS habilitacao_b6_habilitada,

    COUNT(*) FILTER (
        WHERE n.habilitacao_norm LIKE 'b6 - habilitando%'
    ) AS habilitacao_b6_habilitando
FROM norm n
GROUP BY n.carteira_nome, n.tipo_nome, n.tipo_slug
ORDER BY n.carteira_nome, n.tipo_nome;


-- =========================================================
-- [4.1] RECORTE MONITORIA DETALHADO (somente tipo com "monitoria")
-- =========================================================
WITH base AS (
    SELECT
        b.*,
        LOWER(BTRIM(COALESCE(b.respostas_obj->>'propor_monitoria', ''))) AS propor_monitoria,
        LOWER(BTRIM(COALESCE(b.respostas_obj->>'repropor_monitoria', ''))) AS repropor_monitoria,
        LOWER(BTRIM(COALESCE(b.respostas_obj->>'cumprimento_de_sentenca', ''))) AS cumprimento_de_sentenca,
        LOWER(BTRIM(COALESCE(b.respostas_obj->>'habilitacao', ''))) AS habilitacao
    FROM tmp_kpi_cards_base b
    WHERE LOWER(COALESCE(b.tipo_slug, '')) LIKE '%monitoria%'
       OR LOWER(COALESCE(b.tipo_nome, '')) LIKE '%monitoria%'
       OR LOWER(COALESCE(b.tipo_nome, '')) LIKE '%monitória%'
)
SELECT
    carteira_nome,
    tipo_nome,
    COUNT(*) AS cards_total,
    COUNT(*) FILTER (WHERE propor_monitoria = 'sim') AS nova_monitoria,
    COUNT(*) FILTER (WHERE repropor_monitoria = 'sim') AS repropor_monitoria,
    COUNT(*) FILTER (WHERE cumprimento_de_sentenca = 'iniciar cs') AS iniciar_cs,
    COUNT(*) FILTER (WHERE habilitacao LIKE 'habilitar%') AS habilitar_em_cs,
    COUNT(*) FILTER (WHERE habilitacao LIKE 'nao habilitar%' OR habilitacao LIKE 'não habilitar%') AS nao_habilitar_em_cs
FROM base
GROUP BY carteira_nome, tipo_nome
ORDER BY carteira_nome, tipo_nome;


-- =========================================================
-- [5] QUALIDADE DE DADOS: BASE
-- =========================================================
SELECT
    COUNT(*) AS cards_total,
    COUNT(*) FILTER (WHERE tipo_id_card IS NULL) AS cards_sem_tipo,
    COUNT(*) FILTER (WHERE carteira_id_resolved IS NULL) AS cards_sem_carteira,
    COUNT(*) FILTER (WHERE jsonb_object_length(respostas_obj) = 0) AS cards_sem_respostas,
    COUNT(*) FILTER (WHERE source = 'active') AS cards_vindos_de_processos_vinculados
FROM tmp_kpi_cards_base;


-- =========================================================
-- [6] QUALIDADE: CHAVES DE RESPOSTA SEM QUESTAO CONFIGURADA
-- =========================================================
WITH respostas AS (
    SELECT
        b.carteira_nome,
        b.tipo_nome,
        b.tipo_slug,
        kv.key AS pergunta_chave,
        NULLIF(BTRIM(kv.value), '') AS resposta_valor
    FROM tmp_kpi_cards_base b
    CROSS JOIN LATERAL jsonb_each_text(b.respostas_obj) kv
    WHERE NULLIF(BTRIM(kv.value), '') IS NOT NULL
      AND NULLIF(BTRIM(kv.value), '') <> '---'
)
SELECT
    r.carteira_nome,
    r.tipo_nome,
    r.tipo_slug,
    r.pergunta_chave,
    COUNT(*) AS ocorrencias
FROM respostas r
LEFT JOIN contratos_questaoanalise q
    ON q.chave = r.pergunta_chave
WHERE q.id IS NULL
GROUP BY
    r.carteira_nome,
    r.tipo_nome,
    r.tipo_slug,
    r.pergunta_chave
ORDER BY ocorrencias DESC, r.carteira_nome, r.tipo_nome, r.pergunta_chave;


-- =========================================================
-- [7] QUALIDADE: RESPOSTAS DE CAMPO OPCOES FORA DA TABELA DE OPCOES
-- =========================================================
WITH respostas AS (
    SELECT
        b.carteira_nome,
        b.tipo_nome,
        b.tipo_slug,
        kv.key AS pergunta_chave,
        NULLIF(BTRIM(kv.value), '') AS resposta_valor
    FROM tmp_kpi_cards_base b
    CROSS JOIN LATERAL jsonb_each_text(b.respostas_obj) kv
    WHERE NULLIF(BTRIM(kv.value), '') IS NOT NULL
      AND NULLIF(BTRIM(kv.value), '') <> '---'
)
SELECT
    r.carteira_nome,
    r.tipo_nome,
    r.tipo_slug,
    q.texto_pergunta,
    r.pergunta_chave,
    r.resposta_valor,
    COUNT(*) AS ocorrencias
FROM respostas r
JOIN contratos_questaoanalise q
    ON q.chave = r.pergunta_chave
   AND q.tipo_campo = 'OPCOES'
LEFT JOIN contratos_opcaoresposta o
    ON o.questao_origem_id = q.id
   AND o.ativo = TRUE
   AND LOWER(BTRIM(o.texto_resposta)) = LOWER(BTRIM(r.resposta_valor))
WHERE o.id IS NULL
GROUP BY
    r.carteira_nome,
    r.tipo_nome,
    r.tipo_slug,
    q.texto_pergunta,
    r.pergunta_chave,
    r.resposta_valor
ORDER BY ocorrencias DESC, r.carteira_nome, r.tipo_nome, r.pergunta_chave;


-- =========================================================
-- [8] MATRIZ KPI (carteira x tipo x pergunta configurada + cobertura)
-- =========================================================
WITH respostas AS (
    SELECT
        b.carteira_id_resolved,
        b.tipo_id_card,
        kv.key AS pergunta_chave,
        NULLIF(BTRIM(kv.value), '') AS resposta_valor
    FROM tmp_kpi_cards_base b
    CROSS JOIN LATERAL jsonb_each_text(b.respostas_obj) kv
    WHERE NULLIF(BTRIM(kv.value), '') IS NOT NULL
      AND NULLIF(BTRIM(kv.value), '') <> '---'
),
resp_stats AS (
    SELECT
        carteira_id_resolved,
        tipo_id_card,
        pergunta_chave,
        COUNT(*) AS cards_com_resposta
    FROM respostas
    GROUP BY carteira_id_resolved, tipo_id_card, pergunta_chave
),
combos AS (
    SELECT DISTINCT
        carteira_id_resolved,
        tipo_id_card
    FROM tmp_kpi_cards_base
    WHERE tipo_id_card IS NOT NULL
)
SELECT
    COALESCE(c.nome, '[Sem carteira]') AS carteira_nome,
    t.nome AS tipo_nome,
    t.slug AS tipo_slug,
    q.ordem,
    q.chave AS pergunta_chave,
    q.texto_pergunta,
    q.tipo_campo,
    COALESCE(
        STRING_AGG(DISTINCT o.texto_resposta, ' | ' ORDER BY o.texto_resposta)
            FILTER (WHERE o.id IS NOT NULL),
        '[campo livre]'
    ) AS opcoes_configuradas,
    COALESCE(rs.cards_com_resposta, 0) AS cards_com_resposta
FROM combos cb
JOIN contratos_tipoanaliseobjetiva t
    ON t.id = cb.tipo_id_card
LEFT JOIN contratos_carteira c
    ON c.id = cb.carteira_id_resolved
JOIN contratos_questaoanalise q
    ON q.tipo_analise_id = t.id
   AND q.ativo = TRUE
LEFT JOIN contratos_opcaoresposta o
    ON o.questao_origem_id = q.id
   AND o.ativo = TRUE
LEFT JOIN resp_stats rs
    ON rs.carteira_id_resolved = cb.carteira_id_resolved
   AND rs.tipo_id_card = cb.tipo_id_card
   AND rs.pergunta_chave = q.chave
GROUP BY
    c.nome,
    t.nome,
    t.slug,
    q.ordem,
    q.chave,
    q.texto_pergunta,
    q.tipo_campo,
    rs.cards_com_resposta
ORDER BY
    carteira_nome,
    tipo_nome,
    q.ordem,
    q.chave;
