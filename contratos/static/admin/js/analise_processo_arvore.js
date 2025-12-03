(function($) {
    $(document).ready(function() {
        console.log("analise_processo_arvore.js carregado.");

        const decisionTreeApiUrl = '/api/decision-tree/';

        let treeConfig = {};
        let userResponses = {};
        let firstQuestionKey = null;
        const currentProcessoId = $('input[name="object_id"]').val() || null;

        const $inlineGroup = $('.analise-procedural-group');
        
        if (!$inlineGroup.length) {
            console.error("O elemento '.analise-procedural-group' não foi encontrado no DOM.");
            return;
        }

        const $responseField = $inlineGroup.find('textarea[name$="-respostas"]');
        
        $responseField.closest('.form-row').hide(); // Manter o textarea original escondido
        const $dynamicQuestionsContainer = $('<div class="dynamic-questions-container"></div>');
        $inlineGroup.append($dynamicQuestionsContainer);

        const $formattedResponsesContainer = $('<div class="formatted-responses-container"><h3>Respostas da Análise</h3></div>');
        $inlineGroup.append($formattedResponsesContainer); // Novo container para exibir as respostas formatadas

        let allAvailableContratos = [];

        function loadExistingResponses() {
            try {
                const data = $responseField.val();
                userResponses = data ? JSON.parse(data) : {};
                if (!userResponses.contratos_status) {
                    userResponses.contratos_status = {};
                }
                console.log("DEBUG A_P_A: loadExistingResponses - userResponses APÓS carregar:", JSON.stringify(userResponses));
                displayFormattedResponses(); // Atualiza a exibição formatada após carregar
            } catch (e) {
                console.error("DEBUG A_P_A: Erro ao parsear respostas existentes:", e);
                userResponses = { contratos_status: {} };
                displayFormattedResponses(); // Garante que a exibição seja atualizada mesmo em caso de erro
            }
        }

        function saveResponses() {
            console.log("DEBUG A_P_A: saveResponses - userResponses ANTES de salvar:", JSON.stringify(userResponses));
            $responseField.val(JSON.stringify(userResponses, null, 2));
            console.log("DEBUG A_P_A: saveResponses - TextArea contém:", $responseField.val());
            displayFormattedResponses(); // Atualiza a exibição formatada após salvar
        }

        function displayFormattedResponses() {
            $formattedResponsesContainer.empty(); // Limpa o container antes de preencher
            $formattedResponsesContainer.append('<h3>Respostas da Análise</h3>'); // Adiciona o título de volta

            if (Object.keys(userResponses).length === 0 || (!userResponses.contratos_status && !userResponses.judicializado_pela_massa && !userResponses.processos_vinculados && Object.keys(userResponses).length <= 0)) {
                $formattedResponsesContainer.append('<p>Nenhuma análise registrada ainda. Preencha a árvore acima para iniciar.</p>');
                return;
            }

            // --- 1. Renderizar o Card Principal ---
            const $analiseCard = $('<div class="analise-summary-card"></div>');
            const $cardHeader = $('<div class="analise-summary-card-header"></div>');
            const $cardBody = $('<div class="analise-summary-card-body" style="display: none;"></div>');

            // Header do card principal
            let resumoContratos = [];
            const contratosStatus = userResponses.contratos_status || {};
            for (const contratoId in contratosStatus) {
                if (contratosStatus[contratoId].selecionado) {
                    const contratoInfo = allAvailableContratos.find(c => String(c.id) === String(contratoId));
                    if (contratoInfo) resumoContratos.push(contratoInfo.numero_contrato);
                }
            }
            const contratosDisplay = resumoContratos.length > 0 ? resumoContratos.join(', ') : 'Nenhum';
            const judicializadoDisplay = userResponses.judicializado_pela_massa || 'Não informado';
            const analiseCnj = $responseField.data('analise-cnj') || 'Não Atribuído';
            const updatedAtRaw = $responseField.data('analise-updated-at');
            const updatedBy = $responseField.data('analise-updated-by');

            if (updatedAtRaw) {
                const updatedAt = new Date(updatedAtRaw);
                const formattedDate = ('0' + updatedAt.getDate()).slice(-2) + '/' + ('0' + (updatedAt.getMonth() + 1)).slice(-2) + '/' + updatedAt.getFullYear() + ' ' + ('0' + updatedAt.getHours()).slice(-2) + ':' + ('0' + updatedAt.getMinutes()).slice(-2);
                const $dateSpan = $(`<span class="analise-save-date">Última atualização: ${formattedDate}</span>`);
                if (updatedBy) {
                    $dateSpan.attr('title', `Atualizado por: ${updatedBy}`);
                }
                $cardHeader.append($dateSpan);
            }
            $cardHeader.append(`<span>Processo Principal: <strong>${analiseCnj}</strong></span>`);
            $cardHeader.append(`<span>Contratos: <strong>${contratosDisplay}</strong></span>`);
            $cardHeader.append(`<span>Judicializado: <strong>${judicializadoDisplay}</strong></span>`);
            
            const $toggleBtn = $('<button type="button" class="analise-toggle-btn"> + </button>');
            $cardHeader.append($toggleBtn);
            const $editBtn = $('<button type="button" class="analise-edit-btn">Editar</button>');
            $cardHeader.append($editBtn);
            $analiseCard.append($cardHeader);

            // Corpo do card principal (excluindo processos vinculados)
            const $ulDetalhes = $('<ul></ul>');
            for (const key in userResponses) {
                if (userResponses.hasOwnProperty(key) && key !== 'processos_vinculados') { // <-- Exclui os vinculados
                    if (key === 'contratos_status') {
                        const $liContratos = $('<li><strong>Contratos Selecionados:</strong><ul></ul></li>');
                        const $ulContratos = $liContratos.find('ul');
                        let hasSelectedContract = false;
                        for (const contratoId in contratosStatus) {
                            if (contratosStatus[contratoId].selecionado) {
                                hasSelectedContract = true;
                                const contratoInfo = allAvailableContratos.find(c => String(c.id) === String(contratoId));
                                const nomeContrato = contratoInfo ? contratoInfo.numero_contrato : `ID ${contratoId}`;
                                $ulContratos.append(`<li>${nomeContrato} (Quitado: ${contratosStatus[contratoId].quitado ? 'Sim' : 'Não'})</li>`);
                            }
                        }
                        if (!hasSelectedContract) {
                            $ulContratos.append('<li>Nenhum contrato selecionado.</li>');
                        }
                        $ulDetalhes.append($liContratos);
                    } else {
                        $ulDetalhes.append(`<li><strong>${key}:</strong> ${userResponses[key]}</li>`);
                    }
                }
            }
            $cardBody.append($ulDetalhes);
            $analiseCard.append($cardBody);
            $formattedResponsesContainer.append($analiseCard);

            // Event Listeners para o card principal
            $toggleBtn.on('click', function() { $cardBody.slideToggle(200, function() { $toggleBtn.text($cardBody.is(':visible') ? ' - ' : ' + '); }); });
            $editBtn.on('click', function() { /* Lógica para reabrir árvore */ });

            // --- 2. Renderizar Cards para Processos Vinculados ---
            const processosVinculados = userResponses.processos_vinculados;
            if (Array.isArray(processosVinculados) && processosVinculados.length > 0) {
                
                processosVinculados.forEach((processo, index) => {
                    const $cardVinculado = $('<div class="analise-summary-card"></div>');
                    const $headerVinculado = $('<div class="analise-summary-card-header"></div>');
                    const $bodyVinculado = $('<div class="analise-summary-card-body" style="display: none;"></div>');
                    const cnjVinculado = processo.cnj || 'Não informado';

                    // Header do card vinculado
                    $headerVinculado.append(`<span>Processo Vinculado: <strong>${cnjVinculado}</strong></span>`);
                    const $toggleBtnVinculado = $('<button type="button" class="analise-toggle-btn"> + </button>');
                    $headerVinculado.append($toggleBtnVinculado);
                    $cardVinculado.append($headerVinculado);

                    // Corpo do card vinculado
                    const $ulDetalhesVinculado = $('<ul></ul>');
                    if (processo.contratos && processo.contratos.length > 0) {
                        const nomesContratos = processo.contratos.map(cId => {
                            const cInfo = allAvailableContratos.find(c => String(c.id) === String(cId));
                            return cInfo ? cInfo.numero_contrato : `ID ${cId}`;
                        }).join(', ');
                        $ulDetalhesVinculado.append(`<li><strong>Contratos Vinculados:</strong> ${nomesContratos}</li>`);
                    }
                    if (processo.tipo_de_acao_respostas && Object.keys(processo.tipo_de_acao_respostas).length > 0) {
                        const $liAcao = $('<li><strong>Respostas da Ação:</strong><ul></ul></li>');
                        const $ulAcao = $liAcao.find('ul');
                        for (const subKey in processo.tipo_de_acao_respostas) {
                            $ulAcao.append(`<li>${subKey}: ${processo.tipo_de_acao_respostas[subKey]}</li>`);
                        }
                        $ulDetalhesVinculado.append($liAcao);
                    }
                    $bodyVinculado.append($ulDetalhesVinculado);
                    $cardVinculado.append($bodyVinculado);
                    
                    $formattedResponsesContainer.append($cardVinculado);

                    // Event listener para o card vinculado
                    $toggleBtnVinculado.on('click', function() {
                        $bodyVinculado.slideToggle(200, function() {
                            $toggleBtnVinculado.text($bodyVinculado.is(':visible') ? ' - ' : ' + ');
                        });
                    });
                });
            }
        }

        function areAnySelectedContractsQuitado() {
            const status = userResponses.contratos_status || {};
            for (const contratoId in status) {
                if (status[contratoId].selecionado && status[contratoId].quitado) {
                    return true;
                }
            }
                        return false;
                    }
            
                    // NOVA FUNÇÃO: Carrega contratos do DOM
                    function loadContratosFromDOM() {
                        allAvailableContratos = [];
                        $('.contrato-item-wrapper').each(function() {
                            const $wrapper = $(this);
                            const contratoId = $wrapper.data('contrato-id');
                            // Pega o texto do span.contrato-numero e remove espaços em branco extras
                            const numeroContrato = $wrapper.find('.contrato-numero').text().trim().split('\n')[0].trim();
                            
                            if (contratoId && numeroContrato) {
                                allAvailableContratos.push({ id: contratoId, numero_contrato: numeroContrato });
                            }
                        });
                        console.log("DEBUG A_P_A: Contratos carregados do DOM:", JSON.stringify(allAvailableContratos));
                    }
            
                    function fetchDecisionTreeConfig() {
                        const deferredConfig = $.Deferred();
            
                        $.ajax({
                            url: decisionTreeApiUrl,
                            method: 'GET',
                            dataType: 'json',
                            success: function(data) {
                                if (data.status === 'success') {
                                    treeConfig = data.tree_data;
                                    firstQuestionKey = data.primeira_questao_chave;
                                    deferredConfig.resolve();
                                } else {
                                    console.error("Erro ao carregar configuração da árvore:", data.message);
                                    $dynamicQuestionsContainer.html('<p class="errornote">' + data.message + '</p>');
                                    deferredConfig.reject();
                                }
                            },
                            error: function(xhr, status, error) {
                                console.error("Erro AJAX ao carregar configuração da árvore:", status, error);
                                $dynamicQuestionsContainer.html('<p class="errornote">Erro ao carregar a árvore de decisão.</p>');
                                deferredConfig.reject();
                            }
                        });
                        
                        deferredConfig.promise().done(function() {
                            renderDecisionTree();
                        }).fail(function() {
                            console.error("Erro ao carregar configuração da árvore. Não foi possível renderizar a árvore de decisão.");
                        });
                    }
            
                    function renderDecisionTree() {
                        $dynamicQuestionsContainer.empty();
                        if (!firstQuestionKey || !treeConfig[firstQuestionKey]) {
                            $dynamicQuestionsContainer.html('<p>Configuração da árvore incompleta.</p>');
                            return;
                        }
                        renderQuestion(firstQuestionKey, $dynamicQuestionsContainer, userResponses);
                    }

        function renderQuestion(questionKey, $container, currentResponses, cardIndex = null) {
            const question = treeConfig[questionKey];
            if (!question) return;

            const isQuitado = areAnySelectedContractsQuitado();
            let $questionDiv;
            let $inputElement;
            const fieldId = `id_${(cardIndex !== null ? `card_${cardIndex}_` : '')}${question.chave}`;
            const fieldName = (cardIndex !== null ? `card_${cardIndex}_` : '') + question.chave;

            if (question.tipo_campo === 'BLOCO_INDICADOR') {
                $questionDiv = $(`<div class="form-row field-${question.chave}" data-question-key="${question.chave}"><h3>${question.texto_pergunta}</h3></div>`);
                $container.append($questionDiv);
                if (question.proxima_questao_chave) renderQuestion(question.proxima_questao_chave, $questionDiv, currentResponses, cardIndex);
                return;
            } else if (question.tipo_campo === 'PROCESSO_VINCULADO') {
                renderProcessoVinculadoEditor(question.chave, $container);
                return;
            }
            
            $questionDiv = $(`<div class="form-row field-${question.chave}" data-question-key="${question.chave}"><label for="${fieldId}">${question.texto_pergunta}:</label></div>`);
            $container.append($questionDiv);

            switch (question.tipo_campo) {
                case 'OPCOES':
                    $inputElement = $(`<select id="${fieldId}" name="${fieldName}"><option value="">---</option></select>`);
                    question.opcoes.forEach(function(opcao) {
                        const isSelected = (currentResponses[question.chave] === opcao.texto_resposta);
                        let disabled = false;
                        if (isQuitado && ((question.chave === 'repropor_monitoria' && opcao.texto_resposta === 'SIM') || (question.chave === 'cumprimento_de_sentenca' && opcao.texto_resposta === 'INICIAR CS'))) {
                            disabled = true;
                        }
                        $inputElement.append(`<option value="${opcao.texto_resposta}" ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${opcao.texto_resposta}</option>`);
                    });
                    break;
                case 'TEXTO': case 'TEXTO_LONGO': case 'DATA':
                    const type = question.tipo_campo === 'DATA' ? 'date' : 'text';
                    const tag = question.tipo_campo === 'TEXTO_LONGO' ? 'textarea' : 'input';
                    $inputElement = $(`<${tag} type="${type}" id="${fieldId}" name="${fieldName}" ${tag === 'textarea' ? 'rows="4"' : ''}></${tag}>`).val(currentResponses[question.chave] || '');
                    break;
                default:
                    $inputElement = $('<p>Tipo de campo desconhecido: ' + question.tipo_campo + '</p>');
            }

            $inputElement.on('change', function() {
                currentResponses[question.chave] = $(this).val();
                saveResponses();
                renderNextQuestion(questionKey, $(this).val(), $container, currentResponses, cardIndex);
                if (cardIndex === null) handleDataTransitoValidation(question.chave, $(this).val(), currentResponses);
            });

            $questionDiv.append($inputElement);
            if (currentResponses[question.chave]) {
                renderNextQuestion(questionKey, currentResponses[question.chave], $container, currentResponses, cardIndex);
            }
        }

        function handleDataTransitoValidation(dataTransitoKey, selectedDate, currentResponses) {
            if (dataTransitoKey !== 'data_de_transito') return;
            const cincoAnosAtras = new Date();
            cincoAnosAtras.setFullYear(cincoAnosAtras.getFullYear() - 5);
            const dataSelecionada = new Date(selectedDate);
            const $cumprimentoField = $('select[name="cumprimento_de_sentenca"]');
            const $iniciarCsOption = $cumprimentoField.find('option[value="INICIAR CS"]');
            $('.data-transito-aviso').remove();
            if (selectedDate && dataSelecionada < cincoAnosAtras) {
                $iniciarCsOption.prop('disabled', true).attr('title', 'Prescrição: Trânsito há mais de 5 anos.');
                $cumprimentoField.after('<p class="errornote data-transito-aviso">⚠️ Prescrição: Trânsito há mais de 5 anos.</p>');
                if ($cumprimentoField.val() === 'INICIAR CS') {
                    $cumprimentoField.val('');
                    currentResponses['cumprimento_de_sentenca'] = '';
                    saveResponses();
                }
            } else {
                $iniciarCsOption.prop('disabled', false).removeAttr('title');
            }
        }

        function renderNextQuestion(currentQuestionKey, selectedResponseText, $parentContainer, currentResponses, cardIndex = null) {
            const $targetContainer = cardIndex !== null ? $parentContainer : $dynamicQuestionsContainer;
            $targetContainer.find('.form-row').each(function() {
                const qKey = $(this).data('question-key');
                if (qKey && treeConfig[qKey] && treeConfig[currentQuestionKey] && treeConfig[qKey].ordem > treeConfig[currentQuestionKey].ordem) {
                    delete currentResponses[qKey];
                    $(this).remove();
                }
            });

            if (currentQuestionKey === 'julgamento' && selectedResponseText !== 'SEM MÉRITO') {
                $dynamicQuestionsContainer.find('[data-question-key="bloco_reproposicao_wrapper"]').remove();
                delete currentResponses['repropor_monitoria'];
                delete currentResponses['lote'];
                delete currentResponses['observacoes_reproposicao'];
            }

            const currentQuestion = treeConfig[currentQuestionKey];
            if (!currentQuestion) return;
            let nextQuestionKey = null;
            if (currentQuestion.tipo_campo === 'OPCOES') {
                const selectedOption = currentQuestion.opcoes.find(opt => opt.texto_resposta === selectedResponseText);
                if (selectedOption) nextQuestionKey = selectedOption.proxima_questao_chave;
            } else if (currentQuestion.proxima_questao_chave) {
                nextQuestionKey = currentQuestion.proxima_questao_chave;
            }
            if (nextQuestionKey) {
                renderQuestion(nextQuestionKey, $targetContainer, currentResponses, cardIndex);
            } else {
                saveResponses();
            }
            if (cardIndex === null && ['transitado', 'procedencia'].includes(currentQuestionKey)) {
                handleDataTransitoValidation('data_de_transito', currentResponses['data_de_transito'], currentResponses);
            }
        }

        function isValidCnj(cnj) { return /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(cnj); }

        function renderProcessoVinculadoEditor(questionKey, $container) {
            const $editorDiv = $('<div class="form-row field-' + questionKey + '" data-question-key="' + questionKey + '"></div>');
            $editorDiv.append('<h3>' + treeConfig[questionKey].texto_pergunta + '</h3>');
            
            const $cardsContainer = $('<div class="processo-vinculado-cards-container"></div>');
            $editorDiv.append($cardsContainer);

            const $addCardButton = $('<button type="button" class="button add-processo-card">Adicionar Processo</button>');
            $editorDiv.append($addCardButton);

            $container.append($editorDiv);

            if (!Array.isArray(userResponses[questionKey])) {
                userResponses[questionKey] = [];
            }

            userResponses[questionKey].forEach((cardData, index) => {
                renderProcessoVinculadoCard(questionKey, cardData, $cardsContainer, index);
            });

            $addCardButton.on('click', function() {
                const newCardData = { cnj: '', contratos: [], tipo_de_acao_respostas: {} };
                userResponses[questionKey].push(newCardData);
                renderProcessoVinculadoCard(questionKey, newCardData, $cardsContainer, userResponses[questionKey].length - 1);
                saveResponses();
            });
        }

        function renderProcessoVinculadoCard(parentQuestionKey, cardData, $cardsContainer, cardIndex) {
            const $card = $('<div class="processo-vinculado-card" data-card-index="' + cardIndex + '"></div>');
            $card.append('<h4>Processo Vinculado #' + (cardIndex + 1) + '</h4>');
            
            const $cnjDiv = $('<div class="form-row cnj-field"></div>');
            $cnjDiv.append('<label for="id_' + parentQuestionKey + '_' + cardIndex + '_cnj">Nº do Processo CNJ:</label>');
            const $cnjInput = $('<input type="text" id="id_' + parentQuestionKey + '_' + cardIndex + '_cnj" value="' + cardData.cnj + '">');
            $cnjDiv.append($cnjInput);
            const $cnjError = $('<p class="errornote cnj-error"></p>').hide();
            $cnjDiv.append($cnjError);
            $card.append($cnjDiv);

            $cnjInput.on('change', function() {
                cardData.cnj = $(this).val();
                if (cardData.cnj && !isValidCnj(cardData.cnj)) {
                    $cnjInput.addClass('vDateField');
                    $cnjError.text('Formato CNJ inválido. Ex: 0000000-00.0000.8.19.0001').show();
                } else {
                    $cnjInput.removeClass('vDateField');
                    $cnjError.hide();
                }
                saveResponses();
            });

            const $contratosDiv = $('<div class="form-row contratos-field"></div>');
            $contratosDiv.append('<label>Contratos Vinculados:</label>');
            const $contratosCheckboxesContainer = $('<div class="contratos-checkboxes"></div>');
            
            const contratosStatus = userResponses.contratos_status || {};
            console.log("DEBUG RENDER CARD: userResponses.contratos_status:", JSON.stringify(contratosStatus));
            console.log("DEBUG RENDER CARD: allAvailableContratos:", JSON.stringify(allAvailableContratos));

            const selectedContratos = allAvailableContratos.filter(contrato => {
                // Garante que a chave seja string, assim como é salva pelo info_card_manager
                return contratosStatus[String(contrato.id)] && contratosStatus[String(contrato.id)].selecionado;
            });
            console.log("DEBUG RENDER CARD: selectedContratos (após filtro):", JSON.stringify(selectedContratos), "Count:", selectedContratos.length);

            if (selectedContratos.length > 0) {
                selectedContratos.forEach(function(contrato) {
                    const isChecked = cardData.contratos.includes(contrato.id);
                    $contratosCheckboxesContainer.append(`<input type="checkbox" id="id_card_${cardIndex}_contrato_${contrato.id}" value="${contrato.id}" ${isChecked ? 'checked' : ''}><label for="id_card_${cardIndex}_contrato_${contrato.id}">${contrato.numero_contrato}</label><br>`);
                });
            } else {
                $contratosCheckboxesContainer.append('<p>Nenhum contrato selecionado no card de dados básicos.</p>');
            }
            $contratosDiv.append($contratosCheckboxesContainer);
            $card.append($contratosDiv);

            $contratosCheckboxesContainer.on('change', 'input[type="checkbox"]', function() {
                const contratoId = parseInt($(this).val());
                if ($(this).is(':checked')) {
                    if (!cardData.contratos.includes(contratoId)) cardData.contratos.push(contratoId);
                } else {
                    cardData.contratos = cardData.contratos.filter(id => id !== contratoId);
                }
                saveResponses();
            });

            const $subTreeContainer = $('<div class="processo-vinculado-sub-tree"></div>');
            $card.append($subTreeContainer);

            renderQuestion('tipo_de_acao', $subTreeContainer, cardData.tipo_de_acao_respostas, cardIndex);

            const $removeButton = $('<button type="button" class="button remove-processo-card">Remover</button>');
            $card.append($removeButton);

            $removeButton.on('click', function() {
                if (confirm('Tem certeza que deseja remover este processo vinculado?')) {
                    userResponses[parentQuestionKey].splice(cardIndex, 1);
                    saveResponses();
                    $cardsContainer.empty();
                    userResponses[parentQuestionKey].forEach((data, index) => {
                        renderProcessoVinculadoCard(parentQuestionKey, data, $cardsContainer, index);
                    });
                }
            });

            $cardsContainer.append($card);
        }

        $(document).on('contratoStatusChange', function() {
            loadExistingResponses();
            loadContratosFromDOM(); // RECARREGAR contratos do DOM quando o status mudar
            renderDecisionTree();
            displayFormattedResponses(); // Atualiza a exibição formatada após mudanças nos contratos
        });

        if ($inlineGroup.length) {
            loadExistingResponses();
            loadContratosFromDOM(); // Chamar aqui para popular allAvailableContratos do DOM
            fetchDecisionTreeConfig();

            // Esconder o título do fieldset do inline, que é o __str__ do AnaliseProcesso
            // O Django Admin renderiza um h3 para cada item inline com o __str__ do objeto
            // Ocultar o h3 que está diretamente dentro de um div com a classe 'inline-related'.
            $inlineGroup.find('.inline-related h3').hide();
        }
    });
})(django.jQuery);
