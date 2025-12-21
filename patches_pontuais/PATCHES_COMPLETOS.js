/* =========================================================
 * PATCHES COMPLETOS - ANÁLISE PROCEDURAL
 * =========================================================
 * 
 * Este arquivo contém TODOS os patches necessários para implementar
 * o fluxo de "ADICIONAR PROCESSO" no código existente.
 * 
 * INSTRUÇÕES:
 * 1. Faça backup do arquivo original analise_processo_arvore.js
 * 2. Aplique os patches na ordem indicada
 * 3. Teste cada funcionalidade após aplicar
 * 
 * =========================================================
 */


/* =========================================================
 * PATCH 1: ADICIONAR NOVAS FUNÇÕES
 * =========================================================
 * LOCALIZAÇÃO: Após a função renderDecisionTree() (aproximadamente linha 1978)
 * AÇÃO: ADICIONAR (não substituir)
 */

/* =========================================================
 * Botão "ADICIONAR PROCESSO"
 * ======================================================= */

function checkAndShowAddProcessButton() {
    const judicializadoValue = normalizeResponse(userResponses.judicializado_pela_massa);
    
    // Mostra botão apenas se respondeu SIM - EM ANDAMENTO ou SIM - EXTINTO
    if (judicializadoValue === 'SIM - EM ANDAMENTO' || judicializadoValue === 'SIM - EXTINTO') {
        showAddProcessButton();
    } else {
        hideAddProcessButton();
    }
}

function showAddProcessButton() {
    // Remove botão existente se houver
    $('.analise-add-process-btn').remove();
    
    const $addProcessBtn = $(
        '<button type="button" class="button analise-add-process-btn" style="margin: 15px 0; padding: 10px 20px; background-color: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; width: 100%;">+ ADICIONAR PROCESSO</button>'
    );
    
    $addProcessBtn.on('click', function() {
        addNewProcessToAnalysis();
    });
    
    // Adiciona após a primeira questão
    const $firstQuestionContainer = $dynamicQuestionsContainer.find('.form-row').first();
    if ($firstQuestionContainer.length) {
        $firstQuestionContainer.after($addProcessBtn);
    }
}

function hideAddProcessButton() {
    $('.analise-add-process-btn').remove();
}

function addNewProcessToAnalysis() {
    ensureUserResponsesShape();
    
    // Salva a análise atual como card (se houver respostas)
    if (hasActiveAnalysisResponses()) {
        storeActiveAnalysisAsProcessCard();
    }
    
    // Preserva o valor de "judicializado_pela_massa"
    const judicializadoValue = userResponses.judicializado_pela_massa;
    
    // Limpa respostas da árvore
    clearTreeResponsesForNewAnalysis();
    
    // Restaura "judicializado_pela_massa"
    userResponses.judicializado_pela_massa = judicializadoValue;
    
    // Re-renderiza a árvore
    renderDecisionTree();
    saveResponses();
    displayFormattedResponses();
    
    // Scroll para o topo
    if ($dynamicQuestionsContainer.length) {
        $dynamicQuestionsContainer.get(0).scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
        });
    }
}


/* =========================================================
 * PATCH 2: MODIFICAR renderDecisionTree()
 * =========================================================
 * LOCALIZAÇÃO: Função renderDecisionTree() (aproximadamente linha 1962)
 * AÇÃO: SUBSTITUIR a função completa
 */

function renderDecisionTree() {
    $dynamicQuestionsContainer.empty();

    if (!firstQuestionKey || !treeConfig[firstQuestionKey]) {
        $dynamicQuestionsContainer.html(
            '<p>Configuração da árvore incompleta. Verifique a API de árvore de decisão.</p>'
        );
        return;
    }

    renderQuestion(
        firstQuestionKey,
        $dynamicQuestionsContainer,
        userResponses,
        null
    );
    
    // PATCH: Verifica se deve mostrar botão "ADICIONAR PROCESSO"
    checkAndShowAddProcessButton();
}


/* =========================================================
 * PATCH 3: MODIFICAR EVENTO CHANGE
 * =========================================================
 * LOCALIZAÇÃO: Dentro da função renderQuestion(), bloco $inputElement.on('change')
 * (aproximadamente linha 2154)
 * AÇÃO: SUBSTITUIR o bloco completo do evento change
 */

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
        checkAndShowAddProcessButton();
    }
});


/* =========================================================
 * PATCH 4: MODIFICAR startNewAnalysis()
 * =========================================================
 * LOCALIZAÇÃO: Função startNewAnalysis() (aproximadamente linha 563)
 * AÇÃO: SUBSTITUIR a função completa
 */

function startNewAnalysis() {
    ensureUserResponsesShape();
    
    // Salva apenas se houver respostas válidas
    if (hasActiveAnalysisResponses()) {
        storeActiveAnalysisAsProcessCard();
    }
    
    preserveGeneralCardBeforeReset();
    clearTreeResponsesForNewAnalysis();
    renderDecisionTree();
    saveResponses();
    displayFormattedResponses();
    
    // Scroll para o topo da árvore
    if ($dynamicQuestionsContainer.length) {
        $dynamicQuestionsContainer.get(0).scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
        });
    }
}


/* =========================================================
 * PATCH 5 (OPCIONAL): Adicionar hasActiveAnalysisResponses() se não existir
 * =========================================================
 * LOCALIZAÇÃO: Junto com outras funções auxiliares
 * AÇÃO: ADICIONAR apenas se a função não existir
 * 
 * VERIFICAÇÃO: Procure por "function hasActiveAnalysisResponses" no código.
 * Se já existir, PULE este patch.
 */

function hasActiveAnalysisResponses() {
    if (!userResponses) return false;
    
    // Verifica se há pelo menos uma resposta válida nas chaves da árvore
    const hasTreeResponses = treeResponseKeys && treeResponseKeys.some(key => {
        const value = userResponses[key];
        return value !== undefined && value !== null && value !== '';
    });
    
    // Verifica se há contratos selecionados
    const hasContracts = Array.isArray(userResponses.contratos_para_monitoria) && 
                         userResponses.contratos_para_monitoria.length > 0;
    
    return hasTreeResponses || hasContracts;
}


/* =========================================================
 * FIM DOS PATCHES JAVASCRIPT
 * =========================================================
 */
