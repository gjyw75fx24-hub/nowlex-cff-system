/**
 * =========================================================================
 * SISTEMA DE ANÁLISE PROCESSUAL JURÍDICA - VERSÃO 2.0 COMPLETA
 * =========================================================================
 * 
 * Sistema completo de análise processual com todas as funcionalidades:
 * 
 * FUNCIONALIDADES PRINCIPAIS:
 * ---------------------------
 * ✅ Árvore de decisão procedural completa
 * ✅ Salvar, reabrir e editar análises
 * ✅ Geração automática de cards-resumo
 * ✅ Sistema completo de supervisão
 * ✅ Contratos listados e selecionáveis
 * ✅ Botão "Gerar Petição Monitória"
 * ✅ Botão "Gerar Cobrança Judicial"
 * ✅ Cálculo de prescrição (5 anos)
 * ✅ Observações livres (notebook)
 * ✅ Observações do supervisor
 * ✅ Status de supervisão (Pendente/Aprovado/Reprovado)
 * ✅ Sistema de "Barrado" com datas
 * ✅ Múltiplos cards de processos vinculados
 * ✅ Dados básicos do processo
 * ✅ Formatação de valores monetários
 * ✅ Formatação de CNJ
 * 
 * SISTEMA DE SUPERVISÃO:
 * ----------------------
 * - Tab "Supervisionar" exclusiva para supervisores
 * - Alternância de status (Pendente → Aprovado → Reprovado → Pendente)
 * - Campo de observações do supervisor
 * - Sistema de "Barrado" com data de início e retorno
 * - Botão "Concluir Revisão"
 * - Toggle "Supervisionar" em cada card
 * - Badges visuais de status
 * - Filtro automático de processos aguardando supervisão
 * 
 * CONTRATOS:
 * ----------
 * - Lista completa de contratos disponíveis
 * - Seleção múltipla de contratos
 * - Exibição de números de contrato nos cards
 * - Status de contratos (quitado/não quitado)
 * - Estrelas visuais nos contratos selecionados
 * - Vinculação de contratos por processo
 * 
 * ARQUITETURA:
 * ------------
 * O código está organizado em seções modulares:
 * 1. Configuração e Variáveis Globais
 * 2. Inicialização e Setup
 * 3. Gerenciamento de Estado
 * 4. Árvore de Decisão
 * 5. Sistema de Cards
 * 6. Sistema de Supervisão
 * 7. Contratos e Monitória
 * 8. Utilitários e Formatação
 * 9. Event Handlers
 * 10. Integração com Django
 * 
 * @version 2.0.0
 * @date 2024
 * @license Proprietário
 */

