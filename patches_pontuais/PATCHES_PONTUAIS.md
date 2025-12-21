# Patches Pontuais - Análise Procedural

## ⚠️ IMPORTANTE: Abordagem Minimamente Invasiva

Após análise detalhada do código original, identifiquei que ele **JÁ POSSUI** a maioria das funcionalidades solicitadas. Portanto, vou fornecer apenas **patches pontuais** para corrigir os comportamentos específicos que você mencionou.

---

## 🔍 Análise do Código Existente

### ✅ O que JÁ EXISTE e FUNCIONA:
1. ✅ Função `startNewAnalysis()` - linha 563
2. ✅ Função `storeActiveAnalysisAsProcessCard()` - linha 424
3. ✅ Função `captureActiveAnalysisSnapshot()` - linha 387
4. ✅ Função `preserveGeneralCardBeforeReset()` - linha 572
5. ✅ Sistema de cards resumidos (processos_vinculados)
6. ✅ Seleção de contratos para monitória
7. ✅ Botão "Gerar Petição Monitória"

### ⚠️ O que PRECISA SER AJUSTADO:
1. ⚠️ Botão "ADICIONAR PROCESSO" não aparece após primeira questão
2. ⚠️ Possível falta de validação antes de salvar
3. ⚠️ Comportamento do reset da árvore

---

## 📝 PATCH 1: Adicionar Botão "ADICIONAR PROCESSO"

### Localização: Após a função `renderDecisionTree()` (linha ~1978)

**Adicionar estas funções:**

```javascript
/* =========================================================
 * PATCH 1: Botão "ADICIONAR PROCESSO"
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
```

---

## 📝 PATCH 2: Modificar `renderDecisionTree()` para chamar o botão

### Localização: Dentro da função `renderDecisionTree()` (linha ~1962)

**SUBSTITUIR:**
```javascript
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
}
```

**POR:**
```javascript
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
```

---

## 📝 PATCH 3: Garantir que botão aparece ao responder primeira questão

### Localização: Procurar onde a resposta de `judicializado_pela_massa` é capturada

Você precisa adicionar uma chamada a `checkAndShowAddProcessButton()` sempre que o usuário responder a primeira questão.

**Procure por algo como:**
```javascript
// Quando usuário seleciona resposta para "judicializado_pela_massa"
$inputElement.on('change', function() {
    // ... código existente ...
    saveResponses();
});
```

**E adicione:**
```javascript
$inputElement.on('change', function() {
    // ... código existente ...
    saveResponses();
    
    // PATCH: Verifica se deve mostrar botão "ADICIONAR PROCESSO"
    if (question.chave === 'judicializado_pela_massa') {
        checkAndShowAddProcessButton();
    }
});
```

---

## 📝 PATCH 4: Modificar `startNewAnalysis()` para melhor UX

### Localização: Função `startNewAnalysis()` (linha ~563)

**SUBSTITUIR:**
```javascript
function startNewAnalysis() {
    ensureUserResponsesShape();
    storeActiveAnalysisAsProcessCard();
    preserveGeneralCardBeforeReset();
    clearTreeResponsesForNewAnalysis();
    renderDecisionTree();
    saveResponses();
}
```

**POR:**
```javascript
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
```

---

## 📝 PATCH 5: CSS Mínimo para o Botão "ADICIONAR PROCESSO"

### Adicionar ao CSS existente:

```css
/* Botão Adicionar Processo */
.analise-add-process-btn {
    margin: 15px 0;
    padding: 10px 20px;
    background-color: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    font-size: 14px;
    transition: background-color 0.3s;
    width: 100%;
    text-align: center;
}

.analise-add-process-btn:hover {
    background-color: #1976D2;
}
```

---

## 🎯 Resumo dos Patches

### Patches Obrigatórios (para funcionalidade básica):
1. ✅ **PATCH 1** - Adicionar funções do botão "ADICIONAR PROCESSO"
2. ✅ **PATCH 2** - Modificar `renderDecisionTree()`
3. ✅ **PATCH 3** - Adicionar trigger no evento de mudança
4. ✅ **PATCH 4** - Melhorar `startNewAnalysis()`
5. ✅ **PATCH 5** - CSS mínimo

### Total de Linhas Modificadas:
- **~5 linhas modificadas** em funções existentes
- **~60 linhas adicionadas** (novas funções)
- **~15 linhas de CSS**

---

## 📋 Checklist de Aplicação

1. [ ] Fazer backup do arquivo original
2. [ ] Aplicar PATCH 1 (adicionar funções novas)
3. [ ] Aplicar PATCH 2 (modificar renderDecisionTree)
4. [ ] Aplicar PATCH 3 (adicionar trigger no evento)
5. [ ] Aplicar PATCH 4 (modificar startNewAnalysis)
6. [ ] Aplicar PATCH 5 (adicionar CSS)
7. [ ] Testar fluxo completo

---

## ⚠️ Pontos de Atenção

### 1. **PATCH 3 requer localização manual**
O evento de mudança da primeira questão pode estar em diferentes lugares dependendo de como o campo é renderizado. Procure por:
- `question.chave === 'judicializado_pela_massa'`
- Evento `change` ou `input` nesse campo
- Pode estar dentro da função `renderQuestion()`

### 2. **Função `hasActiveAnalysisResponses()` já existe**
O código original já tem essa função (verifique se existe). Se não existir, adicione:

```javascript
function hasActiveAnalysisResponses() {
    if (!userResponses) return false;
    
    const hasTreeResponses = treeResponseKeys && treeResponseKeys.some(key => {
        const value = userResponses[key];
        return value !== undefined && value !== null && value !== '';
    });
    
    const hasContracts = Array.isArray(userResponses.contratos_para_monitoria) && 
                         userResponses.contratos_para_monitoria.length > 0;
    
    return hasTreeResponses || hasContracts;
}
```

### 3. **Função `displayFormattedResponses()` já existe**
O código original já renderiza os cards. Não precisa modificar.

---

## ✅ Resultado Esperado

Após aplicar os patches:

1. ✅ Ao responder primeira questão com "SIM - EM ANDAMENTO" ou "SIM - EXTINTO", botão "ADICIONAR PROCESSO" aparece
2. ✅ Ao clicar em "ADICIONAR PROCESSO", análise atual é salva e árvore reseta mantendo apenas "judicializado_pela_massa"
3. ✅ Ao clicar em "Adicionar Nova Análise", análise é salva (se houver respostas) e árvore reseta completamente
4. ✅ Cards resumidos continuam funcionando normalmente
5. ✅ Botão "Gerar Petição Monitória" continua funcionando

---

## 🔧 Troubleshooting

### Se o botão não aparecer:
1. Verifique se `checkAndShowAddProcessButton()` está sendo chamada
2. Abra o console do navegador e digite: `normalizeResponse(userResponses.judicializado_pela_massa)`
3. Verifique se o valor retornado é exatamente "SIM - EM ANDAMENTO" ou "SIM - EXTINTO"

### Se o botão aparecer mas não funcionar:
1. Verifique se `addNewProcessToAnalysis()` foi adicionada corretamente
2. Verifique se `hasActiveAnalysisResponses()` existe
3. Verifique console do navegador por erros JavaScript

---

## 📞 Próximos Passos

1. **Aplique os patches** seguindo a ordem
2. **Teste cada funcionalidade** individualmente
3. **Reporte qualquer erro** com mensagem do console
4. **Ajuste fino** se necessário

Esses patches são **minimamente invasivos** e se integram ao código existente sem quebrar funcionalidades. Boa sorte! 🚀
