/* =========================================================
 * PATCH ESPECÍFICO: Evento Change para Primeira Questão
 * =========================================================
 * 
 * LOCALIZAÇÃO: Dentro da função renderQuestion(), após linha 2154
 * 
 * SUBSTITUIR O BLOCO:
 */

// CÓDIGO ORIGINAL (linhas 2154-2172):
/*
$inputElement.on('change', function() {
    currentResponses[question.chave] = $(this).val();
    saveResponses();
    renderNextQuestion(
        questionKey,
        $(this).val(),
        $container,
        currentResponses,
        cardIndex
    );

    // valida data_de_transito (tanto raiz quanto em card)
    handleDataTransitoValidation(
        question.chave,
        $(this).val(),
        currentResponses,
        cardIndex
    );
});
*/

// POR ESTE CÓDIGO CORRIGIDO:

$inputElement.on('change', function() {
    currentResponses[question.chave] = $(this).val();
    saveResponses();
    renderNextQuestion(
        questionKey,
        $(this).val(),
        $container,
        currentResponses,
        cardIndex
    );

    // valida data_de_transito (tanto raiz quanto em card)
    handleDataTransitoValidation(
        question.chave,
        $(this).val(),
        currentResponses,
        cardIndex
    );
    
    // PATCH: Verifica se deve mostrar botão "ADICIONAR PROCESSO"
    // Apenas para a árvore raiz (não para cards)
    if (cardIndex === null && question.chave === 'judicializado_pela_massa') {
        // Chama função que verifica e mostra/esconde o botão
        if (typeof checkAndShowAddProcessButton === 'function') {
            checkAndShowAddProcessButton();
        }
    }
});

/* =========================================================
 * INSTRUÇÕES DE APLICAÇÃO:
 * =========================================================
 * 
 * 1. Localize a função renderQuestion() no arquivo original
 * 2. Procure pelo bloco $inputElement.on('change', function() {
 * 3. Substitua todo o bloco pelo código corrigido acima
 * 4. Salve o arquivo
 * 5. Teste a funcionalidade
 * 
 * RESULTADO ESPERADO:
 * - Ao selecionar "SIM - EM ANDAMENTO" ou "SIM - EXTINTO" na primeira questão,
 *   o botão "ADICIONAR PROCESSO" deve aparecer automaticamente
 * - Ao selecionar "NÃO", o botão deve desaparecer
 * 
 * =========================================================
 */
