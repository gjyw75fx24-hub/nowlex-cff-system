(function($) {
    $(document).ready(function() {
        console.log("analise_processo_arvore.js carregado.");

        const decisionTreeApiUrl = '/api/decision-tree/'; // URL da sua API

        let treeConfig = {}; // Armazenará a configuração completa da árvore
        let userResponses = {}; // Armazenará as respostas do usuário
        let firstQuestionKey = null; // Chave da primeira questão configurada
        const currentProcessoId = $('input[name="object_id"]').val() || null;

        // Seletor corrigido para corresponder à classe definida em admin.py
        const $inlineGroup = $('.analise-procedural-group');
        
        if (!$inlineGroup.length) {
            // Este erro agora só aparecerá se a configuração do admin.py for removida.
            console.error("O elemento '.analise-procedural-group' não foi encontrado no DOM.");
            return;
        }

        const $responseField = $inlineGroup.find('textarea[name$="-respostas"]');
        
        // Esconde o campo JSON original e adiciona o nosso container dinâmico
        $responseField.closest('.form-row').hide();
        const $dynamicQuestionsContainer = $('<div class="dynamic-questions-container"></div>');
        $inlineGroup.append($dynamicQuestionsContainer);

        let allAvailableContratos = [];

        function loadExistingResponses() {
            try {
                const existingData = $responseField.val();
                if(existingData){
                    userResponses = JSON.parse(existingData);
                } else {
                    userResponses = {};
                }
            } catch (e) {
                console.error("Erro ao parsear respostas existentes:", e);
                userResponses = {};
            }
        }

        function saveResponses() {
            $responseField.val(JSON.stringify(userResponses, null, 2));
        }

        function fetchContratosForProcesso(processoId) {
            if (!processoId) {
                return $.Deferred().resolve({ contratos: [] }).promise();
            }
            const contratosApiUrl = `/api/processo/${processoId}/contratos/`;
            return $.ajax({
                url: contratosApiUrl,
                method: 'GET',
                dataType: 'json',
                success: function(data) {
                    if (data.status === 'success') {
                        allAvailableContratos = data.contratos;
                    } else {
                        console.error("Erro ao carregar contratos:", data.message);
                    }
                },
                error: function(xhr, status, error) {
                    console.error("Erro AJAX ao carregar contratos:", status, error);
                }
            });
        }

        function fetchDecisionTreeConfig() {
            $.ajax({
                url: decisionTreeApiUrl,
                method: 'GET',
                dataType: 'json',
                success: function(data) {
                    if (data.status === 'success') {
                        treeConfig = data.tree_data;
                        firstQuestionKey = data.primeira_questao_chave;
                        
                        if (currentProcessoId) {
                            fetchContratosForProcesso(currentProcessoId).done(renderDecisionTree);
                        } else {
                            renderDecisionTree();
                        }
                    } else {
                        console.error("Erro ao carregar configuração da árvore:", data.message);
                        $dynamicQuestionsContainer.html('<p class="errornote">' + data.message + '</p>');
                    }
                },
                error: function(xhr, status, error) {
                    console.error("Erro AJAX ao carregar configuração da árvore:", status, error);
                    $dynamicQuestionsContainer.html('<p class="errornote">Erro ao carregar a árvore de decisão. Verifique o console para detalhes.</p>');
                }
            });
        }

        function renderDecisionTree() {
            $dynamicQuestionsContainer.empty();
            if (!firstQuestionKey || !treeConfig[firstQuestionKey]) {
                $dynamicQuestionsContainer.html('<p>Configuração da árvore de decisão incompleta ou questão inicial não encontrada.</p>');
                return;
            }
            renderQuestion(firstQuestionKey, $dynamicQuestionsContainer, userResponses);
        }

        function renderQuestion(questionKey, $container, currentResponses, cardIndex = null) {
            const question = treeConfig[questionKey];
            if (!question) {
                console.warn("Questão não encontrada na configuração:", questionKey);
                return;
            }

            let $questionDiv;
            let $inputElement;

            const fieldId = (cardIndex !== null) ? `id_card_${cardIndex}_${question.chave}` : `id_${question.chave}`;
            const fieldName = (cardIndex !== null) ? `card_${cardIndex}_${question.chave}` : question.chave;

            if (question.tipo_campo === 'BLOCO_INDICADOR') {
                $questionDiv = $('<div class="form-row field-' + question.chave + ' bloco-reproposicao" data-question-key="' + question.chave + '"></div>');
                $questionDiv.append('<h3>' + question.texto_pergunta + '</h3>');
                $container.append($questionDiv);
                
                if (question.proxima_questao_chave) {
                    renderQuestion(question.proxima_questao_chave, $questionDiv, currentResponses, cardIndex);
                }
                return;
            } else if (question.tipo_campo === 'PROCESSO_VINCULADO') {
                renderProcessoVinculadoEditor(question.chave, $container);
                return;
            } else {
                $questionDiv = $('<div class="form-row field-' + question.chave + '" data-question-key="' + question.chave + '"></div>');
                $questionDiv.append('<label for="' + fieldId + '">' + question.texto_pergunta + ':</label>');
                $container.append($questionDiv);
            }
            
            switch (question.tipo_campo) {
                case 'OPCOES':
                    $inputElement = $('<select id="' + fieldId + '" name="' + fieldName + '">');
                    $inputElement.append('<option value="">---</option>');
                    question.opcoes.forEach(function(opcao) {
                        const isSelected = (currentResponses[question.chave] === opcao.texto_resposta);
                        $inputElement.append('<option value="' + opcao.texto_resposta + '"' + (isSelected ? ' selected' : '') + '>' + opcao.texto_resposta + '</option>');
                    });
                    $inputElement.on('change', function() {
                        currentResponses[question.chave] = $(this).val();
                        saveResponses();
                        renderNextQuestion(questionKey, $(this).val(), $container, currentResponses, cardIndex);
                    });
                    break;
                case 'TEXTO':
                    $inputElement = $('<input type="text" id="' + fieldId + '" name="' + fieldName + '">');
                    $inputElement.val(currentResponses[question.chave] || '');
                    $inputElement.on('change', function() {
                        currentResponses[question.chave] = $(this).val();
                        saveResponses();
                        renderNextQuestion(questionKey, $(this).val(), $container, currentResponses, cardIndex);
                    });
                    break;
                case 'TEXTO_LONGO':
                    $inputElement = $('<textarea rows="4" id="' + fieldId + '" name="' + fieldName + '"></textarea>');
                    $inputElement.val(currentResponses[question.chave] || '');
                    $inputElement.on('change', function() {
                        currentResponses[question.chave] = $(this).val();
                        saveResponses();
                        renderNextQuestion(questionKey, $(this).val(), $container, currentResponses, cardIndex);
                    });
                    break;
                case 'DATA':
                    $inputElement = $('<input type="date" id="' + fieldId + '" name="' + fieldName + '">');
                    $inputElement.val(currentResponses[question.chave] || '');
                    $inputElement.on('change', function() {
                        currentResponses[question.chave] = $(this).val();
                        saveResponses();
                        renderNextQuestion(questionKey, $(this).val(), $container, currentResponses, cardIndex);
                        if (cardIndex === null) {
                             handleDataTransitoValidation(question.chave, $(this).val(), currentResponses);
                        }
                    });
                    break;
                default:
                    $inputElement = $('<p>Tipo de campo desconhecido: ' + question.tipo_campo + '</p>');
            }
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
            const $cumprimentoSentencaField = $('select[name="cumprimento_de_sentenca"]');
            const $iniciarCsOption = $cumprimentoSentencaField.find('option[value="INICIAR CS"]');
            
            $('.data-transito-aviso').remove();

            if (selectedDate && dataSelecionada < cincoAnosAtras) {
                $iniciarCsOption.prop('disabled', true).attr('title', 'Prescrição: Trânsito há mais de 5 anos. CS não pode ser iniciado.');
                $cumprimentoSentencaField.after('<p class="errornote data-transito-aviso">⚠️ Prescrição: Trânsito há mais de 5 anos. CS não pode ser iniciado.</p>');
                if ($cumprimentoSentencaField.val() === 'INICIAR CS') {
                    $cumprimentoSentencaField.val('');
                    currentResponses['cumprimento_de_sentenca'] = '';
                    saveResponses();
                }
            } else {
                $iniciarCsOption.prop('disabled', false).removeAttr('title');
            }
        }

        function renderNextQuestion(currentQuestionKey, selectedResponseText, $parentContainer, currentResponses, cardIndex = null) {
            const $targetContainer = (cardIndex !== null) ? $parentContainer : $dynamicQuestionsContainer;

            $targetContainer.find('.form-row').each(function() {
                const questionElementKey = $(this).data('question-key');
                if (questionElementKey) {
                    const questionOrder = treeConfig[questionElementKey] ? treeConfig[questionElementKey].ordem : Infinity;
                    const currentQuestionOrder = treeConfig[currentQuestionKey] ? treeConfig[currentQuestionKey].ordem : -Infinity;

                    if (questionElementKey !== currentQuestionKey && questionOrder > currentQuestionOrder) {
                        delete currentResponses[questionElementKey];
                        $(this).remove();
                    }
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
                if (selectedOption) {
                    nextQuestionKey = selectedOption.proxima_questao_chave;
                }
            } else if (currentQuestion.proxima_questao_chave) {
                 nextQuestionKey = currentQuestion.proxima_questao_chave;
            }
            
            if (nextQuestionKey) {
                renderQuestion(nextQuestionKey, $targetContainer, currentResponses, cardIndex);
            } else {
                saveResponses();
            }
            
            if (cardIndex === null && (currentQuestionKey === 'transitado' || currentQuestionKey === 'procedencia')) {
                handleDataTransitoValidation('data_de_transito', currentResponses['data_de_transito'], currentResponses);
            }
        }

        function isValidCnj(cnj) {
            const cnjRegex = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
            return cnjRegex.test(cnj);
        }

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
            
            if (allAvailableContratos.length > 0) {
                allAvailableContratos.forEach(function(contrato) {
                    const isChecked = cardData.contratos.includes(contrato.id);
                    $contratosCheckboxesContainer.append(`<input type="checkbox" id="id_card_${cardIndex}_contrato_${contrato.id}" value="${contrato.id}" ${isChecked ? 'checked' : ''}><label for="id_card_${cardIndex}_contrato_${contrato.id}">${contrato.numero_contrato}</label><br>`);
                });
            } else {
                $contratosCheckboxesContainer.append('<p>Nenhum contrato disponível para o processo atual.</p>');
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

        if ($inlineGroup.length) {
            loadExistingResponses();
            fetchDecisionTreeConfig();
        }
    });
})(django.jQuery);
