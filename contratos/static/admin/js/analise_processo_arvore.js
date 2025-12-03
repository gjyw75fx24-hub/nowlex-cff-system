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

        const $gerarMonitoriaBtn = $('#id_gerar_monitoria_btn');

        function updateGenerateButtonState() {
            if ($gerarMonitoriaBtn.length) {
                if (userResponses.contratos_para_monitoria && userResponses.contratos_para_monitoria.length > 0) {
                    $gerarMonitoriaBtn.prop('disabled', false);
                } else {
                    $gerarMonitoriaBtn.prop('disabled', true);
                }
            }
        }

        function updateContractStars() {
            $('.monitoria-star').remove(); // Limpa estrelas existentes
            let contratosParaMonitoria = userResponses.contratos_para_monitoria || [];

            // Filtrar contratosParaMonitoria para remover aqueles que estão prescritos ou quitados
            contratosParaMonitoria = contratosParaMonitoria.filter(function(contratoId) {
                const contratoInfo = allAvailableContratos.find(c => String(c.id) === String(contratoId));
                return contratoInfo && !contratoInfo.is_prescrito && !contratoInfo.is_quitado;
            });
            userResponses.contratos_para_monitoria = contratosParaMonitoria; // Atualiza o estado

            contratosParaMonitoria.forEach(function(contratoId) {
                const $wrapper = $(`.contrato-item-wrapper[data-contrato-id="${contratoId}"]`);
                if ($wrapper.length) {
                    $wrapper.prepend('<span class="monitoria-star" title="Sugerido para Monitória">⭐</span>');
                }
            });
        }

        function loadExistingResponses() {
            try {
                const data = $responseField.val();
                userResponses = data ? JSON.parse(data) : {};
                if (!userResponses.contratos_status) userResponses.contratos_status = {};
                if (!userResponses.contratos_para_monitoria) userResponses.contratos_para_monitoria = [];
                
                console.log("DEBUG A_P_A: loadExistingResponses - userResponses APÓS carregar:", JSON.stringify(userResponses));
                displayFormattedResponses();
                updateContractStars(); 
                updateGenerateButtonState(); // Atualiza o estado do botão
            } catch (e) {
                console.error("DEBUG A_P_A: Erro ao parsear respostas existentes:", e);
                userResponses = { contratos_status: {}, contratos_para_monitoria: [] };
                displayFormattedResponses();
            }
        }

        function saveResponses() {
            console.log("DEBUG A_P_A: saveResponses - userResponses ANTES de salvar:", JSON.stringify(userResponses));
            $responseField.val(JSON.stringify(userResponses, null, 2));
            console.log("DEBUG A_P_A: saveResponses - TextArea contém:", $responseField.val());
            displayFormattedResponses();
            updateContractStars();
            updateGenerateButtonState(); // Atualiza o estado do botão
        }

        function displayFormattedResponses() {
            $formattedResponsesContainer.empty(); // Limpa o container antes de preencher
            $formattedResponsesContainer.append('<h3>Respostas da Análise</h3>'); // Adiciona o título de volta

            if (Object.keys(userResponses).length === 0 || (!userResponses.contratos_status && !userResponses.judicializado_pela_massa && !userResponses.processos_vinculados && Object.keys(userResponses).length <= 1)) {
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
            
            const $toggleBtn = $('<button type="button" class="analise-toggle-btn"> + </button>');
            $cardHeader.append($toggleBtn);
            const $editBtn = $('<button type="button" class="analise-edit-btn">Editar</button>');
            $cardHeader.append($editBtn);
            $analiseCard.append($cardHeader);

            // Corpo do card principal (excluindo processos vinculados)
            const $ulDetalhes = $('<ul></ul>');
            for (const key in userResponses) {
                if (userResponses.hasOwnProperty(key) && key !== 'processos_vinculados' && key !== 'contratos_para_monitoria') {
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
                                            const numeroContrato = $wrapper.find('.contrato-numero').text().trim().split('\n')[0].trim();
                                            const isPrescrito = $wrapper.data('is-prescrito') === true;
                                            const isQuitado = $wrapper.data('is-quitado') === true; // Novo: Lendo o status de quitado
                                            
                                            if (contratoId && numeroContrato) {
                                                allAvailableContratos.push({ id: contratoId, numero_contrato: numeroContrato, is_prescrito: isPrescrito, is_quitado: isQuitado });
                                            }
                                        });
                                        console.log("DEBUG A_P_A: Contratos carregados do DOM:", JSON.stringify(allAvailableContratos));
                                    }                    function fetchDecisionTreeConfig() {
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
                case 'CONTRATOS_MONITORIA':
                    renderMonitoriaContractSelector(question, $questionDiv, currentResponses);
                    return; // Retorna para evitar o append padrão e o listener de change
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
                    if (qKey === 'selecionar_contratos_monitoria') { // Limpa a seleção de monitória se a pergunta for removida
                        currentResponses.contratos_para_monitoria = [];
                    }
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
            // ... (código existente sem alterações)
        }

        function renderMonitoriaContractSelector(question, $container, currentResponses) {
            const $selectorDiv = $('<div class="form-row field-contratos-monitoria"></div>');
            $selectorDiv.append(`<label>${question.texto_pergunta}</label>`);
            const selectedInInfoCard = allAvailableContratos.filter(c => userResponses.contratos_status[c.id] && userResponses.contratos_status[c.id].selecionado);
            const selectedForMonitoria = currentResponses.contratos_para_monitoria || [];

            if (selectedInInfoCard.length === 0) {
                $selectorDiv.append('<p>Nenhum contrato selecionado nos "Dados Básicos".</p>');
                $container.append($selectorDiv);
                return;
            }

            selectedInInfoCard.forEach(function(contrato) {
                const isChecked = selectedForMonitoria.includes(contrato.id);
                const isDisabled = contrato.is_prescrito || contrato.is_quitado; // Desabilita se prescrito OU quitado
                
                let label = `${contrato.numero_contrato}`;
                if (contrato.is_prescrito) {
                    label += ' <span style="color: #c62828; font-style: italic;">(Prescrito)</span>';
                } else if (contrato.is_quitado) { // Adiciona notificação para quitado
                    label += ' <span style="color: #007bff; font-style: italic;">(Quitado)</span>';
                }

                const $checkboxWrapper = $(`<div><input type="checkbox" id="monitoria_contrato_${contrato.id}" value="${contrato.id}" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}> <label for="monitoria_contrato_${contrato.id}">${label}</label></div>`);
                $selectorDiv.append($checkboxWrapper);
            });

            $selectorDiv.on('change', 'input[type="checkbox"]', function() {
                const contratoId = parseInt($(this).val());
                const isChecked = $(this).is(':checked');
                let selection = currentResponses.contratos_para_monitoria || [];
                
                if (isChecked && !selection.includes(contratoId)) {
                    selection.push(contratoId);
                } else if (!isChecked) {
                    selection = selection.filter(id => id !== contratoId);
                }
                currentResponses.contratos_para_monitoria = selection;
                saveResponses();
            });
            
            $container.append($selectorDiv);
        }

        $(document).on('contratoStatusChange', function() {
            loadContratosFromDOM(); // RECARREGAR contratos do DOM quando o status mudar
            renderDecisionTree();
            updateContractStars();
        });

        if ($inlineGroup.length) {
            loadExistingResponses();
            loadContratosFromDOM(); // Chamar aqui para popular allAvailableContratos do DOM
            fetchDecisionTreeConfig();

            // Esconder o título do fieldset do inline, que é o __str__ do AnaliseProcesso
            // O Django Admin renderiza um h3 para cada item inline com o __str__ do objeto
            // Ocultar o h3 que está diretamente dentro de um div com a classe 'inline-related'.
            $inlineGroup.find('.inline-related h3').hide();

            // Lógica para o botão "Gerar Petição Monitória"
            $('#id_gerar_monitoria_btn').on('click', function(e) {
                e.preventDefault();
                
                if (!currentProcessoId) {
                    alert('Erro: ID do processo não encontrado para gerar a petição.');
                    return;
                }
                if (!userResponses.contratos_para_monitoria || userResponses.contratos_para_monitoria.length === 0) {
                    alert('Selecione pelo menos um contrato para a monitória antes de gerar a petição.');
                    return;
                }

                const csrftoken = $('input[name="csrfmiddlewaretoken"]').val();
                const url = `/contratos/processo/${currentProcessoId}/gerar-monitoria/`;

                $.ajax({
                    url: url,
                    method: 'POST',
                    headers: { 'X-CSRFToken': csrftoken },
                    data: { processo_id: currentProcessoId }, // Pode ser necessário enviar outros dados, como os IDs dos contratos
                    xhrFields: { responseType: 'blob' }, // Para download de arquivos
                    beforeSend: function() {
                        // Opcional: mostrar um spinner de carregamento ou desabilitar o botão
                        $('#id_gerar_monitoria_btn').prop('disabled', true).text('Gerando...');
                    },
                    success: function(blob, status, xhr) {
                        const filename = xhr.getResponseHeader('Content-Disposition').split('filename=')[1].replace(/"/g, '');
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        alert('Petição gerada com sucesso e download iniciado!');
                    },
                    error: function(xhr, status, error) {
                        let errorMessage = 'Erro ao gerar petição. Tente novamente.';
                        if (xhr.responseJSON && xhr.responseJSON.message) {
                            errorMessage = xhr.responseJSON.message;
                        } else if (xhr.responseText) {
                            // Tenta ler o erro como texto (pode ser o caso para HttpResponse)
                            errorMessage = xhr.responseText;
                        }
                        alert(errorMessage);
                        console.error('Erro na geração da petição:', status, error, xhr);
                    },
                    complete: function() {
                        // Opcional: esconder spinner e reabilitar botão
                        $('#id_gerar_monitoria_btn').prop('disabled', false).text('Gerar Petição Monitória');
                    }
                });
            });
        }
    });
})(django.jQuery);
