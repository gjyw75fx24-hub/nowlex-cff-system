(function($) {
    $(document).ready(function() {
        console.log("analise_processo_arvore.js carregado.");

        /**
         * =========================================================
         * BLOCO DE DOCUMENTAÇÃO JURÍDICA — CUMPRIMENTO DE SENTENÇA
         * =========================================================
         *
         * Regra de negócio adotada:
         *
         * - Campo "DATA DE TRÂNSITO" = trânsito em julgado da sentença de mérito.
         * - Se trânsito há MENOS de 5 anos → pode "INICIAR CS" (cumprimento de sentença).
         * - Se trânsito há 5 anos OU MAIS → em regra, pretensão executória prescrita:
         *      • desabilita opção "INICIAR CS";
         *      • exibe aviso de prescrição;
         *      • mostra nó textual "Análise de Prescrição".
         */

        const decisionTreeApiUrl = '/api/decision-tree/';

        let treeConfig = {};
        let userResponses = {};
        let firstQuestionKey = null;
        const currentProcessoId = (function resolveProcessoId() {
            const hiddenId = $('input[name="object_id"]').val();
            if (hiddenId) return hiddenId;
            const pathMatch = window.location.pathname.match(/processojudicial\/(\\d+)\\//i);
            if (pathMatch && pathMatch[1]) return pathMatch[1];
            const qsId = new URLSearchParams(window.location.search).get('object_id');
            return qsId || null;
        })();

        const $inlineGroup = $('.analise-procedural-group');
        if (!$inlineGroup.length) {
            console.error("O elemento '.analise-procedural-group' não foi encontrado no DOM.");
            return;
        }

        const $responseField = $inlineGroup.find('textarea[name$="-respostas"]');
        $responseField.closest('.form-row').hide();

        const $dynamicQuestionsContainer = $('<div class="dynamic-questions-container"></div>');
        $inlineGroup.append($dynamicQuestionsContainer);

        const $formattedResponsesContainer = $('<div class="formatted-responses-container"></div>');
        $inlineGroup.append($formattedResponsesContainer);

        // REMOVIDO GLOBALMENTE, VAI SER CRIADO DINAMICAMENTE DENTRO DE displayFormattedResponses
        // const $gerarMonitoriaBtn = $('#id_gerar_monitoria_btn');

        let allAvailableContratos = [];

        /* =========================================================
         * Helpers gerais
         * ======================================================= */

        function ensureUserResponsesShape() {
            if (!userResponses || typeof userResponses !== 'object') {
                userResponses = {};
            }
            if (!userResponses.contratos_status || typeof userResponses.contratos_status !== 'object') {
                userResponses.contratos_status = {};
            }
            if (!Array.isArray(userResponses.contratos_para_monitoria)) {
                userResponses.contratos_para_monitoria = [];
            }
            if (!Array.isArray(userResponses.processos_vinculados)) {
                userResponses.processos_vinculados = [];
            }

            // normaliza contratos_para_monitoria como array de strings únicos
            userResponses.contratos_para_monitoria = Array.from(
                new Set(
                    userResponses.contratos_para_monitoria
                        .filter(v => v != null)
                        .map(v => String(v))
                )
            );
        }

        function updateGenerateButtonState() {
            const $gerarMonitoriaBtn = $('#id_gerar_monitoria_btn'); // Buscar dinamicamente
            if (!$gerarMonitoriaBtn.length) return; // Se o botão ainda não existe, sai

            const hasContratos =
                userResponses.contratos_para_monitoria &&
                userResponses.contratos_para_monitoria.length > 0;

            $gerarMonitoriaBtn.prop('disabled', !hasContratos);
        }

        function updateContractStars() {
            $('.monitoria-star').remove();

            let contratosParaMonitoria = userResponses.contratos_para_monitoria || [];

            contratosParaMonitoria = contratosParaMonitoria.filter(function(contratoId) {
                const contratoInfo = allAvailableContratos.find(
                    c => String(c.id) === String(contratoId)
                );
                return (
                    contratoInfo &&
                    !contratoInfo.is_prescrito &&
                    !contratoInfo.is_quitado
                );
            });

            userResponses.contratos_para_monitoria = contratosParaMonitoria;

            contratosParaMonitoria.forEach(function(contratoId) {
                const $wrapper = $(`.contrato-item-wrapper[data-contrato-id="${contratoId}"]`);
                if ($wrapper.length) {
                    $wrapper.prepend(
                        '<span class="monitoria-star" title="Sugerido para Monitória">⭐</span>'
                    );
                }
            });
        }

        function loadExistingResponses() {
            try {
                const data = $responseField.val();
                userResponses = data ? JSON.parse(data) : {};
            } catch (e) {
                console.error("DEBUG A_P_A: Erro ao parsear respostas existentes:", e);
                userResponses = {};
            }

            ensureUserResponsesShape();
            console.log(
                "DEBUG A_P_A: loadExistingResponses - userResponses APÓS carregarః",
                JSON.stringify(userResponses)
            );

            displayFormattedResponses(); // Isso vai criar o botão
            updateContractStars();
            updateGenerateButtonState(); // Isso vai atualizar o estado do botão
        }

        function saveResponses() {
            ensureUserResponsesShape();
            console.log(
                "DEBUG A_P_A: saveResponses - userResponses ANTES de salvar:",
                JSON.stringify(userResponses)
            );
            $responseField.val(JSON.stringify(userResponses, null, 2));
            console.log(
                "DEBUG A_P_A: saveResponses - TextArea contém:",
                $responseField.val()
            );
            displayFormattedResponses(); // Isso vai recriar o botão, então o listener precisa ser global
            updateContractStars();
            updateGenerateButtonState();
        }

        /* =========================================================
         * Formatação e validação de CNJ
         * ======================================================= */

        function formatCnjDigits(raw) {
            const digits = String(raw || '').replace(/\D/g, '').slice(0, 20);
            const p1 = digits.slice(0, 7);
            const p2 = digits.slice(7, 9);
            const p3 = digits.slice(9, 13);
            const p4 = digits.slice(13, 14);
            const p5 = digits.slice(14, 16);
            const p6 = digits.slice(16, 20);

            let out = '';
            if (p1) out += p1;
            if (p2) out += '-' + p2;
            if (p3) out += '.' + p3;
            if (p4) out += '.' + p4;
            if (p5) out += '.' + p5;
            if (p6) out += '.' + p6;
            return out;
        }

        function isValidCnj(cnj) {
            return /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(cnj);
        }

        /* =========================================================
         * Resumo da análise (cards)
         * ======================================================= */

        function buildDateSpan(updatedAtRaw, updatedBy) {
            if (!updatedAtRaw) return null;
            const updatedAt = new Date(updatedAtRaw);
            if (isNaN(updatedAt.getTime())) return null;

            const pad = n => ('0' + n).slice(-2);
            const formattedDate =
                pad(updatedAt.getDate()) +
                '/' +
                pad(updatedAt.getMonth() + 1) +
                '/' +
                updatedAt.getFullYear() +
                ' ' +
                pad(updatedAt.getHours()) +
                ':' +
                pad(updatedAt.getMinutes());

            const $dateSpan = $(
                `<span class="analise-save-date">Última atualização: ${formattedDate}</span>`
            );
            if (updatedBy) {
                $dateSpan.attr('title', `Atualizado por: ${updatedBy}`);
            }
            return $dateSpan;
        }

        function displayFormattedResponses() {
            $formattedResponsesContainer.empty();
            
            // Container flex para título e botão (posicionado discretamente alinhado à direita)
            const $headerContainer = $('<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;"></div>');
            $headerContainer.append('<h3>Respostas da Análise</h3>');

            // Botão Gerar Petição Monitória (criado e anexado dinamicamente)
            const $gerarMonitoriaBtnDynamic = $('<button type="button" id="id_gerar_monitoria_btn" class="button" style="background-color: #28a745; color: white; margin-left: auto;">Gerar Petição Monitória</button>');
            $headerContainer.append($gerarMonitoriaBtnDynamic);
            $formattedResponsesContainer.append($headerContainer);


            ensureUserResponsesShape();

            const temDadosRelevantes =
                userResponses.judicializado_pela_massa ||
                Object.keys(userResponses.contratos_status || {}).length > 0 ||
                (userResponses.processos_vinculados || []).length > 0;

            if (!temDadosRelevantes) {
                $formattedResponsesContainer.append(
                    '<p>Nenhuma análise registrada ainda. Preencha a árvore acima para iniciar.</p>'
                );
                return;
            }

            const $analiseCard = $('<div class="analise-summary-card"></div>');
            const $cardHeader = $('<div class="analise-summary-card-header"></div>');
            const $cardBody = $(
                '<div class="analise-summary-card-body" style="display:none;"></div>'
            );

            const contratosStatus = userResponses.contratos_status || {};

            const resumoContratos = Object.keys(contratosStatus)
                .filter(id => contratosStatus[id].selecionado)
                .map(id => {
                    const contratoInfo = allAvailableContratos.find(
                        c => String(c.id) === String(id)
                    );
                    return contratoInfo ? contratoInfo.numero_contrato : `ID ${id}`;
                });

            const contratosDisplay = resumoContratos.length > 0
                ? resumoContratos.join(', ')
                : 'Nenhum';

            const judicializadoDisplay =
                userResponses.judicializado_pela_massa || 'Não informado';

            const analiseCnjRaw = $responseField.data('analise-cnj') || 'Não Atribuído';
            const analiseCnj =
                analiseCnjRaw && analiseCnjRaw !== 'Não Atribuído'
                    ? formatCnjDigits(analiseCnjRaw)
                    : analiseCnjRaw;

            const updatedAtRaw = $responseField.data('analise-updated-at');
            const updatedBy = $responseField.data('analise-updated-by');

            const tipoAcaoPrincipal = userResponses.tipo_de_acao || 'Não informado';

            /* ---------- Card principal ---------- */

            const $analiseCardContent = $('<div class="analise-summary-card-content"></div>');
            
            const $dateSpan = buildDateSpan(updatedAtRaw, updatedBy);
            if ($dateSpan) $analiseCardContent.append($dateSpan);

            $analiseCardContent.append(
                `<span>Processo Principal: <strong>${analiseCnj}</strong></span>`
            );
            $analiseCardContent.append(
                `<span>Contratos: <strong>${contratosDisplay}</strong></span>`
            );
            $analiseCardContent.append(
                `<span>Judicializado pela Massa: <strong>${judicializadoDisplay}</strong></span>`
            );
            $analiseCardContent.append(
                `<span>Tipo de Ação: <strong>${tipoAcaoPrincipal}</strong></span>`
            );

            const $toggleBtn = $('<button type="button" class="analise-toggle-btn"> + </button>');
            const $editBtn = $('<button type="button" class="analise-edit-btn">Editar</button>');

            $cardHeader.append($analiseCardContent);
            $cardHeader.append($toggleBtn);
            $cardHeader.append($editBtn);

            $analiseCard.append($cardHeader);

            const $ulDetalhes = $('<ul></ul>');

            for (const key in userResponses) {
                if (!Object.prototype.hasOwnProperty.call(userResponses, key)) continue;
                if (['processos_vinculados', 'contratos_para_monitoria'].includes(key)) continue;

                if (key === 'contratos_status') {
                    const $liContratos = $(
                        '<li><strong>Contratos Selecionados:</strong><ul></ul></li>'
                    );
                    const $ulContratos = $liContratos.find('ul');

                    let hasSelectedContract = false;
                    for (const contratoId in contratosStatus) {
                        if (!contratosStatus[contratoId].selecionado) continue;
                        hasSelectedContract = true;

                        const contratoInfo = allAvailableContratos.find(
                            c => String(c.id) === String(contratoId)
                        );
                        const nomeContrato = contratoInfo
                            ? contratoInfo.numero_contrato
                            : `ID ${contratoId}`;

                        $ulContratos.append(
                            `<li>${nomeContrato} (Quitado: ${contratosStatus[contratoId].quitado ? 'Sim' : 'Não'})</li>`
                        );
                    }

                    if (!hasSelectedContract) {
                        $ulContratos.append('<li>Nenhum contrato selecionado.</li>');
                    }
                    $ulDetalhes.append($liContratos);
                } else {
                    $ulDetalhes.append(`<li><strong>${key}:</strong> ${userResponses[key]}</li>`);
                }
            }

            $cardBody.append($ulDetalhes);
            $analiseCard.append($cardBody);
            $formattedResponsesContainer.append($analiseCard);

            $toggleBtn.on('click', function() {
                $cardBody.slideToggle(200, function() {
                    $toggleBtn.text($cardBody.is(':visible') ? ' - ' : ' + ');
                });
            });

            $editBtn.on('click', function() {
                $('html, body').animate(
                    { scrollTop: $dynamicQuestionsContainer.offset().top - 50 },
                    300
                );
            });

            /* ---------- Cards de Processos CNJ vinculados ---------- */

            const processosVinculados = userResponses.processos_vinculados || [];
            if (Array.isArray(processosVinculados) && processosVinculados.length > 0) {
                processosVinculados.forEach((processo) => {
                    const $cardVinculado = $(
                        '<div class="analise-summary-card"></div>'
                    );
                    const $headerVinculado = $(
                        '<div class="analise-summary-card-header"></div>'
                    );
                    const $bodyVinculado = $(
                        '<div class="analise-summary-card-body" style="display:none;"></div>'
                    );
                    const cnjVinculado = processo.cnj || 'Não informado';

                    $headerVinculado.append(
                        `<span>Processo CNJ: <strong>${cnjVinculado}</strong></span>`
                    );
                    const $toggleBtnVinculado = $(
                        '<button type="button" class="analise-toggle-btn"> + </button>'
                    );
                    $headerVinculado.append($toggleBtnVinculado);

                    $cardVinculado.append($headerVinculado);

                    const $ulDetalhesVinculado = $('<ul></ul>');

                    if (Array.isArray(processo.contratos) && processo.contratos.length > 0) {
                        const nomesContratos = processo.contratos
                            .map(cId => {
                                const cInfo = allAvailableContratos.find(
                                    c => String(c.id) === String(cId)
                                );
                                return cInfo ? cInfo.numero_contrato : `ID ${cId}`;
                            })
                            .join(', ');
                        $ulDetalhesVinculado.append(
                            `<li><strong>Contratos Vinculados:</strong> ${nomesContratos}</li>`
                        );
                    }

                    if (processo.tipo_de_acao_respostas &&
                        Object.keys(processo.tipo_de_acao_respostas).length > 0) {
                        const $liAcao = $('<li><strong>Respostas da Ação:</strong><ul></ul></li>');
                        const $ulAcao = $liAcao.find('ul');
                        for (const subKey in processo.tipo_de_acao_respostas) {
                            if (!Object.prototype.hasOwnProperty.call(processo.tipo_de_acao_respostas, subKey)) continue;
                            $ulAcao.append(
                                `<li>${subKey}: ${processo.tipo_de_acao_respostas[subKey]}</li>`
                            );
                        }
                        $ulDetalhesVinculado.append($liAcao);
                    }

                    $bodyVinculado.append($ulDetalhesVinculado);
                    $cardVinculado.append($bodyVinculado);
                    $formattedResponsesContainer.append($cardVinculado);

                    $toggleBtnVinculado.on('click', function() {
                        $bodyVinculado.slideToggle(200, function() {
                            $toggleBtnVinculado.text(
                                $bodyVinculado.is(':visible') ? ' - ' : ' + '
                            );
                        });
                    });
                });
            }
        }

        /* =========================================================
         * Utilidades de contratos
         * ======================================================= */

        function areAnySelectedContractsQuitado() {
            const status = userResponses.contratos_status || {};
            return Object.values(status).some(
                st => st && st.selecionado && st.quitado
            );
        }

        function loadContratosFromDOM() {
            allAvailableContratos = [];
            $('.contrato-item-wrapper').each(function() {
                const $wrapper = $(this);
                const rawId = $wrapper.data('contrato-id');
                if (!rawId) return;

                const contratoId = String(rawId);
                const numeroContrato = $wrapper
                    .find('.contrato-numero')
                    .text()
                    .trim()
                    .split('\n')[0]
                    .trim();

                let isPrescrito = !!$wrapper.data('is-prescrito');
                let isQuitado = !!$wrapper.data('is-quitado');

                // sobrescreve quitado pelo JSON
                const statusMap = userResponses.contratos_status || {};
                const st = statusMap[contratoId];
                if (st && typeof st.quitado === 'boolean') {
                    isQuitado = st.quitado;
                }

                if (contratoId && numeroContrato) {
                    allAvailableContratos.push({
                        id: contratoId,
                        numero_contrato: numeroContrato,
                        is_prescrito: isPrescrito,
                        is_quitado: isQuitado
                    });
                }
            });
            console.log(
                "DEBUG A_P_A: Contratos carregados do DOM (já considerando JSON.quitado):",
                JSON.stringify(allAvailableContratos)
            );
        }

        /* =========================================================
         * Carregar árvore do backend
         * ======================================================= */

        function fetchDecisionTreeConfig() {
            const deferredConfig = $.Deferred();

            $.ajax({
                url: decisionTreeApiUrl,
                method: 'GET',
                dataType: 'json',
                success: function(data) {
                    if (data.status === 'success') {
                        treeConfig = data.tree_data || {};
                        firstQuestionKey = data.primeira_questao_chave || null;
                        deferredConfig.resolve();
                    } else {
                        console.error("Erro ao carregar configuração da árvore:", data.message);
                        $dynamicQuestionsContainer.html(
                            '<p class="errornote">' + data.message + '</p>'
                        );
                        deferredConfig.reject();
                    }
                },
                error: function(xhr, status, error) {
                    console.error("Erro AJAX ao carregar configuração da árvore:", status, error);
                    $dynamicQuestionsContainer.html(
                        '<p class="errornote">Erro ao carregar a árvore de decisão.</p>'
                    );
                    deferredConfig.reject();
                }
            });

            return deferredConfig.promise();
        }

        /* =========================================================
         * Renderização da árvore (RAIZ)
         * ======================================================= */

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

        /* =========================================================
         * Validação Data de Trânsito (5 anos) + Nó "Análise de Prescrição"
         * ======================================================= */

        function handleDataTransitoValidation(dataTransitoKey, selectedDate, currentResponses, cardIndex = null) {
            if (dataTransitoKey !== 'data_de_transito') return;

            const prefix = cardIndex !== null ? `card_${cardIndex}_` : '';

            // limpa avisos apenas dentro do escopo correto
            let $scope;
            if (cardIndex !== null) {
                $scope = $dynamicQuestionsContainer.find(
                    `.processo-card[data-card-index="${cardIndex}"]`
                );
                if (!$scope.length) $scope = $dynamicQuestionsContainer;
            } else {
                $scope = $dynamicQuestionsContainer;
            }

            $scope.find('.data-transito-aviso').remove();
            $scope.find('.analise-prescricao-node').remove();

            const $cumprimentoField = $scope.find(`select[name="${prefix}cumprimento_de_sentenca"]`);
            const $iniciarCsOption = $cumprimentoField.find('option[value="INICIAR CS"]');

            if (!selectedDate) {
                $iniciarCsOption.prop('disabled', false).removeAttr('title');
                return;
            }

            const dataSelecionada = new Date(selectedDate);
            if (isNaN(dataSelecionada.getTime())) {
                return;
            }

            const cincoAnosAtras = new Date();
            cincoAnosAtras.setFullYear(cincoAnosAtras.getFullYear() - 5);

            if (dataSelecionada < cincoAnosAtras) {
                // PRESCRIÇÃO PRESUMIDA DA PRETENSÃO EXECUTÓRIA
                $iniciarCsOption
                    .prop('disabled', true)
                    .attr('title', 'Prescrição: Trânsito em julgado há mais de 5 anos.');

                $cumprimentoField.after(
                    '<p class="errornote data-transito-aviso">⚠️ Prescrição: trânsito em julgado há mais de 5 anos. Em regra, não é adequado iniciar cumprimento de sentença.</p>'
                );

                const $csRow = $scope.find('.form-row[data-question-key="cumprimento_de_sentenca"]');

                if ($csRow.length) {
                    const texto = `
                        <div class="analise-prescricao-node">
                            <strong>Análise de Prescrição do Cumprimento de Sentença</strong>
                            <p>
                                A data de trânsito em julgado informada é anterior a 5 anos da data atual.
                                Em regra, considera-se prescrita a pretensão de promover o cumprimento de sentença,
                                salvo se houver causa interruptiva ou suspensiva da prescrição (por exemplo,
                                atos efetivos de execução já ajuizados dentro do prazo).
                            </p>
                            <ul>
                                <li>Verificar nos autos se já houve cumprimento de sentença tempestivo;</li>
                                <li>Avaliar se há algum ato interruptivo ou suspensivo da prescrição;</li>
                                <li>Na ausência desses elementos, tratar como inviável iniciar novo cumprimento de sentença.</li>
                            </ul>
                        </div>
                    `;
                    $csRow.append(texto);
                }

                if ($cumprimentoField.val() === 'INICIAR CS') {
                    $cumprimentoField.val('');
                    currentResponses['cumprimento_de_sentenca'] = '';
                    saveResponses();
                }
            } else {
                $iniciarCsOption.prop('disabled', false).removeAttr('title');
            }
        }

        /* =========================================================
         * Renderização genérica de perguntas
         * ======================================================= */

        function renderQuestion(questionKey, $container, currentResponses, cardIndex = null) {
            const question = treeConfig[questionKey];
            if (!question) return;

            const isQuitado = areAnySelectedContractsQuitado();
            let $questionDiv;
            let $inputElement;

            const prefix = cardIndex !== null ? `card_${cardIndex}_` : '';
            const fieldId = `id_${prefix}${question.chave}`;
            const fieldName = `${prefix}${question.chave}`;

            if (question.tipo_campo === 'BLOCO_INDICADOR') {
                $questionDiv = $(
                    `<div class="form-row field-${question.chave}" data-question-key="${question.chave}"><h3>${question.texto_pergunta}</h3></div>`
                );
                $container.append($questionDiv);

                if (question.proxima_questao_chave) {
                    renderQuestion(
                        question.proxima_questao_chave,
                        $questionDiv,
                        currentResponses,
                        cardIndex
                    );
                }
                return;
            }

            if (question.tipo_campo === 'PROCESSO_VINCULADO') {
                renderProcessoVinculadoEditor(question.chave, $container);
                return;
            }

            $questionDiv = $(
                `<div class="form-row field-${question.chave}" data-question-key="${question.chave}"><label for="${fieldId}">${question.texto_pergunta}:</label></div>`
            );
            $container.append($questionDiv);

            switch (question.tipo_campo) {
                case 'OPCOES':
                    $inputElement = $(
                        `<select id="${fieldId}" name="${fieldName}"><option value="">---</option></select>`
                    );
                    (question.opcoes || []).forEach(function(opcao) {
                        const isSelected = currentResponses[question.chave] === opcao.texto_resposta;
                        let disabled = false;

                        if (
                            isQuitado &&
                            ((question.chave === 'repropor_monitoria' &&
                                opcao.texto_resposta === 'SIM') ||
                                (question.chave === 'cumprimento_de_sentenca' &&
                                    opcao.texto_resposta === 'INICIAR CS'))
                        ) {
                            disabled = true;
                        }

                        $inputElement.append(
                            `<option value="${opcao.texto_resposta}" ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${opcao.texto_resposta}</option>`
                        );
                    });
                    break;

                case 'CONTRATOS_MONITORIA':
                    // "Propor Monitória": só aparece quando a árvore chega aqui.
                    renderMonitoriaContractSelector(question, $questionDiv, currentResponses);
                    return;

                case 'TEXTO':
                case 'TEXTO_LONGO':
                case 'DATA': {
                    const type = question.tipo_campo === 'DATA' ? 'date' : 'text';
                    const tag =
                        question.tipo_campo === 'TEXTO_LONGO' ? 'textarea' : 'input';
                    $inputElement = $(
                        `<${tag} type="${type}" id="${fieldId}" name="${fieldName}" ${ 
                            tag === 'textarea' ? 'rows="4"' : '' 
                        }></${tag}>`
                    ).val(currentResponses[question.chave] || '');
                    break;
                }

                default:
                    $inputElement = $(
                        '<p>Tipo de campo desconhecido: ' + question.tipo_campo + '</p>'
                    );
            }

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

            $questionDiv.append($inputElement);

            if (currentResponses[question.chave]) {
                renderNextQuestion(
                    question.chave,
                    currentResponses[question.chave],
                    $container,
                    currentResponses,
                    cardIndex
                );
            }
        }

        /* =========================================================
         * Lógica de próxima pergunta
         * ======================================================= */

        function renderNextQuestion(
            currentQuestionKey,
            selectedResponseText,
            $parentContainer,
            currentResponses,
            cardIndex = null
        ) {
            const $targetContainer =
                cardIndex !== null ? $parentContainer : $dynamicQuestionsContainer;

            $targetContainer.find('.form-row').each(function() {
                const qKey = $(this).data('question-key');
                if (
                    qKey &&
                    treeConfig[qKey] &&
                    treeConfig[currentQuestionKey] &&
                    treeConfig[qKey].ordem > treeConfig[currentQuestionKey].ordem
                ) {
                    delete currentResponses[qKey];
                    if (qKey === 'selecionar_contratos_monitoria') {
                        currentResponses.contratos_para_monitoria = [];
                    }
                    $(this).remove();
                }
            });

            if (
                cardIndex === null &&
                currentQuestionKey === 'julgamento' &&
                selectedResponseText !== 'SEM MÉRITO'
            ) {
                $dynamicQuestionsContainer
                    .find('[data-question-key="bloco_reproposicao_wrapper"]')
                    .remove();
                delete currentResponses['repropor_monitoria'];
                delete currentResponses['lote'];
                delete currentResponses['observacoes_reproposicao'];
            }

            const currentQuestion = treeConfig[currentQuestionKey];
            if (!currentQuestion) return;

            let nextQuestionKey = null;

            if (currentQuestion.tipo_campo === 'OPCOES') {
                const selectedOption = (currentQuestion.opcoes || []).find(
                    opt => opt.texto_resposta === selectedResponseText
                );
                if (selectedOption) {
                    nextQuestionKey = selectedOption.proxima_questao_chave;
                }
            } else if (currentQuestion.proxima_questao_chave) {
                nextQuestionKey = currentQuestion.proxima_questao_chave;
            }

            if (nextQuestionKey) {
                renderQuestion(
                    nextQuestionKey,
                    $targetContainer,
                    currentResponses,
                    cardIndex
                );
            } else {
                saveResponses();
            }

            // sempre que passarmos por "transitado" ou "procedencia", checa a data
            if (['transitado', 'procedencia'].includes(currentQuestionKey)) {
                handleDataTransitoValidation(
                    'data_de_transito',
                    currentResponses['data_de_transito'],
                    currentResponses,
                    cardIndex
                );
            }
        }

        /* =========================================================
         * Processos Vinculados (cards)
         * ======================================================= */

        function renderProcessoVinculadoEditor(questionKey, $container) {
            const nodeConfig = treeConfig[questionKey] || {};

            const startQuestionKey =
                'tipo_de_acao' in treeConfig
                    ? 'tipo_de_acao'
                    : nodeConfig.primeira_questao_vinculada ||
                      nodeConfig.proxima_questao_chave ||
                      null;

            const $editorDiv = $(
                `<div class="form-row field-${questionKey}" data-question-key="${questionKey}"></div>`
            );
            $editorDiv.append(
                `<h3>${nodeConfig.texto_pergunta || 'Processos CNJ (árvore judicial)'}</h3>`
            );

            const $cardsContainer = $('<div class="processo-vinculado-cards-container"></div>');
            $editorDiv.append($cardsContainer);

            const $addCardButton = $(
                '<button type="button" class="button add-processo-card">Adicionar Processo</button>'
            );
            $editorDiv.append($addCardButton);

            $container.append($editorDiv);

            ensureUserResponsesShape();

            if (!Array.isArray(userResponses[questionKey])) {
                userResponses[questionKey] = [];
            }

            $cardsContainer.empty();

            userResponses[questionKey].forEach((cardData, index) => {
                renderProcessoVinculadoCard(
                    questionKey,
                    cardData,
                    $cardsContainer,
                    index,
                    startQuestionKey
                );
            });

            $addCardButton.on('click', function() {
                const newCardData = {
                    cnj: '',
                    contratos: [],
                    tipo_de_acao_respostas: {}
                };
                userResponses[questionKey].push(newCardData);
                renderProcessoVinculadoCard(
                    questionKey,
                    newCardData,
                    $cardsContainer,
                    userResponses[questionKey].length - 1,
                    startQuestionKey
                );
                saveResponses();
            });
        }

        function renderProcessoVinculadoCard(
            parentQuestionKey,
            cardData,
            $cardsContainer,
            cardIndex,
            startQuestionKey
        ) {
            cardData.tipo_de_acao_respostas =
                cardData.tipo_de_acao_respostas || {};
            cardData.contratos = Array.isArray(cardData.contratos)
                ? cardData.contratos
                : [];

            const indexLabel = cardIndex + 1;

            const $card = $('<div class="processo-card"></div>').attr(
                'data-card-index',
                cardIndex
            );

            const $header = $('<div class="processo-card-header"></div>');
            $header.append(`<strong>Processo CNJ #${indexLabel}</strong>`);

            const $removeBtn = $(
                '<button type="button" class="button processo-card-remove">Remover</button>'
            );
            $header.append($removeBtn);
            $card.append($header);

            const $body = $('<div class="processo-card-body"></div>');

            // Campo CNJ com formatação padrão
            const $cnjWrapper = $('<div class="field-cnj"></div>');
            $cnjWrapper.append('<label>Nº Processo CNJ</label>');
            const $cnjInput = $(`
                <input type="text" class="vTextField processo-cnj-input"
                       placeholder="0000000-00.0000.0.00.0000">
            `).val(formatCnjDigits(cardData.cnj || ''));

            $cnjInput.on('input', function() {
                const formatted = formatCnjDigits($(this).val());
                $(this).val(formatted);
            });

            $cnjInput.on('blur', function() {
                const formatted = formatCnjDigits($(this).val());
                $(this).val(formatted);
                cardData.cnj = formatted;
                if (formatted && !isValidCnj(formatted)) {
                    alert('CNJ inválido. Verifique o formato (0000000-00.0000.0.00.0000).');
                }
                saveResponses();
            });

            $cnjWrapper.append($cnjInput);
            $body.append($cnjWrapper);

            // Contratos vinculados a esse processo
            const $contratosWrapper = $('<div class="field-contratos-vinculados"></div>');
            $contratosWrapper.append(
                '<label>Contratos vinculados a este processo</label>'
            );

            const contratosStatus = userResponses.contratos_status || {};
            const selectedInInfoCard = allAvailableContratos.filter(
                c => contratosStatus[c.id] && contratosStatus[c.id].selecionado
            );

            const listaParaExibir =
                selectedInInfoCard.length > 0 ? selectedInInfoCard : allAvailableContratos;

            if (listaParaExibir.length === 0) {
                $contratosWrapper.append(
                    '<p>Nenhum contrato disponível. Selecione primeiro nos "Dados Básicos".</p>'
                );
            } else {
                listaParaExibir.forEach(contrato => {
                    const idStr = String(contrato.id);
                    const isChecked = cardData.contratos
                        .map(String)
                        .includes(idStr);

                    const $row = $('<div class="processo-contrato-item"></div>');
                    const $chk = $(
                        `<input type="checkbox"
                               id="proc_${cardIndex}_contrato_${idStr}"
                               value="${idStr}" ${isChecked ? 'checked' : ''}>
                    `);
                    const $lbl = $(
                        `<label for="proc_${cardIndex}_contrato_${idStr}">${contrato.numero_contrato}</label>`
                    );

                    $chk.on('change', function() {
                        const val = $(this).val(); // string
                        if ($(this).is(':checked')) {
                            if (!cardData.contratos.map(String).includes(val)) {
                                cardData.contratos.push(val);
                            }
                        } else {
                            cardData.contratos = cardData.contratos
                                .map(String)
                                .filter(id => id !== val);
                        }
                        saveResponses();
                    });

                    $row.append($chk).append($lbl);
                    $contratosWrapper.append($row);
                });
            }

            $body.append($contratosWrapper);

            // Sub-árvore processual dentro do card
            const $subQuestionsContainer = $('<div class="processo-subquestions"></div>');
            $body.append($subQuestionsContainer);

            if (startQuestionKey && treeConfig[startQuestionKey]) {
                renderQuestion(
                    startQuestionKey,
                    $subQuestionsContainer,
                    cardData.tipo_de_acao_respostas,
                    cardIndex
                );
            }

            $card.append($body);
            $cardsContainer.append($card);

            $removeBtn.on('click', function() {
                if (!confirm('Remover este processo vinculado?')) return;
                const arr = userResponses[parentQuestionKey] || [];
                arr.splice(cardIndex, 1);
                userResponses[parentQuestionKey] = arr;
                saveResponses();
                renderDecisionTree();
            });
        }

        /* =========================================================
         * Seleção de contratos para Monitória ("Propor Monitória")
         * ======================================================= */

        function renderMonitoriaContractSelector(question, $container, currentResponses) {
            ensureUserResponsesShape();

            const $selectorDiv = $('<div class="form-row field-contratos-monitoria"></div>');
            $selectorDiv.append(`<label>${question.texto_pergunta}</label>`);

            const selectedInInfoCard = allAvailableContratos.filter(
                c => userResponses.contratos_status[c.id] && userResponses.contratos_status[c.id].selecionado
            );
            const selection = currentResponses.contratos_para_monitoria || [];

            if (selectedInInfoCard.length === 0) {
                $selectorDiv.append(
                    '<p>Nenhum contrato selecionado nos "Dados Básicos".</p>'
                );
                $container.append($selectorDiv);
                return;
            }

            selectedInInfoCard.forEach(function(contrato) {
                const contratoIdStr = String(contrato.id);
                const isChecked = selection.includes(contratoIdStr);
                const isDisabled = contrato.is_prescrito || contrato.is_quitado;

                let label = `${contrato.numero_contrato}`;
                if (contrato.is_prescrito) {
                    label += ' <span style="color:#c62828;font-style:italic;">(Prescrito)</span>';
                } else if (contrato.is_quitado) {
                    label += ' <span style="color:#007bff;font-style:italic;">(Quitado)</span>';
                }

                const $checkboxWrapper = $(
                    `<div>
                        <input type="checkbox"
                               id="monitoria_contrato_${contratoIdStr}"
                               value="${contratoIdStr}"
                               ${isChecked ? 'checked' : ''}
                               ${isDisabled ? 'disabled' : ''}>
                        <label for="monitoria_contrato_${contratoIdStr}">${label}</label>
                    </div>`
                );

                $selectorDiv.append($checkboxWrapper);
            });

            $selectorDiv.on('change', 'input[type="checkbox"]', function() {
                const contratoId = $(this).val(); // string
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

        /* =========================================================
         * Eventos globais
         * ======================================================= */

        // RECARREGA JSON AO MUDAR STATUS DO CONTRATO (Q, seleção etc.)
        $(document).on('contratoStatusChange', function() {
            try {
                const data = $responseField.val();
                userResponses = data ? JSON.parse(data) : {};
            } catch (e) {
                console.error("DEBUG A_P_A: erro ao reparsear userResponses no evento contratoStatusChange:", e);
                userResponses = {};
            }

            ensureUserResponsesShape();
            loadContratosFromDOM();
            renderDecisionTree();
            updateContractStars();
            updateGenerateButtonState();
            displayFormattedResponses();
        });

        /* =========================================================
         * Inicialização
         * ======================================================= */

        loadExistingResponses();
        loadContratosFromDOM();

        fetchDecisionTreeConfig().done(function() {
            renderDecisionTree();
        });

        $inlineGroup.find('.inline-related h3').hide();

        /* =========================================================
         * Botão Gerar Monitória
         * ======================================================= */

        // Event listener para o botão, que agora é criado dinamicamente
        $(document).on('click', '#id_gerar_monitoria_btn', function(e) {
            e.preventDefault();

            if (!currentProcessoId) {
                alert('Erro: ID do processo não encontrado para gerar a petição.');
                return;
            }
            if (
                !userResponses.contratos_para_monitoria ||
                userResponses.contratos_para_monitoria.length === 0
            ) {
                alert('Selecione pelo menos um contrato para a monitória antes de gerar a petição.');
                return;
            }

            const csrftoken = $('input[name="csrfmiddlewaretoken"]').val();
            const url = `/contratos/processo/${currentProcessoId}/gerar-monitoria/`;

            $.ajax({
                url: url,
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken },
                data: {
                    processo_id: currentProcessoId,
                    contratos_para_monitoria: JSON.stringify(userResponses.contratos_para_monitoria)
                },
                xhrFields: { responseType: 'blob' },
                beforeSend: function() {
                    $('#id_gerar_monitoria_btn')
                        .prop('disabled', true)
                        .text('Gerando...');
                },
                success: function(blob, status, xhr) {
                    try {
                        const disposition = xhr.getResponseHeader('Content-Disposition') || '';
                        let filename = 'monitoria.docx';
                        const match = disposition.match(/filename="?([^\"]+)"?/i);
                        if (match && match[1]) {
                            filename = decodeURIComponent(match[1]);
                        }

                        const urlBlob = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = urlBlob;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        window.URL.revokeObjectURL(urlBlob);
                        alert('Petição generada com sucesso e download iniciado!');
                    } catch (err) {
                        console.error('Erro ao processar download da monitória:', err);
                        alert('Monitória gerada, mas houve um problema ao iniciar o download.');
                    }
                },
                error: function(xhr, status, error) {
                    let errorMessage =
                        'Erro ao gerar petição. Tente novamente.';
                    if (xhr.responseJSON && xhr.responseJSON.message) {
                        errorMessage = xhr.responseJSON.message;
                    } else if (xhr.responseText) {
                        errorMessage = xhr.responseText;
                    }
                    alert(errorMessage);
                    console.error('Erro na geração da petição:', status, error, xhr);
                },
                complete: function() {
                    $('#id_gerar_monitoria_btn')
                        .prop('disabled', false)
                        .text('Gerar Petição Monitória');
                }
            });
        });
    });
})((window.django && window.django.jQuery) ? window.django.jQuery : jQuery);