(function ($) {
    'use strict';

    $(document).ready(function () {
        console.log("analise_processo_arvore.js carregado.");
        const savedScroll = sessionStorage.getItem('scrollPosition');
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }
        if (savedScroll !== null) {
            window.scrollTo(0, parseInt(savedScroll, 10));
            sessionStorage.removeItem('scrollPosition');
        }

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
        let treeResponseKeys = [];
        let userResponses = {};
        let firstQuestionKey = null;
        const currentProcessoId =
            $('input[name="object_id"]').val() ||
            (window.location.pathname.match(/processojudicial\/([^/]+)/) || [])[1] ||
            null;
        const localResponsesKey = currentProcessoId
            ? `analise_respostas_${currentProcessoId}`
            : 'analise_respostas_rascunho';
        const notebookStorageKey = `observacoes_livres_${window.location.pathname}`;
        const currencyFormatter = new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
        const SUPERVISION_STATUS_SEQUENCE = ['pendente', 'aprovado', 'reprovado'];
        const SUPERVISION_STATUS_LABELS = {
            pendente: 'Pendente de Supervisão',
            aprovado: 'Aprovado',
            reprovado: 'Reprovado'
        };
        const SUPERVISION_STATUS_CLASSES = {
            pendente: 'status-pendente',
            aprovado: 'status-aprovado',
            reprovado: 'status-reprovado'
        };
        const currentSupervisorUsername = window.__analise_username || 'Supervisor';


        const $inlineGroup = $('.analise-procedural-group');
        if (!$inlineGroup.length) {
            return;
        }

        const $responseField = $inlineGroup.find('textarea[name$="-respostas"]');
        $responseField.closest('.form-row').hide();
        let $adminForm = $('form#processojudicial_form');
        if (!$adminForm.length) {
            $adminForm = $('form').first();
        }
        $adminForm.on('submit', function (event) {
            flushPendingSave();
            const activeTab = $tabNavigation.find('.analise-inner-tab-button.active').data('tab');
            if (activeTab) {
                sessionStorage.setItem(TAB_STORAGE_KEY, activeTab);
            }
            clearLocalResponses();
        });

        const isSupervisorUser = Boolean(window.__analise_is_supervisor);
        const TAB_STORAGE_KEY = 'analise_active_tab';
        const desiredTab = sessionStorage.getItem(TAB_STORAGE_KEY);
        const $analysisTabButton = $(
            '<button type="button" class="analise-inner-tab-button" data-tab="analise">Análise do Processo</button>'
        );
        const $tabNavigation = $('<div class="analise-inner-tab-navigation"></div>').append($analysisTabButton);
        let $supervisionTabButton = null;
        if (isSupervisorUser) {
            $supervisionTabButton = $(
                '<button type="button" class="analise-inner-tab-button" data-tab="supervisionar">Supervisionar</button>'
            );
            $tabNavigation.append($supervisionTabButton);
        }

        let suppressGeneralSummaryUntilFirstAnswer = true;

        const $analysisActionRow = $('<div class="analise-inner-action-row"></div>');
        const $saveAnalysisButton = $(
            '<button type="button" class="button analise-save-analysis-btn">Concluir Análise</button>'
        );
        $analysisActionRow.append($saveAnalysisButton);

        const $tabPanels = $('<div class="analise-inner-tab-panels"></div>');
        const $analysisPanel = $(
            '<div class="analise-inner-tab-panel active" data-panel="analise"></div>'
        );
        $tabPanels.append($analysisPanel);
        let $supervisionPanel = null;
        let $supervisionPanelContent = null;
        if (isSupervisorUser) {
            $supervisionPanel = $(
                '<div class="analise-inner-tab-panel" data-panel="supervisionar"></div>'
            );
            $supervisionPanelContent = $('<div class="analise-supervision-panel"></div>');
            $supervisionPanel.append($supervisionPanelContent);
            $tabPanels.append($supervisionPanel);
        }

        const $tabWrapper = $('<div class="analise-inner-tab-wrapper"></div>').append(
            $tabNavigation,
            $analysisActionRow,
            $tabPanels
        );
        $inlineGroup.append($tabWrapper);

        const clickSaveAndContinueEditor = () => {
            const $continueBtn = $adminForm.find('button[name="_continue"], input[name="_continue"]');
            if ($continueBtn.length) {
                $continueBtn.first().trigger('click');
                return true;
            }
            return false;
        };

        $saveAnalysisButton.on('click', () => {
            if (!hasActiveAnalysisResponses()) {
                return;
            }
            const stored = storeActiveAnalysisAsProcessCard();
            if (stored) {
                saveResponses();
                suppressGeneralSummaryUntilFirstAnswer = true;
                startNewAnalysis({ skipGeneralSnapshot: true, suppressSummary: false });
                setTimeout(() => {
                    if (!clickSaveAndContinueEditor()) {
                        const $continueInput = $('<input>', { type: 'hidden', name: '_continue', value: '1' });
                        if (!$adminForm.find('input[name="_continue"]').length) {
                            $adminForm.append($continueInput);
                        } else {
                            $adminForm.find('input[name="_continue"]').val('1');
                        }
                        $adminForm.first().submit();
                    }
                }, 150);
            }
        });

        function activateInnerTab(tabName) {
            const $targetPanel = $tabPanels.find(
                `.analise-inner-tab-panel[data-panel="${tabName}"]`
            );
            if (!$targetPanel.length) {
                return;
            }
            $tabNavigation.find('.analise-inner-tab-button').removeClass('active');
            $tabNavigation
                .find(`.analise-inner-tab-button[data-tab="${tabName}"]`)
                .addClass('active');
            $tabPanels.find('.analise-inner-tab-panel').removeClass('active');
            $targetPanel.addClass('active');
            sessionStorage.setItem(TAB_STORAGE_KEY, tabName);
        }

        $tabNavigation.on('click', '.analise-inner-tab-button', function () {
            const selectedTab = $(this).data('tab');
            activateInnerTab(selectedTab);
        });

        const initialTab = isSupervisorUser && desiredTab === 'supervisionar' ? 'supervisionar' : 'analise';
        activateInnerTab(initialTab);

        const $dynamicQuestionsContainer = $('<div class="dynamic-questions-container"></div>');
        $analysisPanel.append($dynamicQuestionsContainer);

        const $formattedResponsesContainer = $('<div class="formatted-responses-container"></div>');
        $analysisPanel.append($formattedResponsesContainer);

        // REMOVIDO GLOBALMENTE, VAI SER CRIADO DINAMICAMENTE DENTRO DE displayFormattedResponses
        // const $gerarMonitoriaBtn = $('#id_gerar_monitoria_btn');

        let allAvailableContratos = [];
        const GENERAL_MONITORIA_CARD_KEY = 'general-monitoria';
        const GENERAL_CARD_FIELD_KEYS = [
            'judicializado_pela_massa',
            'propor_monitoria',
            'tipo_de_acao',
            'julgamento',
            'transitado',
            'procedencia',
            'data_de_transito',
            'cumprimento_de_sentenca',
            'repropor_monitoria',
            'ativar_botao_monitoria'
        ];
        let hasUserActivatedCardSelection = false;
        const SAVED_PROCESSOS_KEY = 'saved_processos_vinculados';
        const CARD_EXPANSION_STATE = {};

        function getCardExpansionState(cardKey, defaultState = false) {
            if (Object.prototype.hasOwnProperty.call(CARD_EXPANSION_STATE, cardKey)) {
                return CARD_EXPANSION_STATE[cardKey];
            }
            CARD_EXPANSION_STATE[cardKey] = defaultState;
            return defaultState;
        }

        function setCardExpansionState(cardKey, expanded) {
            CARD_EXPANSION_STATE[cardKey] = Boolean(expanded);
        }

        function getGeneralCardSnapshot() {
            ensureUserResponsesShape();
            return userResponses.general_card || null;
        }

        function setGeneralCardSnapshot(snapshot) {
            ensureUserResponsesShape();
            if (snapshot) {
                userResponses.general_card = snapshot;
            } else {
                delete userResponses.general_card;
            }
        }

        function buildGeneralCardSnapshotFromCurrentResponses() {
            const contractIds = (userResponses.contratos_para_monitoria || [])
                .map(id => String(id))
                .filter(Boolean);
            if (!contractIds.length) {
                return null;
            }
            const keysToCapture = Array.from(
                new Set([...(GENERAL_CARD_FIELD_KEYS || []), ...(treeResponseKeys || [])])
            );
            const capturedResponses = {};
            keysToCapture.forEach(key => {
                if (userResponses.hasOwnProperty(key)) {
                    capturedResponses[key] = userResponses[key];
                }
            });
            const sanitizedResponses = deepClone(capturedResponses);
            delete sanitizedResponses.processos_vinculados;
            delete sanitizedResponses.general_card;
            return {
                contracts: contractIds,
                responses: sanitizedResponses,
                updatedAt: new Date().toISOString()
            };
        }

        function getGeneralCardTitle(snapshot) {
            if (!snapshot || !snapshot.responses) {
                return 'Monitória Jurídica';
            }
            const value = String(snapshot.responses.judicializado_pela_massa || '').trim().toUpperCase();
            if (value === 'NÃO') {
                return 'Não Judicializado';
            }
            if (value) {
                return value.charAt(0) + value.slice(1).toLowerCase();
            }
            return 'Monitória Jurídica';
        }

        function restoreTreeFromGeneralSnapshot() {
            const snapshot = getGeneralCardSnapshot();
            if (!snapshot || !snapshot.responses) {
                return;
            }
            ensureUserResponsesShape();

            const keysToRestore = Array.from(
                new Set([...(GENERAL_CARD_FIELD_KEYS || []), ...(treeResponseKeys || [])])
            );
            keysToRestore.forEach(key => {
                if (snapshot.responses.hasOwnProperty(key)) {
                    userResponses[key] = snapshot.responses[key];
                } else {
                    delete userResponses[key];
                }
            });

            userResponses.contratos_para_monitoria = (snapshot.contracts || []).map(id => String(id));
            userResponses.ativar_botao_monitoria = userResponses.contratos_para_monitoria.length ? 'SIM' : '';

            // CORRIGIDO: Renderizar árvore e popular campos de forma síncrona
            renderDecisionTree();
            populateTreeFieldsFromResponses(userResponses);

            // CORRIGIDO: Disparar eventos change apenas uma vez, de forma ordenada
            setTimeout(() => {
                const orderedKeys = treeResponseKeys.filter(key =>
                    userResponses.hasOwnProperty(key) &&
                    userResponses[key] !== undefined &&
                    userResponses[key] !== null &&
                    userResponses[key] !== ''
                );

                orderedKeys.forEach((key, index) => {
                    setTimeout(() => {
                        const $field = $(`[name="${key}"]`);
                        if ($field.length) {
                            if ($field.attr('type') === 'checkbox') {
                                $field.prop('checked', String(userResponses[key]).toLowerCase() === 'sim');
                            } else {
                                $field.val(userResponses[key]);
                            }
                            // Disparar change apenas uma vez
                            $field.off('change.restore').on('change.restore', function () {
                                $(this).off('change.restore');
                            }).trigger('change');
                        }
                    }, index * 50); // Delay escalonado para evitar conflitos
                });
            }, 200);
        }

        function editGeneralSummaryCard() {
            const snapshot = getGeneralCardSnapshot();
            if (!snapshot || !snapshot.responses) {
                alert('Não há uma análise salva para editar.');
                return;
            }
            ensureUserResponsesShape();
            suppressGeneralSummaryUntilFirstAnswer = false;
            clearTreeResponsesForNewAnalysis();
            restoreTreeFromGeneralSnapshot();
            if ($dynamicQuestionsContainer.length) {
                $dynamicQuestionsContainer.get(0).scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        /* =========================================================
         * Helpers gerais
         * ======================================================= */

        function ensureUserResponsesShape() {
            if (!userResponses || typeof userResponses !== 'object') {
                userResponses = {};
            }
            if (!Array.isArray(userResponses.selected_analysis_cards)) {
                userResponses.selected_analysis_cards = [];
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
            if (!userResponses.hasOwnProperty('saved_entries_migrated')) {
                userResponses.saved_entries_migrated = false;
            }
            if (!userResponses.ativar_botao_monitoria) {
                userResponses.ativar_botao_monitoria = '';
            }
            if (!Array.isArray(userResponses[SAVED_PROCESSOS_KEY])) {
                userResponses[SAVED_PROCESSOS_KEY] = [];
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

        function getMonitoriaContractIds(options = {}) {
            const {
                includeGeneralSnapshot = false,
                includeSummaryCardContracts = false
            } = options || {};
            let ids = (userResponses.contratos_para_monitoria || [])
                .map(id => String(id))
                .filter(Boolean);
            if (includeSummaryCardContracts) {
                ids = ids.concat(getContractsFromSelectedSummaryCards());
            }
            if (includeGeneralSnapshot && isGeneralMonitoriaSelected()) {
                const snapshot = getGeneralCardSnapshot();
                if (snapshot && Array.isArray(snapshot.contracts)) {
                    ids = ids.concat(snapshot.contracts.map(id => String(id)));
                }
            }
            return Array.from(new Set(ids));
        }

        function getContractsFromSelectedSummaryCards() {
            if (!Array.isArray(userResponses.selected_analysis_cards)) {
                return [];
            }
            const contractIds = [];
            userResponses.selected_analysis_cards.forEach(selection => {
                if (!selection || selection === GENERAL_MONITORIA_CARD_KEY) {
                    return;
                }
                const match = /^card-(\d+)$/.exec(selection);
                if (!match) {
                    return;
                }
                const cardIndex = Number(match[1]);
                if (!Number.isFinite(cardIndex)) {
                    return;
                }
                const savedCards = getSavedProcessCards();
                const processo = savedCards[cardIndex];
                if (!processo) {
                    return;
                }
                let candidates = parseContractsField(
                    processo.tipo_de_acao_respostas && processo.tipo_de_acao_respostas.contratos_para_monitoria
                );
                if (candidates.length === 0 && Array.isArray(processo.contratos)) {
                    candidates = processo.contratos.map(item => String(item).trim()).filter(Boolean);
                }
                candidates.forEach(id => {
                    if (id) {
                        contractIds.push(String(id));
                    }
                });
            });
            return contractIds;
        }

        function getSavedProcessCards() {
            if (!Array.isArray(userResponses[SAVED_PROCESSOS_KEY])) {
                return [];
            }
            return userResponses[SAVED_PROCESSOS_KEY];
        }

        function getCombinedProcessCardsForSummary() {
            const savedCards = getSavedProcessCards();
            const activeCards = Array.isArray(userResponses.processos_vinculados)
                ? userResponses.processos_vinculados
                : [];

            const combined = savedCards.map((card, idx) => ({
                ...card,
                __savedIndex: idx,
                __source: 'saved'
            }));

            if (!activeCards.length) {
                return combined;
            }

            activeCards.forEach(activeCard => {
                if (!activeCard || !activeCard.cnj) return;

                const alreadyIncluded = combined.some(card =>
                    card && card.cnj && activeCard.cnj && String(card.cnj).trim() === String(activeCard.cnj).trim()
                );

                if (!alreadyIncluded) {
                    combined.push({
                        ...activeCard,
                        __savedIndex: null,
                        __source: 'active'
                    });
                }
            });

            return combined;
        }

        function getTreeQuestionKeysForSnapshot() {
            if (!Array.isArray(treeResponseKeys)) {
                return [];
            }
            return treeResponseKeys.filter(key => key !== 'processos_vinculados');
        }

        function migrateProcessCardsIfNeeded() {
            if (userResponses.saved_entries_migrated) {
                return;
            }
            if (!Array.isArray(userResponses[SAVED_PROCESSOS_KEY])) {
                userResponses[SAVED_PROCESSOS_KEY] = [];
            }
            if (
                Array.isArray(userResponses.processos_vinculados) &&
                userResponses.processos_vinculados.length &&
                !hasActiveAnalysisResponses()
            ) {
                userResponses[SAVED_PROCESSOS_KEY] = userResponses.processos_vinculados.slice();
                userResponses.processos_vinculados = [];
            }
            userResponses.saved_entries_migrated = true;
        }

        function hasActiveAnalysisResponses() {
            const contractSelectionFilled = Array.isArray(userResponses.contratos_para_monitoria) &&
                userResponses.contratos_para_monitoria.length > 0;
            if (contractSelectionFilled) {
                return true;
            }
            if (Array.isArray(userResponses.processos_vinculados) && userResponses.processos_vinculados.length > 0) {
                return true;
            }
            const relevantKeys = getTreeQuestionKeysForSnapshot();
            if (relevantKeys.length === 0) {
                return fallbackHasResponses();
            }
            const hasFromRelevant = relevantKeys.some(key => {
                const value = userResponses[key];
                if (value === undefined || value === null) {
                    return false;
                }
                if (Array.isArray(value)) {
                    return value.length > 0;
                }
                return String(value).trim() !== '';
            });
            return hasFromRelevant || fallbackHasResponses();
        }

        function fallbackHasResponses() {
            const fallbackKeys = [
                'judicializado_pela_massa',
                'cnj',
                'tipo_de_acao',
                'julgamento',
                'transitado',
                'procedencia'
            ];
            return fallbackKeys.some(key => {
                const value = userResponses[key];
                if (value === undefined || value === null) {
                    return false;
                }
                if (Array.isArray(value)) {
                    return value.length > 0;
                }
                return String(value).trim() !== '';
            });
        }

        function deepClone(value) {
            if (value === null || typeof value !== 'object') {
                return value;
            }
            if (Array.isArray(value)) {
                return value.map(item => deepClone(item));
            }
            const cloned = {};
            Object.keys(value).forEach(key => {
                cloned[key] = deepClone(value[key]);
            });
            return cloned;
        }

        function captureActiveAnalysisSnapshot() {
            const keysToCapture = new Set([
                ...getTreeQuestionKeysForSnapshot(),
                'contratos_para_monitoria',
                'ativar_botao_monitoria',
                'cnj'
            ]);
            const capturedResponses = {};
            keysToCapture.forEach(key => {
                if (Object.prototype.hasOwnProperty.call(userResponses, key)) {
                    capturedResponses[key] = userResponses[key];
                }
            });
            if (Array.isArray(userResponses.processos_vinculados) && userResponses.processos_vinculados.length) {
                capturedResponses.processos_vinculados = userResponses.processos_vinculados.map(card => deepClone(card));
            }
            const contractIdsSet = new Set(
                (capturedResponses.contratos_para_monitoria || [])
                    .map(id => String(id).trim())
                    .filter(Boolean)
            );
            if (Array.isArray(capturedResponses.processos_vinculados)) {
                capturedResponses.processos_vinculados.forEach(proc => {
                    if (!proc || !Array.isArray(proc.contratos)) {
                        return;
                    }
                    proc.contratos.forEach(ct => {
                        const id = String(ct).trim();
                        if (id) contractIdsSet.add(id);
                    });
                    const fallbackContracts =
                        proc.tipo_de_acao_respostas &&
                            Array.isArray(proc.tipo_de_acao_respostas.contratos_para_monitoria)
                            ? proc.tipo_de_acao_respostas.contratos_para_monitoria
                            : [];
                    fallbackContracts.forEach(ct => {
                        const id = String(ct).trim();
                        if (id) contractIdsSet.add(id);
                    });
                });
            }
            const contractIds = Array.from(contractIdsSet);
            const rawCnj = capturedResponses.cnj || $('input[name="cnj"]').val() || '';
            const formattedCnj = rawCnj ? formatCnjDigits(rawCnj) : '';
            const snapshotResponses = deepClone(capturedResponses);
            const supervisionado = Boolean(snapshotResponses.supervisionado);
            const supervisor_status =
                snapshotResponses.supervisor_status || 'pendente';
            const awaiting_supervision_confirm = Boolean(
                snapshotResponses.awaiting_supervision_confirm
            );
            const barrado = snapshotResponses.barrado
                ? deepClone(snapshotResponses.barrado)
                : { ativo: false, inicio: null, retorno_em: null };
            delete snapshotResponses.supervisionado;
            delete snapshotResponses.supervisor_status;
            delete snapshotResponses.awaiting_supervision_confirm;
            delete snapshotResponses.barrado;
            delete snapshotResponses.processos_vinculados;
            return {
                cnj: formattedCnj || 'Não informado',
                contratos: contractIds,
                tipo_de_acao_respostas: snapshotResponses,
                supervisionado,
                supervisor_status,
                awaiting_supervision_confirm,
                barrado
            };
        }

        function buildSnapshotFromProcessosVinculados() {
            if (!Array.isArray(userResponses.processos_vinculados) || userResponses.processos_vinculados.length === 0) {
                return null;
            }
            const processo = userResponses.processos_vinculados[0];
            const contratoArray = Array.isArray(processo.contratos) ? processo.contratos : [];
            const respostaContratos = processo.tipo_de_acao_respostas && Array.isArray(processo.tipo_de_acao_respostas.contratos_para_monitoria)
                ? processo.tipo_de_acao_respostas.contratos_para_monitoria
                : [];
            const contractIds = Array.from(
                new Set(
                    [...contratoArray, ...respostaContratos]
                        .map(id => String(id).trim())
                        .filter(Boolean)
                )
            );
            const responses = deepClone(processo.tipo_de_acao_respostas || {});
            const cnjFormatted = processo.cnj ? formatCnjDigits(processo.cnj) : '';
            const barrado = processo.barrado
                ? deepClone(processo.barrado)
                : { ativo: false, inicio: null, retorno_em: null };
            delete responses.processos_vinculados;
            return {
                cnj: cnjFormatted || 'Não informado',
                contratos: contractIds,
                tipo_de_acao_respostas: responses,
                supervisionado: Boolean(processo.supervisionado),
                supervisor_status: processo.supervisor_status || 'pendente',
                awaiting_supervision_confirm: Boolean(processo.awaiting_supervision_confirm),
                barrado,
                general_card_snapshot: false
            };
        }

        function appendProcessCardToHistory(cardData) {
            if (!cardData) {
                return;
            }
            ensureUserResponsesShape();
            if (!Array.isArray(userResponses[SAVED_PROCESSOS_KEY])) {
                userResponses[SAVED_PROCESSOS_KEY] = [];
            }
            userResponses[SAVED_PROCESSOS_KEY].push(cardData);
        }

        function storeActiveAnalysisAsProcessCard() {
            ensureUserResponsesShape();
            const savedCards = userResponses[SAVED_PROCESSOS_KEY] || [];
            const editingIndex =
                Number.isFinite(userResponses._editing_card_index) &&
                userResponses._editing_card_index >= 0
                    ? Number(userResponses._editing_card_index)
                    : null;

            let snapshot = buildSnapshotFromProcessosVinculados();
            if (!snapshot) {
                snapshot = captureActiveAnalysisSnapshot();
            }
            if (!snapshot) {
                return false;
            }
            snapshot.saved_at = new Date().toISOString();
            snapshot.updated_at = snapshot.saved_at;

            if (editingIndex !== null && savedCards[editingIndex]) {
                snapshot.general_card_snapshot =
                    savedCards[editingIndex].general_card_snapshot || false;
                savedCards[editingIndex] = snapshot;
            } else {
                appendProcessCardToHistory(snapshot);
            }

            userResponses.processos_vinculados = [];
            if (editingIndex !== null) {
                delete userResponses._editing_card_index;
                $('.edit-mode-indicator').remove();
            }
            return true;
        }

        function isCurrentGeneralMonitoriaEligible() {
            const contractIds = getMonitoriaContractIds();
            if (!contractIds.length) {
                return false;
            }
            const judicializado = normalizeResponse(userResponses.judicializado_pela_massa);
            const proporMonitoria = normalizeResponse(userResponses.propor_monitoria);
            return judicializado === 'NÃO' && proporMonitoria === 'SIM';
        }

        function isGeneralMonitoriaEligible() {
            const snapshot = getGeneralCardSnapshot();
            return snapshot && Array.isArray(snapshot.contracts) && snapshot.contracts.length > 0;
        }

        function isGeneralMonitoriaSelected() {
            return Array.isArray(userResponses.selected_analysis_cards) &&
                userResponses.selected_analysis_cards.includes(GENERAL_MONITORIA_CARD_KEY);
        }

        function hasAnySummaryCardSelection() {
            return Array.isArray(userResponses.selected_analysis_cards) &&
                userResponses.selected_analysis_cards.some(sel => typeof sel === 'string');
        }

        function syncGeneralMonitoriaSelection(checked) {
            if (!Array.isArray(userResponses.selected_analysis_cards)) {
                userResponses.selected_analysis_cards = [];
            }
            const selections = userResponses.selected_analysis_cards;
            const idx = selections.indexOf(GENERAL_MONITORIA_CARD_KEY);
            if (checked && idx === -1) {
                selections.push(GENERAL_MONITORIA_CARD_KEY);
            } else if (!checked && idx > -1) {
                selections.splice(idx, 1);
            }
        }

        function clearTreeResponsesForNewAnalysis() {
            const preservedKeys = new Set(['processos_vinculados', 'selected_analysis_cards', 'contratos_status']);
            treeResponseKeys.forEach(key => {
                if (preservedKeys.has(key)) {
                    return;
                }
                delete userResponses[key];
            });
            userResponses.contratos_para_monitoria = [];
            userResponses.ativar_botao_monitoria = '';
            ['judicializado_pela_massa', 'propor_monitoria', 'tipo_de_acao', 'transitado', 'procedencia', 'data_de_transito', 'cumprimento_de_sentenca'].forEach(key => {
                delete userResponses[key];
            });
            const preservedSelections = (userResponses.selected_analysis_cards || []).filter(
                sel => sel === GENERAL_MONITORIA_CARD_KEY
            );
            userResponses.selected_analysis_cards = preservedSelections;
        }

        function syncEditingCardWithSaved(cardData) {
            if (!cardData) {
                return;
            }
            ensureUserResponsesShape();
            const editIndex =
                Number.isFinite(userResponses._editing_card_index) &&
                userResponses._editing_card_index >= 0
                    ? Number(userResponses._editing_card_index)
                    : null;
            if (editIndex === null) {
                return;
            }
            if (!Array.isArray(userResponses[SAVED_PROCESSOS_KEY])) {
                userResponses[SAVED_PROCESSOS_KEY] = [];
            }
            const savedCards = userResponses[SAVED_PROCESSOS_KEY];
            const updatedCard = deepClone(cardData);
            ensureSupervisionFields(updatedCard);
            savedCards[editIndex] = updatedCard;
            if (!Array.isArray(userResponses.processos_vinculados)) {
                userResponses.processos_vinculados = [];
            }
            userResponses.processos_vinculados[editIndex] = updatedCard;
        }

        function showEditModeIndicator(cnj, cardIndex) {
            // Remover indicador anterior se existir
            $('.edit-mode-indicator').remove();
    
            const isNaoJudicializado = !cnj || String(cnj).toLowerCase().includes('não') || String(cnj).trim() === '';
            const displayText = isNaoJudicializado ? 'Não Judicializado' : cnj;
    
            const $indicator = $(`
                <div class="edit-mode-indicator" style="
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-radius: 8px;
                    padding: 12px 20px;
                    margin-bottom: 15px;
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                ">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 20px;">✏️</span>
                        <div>
                            <strong style="display: block; font-size: 14px;">Modo de Edição</strong>
                            <span style="font-size: 12px; opacity: 0.9;">Editando: ${displayText}</span>
                        </div>
                    </div>
                    <button type="button" class="cancel-edit-btn" style="
                        background: rgba(255, 255, 255, 0.2);
                        color: white;
                        border: 1px solid rgba(255, 255, 255, 0.3);
                        border-radius: 4px;
                        padding: 6px 12px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.2s;
                    ">Cancelar Edição</button>
                </div>
            `);
    
            $dynamicQuestionsContainer.before($indicator);
    
            $indicator.find('.cancel-edit-btn').on('click', function() {
                const confirmar = confirm(
                    'Deseja cancelar a edição?\n\n' +
                    'As alterações não salvas serão perdidas.'
                );
        
                if (confirmar) {
                    $('.edit-mode-indicator').remove();
                    delete userResponses._editing_card_index;
                    clearTreeResponsesForNewAnalysis();
                    renderDecisionTree();
                    saveResponses();
                    console.log('Edição cancelada');
                }
            });
    
            $indicator.find('.cancel-edit-btn').hover(
                function() { $(this).css('background', 'rgba(255, 255, 255, 0.3)'); },
                function() { $(this).css('background', 'rgba(255, 255, 255, 0.2)'); }
            );
        }

        function restoreTreeFromCard(cardIndex) {
            const parsedIndex = Number(cardIndex);
            if (!Number.isFinite(parsedIndex)) {
                console.warn('restoreTreeFromCard: índice inválido:', cardIndex);
                return;
            }
            cardIndex = parsedIndex;
    
            console.log('=== INICIANDO EDIÇÃO DO CARD ===', cardIndex);
    
            userResponses._editing_card_index = cardIndex;
            const savedCards = getSavedProcessCards();
            const cardData = savedCards[cardIndex];
    
            if (!cardData) {
                console.warn('restoreTreeFromCard: card não encontrado no índice:', cardIndex);
                return;
            }

            console.log('Card encontrado:', cardData);

            clearTreeResponsesForNewAnalysis();
            userResponses.processos_vinculados = [deepClone(cardData)];
            ensureUserResponsesShape();
    
            const savedResponses = cardData.tipo_de_acao_respostas || {};

            console.log('🔍 Verificando primeira pergunta...');
            if (!savedResponses.hasOwnProperty('judicializado_pela_massa') || !savedResponses.judicializado_pela_massa) {
                console.log('⚠️ Primeira pergunta faltando!');
                if (savedResponses.tipo_de_acao && savedResponses.tipo_de_acao.trim() !== '') {
                    console.log('→ Tem tipo_de_acao =', savedResponses.tipo_de_acao);
                    console.log('→ Inferindo: judicializado_pela_massa = "SIM"');
                    savedResponses.judicializado_pela_massa = 'SIM';
                    userResponses.judicializado_pela_massa = 'SIM';
                } else if (savedResponses.propor_monitoria) {
                    console.log('→ Tem propor_monitoria =', savedResponses.propor_monitoria);
                    console.log('→ Inferindo: judicializado_pela_massa = "NÃO"');
                    savedResponses.judicializado_pela_massa = 'NÃO';
                    userResponses.judicializado_pela_massa = 'NÃO';
                } else {
                    console.log('→ Nenhuma pista, usando padrão = "NÃO"');
                    savedResponses.judicializado_pela_massa = 'NÃO';
                    userResponses.judicializado_pela_massa = 'NÃO';
                }
                console.log('✅ Primeira pergunta inferida:', savedResponses.judicializado_pela_massa);
            } else {
                console.log('✅ Primeira pergunta já existe:', savedResponses.judicializado_pela_massa);
            }
    
            console.log('Respostas salvas:', savedResponses);
    
            Object.keys(savedResponses).forEach(key => {
                userResponses[key] = deepClone(savedResponses[key]);
                console.log(`Carregando: ${key} =`, savedResponses[key]);
            });

            const contratoArray = parseContractsField(cardData.contratos);
            userResponses.contratos_para_monitoria = contratoArray;
            userResponses.ativar_botao_monitoria = contratoArray.length ? 'SIM' : '';

            console.log('UserResponses completo:', userResponses);

            console.log('Renderizando árvore...');
            renderDecisionTree();

            setTimeout(() => {
                console.log('=== INICIANDO POPULAÇÃO EM CASCATA ===');
    
                function populateFieldsCascade(attempt = 1, maxAttempts = 10) {
                    console.log(`--- Tentativa ${attempt} de ${maxAttempts} ---`);
    
                    const savedResponses = cardData.tipo_de_acao_respostas || {};
                    console.log('savedResponses disponível:', savedResponses);

                    const $allFields = $dynamicQuestionsContainer.find('[name]');
                    const totalFields = $allFields.length;
    
                    console.log(`Campos no DOM: ${totalFields}`);
    
                    let fieldsPopulated = 0;
    
                    $allFields.each(function() {
                        const $field = $(this);
                        const fieldName = $field.attr('name');
                        const currentValue = $field.val();

                        let savedValue = userResponses[fieldName];
                        if (savedValue === undefined && savedResponses && savedResponses[fieldName]) {
                            savedValue = savedResponses[fieldName];
                        }

                        console.log(`  Verificando campo: ${fieldName}, valor atual: "${currentValue}", valor salvo:`, savedValue);

                        if (savedValue !== undefined && savedValue !== null) {
                            const needsPopulation = !currentValue ||
                                                  currentValue === '---' ||
                                                  currentValue === '' ||
                                                  (Array.isArray(savedValue) && currentValue !== savedValue.join(','));

                            if (needsPopulation) {
                                console.log(`  → Populando: ${fieldName} = ${savedValue}`);

                                if ($field.attr('type') === 'checkbox') {
                                    const isChecked = String(savedValue).toUpperCase() === 'SIM' ||
                                                    String(savedValue).toLowerCase() === 'true' ||
                                                    savedValue === true;
                                    $field.prop('checked', isChecked);
                                    console.log(`    ✓ Checkbox setado para: ${isChecked}`);

                                } else if ($field.is('select')) {
                                    console.log(`    📋 Select detectado, valor desejado: "${savedValue}"`);
                                    const options = [];
                                    $field.find('option').each(function() {
                                        const optValue = $(this).val();
                                        const optText = $(this).text().trim();
                                        options.push({ value: optValue, text: optText });
                                        console.log(`      - Option: value="${optValue}", text="${optText}"`);
                                    });

                                    let matchedValue = null;
                                    if ($field.find(`option[value="${savedValue}"]`).length > 0) {
                                        matchedValue = savedValue;
                                        console.log(`    ✓ Match exato encontrado: "${matchedValue}"`);
                                    } else {
                                        $field.find('option').each(function() {
                                            const optValue = $(this).val();
                                            const optText = $(this).text().trim();

                                            if (optValue && optValue.toUpperCase().includes(String(savedValue).toUpperCase())) {
                                                matchedValue = optValue;
                                                console.log(`    ✓ Match parcial por value encontrado: "${matchedValue}"`);
                                                return false;
                                            }
                                            if (optText && optText.toUpperCase().includes(String(savedValue).toUpperCase())) {
                                                matchedValue = optValue;
                                                console.log(`    ✓ Match parcial por text encontrado: "${matchedValue}"`);
                                                return false;
                                            }
                                        });
                                    }

                                    if (!matchedValue && String(savedValue).toUpperCase() === 'SIM') {
                                        $field.find('option').each(function() {
                                            const optValue = $(this).val();
                                            if (optValue && optValue.toUpperCase().startsWith('SIM')) {
                                                matchedValue = optValue;
                                                console.log(`    ✓ Primeira option "SIM*" encontrada: "${matchedValue}"`);
                                                return false;
                                            }
                                        });
                                    }
                                    if (!matchedValue && String(savedValue).toUpperCase() === 'NÃO') {
                                        $field.find('option').each(function() {
                                            const optValue = $(this).val();
                                            if (optValue && (optValue.toUpperCase().startsWith('NÃO') || optValue.toUpperCase().startsWith('NAO'))) {
                                                matchedValue = optValue;
                                                console.log(`    ✓ Primeira option "NÃO*" encontrada: "${matchedValue}"`);
                                                return false;
                                            }
                                        });
                                    }

                                    if (matchedValue) {
                                        $field.val(matchedValue);
                                        console.log(`    ✅ Select populado com: "${matchedValue}"`);
                                    } else {
                                        console.warn(`    ⚠️ Nenhuma option correspondente encontrada para: "${savedValue}"`);
                                        console.warn(`    ⚠️ Options disponíveis:`, options);
                                        $field.val(savedValue);
                                    }

                                } else if ($field.attr('type') === 'date') {
                                    $field.val(savedValue);
                                    console.log(`    ✓ Date setado para: ${savedValue}`);

                                } else if ($field.attr('type') === 'radio') {
                                    $field.filter(`[value="${savedValue}"]`).prop('checked', true);
                                    console.log(`    ✓ Radio setado para: ${savedValue}`);

                                } else {
                                    $field.val(savedValue);
                                    console.log(`    ✓ Campo setado para: ${savedValue}`);
                                }

                                console.log(`    🔄 Disparando change event...`);
                                $field.trigger('change');

                                setTimeout(() => {
                                    const camposAposChange = $dynamicQuestionsContainer.find('[name]').length;
                                    console.log(`    📊 Campos após change: ${camposAposChange} (antes: ${totalFields})`);
                                    if (camposAposChange > totalFields) {
                                        console.log(`    ✅ Novos campos criados! (+${camposAposChange - totalFields})`);
                                    } else {
                                        console.log(`    ⚠️ Nenhum campo novo criado`);
                                    }
                                }, 200);

                                fieldsPopulated++;
                            } else {
                                console.log(`  ⏭️ Campo já populado, pulando`);
                            }
                        } else {
                            console.log(`  ⚠️ Sem valor salvo para: ${fieldName}`);
                        }
                    });
    
                    console.log(`  Campos populados: ${fieldsPopulated}`);
    
                    if (fieldsPopulated > 0 && attempt < maxAttempts) {
                        setTimeout(() => {
                            const $newFields = $dynamicQuestionsContainer.find('[name]');
                            const newTotalFields = $newFields.length;
    
                            console.log(`  Campos após change: ${newTotalFields}`);
    
                            if (newTotalFields > totalFields) {
                                console.log(`  ✅ Novos campos criados! Continuando...`);
                                populateFieldsCascade(attempt + 1, maxAttempts);
                            } else {
                                if (attempt < maxAttempts) {
                                    console.log(`  ⚠️ Nenhum campo novo, mas tentando novamente...`);
                                    populateFieldsCascade(attempt + 1, maxAttempts);
                                } else {
                                    console.log(`  ✅ Cascata finalizada`);
                                    finalizarEdicao();
                                }
                            }
                        }, 800);
                    } else {
                        console.log(`  ✅ Cascata finalizada (sem mais campos para popular)`);
                        finalizarEdicao();
                    }
                }
    
                function finalizarEdicao() {
                    console.log('=== FINALIZANDO EDIÇÃO ===');
    
                    if (typeof updateContractStars === 'function') {
                        updateContractStars();
                    }
    
                    if (typeof updateGenerateButtonState === 'function') {
                        updateGenerateButtonState();
                    }
    
                    saveResponses();
    
                    const $finalFields = $dynamicQuestionsContainer.find('[name]');
                    console.log(`=== TOTAL FINAL DE CAMPOS: ${$finalFields.length} ===`);
    
                    $finalFields.each(function() {
                        const fieldName = $(this).attr('name');
                        const fieldValue = $(this).val();
                        console.log(`  ${fieldName}: ${fieldValue}`);
                    });
    
                    console.log('=== EDIÇÃO CARREGADA COM SUCESSO ===');
    
                    showEditModeIndicator(cardData.cnj, cardIndex);
                }
    
                populateFieldsCascade();
    
            }, 500);
        }
        function scrollToProcessCard(cardIndexValue) {
            activateInnerTab('analise');
            if (cardIndexValue === 'general') {
                restoreTreeFromGeneralSnapshot();
                // CORRIGIDO: Aguardar renderização completa antes de rolar
                setTimeout(() => {
                    if ($dynamicQuestionsContainer.length) {
                        $dynamicQuestionsContainer.get(0).scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }, 800); // Aumentado para aguardar todos os delays escalonados
                return;
            }

            restoreTreeFromCard(cardIndexValue);
            // CORRIGIDO: Aguardar renderização completa antes de rolar
            setTimeout(() => {
                const selector = `.processo-card[data-card-index="${cardIndexValue}"]`;
                const $targetCard = $dynamicQuestionsContainer.find(selector);
                if ($targetCard.length) {
                    $targetCard.removeClass('collapsed');
                    $targetCard.find('.processo-card-toggle')
                        .text('−')
                        .attr('aria-expanded', 'true');
                    $targetCard.get(0).scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 800); // Aumentado para aguardar todos os delays escalonados
        }

        function startNewAnalysis(options = {}) {
            ensureUserResponsesShape();

            hasUserActivatedCardSelection = false;

            const suppressSummary = options.hasOwnProperty('suppressSummary')
                ? options.suppressSummary
                : true;
            suppressGeneralSummaryUntilFirstAnswer = suppressSummary;

            const skipGeneralSnapshot = Boolean(options.skipGeneralSnapshot);
            if (!skipGeneralSnapshot) {
                preserveGeneralCardBeforeReset();
            }
            clearTreeResponsesForNewAnalysis();
            renderDecisionTree();
            saveResponses();
            displayFormattedResponses();

            if ($dynamicQuestionsContainer.length) {
                $dynamicQuestionsContainer.get(0).scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        }

        function preserveGeneralCardBeforeReset() {
            const snapshot = getGeneralCardSnapshot();
            if (!snapshot || !(snapshot.contracts && snapshot.contracts.length)) {
                return;
            }
            ensureUserResponsesShape();
            const savedCards = getSavedProcessCards();
            const existingGeneralIndex = savedCards.findIndex(entry => entry && entry.general_card_snapshot);
            const cardData = {
                cnj: snapshot.responses && snapshot.responses.cnj ? snapshot.responses.cnj : 'Não Judicializado',
                contratos: [...snapshot.contracts],
                tipo_de_acao_respostas: { ...(snapshot.responses || {}) },
                supervisionado: snapshot.responses && snapshot.responses.supervisionado,
                supervisor_status: snapshot.responses && snapshot.responses.supervisor_status,
                barrado: snapshot.responses && snapshot.responses.barrado ? { ...snapshot.responses.barrado } : { ativo: false, inicio: null, retorno_em: null },
                general_card_snapshot: true
            };
            if (existingGeneralIndex > -1) {
                savedCards.splice(existingGeneralIndex, 1);
            }
            appendProcessCardToHistory(cardData);
        }

        function getServerUpdatedTimestamp() {
            const raw = $responseField.data('analise-updated-at');
            const parsed = raw ? Date.parse(raw) : NaN;
            return Number.isFinite(parsed) ? parsed : 0;
        }
        function getNotebookText() {
            let text = '';
            const notebookTextarea = document.querySelector('.notebook-textarea');
            if (notebookTextarea) {
                text = notebookTextarea.value;
            } else {
                text = localStorage.getItem(notebookStorageKey) || '';
            }
            return text;
        }

        function dispatchObservationUpdate(detail = '') {
            const value = detail || localStorage.getItem(notebookStorageKey) || '';
            if (detail && typeof detail === 'string') {
                localStorage.setItem(notebookStorageKey, detail);
            }
            window.dispatchEvent(new CustomEvent('analiseObservacoesSalvas', {
                detail: value
            }));
        }

        function restoreLocalResponsesIfNewer() {
            if (!localResponsesKey || typeof localStorage === 'undefined') {
                return;
            }
            const saved = localStorage.getItem(localResponsesKey);
            if (!saved) {
                return;
            }
            try {
                const parsed = JSON.parse(saved);
                if (!parsed || typeof parsed !== 'object') return;
                const storedData = parsed.data;
                const storedTs = Number(parsed.ts) || 0;
                if (!storedData) return;
                const serverTs = getServerUpdatedTimestamp();
                if (storedTs > serverTs) {
                    userResponses = storedData;
                    ensureUserResponsesShape();
                    console.info('Restaurando resposta da análise salva localmente.');
                }
            } catch (error) {
                console.warn('Falha ao restaurar rascunho local da análise:', error);
            }
        }

        function persistLocalResponses() {
            if (!localResponsesKey || typeof localStorage === 'undefined') {
                return;
            }
            try {
                localStorage.setItem(
                    localResponsesKey,
                    JSON.stringify({
                        ts: Date.now(),
                        data: userResponses
                    })
                );
            } catch (error) {
                console.warn('Não foi possível salvar localmente as respostas da análise:', error);
            }
        }

        function clearLocalResponses() {
            if (!localResponsesKey || typeof localStorage === 'undefined') {
                return;
            }
            localStorage.removeItem(localResponsesKey);
        }

        function normalizeResponse(value) {
            if (typeof value !== 'string') {
                return '';
            }
            return value.trim().toUpperCase();
        }

        function updateGenerateButtonState() {
            const $gerarMonitoriaBtn = $('#id_gerar_monitoria_btn'); // Buscar dinamicamente
            if (!$gerarMonitoriaBtn.length) return;

            const generalEnabled =
                isGeneralMonitoriaEligible() &&
                isGeneralMonitoriaSelected();
            const cardSelectionEnabled = hasAnySummaryCardSelection();
            if (!hasUserActivatedCardSelection) {
                $gerarMonitoriaBtn.prop('disabled', true);
                return;
            }
            $gerarMonitoriaBtn.prop('disabled', !(generalEnabled || cardSelectionEnabled));
        }

        function updateContractStars() {
            // Evita limpar seleção antes de termos os contratos carregados do DOM
            if (!allAvailableContratos || allAvailableContratos.length === 0) {
                return;
            }

            $('.monitoria-star').remove();

            let contratosParaMonitoria = userResponses.contratos_para_monitoria || [];

            contratosParaMonitoria = contratosParaMonitoria.filter(function (contratoId) {
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

            contratosParaMonitoria.forEach(function (contratoId) {
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
            restoreLocalResponsesIfNewer();
            migrateProcessCardsIfNeeded();
            console.log(
                "DEBUG A_P_A: loadExistingResponses - userResponses APÓS carregarః",
                JSON.stringify(userResponses)
            );

            displayFormattedResponses(); // Isso vai criar o botão
            updateContractStars();
            updateGenerateButtonState(); // Isso vai atualizar o estado do botão
            initAutoSaveListeners();
        }

        let autoSaveTimer = null;
        let autoSaveListenersAttached = false;

        function scheduleAutoSave() {
            if (autoSaveTimer) {
                clearTimeout(autoSaveTimer);
            }
            autoSaveTimer = setTimeout(() => {
                autoSaveTimer = null;
                saveResponses();
            }, 400);
        }

        function initAutoSaveListeners() {
            if (autoSaveListenersAttached) {
                return;
            }
            const container = $dynamicQuestionsContainer.get(0);
            if (!container) {
                return;
            }
            const handler = () => scheduleAutoSave();
            ['input', 'change'].forEach(eventName => {
                container.addEventListener(eventName, handler, true);
            });
            autoSaveListenersAttached = true;
        }

        function flushPendingSave() {
            if (autoSaveTimer) {
                clearTimeout(autoSaveTimer);
                autoSaveTimer = null;
                saveResponses();
            }
        }

        window.addEventListener('beforeunload', flushPendingSave);

        function saveResponses() {
            if (autoSaveTimer) {
                clearTimeout(autoSaveTimer);
                autoSaveTimer = null;
            }
            ensureUserResponsesShape();
            const treeSelectionIds = getMonitoriaContractIds();
            userResponses.contratos_para_monitoria = treeSelectionIds;
            const currentGeneralSnapshot = getGeneralCardSnapshot();
            if (isCurrentGeneralMonitoriaEligible() && !shouldSkipGeneralCard()) {
                const generalSnapshot = buildGeneralCardSnapshotFromCurrentResponses();
                if (generalSnapshot) {
                    setGeneralCardSnapshot(generalSnapshot);
                }
            } else if (
                !currentGeneralSnapshot ||
                !Array.isArray(currentGeneralSnapshot.contracts) ||
                currentGeneralSnapshot.contracts.length === 0
            ) {
                setGeneralCardSnapshot(null);
            }
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
            persistLocalResponses();
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

        function parseDecimalValue(raw) {
            if (raw === undefined || raw === null) {
                return null;
            }
            const sanitized = String(raw).trim();
            if (!sanitized) {
                return null;
            }
            let normalized = sanitized.replace(/[^\d.,-]/g, '');
            const hasComma = normalized.indexOf(',') >= 0;
            const hasDot = normalized.indexOf('.') >= 0;
            if (hasComma && hasDot) {
                normalized = normalized.replace(/\./g, '');
                normalized = normalized.replace(',', '.');
            } else if (hasComma) {
                normalized = normalized.replace(',', '.');
            }
            const parsed = parseFloat(normalized);
            return Number.isFinite(parsed) ? parsed : null;
        }

        function formatCurrency(value) {
            const numeric = Number.isFinite(value) ? value : 0;
            return currencyFormatter.format(numeric);
        }

        function parseContractsField(value) {
            if (!value) return [];
            if (Array.isArray(value)) {
                return value.map(item => String(item).trim()).filter(Boolean);
            }
            return String(value)
                .split(',')
                .map(part => part.trim())
                .filter(Boolean);
        }

        function populateTreeFieldsFromResponses(responses) {
            if (!responses || typeof responses !== 'object') {
                return;
            }
            const excludedKeys = new Set([
                'processos_vinculados',
                'selected_analysis_cards',
                'contratos_status',
                'notebook'
            ]);
            const orderedKeys = (Array.isArray(treeResponseKeys) && treeResponseKeys.length
                ? treeResponseKeys.filter(key => responses.hasOwnProperty(key))
                : Object.keys(responses));
            orderedKeys.forEach(key => {
                if (excludedKeys.has(key)) {
                    return;
                }
                const $fields = $(`[name="${key}"]`);
                if (!$fields.length) {
                    return;
                }
                $fields.each(function () {
                    const $field = $(this);
                    if ($field.attr('type') === 'checkbox') {
                        $field.prop('checked', String(responses[key]).toLowerCase() === 'sim');
                    } else {
                        $field.val(responses[key]);
                    }
                    $field.trigger('change');
                });
            });
        }

        function formatDateDisplay(value) {
            if (!value) return null;
            const parsed = new Date(value);
            if (Number.isNaN(parsed.getTime())) return null;
            const pad = n => ('0' + n).slice(-2);
            return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
        }


        function extractCnjDigits(text) {
            if (!text) return null;
            const match = text.match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
            if (match) {
                return match[1].replace(/\D/g, '');
            }
            return null;
        }

        function getNextSupervisorStatus(current) {
            const currentIndex = SUPERVISION_STATUS_SEQUENCE.indexOf(current);
            const nextIndex = (currentIndex + 1) % SUPERVISION_STATUS_SEQUENCE.length;
            return SUPERVISION_STATUS_SEQUENCE[nextIndex];
        }

        function getObservationEntriesForCnj(cnj, relatedContracts) {
            if (!cnj || typeof localStorage === 'undefined') {
                return [];
            }
            const rawNotes = localStorage.getItem(notebookStorageKey) || '';
            if (!rawNotes.trim()) {
                return [];
            }
            const normalizedCnjDigits = cnj.replace(/\D/g, '');
            const entries = rawNotes
                .split(/\n{2,}/)
                .map(entry => entry.trim())
                .filter(Boolean);

            const parsedEntries = entries.map(entry => {
                const lines = entry
                    .split('\n')
                    .map(line => line.trim())
                    .filter(Boolean);
                const mentionLines = lines.filter(line =>
                    /cnj/i.test(line) || /contratos?\s*:/i.test(line)
                );
                const contentLines = lines.filter(line =>
                    !mentionLines.includes(line)
                );
                const summaryLine = contentLines[0] || mentionLines[0] || lines[0] || '';
                return {
                    raw: entry,
                    mentionLines,
                    contentLines,
                    summary: summaryLine,
                    cnjDigits: extractCnjDigits(entry)
                };
            });

            const matches = [];
            let capturing = false;
            parsedEntries.forEach(entry => {
                const lowerRaw = (entry.raw || '').toLowerCase();
                const hasTargetCnj = normalizedCnjDigits
                    ? entry.raw.replace(/\D/g, '').includes(normalizedCnjDigits)
                    : lowerRaw.includes(cnj.toLowerCase());
                if (hasTargetCnj) {
                    capturing = true;
                } else if (
                    capturing &&
                    entry.cnjDigits &&
                    entry.cnjDigits !== normalizedCnjDigits
                ) {
                    capturing = false;
                }
                if (capturing) {
                    matches.push(entry);
                }
            });

            if (!matches.length && relatedContracts && relatedContracts.length) {
                return parsedEntries.filter(entry =>
                    relatedContracts.some(contractId =>
                        entry.raw.includes(String(contractId))
                    )
                );
            }

            return matches;
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

        function getContractNumberDisplay(contractIds = []) {
            return contractIds
                .map(id => {
                    const contratoInfo = allAvailableContratos.find(c => String(c.id) === String(id));
                    return contratoInfo ? contratoInfo.numero_contrato : `ID ${id}`;
                })
                .filter(Boolean);
        }

        function formatAnsweredValue(key, value) {
            if (Array.isArray(value)) {
                if (key === 'contratos_para_monitoria') {
                    const contractNumbers = getContractNumberDisplay(value);
                    return contractNumbers.length ? contractNumbers.join(', ') : value.join(', ');
                }
                return value.join(', ');
            }
            return String(value);
        }

        function getAnsweredFieldEntries(processo, options = {}) {
            if (!processo || typeof processo !== 'object') {
                return [];
            }
            const responseOrder = [
                'judicializado_pela_massa',
                'tipo_de_acao',
                'julgamento',
                'transitado',
                'procedencia',
                'data_de_transito',
                'cumprimento_de_sentenca',
                'repropor_monitoria',
                'contratos_para_monitoria',
                'ativar_botao_monitoria'
            ];
            const excludeFields = Array.isArray(options.excludeFields) ? options.excludeFields : [];
            const labels = {
                judicializado_pela_massa: 'Judicializado pela massa',
                tipo_de_acao: 'Tipo de ação',
                julgamento: 'Julgamento',
                transitado: 'Transitado',
                procedencia: 'Procedência',
                data_de_transito: 'Data de trânsito',
                cumprimento_de_sentenca: 'Cumprimento de sentença',
                repropor_monitoria: 'Repropor monitória',
                contratos_para_monitoria: 'Contratos para monitória',
                ativar_botao_monitoria: 'Ativar botão monitória'
            };
            const entries = [];
            responseOrder.forEach(key => {
                let value = undefined;
                if (processo.hasOwnProperty(key)) {
                    value = processo[key];
                }
                if ((value === undefined || value === null) && processo.tipo_de_acao_respostas) {
                    value = processo.tipo_de_acao_respostas[key];
                }
                if (value === undefined || value === null || value === '') {
                    return;
                }
                if (excludeFields.includes(key)) {
                    return;
                }
                entries.push({
                    label: labels[key] || key,
                    value: formatAnsweredValue(key, value)
                });
            });
            return entries;
        }

        function buildProcessoDetailsSnapshot(processo, options = {}) {
            const cnjVinculado = processo.cnj || 'Não informado';
            const $ulDetalhes = $('<ul></ul>');
            const contratoInfos = (processo.contratos || []).map(cId => {
                const cInfo = allAvailableContratos.find(c => String(c.id) === String(cId));
                if (cInfo) {
                    return cInfo;
                }
                const fallback = fetchContractInfoFromDOM(cId);
                if (fallback) {
                    return fallback;
                }
                return {
                    id: cId,
                    numero_contrato: `ID ${cId}`,
                    valor_total_devido: 0,
                    valor_causa: 0
                };
            });

            if (contratoInfos.length > 0) {
                const nomesContratos = contratoInfos
                    .map(c => c.numero_contrato || `ID ${c.id}`)
                    .join(', ');
                $ulDetalhes.append(
                    `<li><strong>Contratos Vinculados:</strong> ${nomesContratos}</li>`
                );
            } else {
                $ulDetalhes.append(
                    '<li><strong>Contratos Vinculados:</strong> Nenhum</li>'
                );
            }

            const totalDevido = contratoInfos.reduce(
                (acc, c) => acc + (c.valor_total_devido || 0),
                0
            );
            const totalCausa = contratoInfos.reduce(
                (acc, c) => acc + (c.valor_causa || 0),
                0
            );
            $ulDetalhes.append(
                `<li><strong>Valor Total Devido:</strong> ${formatCurrency(totalDevido)}</li>`
            );
            $ulDetalhes.append(
                `<li><strong>Valor da Causa:</strong> ${formatCurrency(totalCausa)}</li>`
            );

            const fieldEntries = getAnsweredFieldEntries(processo, {
                excludeFields: options.excludeFields || []
            });
            if (fieldEntries.length) {
                const $liAcao = $('<li><strong>Resultado da Análise:</strong><ul></ul></li>');
                const $ulAcao = $liAcao.find('ul');
                fieldEntries.forEach(entry => {
                    $ulAcao.append(
                        `<li>${entry.label}: ${entry.value}</li>`
                    );
                });
                $ulDetalhes.append($liAcao);
            }

            const contractsReferenced = Array.from(
                new Set(contratoInfos.map(c => c.id))
            );
            const observationEntries = getObservationEntriesForCnj(cnjVinculado, contractsReferenced);

            return {
                cnj: cnjVinculado,
                contratoInfos,
                contractIds: contractsReferenced,
                $detailsList: $ulDetalhes,
                observationEntries
            };
        }

        function adjustObservationTextareaHeight($textarea) {
            if (!$textarea || !$textarea.length) {
                return;
            }
            $textarea.css('height', 'auto');
            const scrollHeight = $textarea.prop('scrollHeight');
            $textarea.css('height', `${scrollHeight}px`);
        }

        function createObservationNoteElement(observationEntries) {
            if (!observationEntries || !observationEntries.length) {
                return null;
            }
            const populatedEntries = observationEntries.filter(entry => entry.contentLines && entry.contentLines.length);
            if (!populatedEntries.length) {
                return null;
            }
            const $note = $('<div class="analise-observation-note" role="status"></div>');
            $note.append('<span class="analise-observation-pin" aria-hidden="true"></span>');
            const $noteContent = $('<div class="analise-observation-content"></div>');
            $noteContent.append('<strong>Observações</strong>');
            const $noteTextarea = $('<textarea class="analise-observation-textarea" readonly></textarea>');
            const allLines = [];
            populatedEntries.forEach(entry => {
                const contentLines = (entry.contentLines || []).filter(Boolean);
                if (contentLines.length) {
                    contentLines.forEach(line => {
                        allLines.push(line);
                    });
                }
            });
            $noteTextarea.val(allLines.join('\n'));
            $noteContent.append($noteTextarea);
            adjustObservationTextareaHeight($noteTextarea);
            const $refreshButton = $('<button type="button" class="analise-observation-refresh" title="Atualizar observações">A</button>');
            $refreshButton.on('click', () => {
                const updatedText = getNotebookText();
                dispatchObservationUpdate(updatedText);
            });
            $note.append($noteContent);
            $note.append($refreshButton);
            return $note;
        }

        function appendNotesColumn($detailsRow, noteElements, options = {}) {
            const notes = (noteElements || []).filter(Boolean);
            if (!notes.length) {
                return;
            }
            const $notesColumn = $('<div class="analise-card-notes-column"></div>');
            notes.forEach(note => {
                $notesColumn.append(note);
            });
            if (options.cnj) {
                $notesColumn.attr('data-analise-cnj', options.cnj);
            }
            if (Array.isArray(options.contracts) && options.contracts.length) {
                $notesColumn.attr('data-analise-contracts', options.contracts.join(','));
            }
            $detailsRow.append($notesColumn);
        }

        function createSupervisorNoteElement(processo, options = {}) {
            if (!processo) {
                return null;
            }
            const editable = options.editable !== false;
            const placeholderText = 'Anote sua observação...';
            const $note = $('<div class="analise-supervisor-note"></div>');
            $note.append('<strong>Observações do Supervisor</strong>');
            const $textArea = $(
                `<textarea class="analise-supervisor-note-text" rows="4" placeholder="${placeholderText}"></textarea>`
            );
            if (!editable) {
                $textArea.prop('readonly', true);
                $textArea.attr('tabindex', -1);
            }

            $note.append($textArea);

            const currentText = processo.supervisor_observacoes || '';
            $textArea.val(currentText);
            if (!editable) {
                return $note;
            }

            let saveTimeout = null;
            const persistObservation = () => {
                const value = $textArea.val().trim();
                processo.supervisor_observacoes = value;
                processo.supervisor_observacoes_autor = value ? currentSupervisorUsername : '';
                saveResponses();
            };

            $textArea.on('input', () => {
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                }
                saveTimeout = setTimeout(persistObservation, 500);
            });
            $textArea.on('change', persistObservation);

            return $note;
        }

        function ensureSupervisionFields(processo) {
            if (!processo || typeof processo !== 'object') {
                return;
            }
            if (!SUPERVISION_STATUS_SEQUENCE.includes(processo.supervisor_status)) {
                processo.supervisor_status = 'pendente';
            }
            processo.barrado = processo.barrado || {};
            processo.barrado.ativo = Boolean(processo.barrado.ativo);
            processo.barrado.inicio = processo.barrado.inicio || null;
            processo.barrado.retorno_em = processo.barrado.retorno_em || null;
            if (typeof processo.awaiting_supervision_confirm === 'undefined') {
                processo.awaiting_supervision_confirm = false;
            }
            if (typeof processo.supervisionado === 'undefined') {
                processo.supervisionado = false;
            }
        }

        function buildSummaryStatusMetadata(processo, options = {}) {
            if (!processo || typeof processo !== 'object') {
                return {
                    label: SUPERVISION_STATUS_LABELS.pendente,
                    classes: ['status-pendente'],
                    tooltip: ''
                };
            }
            ensureSupervisionFields(processo);
            const statusKey = processo.supervisor_status || 'pendente';
            const baseLabel = SUPERVISION_STATUS_LABELS[statusKey] || statusKey;
            const baseClass = SUPERVISION_STATUS_CLASSES[statusKey] || 'status-pendente';
            const classes = [baseClass];
            let label = baseLabel;
            let tooltip = '';
            if (processo.barrado && processo.barrado.ativo) {
                classes.push('status-barrado');
                const inicio = formatDateDisplay(processo.barrado.inicio) || processo.barrado.inicio || 'data não informada';
                const retorno = formatDateDisplay(processo.barrado.retorno_em) || processo.barrado.retorno_em || 'sem data definida';
                tooltip = `Ficou barrado de ${inicio} a ${retorno}`;
                if (statusKey === 'aprovado') {
                    label = 'Aprovado & Barrado';
                } else if (statusKey === 'reprovado') {
                    label = 'Reprovado & Barrado';
                } else {
                    label = 'Barrado';
                }
            }
            const shouldShow = options.showAlways || statusKey !== 'pendente' || (processo.barrado && processo.barrado.ativo);
            return { label, classes, tooltip, show: shouldShow };
        }

        function shouldSkipGeneralCard() {
            return false;
        }

        function displayFormattedResponses() {
            $formattedResponsesContainer.empty();

            const hasSavedCards = getSavedProcessCards().length > 0;
            const hasGeneralSnapshot = Boolean(getGeneralCardSnapshot());
            if (
                suppressGeneralSummaryUntilFirstAnswer &&
                !userResponses.judicializado_pela_massa &&
                !hasSavedCards &&
                !hasGeneralSnapshot
            ) {
                return;
            }

            // Container flex para título e botão (posicionado discretamente alinhado à direita)
            const $headerContainer = $('<div style="display: flex; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 10px;"></div>');
            $headerContainer.append('<h3>Respostas da Análise</h3>');

            // Botões de ação
            const $btnGroup = $('<div style="display:flex; gap:8px; margin-left:auto;"></div>');
            const $gerarMonitoriaBtnDynamic = $('<button type="button" id="id_gerar_monitoria_btn" class="button" style="background-color: #28a745; color: white;">Gerar Petição Monitória (PDF)</button>');
            const $gerarCobrancaBtnDynamic = $('<button type="button" id="id_gerar_cobranca_btn" class="button" style="background-color: #1c7ed6; color: white;">Petição Cobrança Judicial (PDF)</button>');
            $btnGroup.append($gerarMonitoriaBtnDynamic);
            $btnGroup.append($gerarCobrancaBtnDynamic);
            $headerContainer.append($btnGroup);
            $formattedResponsesContainer.append($headerContainer);
            $gerarMonitoriaBtnDynamic.prop('disabled', true);


            ensureUserResponsesShape();

            const generalSnapshot = getGeneralCardSnapshot();
            const generalSnapshotReady = generalSnapshot &&
                Array.isArray(generalSnapshot.contracts) &&
                generalSnapshot.contracts.length > 0 &&
                !shouldSkipGeneralCard();
            const generalEligible = generalSnapshotReady;
            const savedProcessCount = getSavedProcessCards().length;
            const temDadosRelevantes =
                generalSnapshotReady ||
                userResponses.judicializado_pela_massa ||
                Object.keys(userResponses.contratos_status || {}).length > 0 ||
                savedProcessCount > 0;

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

            const cnjFieldVal = $('input[name="cnj"]').val() || '';
            const analiseCnjRaw = $responseField.data('analise-cnj') || cnjFieldVal || '';
            const analiseCnj = analiseCnjRaw ? formatCnjDigits(analiseCnjRaw) : '';

            const updatedAtRaw = $responseField.data('analise-updated-at');
            const updatedBy = $responseField.data('analise-updated-by');

            const tipoAcaoPrincipal = userResponses.tipo_de_acao || 'Não informado';

            /* ---------- Cards de Processos CNJ vinculados ---------- */

            const processosVinculados = getCombinedProcessCardsForSummary();
            if (Array.isArray(processosVinculados) && processosVinculados.length > 0) {
                processosVinculados.forEach((processo, idx) => {
                    if (
                        processo &&
                        typeof processo.cnj === 'string' &&
                        processo.cnj.toLowerCase().includes('não judicializado')
                    ) {
                        return;
                    }
                const cardIndex = idx;
                const savedCardIndex = Number.isFinite(processo.__savedIndex)
                    ? processo.__savedIndex
                    : cardIndex;
                    const snapshot = buildProcessoDetailsSnapshot(processo);
                    const $cardVinculado = $('<div class="analise-summary-card"></div>');
                    const $headerVinculado = $('<div class="analise-summary-card-header"></div>');
                    const $bodyVinculado = $('<div class="analise-summary-card-body"></div>');

                    $headerVinculado.append(
                        `<span>Processo CNJ: <strong>${snapshot.cnj}</strong></span>`
                    );
                    const summaryStatus = buildSummaryStatusMetadata(processo, {
                        showAlways: Boolean(processo.supervisionado)
                    });
                    const $statusBadge = $('<span class="supervisor-status-badge"></span>');
                    $statusBadge.text(summaryStatus.label);
                    summaryStatus.classes.forEach(cls => $statusBadge.addClass(cls));
                    if (summaryStatus.tooltip) {
                        $statusBadge.attr('title', summaryStatus.tooltip);
                    }
                    if (summaryStatus.show) {
                        $headerVinculado.append($statusBadge);
                    }
                    const $toggleBtnVinculado = $('<button type="button" class="analise-toggle-btn"> + </button>');
                    $headerVinculado.append($toggleBtnVinculado);
                    const $deleteBtn = $('<button type="button" class="analise-summary-card-delete" title="Excluir esta análise">✕</button>');
                    $headerVinculado.append($deleteBtn);
                    const $editBtn = $('<button type="button" class="analise-summary-card-edit" title="Editar esta análise">Editar</button>');
                    $headerVinculado.append($editBtn);
                    const cardKey = `card-${cardIndex}`;
                    const savedIndexAttr = Number.isFinite(savedCardIndex) ? String(savedCardIndex) : '';
                    $deleteBtn.attr('data-card-index', savedIndexAttr);
                    $editBtn.attr('data-saved-index', savedIndexAttr);
                    $editBtn.attr('data-cnj', snapshot.cnj || '');
                    $editBtn.attr('data-visual-index', String(cardIndex));
                    $deleteBtn.on('click', function () {
                        if (Array.isArray(userResponses.processos_vinculados)) {
                            userResponses.processos_vinculados.splice(cardIndex, 1);
                        }
                        const savedCards = userResponses[SAVED_PROCESSOS_KEY] || [];
                        const attrIndex = $(this).attr('data-card-index');
                        const targetIndex = attrIndex ? Number(attrIndex) : null;
                        if (Number.isFinite(targetIndex) && savedCards[targetIndex]) {
                            savedCards.splice(targetIndex, 1);
                        } else if (savedCards[cardIndex]) {
                            savedCards.splice(cardIndex, 1);
                        }
                        if (Array.isArray(userResponses.selected_analysis_cards)) {
                            userResponses.selected_analysis_cards = userResponses.selected_analysis_cards.filter(sel => sel !== cardKey);
                        }
                        saveResponses();
                        displayFormattedResponses();
                    });
                    $editBtn.on('click', function () {
                        suppressGeneralSummaryUntilFirstAnswer = false;
                        activateInnerTab('analise');

                        const savedIndexRaw = $(this).attr('data-saved-index');
                        const savedIndex = savedIndexRaw !== null && savedIndexRaw !== '' ? Number(savedIndexRaw) : NaN;
                        if (Number.isFinite(savedIndex)) {
                            restoreTreeFromCard(savedIndex);
                            setTimeout(() => {
                                if ($dynamicQuestionsContainer.length) {
                                    $dynamicQuestionsContainer.get(0).scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }
                            }, 300);
                            return;
                        }

                        const cnj = String($(this).attr('data-cnj') || '').trim();
                        if (cnj) {
                            const savedCards = getSavedProcessCards();
                            const foundIndex = savedCards.findIndex(card => card && String(card.cnj || '').trim() === cnj);
                            if (foundIndex > -1) {
                                restoreTreeFromCard(foundIndex);
                                setTimeout(() => {
                                    if ($dynamicQuestionsContainer.length) {
                                        $dynamicQuestionsContainer.get(0).scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                }, 300);
                                return;
                            }
                        }

                        const visualIndexRaw = $(this).attr('data-visual-index');
                        const visualIndex = visualIndexRaw ? Number(visualIndexRaw) : NaN;
                        if (Number.isFinite(visualIndex)) {
                            restoreTreeFromCard(visualIndex);
                            setTimeout(() => {
                                if ($dynamicQuestionsContainer.length) {
                                    $dynamicQuestionsContainer.get(0).scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }
                            }, 300);
                            return;
                        }

                        console.warn('Editar: não foi possível resolver o card para edição.', { savedIndexRaw, cnj, visualIndexRaw });
                    });
                    const actionResponses = processo && processo.tipo_de_acao_respostas;
                    let contractCandidates = parseContractsField(
                        actionResponses && actionResponses.contratos_para_monitoria
                            ? actionResponses.contratos_para_monitoria
                            : []
                    );
                    if (contractCandidates.length === 0 && Array.isArray(processo.contratos)) {
                        contractCandidates = processo.contratos.map(String);
                    }
                    const canSelectForMonitoria =
                        processo &&
                        contractCandidates.length > 0;
                    if (canSelectForMonitoria) {
                        const $cardCheckbox = $(
                            `<input type="checkbox" id="${cardKey}-checkbox">`
                        );
                        $cardCheckbox.prop('disabled', false);
                        const isSelected = Array.isArray(userResponses.selected_analysis_cards) &&
                            userResponses.selected_analysis_cards.includes(cardKey);
                        if (isSelected) {
                            $cardCheckbox.prop('checked', true);
                        }
                        const { show, tooltip } = buildSummaryStatusMetadata(processo);
                        const $checkboxLabel = $(
                            `<label for="${cardKey}-checkbox" ${!show ? `title="${tooltip || 'Aguardando aprovação'}"` : ''}> </label>`
                        );
                        $cardCheckbox.prop('disabled', false);
                        $headerVinculado.prepend($checkboxLabel.prepend($cardCheckbox));
                        $cardCheckbox.on('change', function () {
                            hasUserActivatedCardSelection = true;
                            if (!Array.isArray(userResponses.selected_analysis_cards)) {
                                userResponses.selected_analysis_cards = [];
                            }
                            const selections = userResponses.selected_analysis_cards;
                            const isChecked = $(this).is(':checked');
                            const idx = selections.indexOf(cardKey);
                            if (isChecked && idx === -1) {
                                selections.push(cardKey);
                            } else if (!isChecked && idx > -1) {
                                selections.splice(idx, 1);
                            }
                            updateGenerateButtonState();
                        });
                    }

                    $cardVinculado.append($headerVinculado);

                    const $detailsRow = $('<div class="analise-card-details-row"></div>');
                    $detailsRow.append(snapshot.$detailsList);
                    const $noteElement = createObservationNoteElement(snapshot.observationEntries);
                    const $supervisorNoteElement = createSupervisorNoteElement(processo, { editable: false });
                    appendNotesColumn($detailsRow, [$noteElement, $supervisorNoteElement], {
                        cnj: snapshot.cnj,
                        contracts: snapshot.contractIds
                    });
                    $bodyVinculado.append($detailsRow);
                    $cardVinculado.append($bodyVinculado);
                    $formattedResponsesContainer.append($cardVinculado);

                    const cardExpanded = getCardExpansionState(cardKey, false);
                    if (cardExpanded) {
                        $bodyVinculado.show();
                        $toggleBtnVinculado.text(' - ');
                    } else {
                        $bodyVinculado.hide();
                        $toggleBtnVinculado.text(' + ');
                    }

                    $toggleBtnVinculado.on('click', function () {
                        $bodyVinculado.slideToggle(200, function () {
                            const expanded = $bodyVinculado.is(':visible');
                            $toggleBtnVinculado.text(expanded ? ' - ' : ' + ');
                            setCardExpansionState(cardKey, expanded);
                        });
                    });
                });
            }
            const hasSummaryCard = generalEligible || processosVinculados.length > 0;
            if (isSupervisorUser) {
                renderSupervisionPanel();
            }
        }


        function getTodayIso() {
            return new Date().toISOString().slice(0, 10);
        }

        function createSupervisionFooter(processo, onStatusChange) {
            const $footer = $('<div class="analise-supervision-footer"></div>');
            const $statusBtn = $('<button type="button" class="analise-supervision-status-btn"></button>');
            const $barrarGroup = $('<div class="analise-supervision-barrar-group"></div>');
            const $barrarToggle = $('<button type="button" class="analise-supervision-barrar-toggle"></button>');
            const $barrarDate = $('<input type="date" class="analise-supervision-barrar-date">');
            const $barradoInfoToggle = $('<button type="button" class="analise-supervision-barrado-info-toggle" aria-expanded="false">+</button>');
            const $barradoNote = $('<div class="analise-supervision-barrado-note" style="display:none;"></div>');
            const $concludeRow = $('<div class="analise-supervision-conclude-row"></div>');
            const $concludeBtn = $('<button type="button" class="analise-supervision-conclude-btn">Concluir Revisão</button>');
            const updateConcludeButton = () => {
                const needsConfirm = Boolean(processo.awaiting_supervision_confirm) && (processo.supervisor_status || 'pendente') !== 'pendente';
                $concludeBtn.prop('disabled', !needsConfirm);
            };

            const updateStatusButton = () => {
                const status = processo.supervisor_status || 'pendente';
                $statusBtn.text(`Status: ${SUPERVISION_STATUS_LABELS[status] || status}`);
                const allStatusClasses = Object.values(SUPERVISION_STATUS_CLASSES).join(' ');
                $statusBtn.removeClass(allStatusClasses);
                $statusBtn.addClass(SUPERVISION_STATUS_CLASSES[status]);
                processo.awaiting_supervision_confirm = status !== 'pendente';
                if (typeof onStatusChange === 'function') {
                    onStatusChange(status);
                }
                updateConcludeButton();
            };

            const updateBarradoControls = () => {
                const { barrado } = processo;
                const hasInicio = Boolean(barrado.inicio);
                const hasRetorno = Boolean(barrado.retorno_em);
                $barrarToggle.text(barrado.ativo ? 'Desbloquear' : 'Barrar');
                $barrarDate.val(barrado.retorno_em || '');
                if (hasInicio) {
                    const inicio = formatDateDisplay(barrado.inicio) || barrado.inicio;
                    const retorno = hasRetorno
                        ? (formatDateDisplay(barrado.retorno_em) || barrado.retorno_em)
                        : 'sem data definida';
                    $barradoNote.text(`Ficou barrado de ${inicio} a ${retorno}`);
                    $barradoNote.show();
                    $barradoInfoToggle.show().text('+').attr('aria-expanded', 'false');
                } else {
                    $barradoNote.text('');
                    $barradoNote.hide();
                    $barradoInfoToggle.hide();
                    $barradoInfoToggle.attr('aria-expanded', 'false').text('+');
                }
            };

            $statusBtn.on('click', () => {
                processo.supervisor_status = getNextSupervisorStatus(processo.supervisor_status);
                updateStatusButton();
                if (processo.cnj && processo.cnj.toLowerCase().includes('não judicializado')) {
                    userResponses.supervisor_status_nao_judicializado = processo.supervisor_status;
                    userResponses.supervisionado_nao_judicializado = true;
                    userResponses.barrado_nao_judicializado = processo.barrado || { ativo: false, inicio: null, retorno_em: null };
                }
                saveResponses();
            });

            $barrarToggle.on('click', () => {
                processo.barrado.ativo = !processo.barrado.ativo;
                if (processo.barrado.ativo && !processo.barrado.inicio) {
                    processo.barrado.inicio = getTodayIso();
                }
                if (!processo.barrado.ativo) {
                    processo.barrado.retorno_em = null;
                }
                updateBarradoControls();
                saveResponses();
            });

            $barrarDate.on('change', function () {
                const value = $(this).val();
                processo.barrado.retorno_em = value || null;
                if (value) {
                    processo.barrado.ativo = true;
                    if (!processo.barrado.inicio) {
                        processo.barrado.inicio = getTodayIso();
                    }
                } else {
                    processo.barrado.ativo = false;
                }
                updateBarradoControls();
                saveResponses();
            });

            updateStatusButton();
            updateBarradoControls();

            $footer.append($statusBtn);
            $barrarGroup.append($barrarToggle);
            $barrarGroup.append($barrarDate);
            $barrarGroup.append($barradoInfoToggle);
            $footer.append($barrarGroup);
            $footer.append($barradoNote);
            $barradoInfoToggle.on('click', () => {
                if ($barradoNote.is(':visible')) {
                    $barradoNote.slideUp(100);
                    $barradoInfoToggle.text('+').attr('aria-expanded', 'false');
                } else if ($barradoNote.text().trim()) {
                    $barradoNote.slideDown(120);
                    $barradoInfoToggle.text('-').attr('aria-expanded', 'true');
                }
            });
            $concludeRow.append($concludeBtn);
            $footer.append($concludeRow);
            updateConcludeButton();

            $concludeBtn.on('click', () => {
                processo.supervisionado = false;
                processo.awaiting_supervision_confirm = false;
                updateConcludeButton();
                saveResponses();
                renderSupervisionPanel();
            });

            return $footer;
        }

        function createSupervisionCard(processo, index) {
            const snapshot = buildProcessoDetailsSnapshot(processo);
            const $card = $('<div class="analise-supervision-card"></div>');
            const $header = $('<div class="analise-supervision-card-header"></div>');
            const $headerTitle = $(
                `<span>Processo CNJ: <strong>${snapshot.cnj}</strong></span>`
            );
            const $statusBadge = $('<span class="analise-supervision-status-badge"></span>');

            const updateStatusBadge = (status) => {
                $statusBadge.text(SUPERVISION_STATUS_LABELS[status] || status);
                const allStatusClasses = Object.values(SUPERVISION_STATUS_CLASSES).join(' ');
                $statusBadge.removeClass(allStatusClasses);
                $statusBadge.addClass(SUPERVISION_STATUS_CLASSES[status]);
            };

            $header.append($headerTitle);
            $header.append($statusBadge);
            $card.append($header);

            const $body = $('<div class="analise-supervision-card-body"></div>');
            const $detailsRow = $('<div class="analise-card-details-row"></div>');
            $detailsRow.append(snapshot.$detailsList);
            const $noteElement = createObservationNoteElement(snapshot.observationEntries);
            const $supervisorNoteElement = createSupervisorNoteElement(processo);
            appendNotesColumn($detailsRow, [$noteElement, $supervisorNoteElement], {
                cnj: snapshot.cnj,
                contracts: snapshot.contractIds
            });
            $body.append($detailsRow);

            const $footer = createSupervisionFooter(processo, updateStatusBadge);
            $body.append($footer);
            $card.append($body);

            return $card;
        }

        function renderSupervisionPanel() {
            if (!isSupervisorUser || !$supervisionPanelContent) {
                return;
            }
            const activeProcessos =
                Array.isArray(userResponses.processos_vinculados) ? userResponses.processos_vinculados : [];
            const processos = [...getSavedProcessCards(), ...activeProcessos].filter(processo => {
                ensureSupervisionFields(processo);
                return Boolean(processo.supervisionado);
            });
            if (processos.length === 0) {
                $supervisionPanelContent.html(
                    '<p>Nenhum processo está aguardando supervisão.</p>'
                );
                return;
            }
            const $list = $('<div class="analise-supervision-card-list"></div>');
            processos.forEach((processo, index) => {
                const $card = createSupervisionCard(processo, index);
                $list.append($card);
            });
            $supervisionPanelContent.empty().append($list);
            refreshObservationNotes();
        }

        function refreshObservationNotes(event) {
            if (event && typeof event.detail === 'string') {
                localStorage.setItem(notebookStorageKey, event.detail);
            }
            $('[data-analise-cnj]').each(function () {
                const $column = $(this);
                const cnj = $column.attr('data-analise-cnj');
                if (!cnj) {
                    return;
                }
                const contractsAttr = $column.attr('data-analise-contracts') || '';
                const contracts = contractsAttr
                    .split(',')
                    .map(id => id.trim())
                    .filter(Boolean);
                const entries = getObservationEntriesForCnj(cnj, contracts);
                const $newObservation = createObservationNoteElement(entries);
                $column.find('.analise-observation-note').remove();
                if ($newObservation) {
                    const supervisorNote = $column.find('.analise-supervisor-note');
                    if (supervisorNote.length) {
                        supervisorNote.before($newObservation);
                    } else {
                        $column.append($newObservation);
                    }
                }
            });
        }

        window.addEventListener('analiseObservacoesSalvas', refreshObservationNotes);

        /* =========================================================
         * Utilidades de contratos
         * ======================================================= */

        function areAnySelectedContractsQuitado() {
            const status = userResponses.contratos_status || {};
            return Object.values(status).some(
                st => st && st.selecionado && st.quitado
            );
        }

        function fetchContractInfoFromDOM(contractId) {
            const idStr = String(contractId);
            const $element = $(`.contrato-item-wrapper[data-contrato-id="${idStr}"]`).first();
            if (!$element.length) {
                return null;
            }
            const numeroContrato = $element
                .find('.contrato-numero')
                .first()
                .text()
                .trim()
                .split('\n')[0]
                .trim();
            const valorTotalRaw = $element.attr('data-valor-total');
            const valorCausaRaw = $element.attr('data-valor-causa');
            return {
                id: idStr,
                numero_contrato: numeroContrato || `ID ${idStr}`,
                is_prescrito: Boolean($element.data('is-prescrito')),
                is_quitado: Boolean($element.data('is-quitado')),
                valor_total_devido: parseDecimalValue(valorTotalRaw),
                valor_causa: parseDecimalValue(valorCausaRaw)
            };
        }

        function loadContratosFromDOM() {
            allAvailableContratos = [];
            $('.contrato-item-wrapper').each(function () {
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
                const valorTotalRaw = $wrapper.attr('data-valor-total');
                const valorCausaRaw = $wrapper.attr('data-valor-causa');

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
                        is_quitado: isQuitado,
                        valor_total_devido: parseDecimalValue(valorTotalRaw),
                        valor_causa: parseDecimalValue(valorCausaRaw)
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
                success: function (data) {
                    if (data.status === 'success') {
                        treeConfig = data.tree_data || {};
                        treeResponseKeys = Array.from(
                            new Set(
                                Object.values(treeConfig || {})
                                    .map(question => question && question.chave)
                                    .filter(Boolean)
                            )
                        );
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
                error: function (xhr, status, error) {
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
                    (question.opcoes || []).forEach(function (opcao) {
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
                    renderMonitoriaContractSelector(question, $questionDiv, currentResponses, cardIndex);
                    return;

                case 'TEXTO':
                case 'TEXTO_LONGO':
                case 'DATA': {
                    const type = question.tipo_campo === 'DATA' ? 'date' : 'text';
                    const tag =
                        question.tipo_campo === 'TEXTO_LONGO' ? 'textarea' : 'input';
                    $inputElement = $(
                        `<${tag} type="${type}" id="${fieldId}" name="${fieldName}" ${tag === 'textarea' ? 'rows="4"' : ''
                        }></${tag}>`
                    ).val(currentResponses[question.chave] || '');
                    break;
                }

                default:
                    $inputElement = $(
                        '<p>Tipo de campo desconhecido: ' + question.tipo_campo + '</p>'
                    );
            }

            $inputElement.on('change', function () {
                currentResponses[question.chave] = $(this).val();
                if (question.chave === 'judicializado_pela_massa') {
                    suppressGeneralSummaryUntilFirstAnswer = false;
                }
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

            $targetContainer.find('.form-row').each(function () {
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

            $addCardButton.on('click', function () {
                const newCardData = {
                    cnj: '',
                    contratos: [],
                    tipo_de_acao_respostas: {},
                    supervisionado: false,
                    supervisor_status: 'pendente',
                    barrado: {
                        ativo: false,
                        inicio: null,
                        retorno_em: null
                    }
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
            cardData.supervisionado = Boolean(cardData.supervisionado);
            cardData.supervisor_status = cardData.supervisor_status || 'pendente';
            cardData.barrado = cardData.barrado || {};
            cardData.barrado.ativo = Boolean(cardData.barrado.ativo);
            cardData.barrado.inicio = cardData.barrado.inicio || null;
            cardData.barrado.retorno_em = cardData.barrado.retorno_em || null;

            const indexLabel = cardIndex + 1;

            const $card = $('<div class="processo-card"></div>').attr(
                'data-card-index',
                cardIndex
            );

            const $header = $('<div class="processo-card-header"></div>');
            const $titleWrapper = $(
                '<div class="processo-card-title"><span>Processo CNJ</span></div>'
            );
            const $hashtagBtn = $(
                `<button type="button" class="processo-cnj-hashtag" aria-label="Mencionar processo CNJ #${indexLabel}">#${indexLabel}</button>`
            );
            $hashtagBtn.on('click', function () {
                mentionProcessoInNotas(cardData);
            });
            $titleWrapper.append($hashtagBtn);
            const $toggleBtn = $(
                `<button type="button" class="processo-card-toggle" aria-expanded="true" aria-label="Minimizar processo CNJ #${indexLabel}">−</button>`
            );
            $toggleBtn.on('click', function () {
                const isCollapsed = $card.toggleClass('collapsed').hasClass('collapsed');
                $toggleBtn.attr('aria-expanded', (!isCollapsed).toString());
                $toggleBtn.text(isCollapsed ? '+' : '−');
            });
            $header.append($titleWrapper);
            $header.append($toggleBtn);

            $card.append($header);

            const $body = $('<div class="processo-card-body"></div>');

            // Campo CNJ com formatação padrão
            const $cnjWrapper = $('<div class="field-cnj"></div>');
            $cnjWrapper.append('<label>Nº Processo CNJ</label>');
            const $cnjInputRow = $('<div class="cnj-input-row"></div>');
            const $cnjInput = $(`
                <input type="text" class="vTextField processo-cnj-input"
                       placeholder="0000000-00.0000.0.00.0000">
            `).val(formatCnjDigits(cardData.cnj || ''));

            $cnjInput.on('input', function () {
                const formatted = formatCnjDigits($(this).val());
                $(this).val(formatted);
            });

            $cnjInput.on('blur', function () {
                const formatted = formatCnjDigits($(this).val());
                $(this).val(formatted);
                cardData.cnj = formatted;
                if (formatted && !isValidCnj(formatted)) {
                    alert('CNJ inválido. Verifique o formato (0000000-00.0000.0.00.0000).');
                }
                saveResponses();
            });

            $cnjInputRow.append($cnjInput);
            const $removeBtnInline = $(
                '<button type="button" class="button button-secondary processo-card-remove-inline">×</button>'
            );
            $cnjInputRow.append($removeBtnInline);
            $cnjWrapper.append($cnjInputRow);
            $removeBtnInline.on('click', function () {
                if (!confirm('Remover este processo vinculado?')) return;
                const arr = userResponses[parentQuestionKey] || [];
                arr.splice(cardIndex, 1);
                userResponses[parentQuestionKey] = arr;
                saveResponses();
                renderDecisionTree();
            });
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

                    $chk.on('change', function () {
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

            const $supervisionWrapper = $('<div class="field-supervision"></div>');
            const $supervisionToggle = $(`
                <label class="supervision-toggle" title="Ative ao concluir a análise processual e o caso será delegado a seu supervisor.">
                    <input type="checkbox" class="supervision-toggle-input">
                    <span class="supervision-switch" aria-hidden="true"></span>
                    <span class="supervision-label-text">Supervisionar</span>
                </label>
            `);
            $supervisionWrapper.append($supervisionToggle);
            $body.append($supervisionWrapper);

            const $supervisionInput = $supervisionToggle.find('.supervision-toggle-input');
            $supervisionInput.prop('checked', cardData.supervisionado);
            $supervisionInput.on('change', function (e) {
                console.log('═══════════════════════════════════════════════════');
                console.log('🔄 TOGGLE SUPERVISIONAR MUDOU');
                console.log('═══════════════════════════════════════════════════');

                const checked = $(this).is(':checked');
                console.log('   Checked:', checked ? 'ATIVADO ✅' : 'DESATIVADO ❌');
                console.log('   cardData ANTES:', JSON.parse(JSON.stringify(cardData)));

                cardData.supervisionado = checked;

                if (checked) {
                    cardData.supervisor_status = 'pendente';
                    cardData.awaiting_supervision_confirm = false;
                    console.log('   ✅ ATIVADO → Status mudou para: pendente');
                } else {
                    cardData.awaiting_supervision_confirm = false;
                    console.log('   ⬇️ DESATIVADO → Mantém status:', cardData.supervisor_status);
                }

                console.log('   cardData DEPOIS:', JSON.parse(JSON.stringify(cardData)));

                console.log('───────────────────────────────────────────────────');
                console.log('1️⃣ Sincronizando card com saved...');
                syncEditingCardWithSaved(cardData);

                if (!Array.isArray(userResponses.processos_vinculados)) {
                    userResponses.processos_vinculados = [];
                }
                const editIndex =
                    Number.isFinite(userResponses._editing_card_index) &&
                    userResponses._editing_card_index >= 0
                        ? Number(userResponses._editing_card_index)
                        : null;
                if (editIndex !== null) {
                    userResponses.processos_vinculados[editIndex] = cardData;
                }

                console.log('───────────────────────────────────────────────────');
                console.log('2️⃣ Salvando respostas...');
                saveResponses();

                console.log('───────────────────────────────────────────────────');
                console.log('3️⃣ Renderizando painel de supervisão (atualiza badge)...');
                renderSupervisionPanel();

                console.log('═══════════════════════════════════════════════════');
                console.log('✅ TOGGLE PROCESSADO COM SUCESSO!');
                console.log('═══════════════════════════════════════════════════');
            });

            $card.append($body);
            $cardsContainer.append($card);
        }

        function mentionProcessoInNotas(cardData) {
            if (typeof window.openNotebookWithMention !== 'function') {
                return;
            }
            const formattedCnj = cardData.cnj ? formatCnjDigits(cardData.cnj) : 'CNJ não informado';
            const contractNames = (cardData.contratos || [])
                .map(id => allAvailableContratos.find(c => String(c.id) === String(id)))
                .filter(Boolean)
                .map(c => c.numero_contrato);
            const contractsText =
                contractNames.length > 0 ? contractNames.join(', ') : 'Nenhum contrato selecionado';
            const mention = `CNJ ${formattedCnj} — Contratos: ${contractsText}`;
            window.openNotebookWithMention(mention);
        }

        /* =========================================================
         * Seleção de contratos para Monitória ("Propor Monitória")
         * ======================================================= */

        function renderMonitoriaContractSelector(question, $container, currentResponses, cardIndex = null) {
            ensureUserResponsesShape();

            const $selectorDiv = $('<div class="form-row field-contratos-monitoria"></div>');

            const selectedInInfoCard = allAvailableContratos.filter(
                c => userResponses.contratos_status[c.id] && userResponses.contratos_status[c.id].selecionado
            );
            const selection = currentResponses.contratos_para_monitoria || [];
            const processo = (cardIndex !== null && cardIndex >= 0 && Array.isArray(userResponses.processos_vinculados))
                ? userResponses.processos_vinculados[cardIndex] || null
                : null;

            // Conjunto final: mantém os já marcados e os selecionados no info-card
            const contractCandidates = Array.from(new Set([
                ...(processo && Array.isArray(processo.contratos) ? processo.contratos : []),
                ...selection,
                ...selectedInInfoCard.map(c => String(c.id)),
            ].map(id => String(id))));

            if (contractCandidates.length === 0) {
                $selectorDiv.append(
                    '<p>Nenhum contrato selecionado para monitória.</p>'
                );
                $container.append($selectorDiv);
                return;
            }

            contractCandidates.forEach(function (idStr) {
                const contratoInfo = allAvailableContratos.find(c => String(c.id) === idStr);
                const isChecked = selection.includes(idStr);
                const isDisabled = contratoInfo ? (contratoInfo.is_prescrito || contratoInfo.is_quitado) : false;

                let label = contratoInfo ? `${contratoInfo.numero_contrato}` : `Contrato ${idStr}`;
                if (contratoInfo && contratoInfo.is_prescrito) {
                    label += ' <span style="color:#c62828;font-style:italic;">(Prescrito)</span>';
                } else if (contratoInfo && contratoInfo.is_quitado) {
                    label += ' <span style="color:#007bff;font-style:italic;">(Quitado)</span>';
                }

                const $checkboxWrapper = $(
                    `<div>
                        <input type="checkbox"
                               id="monitoria_contrato_${idStr}"
                               value="${idStr}"
                               ${isChecked ? 'checked' : ''}
                               ${isDisabled ? 'disabled' : ''}>
                        <label for="monitoria_contrato_${idStr}">${label}</label>
                    </div>`
                );

                $selectorDiv.append($checkboxWrapper);
            });

            $selectorDiv.on('change', 'input[type="checkbox"]', function () {
                const contratoId = $(this).val(); // string
                const isChecked = $(this).is(':checked');
                let selection = currentResponses.contratos_para_monitoria || [];

                if (isChecked && !selection.includes(contratoId)) {
                    selection.push(contratoId);
                } else if (!isChecked) {
                    selection = selection.filter(id => id !== contratoId);
                }

                currentResponses.contratos_para_monitoria = selection;
                const overrideValue = selection.length > 0 ? 'SIM' : '';
                currentResponses.ativar_botao_monitoria = overrideValue;

                saveResponses();
            });

            if (cardIndex === null && normalizeResponse(userResponses.judicializado_pela_massa) === 'NÃO') {
                ensureNaoJudicializadoSupervisionToggle($selectorDiv);
            }

            $container.append($selectorDiv);
        }

        function ensureNaoJudicializadoSupervisionToggle($container) {
            const existing = $container.find('.nao-judicializado-supervision-toggle');
            if (existing.length) {
                return;
            }
            const $wrapper = $('<div class="field-supervision nao-judicializado-supervisionize"></div>');
            const $toggle = $(`
                <label class="supervision-toggle nao-judicializado-supervision-toggle" title="Ao concluir esta análise, encaminhe para supervisão.">
                    <input type="checkbox" class="supervision-toggle-input">
                    <span class="supervision-switch" aria-hidden="true"></span>
                    <span class="supervision-label-text">Supervisionar</span>
                </label>
            `);
            const $input = $toggle.find('.supervision-toggle-input');
            $input.on('change', function () {
                const checked = $(this).is(':checked');
                if (!Array.isArray(userResponses.processos_vinculados)) {
                    userResponses.processos_vinculados = [];
                }
                if (checked) {
                    const card = {
                        cnj: 'Não Judicializado',
                        contratos: userResponses.contratos_para_monitoria.slice(),
                        tipo_de_acao_respostas: {
                            judicializado_pela_massa: 'NÃO',
                            propor_monitoria: 'SIM',
                            contratos_para_monitoria: userResponses.contratos_para_monitoria.slice()
                        },
                        supervisionado: true,
                        supervisor_status: 'pendente',
                        barrado: { ativo: false, inicio: null, retorno_em: null },
                        awaiting_supervision_confirm: false
                    };
                    userResponses.processos_vinculados = userResponses.processos_vinculados.filter(p => p.cnj !== 'Não Judicializado');
                    userResponses.processos_vinculados.push(card);
                    userResponses.supervisionado_nao_judicializado = true;
                    userResponses.supervisor_status_nao_judicializado = 'pendente';
                    userResponses.barrado_nao_judicializado = { ativo: false, inicio: null, retorno_em: null };
                } else {
                    userResponses.processos_vinculados = userResponses.processos_vinculados.filter(p => p.cnj !== 'Não Judicializado');
                    userResponses.supervisionado_nao_judicializado = false;
                    userResponses.supervisor_status_nao_judicializado = '';
                    userResponses.barrado_nao_judicializado = { ativo: false, inicio: null, retorno_em: null };
                }
                saveResponses();
                displayFormattedResponses();
                if (isSupervisorUser) {
                    renderSupervisionPanel();
                }
            });
            $wrapper.append($toggle);
            $container.append($wrapper);
        }

        /* =========================================================
         * Eventos globais
         * ======================================================= */

        // RECARREGA JSON AO MUDAR STATUS DO CONTRATO (Q, seleção etc.)
        $(document).on('contratoStatusChange', function () {
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

        fetchDecisionTreeConfig().done(function () {
            renderDecisionTree();
        });

        $inlineGroup.find('.inline-related h3').hide();

        /* =========================================================
         * Botão Gerar Monitória
         * ======================================================= */

        // Event listener para o botão, que agora é criado dinamicamente
        $(document).on('click', '#id_gerar_monitoria_btn', function (e) {
            e.preventDefault();

            if (!currentProcessoId) {
                alert('Erro: ID do processo não encontrado para gerar a petição.');
                return;
            }
            const aggregatedContratoIds = getMonitoriaContractIds({
                includeGeneralSnapshot: true,
                includeSummaryCardContracts: true
            });
            if (aggregatedContratoIds.length === 0) {
                alert('Selecione pelo menos um contrato para a monitória antes de gerar a petição.');
                return;
            }

            const csrftoken = $('input[name="csrfmiddlewaretoken"]').val();
            const url = `/processo/${currentProcessoId}/gerar-monitoria/`;

            $.ajax({
                url: url,
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken },
                data: {
                    processo_id: currentProcessoId,
                    contratos_para_monitoria: JSON.stringify(aggregatedContratoIds)
                },
                dataType: 'json',
                beforeSend: function () {
                    $('#id_gerar_monitoria_btn')
                        .prop('disabled', true)
                        .text('Gerando...');
                },
                success: function (data) {
                    const msg = data && data.message ? data.message : 'Petição gerada com sucesso.';
                    let extra = '';
                    if (data && data.pdf_url) {
                        extra += `\nPDF salvo em Arquivos.`;
                    } else {
                        extra += `\nPDF não foi gerado; verifique o conversor.`;
                    }
                    alert(`${msg}${extra}`);
                    if ('scrollRestoration' in history) {
                        history.scrollRestoration = 'manual';
                    }
                    sessionStorage.setItem('scrollPosition', window.scrollY || document.documentElement.scrollTop || 0);
                    // Recarrega a página para que a aba Arquivos reflita os novos anexos
                    window.location.reload();
                },
                error: function (xhr, status, error) {
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
                complete: function () {
                    $('#id_gerar_monitoria_btn')
                        .prop('disabled', false)
                        .text('Gerar Petição Monitória');
                }
            });
        });

        $(document).on('click', '#id_gerar_cobranca_btn', function (e) {
            e.preventDefault();

            if (!currentProcessoId) {
                alert('Erro: ID do processo não encontrado para gerar a cobrança.');
                return;
            }
            if (
                !userResponses.contratos_para_monitoria ||
                userResponses.contratos_para_monitoria.length === 0
            ) {
                alert('Selecione pelo menos um contrato antes de gerar a petição de cobrança.');
                return;
            }

            const csrftoken = $('input[name="csrfmiddlewaretoken"]').val();
            const url = `/processo/${currentProcessoId}/gerar-cobranca-judicial/`;

            $.ajax({
                url: url,
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken },
                data: {
                    processo_id: currentProcessoId,
                    contratos_para_monitoria: JSON.stringify(userResponses.contratos_para_monitoria)
                },
                dataType: 'json',
                beforeSend: function () {
                    $('#id_gerar_cobranca_btn')
                        .prop('disabled', true)
                        .text('Gerando cobrança...');
                },
                success: function (data) {
                    const msg = data && data.message ? data.message : 'Petição de cobrança gerada com sucesso.';
                    let extra = '';
                    if (data && data.pdf_url) {
                        extra += `\nPDF salvo em Arquivos.`;
                    }
                    if (data && data.extrato_url) {
                        extra += `\nExtrato de titularidade disponível.`;
                    }
                    alert(`${msg}${extra}`);
                    if ('scrollRestoration' in history) {
                        history.scrollRestoration = 'manual';
                    }
                    sessionStorage.setItem('scrollPosition', window.scrollY || document.documentElement.scrollTop || 0);
                    window.location.reload();
                },
                error: function (xhr, status, error) {
                    let errorMessage = 'Erro ao gerar petição de cobrança. Tente novamente.';
                    if (xhr.responseJSON && xhr.responseJSON.message) {
                        errorMessage = xhr.responseJSON.message;
                    } else if (xhr.responseText) {
                        errorMessage = xhr.responseText;
                    }
                    alert(errorMessage);
                    console.error('Erro na geração da cobrança judicial:', status, error, xhr);
                },
                complete: function () {
                    $('#id_gerar_cobranca_btn')
                        .prop('disabled', false)
                        .text('Petição Cobrança Judicial (PDF)');
                }
            });
        });

        // Botão para baixar DOC editável (gera DOCX on-demand; não salva em Arquivos)
        $(document).on('click', '#id_baixar_doc_monitoria_btn', function (e) {
            e.preventDefault();

            if (!currentProcessoId) {
                alert('Erro: ID do processo não encontrado.');
                return;
            }
            if (!userResponses.contratos_para_monitoria || userResponses.contratos_para_monitoria.length === 0) {
                alert('Selecione pelo menos um contrato para a monitória.');
                return;
            }

            const csrftoken = $('input[name="csrfmiddlewaretoken"]').val();
            const url = `/processo/${currentProcessoId}/gerar-monitoria-docx/`;

            $.ajax({
                url: url,
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken },
                data: {
                    processo_id: currentProcessoId,
                    contratos_para_monitoria: JSON.stringify(userResponses.contratos_para_monitoria)
                },
                xhrFields: { responseType: 'blob' },
                beforeSend: function () {
                    $('#id_baixar_doc_monitoria_btn').prop('disabled', true).text('Baixando...');
                },
                success: function (blob, status, xhr) {
                    try {
                        const disposition = xhr.getResponseHeader('Content-Disposition') || '';
                        let filename = 'monitoria.docx';
                        const match = disposition.match(/filename=\"?([^\"]+)\"?/i);
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
                    } catch (err) {
                        console.error('Erro ao baixar doc:', err);
                        alert('Documento gerado, mas houve problema ao iniciar o download.');
                    }
                },
                error: function (xhr, status, error) {
                    let errorMessage = 'Erro ao gerar DOC editável.';
                    if (xhr.responseText) errorMessage = xhr.responseText;
                    alert(errorMessage);
                },
                complete: function () {
                    $('#id_baixar_doc_monitoria_btn').prop('disabled', false).text('DOC');
                }
            });
        });

        // Botão para baixar PDF com nome amigável (via endpoint dedicado)
        $(document).on('click', '#id_baixar_pdf_monitoria_btn', function (e) {
            e.preventDefault();
            if (!currentProcessoId) {
                alert('Erro: ID do processo não encontrado.');
                return;
            }
            const url = `/processo/${currentProcessoId}/download-monitoria-pdf/`;
            const csrftoken = $('input[name="csrfmiddlewaretoken"]').val();
            $.ajax({
                url: url,
                method: 'GET',
                headers: { 'X-CSRFToken': csrftoken },
                xhrFields: { responseType: 'blob' },
                beforeSend: function () {
                    $('#id_baixar_pdf_monitoria_btn').prop('disabled', true).text('Baixando...');
                },
                success: function (blob, status, xhr) {
                    try {
                        const disposition = xhr.getResponseHeader('Content-Disposition') || '';
                        let filename = 'monitoria.pdf';
                        const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
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
                    } catch (err) {
                        console.error('Erro ao baixar pdf:', err);
                        alert('PDF disponível, mas houve problema ao iniciar o download.');
                    }
                },
                error: function (xhr) {
                    let msg = 'PDF da monitória não encontrado. Gere o PDF e tente novamente.';
                    if (xhr.responseText) msg = xhr.responseText;
                    alert(msg);
                },
                complete: function () {
                    $('#id_baixar_pdf_monitoria_btn').prop('disabled', false).text('Baixar PDF');
                }
            });
        });
    });
})((window.django && window.django.jQuery) ? window.django.jQuery : jQuery);
