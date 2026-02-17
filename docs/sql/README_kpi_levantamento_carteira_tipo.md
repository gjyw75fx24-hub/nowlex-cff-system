# Levantamento KPI por Carteira e Tipo de Analise

Arquivo SQL principal:
- `docs/sql/kpi_levantamento_carteira_tipo.sql`

## Objetivo

Gerar uma base unica de cards de analise e extrair:
- volume por `carteira x tipo de analise`;
- distribuicao de respostas por pergunta;
- recortes de decisao (Monitória, CS, Habilitacao);
- checagens de qualidade dos dados antes de publicar KPI.

## Como rodar no TablePlus

1. Abra a conexao do banco de producao.
2. Crie uma nova aba SQL.
3. Cole o conteudo de `kpi_levantamento_carteira_tipo.sql`.
4. Execute bloco por bloco (na ordem):
   - `[0]` cria a view temporaria `tmp_kpi_cards_base`;
   - `[1]` a `[4.1]` extraem os KPIs;
   - `[5]` a `[8]` validam qualidade/cobertura.
5. Exporte cada resultado (CSV) para consolidar no BI.

## Leitura recomendada dos resultados

- `[1]` = base de volume para cards/processos/CPFs.
- `[2]` = perguntas com preenchimento real (o que e contabilizavel).
- `[3]` = distribuicao percentual das respostas por pergunta.
- `[4]` = macro de decisoes operacionais por carteira/tipo.
- `[4.1]` = detalhamento do fluxo de Monitória.
- `[5]` = saude geral do dataset (cards sem tipo/carteira/resposta).
- `[6]` = chaves de resposta sem questao configurada.
- `[7]` = respostas de `OPCOES` fora do cadastro de opcoes.
- `[8]` = cobertura de cada pergunta configurada por carteira/tipo.

## Regra de validacao antes de fechar KPI

So considerar KPI final quando:
- `cards_sem_tipo` e `cards_sem_carteira` (bloco `[5]`) estiverem baixos/explicados;
- nao houver volume relevante em `[6]` e `[7]`;
- perguntas criticas do negocio tiverem cobertura adequada em `[8]`.

## Observacoes tecnicas

- A base prioriza `saved_processos_vinculados`; se vazio, usa `processos_vinculados`.
- O CPF e derivado da primeira parte passiva do processo (fallback por ordem).
- `cumprimento_de_sentenca = INICIAR CS` ja aparece separado no bloco `[4]`.

