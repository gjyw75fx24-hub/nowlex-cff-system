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
        
        $responseField.closest('.form-row').hide();
        const $dynamicQuestionsContainer = $('<div class="dynamic-questions-container"></div>');
        $inlineGroup.append($dynamicQuestionsContainer);

        let allAvailableContratos = [];

        function loadExistingResponses() {
            try {
                const data = $responseField.val();
                userResponses = data ? JSON.parse(data) : {};
                if (!userResponses.contratos_status) {
                    userResponses.contratos_status = {};
                }
                console.log("DEBUG A_P_A: loadExistingResponses - userResponses APÓS carregar:", JSON.stringify(userResponses));
            } catch (e) {
                console.error("DEBUG A_P_A: Erro ao parsear respostas existentes:", e);
                userResponses = { contratos_status: {} };
            }
        }

        function saveResponses() {
            console.log("DEBUG A_P_A: saveResponses - userResponses ANTES de salvar:", JSON.stringify(userResponses));
            $responseField.val(JSON.stringify(userResponses, null, 2));
            console.log("DEBUG A_P_A: saveResponses - TextArea contém:", $responseField.val());
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
        });

        if ($inlineGroup.length) {
            loadExistingResponses();
            loadContratosFromDOM(); // Chamar aqui para popular allAvailableContratos do DOM
            fetchDecisionTreeConfig();
        }
    });
})(django.jQuery);
