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
 * ✅ Status de supervisão (Pendente/Pré-aprovado/Aprovado/Reprovado)
 * ✅ Sistema de "Barrado" com datas
 * ✅ Múltiplos cards de processos vinculados
 * ✅ Dados básicos do processo
 * ✅ Formatação de valores monetários
 * ✅ Formatação de CNJ
 * 
 * SISTEMA DE SUPERVISÃO:
 * ----------------------
 * - Tab "Supervisionar" exclusiva para supervisores
 * - Alternância de status (Pendente → Pré-aprovado → Aprovado → Reprovado → Pendente)
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
        if (window.__analiseProcessoArvoreInitialized) {
            return;
        }
        window.__analiseProcessoArvoreInitialized = true;
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
        const analysisTypesApiUrl = '/api/analysis-types/';
        const DECISION_TREE_CACHE_KEY = 'nowlex_cache_v1:decision_tree_config';
        const DECISION_TREE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
        const readSessionCache = (key, ttlMs) => {
            try {
                const storage = window.sessionStorage;
                if (!storage) return null;
                const raw = storage.getItem(key);
                if (!raw) return null;
                const payload = JSON.parse(raw);
                if (!payload || typeof payload !== 'object') return null;
                if (ttlMs && payload.timestamp && Date.now() - payload.timestamp > ttlMs) {
                    storage.removeItem(key);
                    return null;
                }
                return payload.data || null;
            } catch (error) {
                return null;
            }
        };
        const writeSessionCache = (key, data) => {
            try {
                const storage = window.sessionStorage;
                if (!storage) return;
                storage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
            } catch (error) {
                // ignore storage errors
            }
        };
        const AGENDA_PAGE_SIZE = 200;
        let agendaLoadMoreButton = null;

        let treeConfig = {};
        let treeResponseKeys = [];
        let userResponses = {};
        let firstQuestionKey = null;
        let activeAnalysisType = null;
        let analysisTypesById = {};
        let decisionTreeFetchSeq = 0;
        let decisionTreeLatestSeq = 0;
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
        const SUPERVISION_STATUS_SEQUENCE = ['pendente', 'pre_aprovado', 'aprovado', 'reprovado'];
        const SUPERVISION_STATUS_LABELS = {
            pendente: 'Pendente de Supervisão',
            pre_aprovado: 'Pré-aprovado',
            aprovado: 'Aprovado',
            reprovado: 'Reprovado'
        };
        const SUPERVISION_STATUS_CLASSES = {
            pendente: 'status-pendente',
            pre_aprovado: 'status-pre-aprovado',
            aprovado: 'status-aprovado',
            reprovado: 'status-reprovado'
        };
        const currentSupervisorUsername = window.__analise_username || 'Supervisor';
        let countdownTimer = null;
        let countdownEl = null;

        const ensureCountdownStyle = () => {
            if (document.getElementById('cff-countdown-style')) return;
            const style = document.createElement('style');
            style.id = 'cff-countdown-style';
            style.textContent = `
            .cff-countdown-bubble {
                position: fixed;
                bottom: 16px;
                right: 16px;
                width: 68px;
                height: 68px;
                border-radius: 50%;
                background: #1f6feb;
                color: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-direction: column;
                font-size: 13px;
                font-weight: 600;
                box-shadow: 0 8px 18px rgba(0,0,0,0.15);
                animation: cff-pulse 1.4s ease-in-out infinite;
                z-index: 9999;
                pointer-events: none;
            }
            .cff-countdown-bubble small {
                font-size: 9px;
                font-weight: 500;
                opacity: 0.9;
            }
            @keyframes cff-pulse {
                0% { transform: scale(1); opacity: 0.95; }
                50% { transform: scale(1.06); opacity: 1; }
                100% { transform: scale(1); opacity: 0.95; }
            }
            `;
            document.head.appendChild(style);
        };

        const startCountdown = (seconds = 3) => {
            clearInterval(countdownTimer);
            if (countdownEl) {
                countdownEl.remove();
                countdownEl = null;
            }
            ensureCountdownStyle();
            countdownEl = document.createElement('div');
            countdownEl.className = 'cff-countdown-bubble';
            const label = document.createElement('small');
            label.textContent = 'Gerando em';
            const value = document.createElement('div');
            value.textContent = `${seconds}`;
            countdownEl.append(label, value);
            document.body.appendChild(countdownEl);

            let remaining = seconds;
            countdownTimer = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                    countdownEl?.remove();
                    countdownEl = null;
                    return;
                }
                value.textContent = `${remaining}`;
            }, 1000);
        };

        const stopCountdown = () => {
            clearInterval(countdownTimer);
            countdownTimer = null;
            if (countdownEl) {
                countdownEl.remove();
                countdownEl = null;
            }
        };


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
        const $startAnalysisButton = $(
            '<button type="button" class="button button-secondary analise-start-analysis-btn" title="Carregar Questionário de Análise">Começar</button>'
        );
        $saveAnalysisButton.prop('disabled', true);
        $analysisActionRow.append($startAnalysisButton, $saveAnalysisButton);
        const $petitionsWrap = $(
            '<div class="petitions-wrap">' +
                '<button class="petitions-trigger" id="petitionsTrigger" type="button" aria-expanded="false">Gerar Petições ▾</button>' +
                '<div class="petitions-panel" id="petitionsPanel" aria-hidden="true">' +
                    '<div class="petitions-rail" role="menu" aria-label="Protocolar">' +
                        '<div class="petitions-indicator" id="petitionsIndicator"></div>' +
                        '<button class="petitions-item is-active" role="menuitem" data-action="monitoria" type="button">Monitória</button>' +
                        '<button class="petitions-item" role="menuitem" data-action="cobranca" type="button">Cobrança</button>' +
                        '<button class="petitions-item" role="menuitem" data-action="habilitacao" type="button">Habilitação</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
        const $hiddenButtons = $('<div class="petitions-hidden-buttons" style="display:none;"></div>');
        const $gerarMonitoriaBtnDynamic = $('<button type="button" id="id_gerar_monitoria_btn" class="button" style="background-color: #28a745; color: white;">Gerar Petição Monitória (PDF)</button>');
        const $gerarCobrancaBtnDynamic = $('<button type="button" id="id_gerar_cobranca_btn" class="button" style="background-color: #1c7ed6; color: white;">Petição Cobrança Judicial (PDF)</button>');
        const $gerarHabilitacaoBtnDynamic = $('<button type="button" id="id_gerar_habilitacao_btn" class="button" style="background-color: #805ad5; color: white;">Gerar Petição de Habilitação (PDF)</button>');
        $gerarMonitoriaBtnDynamic.prop('disabled', true);
        $hiddenButtons.append($gerarMonitoriaBtnDynamic, $gerarCobrancaBtnDynamic, $gerarHabilitacaoBtnDynamic);

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

        const $tabTopRow = $('<div class="analise-inner-top-row"></div>').append(
            $tabNavigation,
            $('<div class="analise-inner-petitions-slot"></div>').append($petitionsWrap)
        );
        const $tabWrapper = $('<div class="analise-inner-tab-wrapper"></div>').append(
            $tabTopRow,
            $tabPanels,
            $hiddenButtons
        );
        $inlineGroup.append($tabWrapper);
        initializePetitionsDropdown($petitionsWrap);

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
        $analysisPanel.append($analysisActionRow, $dynamicQuestionsContainer);

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
	            analysisHasStarted = true;
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

        function hasMeaningfulResponseValue(value) {
            if (value === undefined || value === null) {
                return false;
            }
            if (Array.isArray(value)) {
                return value.some(item => hasMeaningfulResponseValue(item));
            }
            if (typeof value === 'object') {
                return Object.keys(value).length > 0;
            }
            return String(value).trim() !== '';
        }

        function isLikelyProcessCard(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return false;
            }
            const markerKeys = [
                'cnj',
                'contratos',
                'valor_causa',
                'observacoes',
                'analysis_type',
                'analysis_author',
                'supervisionado',
                'supervisor_status',
                'barrado',
                'tipo_de_acao_respostas'
            ];
            if (markerKeys.some(key => Object.prototype.hasOwnProperty.call(value, key))) {
                return true;
            }
            return GENERAL_CARD_FIELD_KEYS.some(key => Object.prototype.hasOwnProperty.call(value, key));
        }

        function coerceLegacyProcessCardList(rawValue) {
            if (Array.isArray(rawValue)) {
                return rawValue.filter(item => isLikelyProcessCard(item));
            }
            if (!rawValue || typeof rawValue !== 'object') {
                return [];
            }
            if (isLikelyProcessCard(rawValue)) {
                return [rawValue];
            }
            return Object.values(rawValue).filter(item => isLikelyProcessCard(item));
        }

        function buildActiveAnalysisTypeSnapshot() {
            if (!activeAnalysisType || activeAnalysisType.id == null) {
                return null;
            }
            return {
                id: activeAnalysisType.id,
                nome: activeAnalysisType.nome,
                slug: activeAnalysisType.slug,
                hashtag: activeAnalysisType.hashtag,
                versao: activeAnalysisType.versao
            };
        }

        function getFallbackProcessCnj() {
            const fromRoot = String(userResponses?.cnj || '').trim();
            if (fromRoot) {
                return formatCnjDigits(fromRoot);
            }
            const fromWidget = String($responseField?.data('analise-cnj') || '').trim();
            if (fromWidget) {
                return formatCnjDigits(fromWidget);
            }
            const fromForm = String($('input[name="cnj"]').val() || '').trim();
            if (fromForm) {
                return formatCnjDigits(fromForm);
            }
            return '';
        }

        function extractLegacyRootResponses() {
            const result = {};
            const ignored = new Set([
                'processos_vinculados',
                SAVED_PROCESSOS_KEY,
                'selected_analysis_cards',
                'contratos_status',
                'contratos_para_monitoria',
                'saved_entries_migrated',
                'ativar_botao_monitoria',
                'general_card',
                '_editing_card_index',
                'notebook'
            ]);
            const preferredKeys = Array.from(
                new Set([...(GENERAL_CARD_FIELD_KEYS || []), ...(treeResponseKeys || [])])
            ).filter(key => key && !ignored.has(key));
            preferredKeys.forEach(key => {
                const value = userResponses[key];
                if (hasMeaningfulResponseValue(value)) {
                    result[key] = deepClone(value);
                }
            });
            if (Object.keys(result).length > 0) {
                return result;
            }

            Object.keys(userResponses || {}).forEach(key => {
                if (ignored.has(key)) {
                    return;
                }
                if (/^_/.test(key)) {
                    return;
                }
                const value = userResponses[key];
                if (!hasMeaningfulResponseValue(value)) {
                    return;
                }
                const isScalar =
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean';
                const isSimpleArray = Array.isArray(value) && value.every(item => typeof item !== 'object');
                if (isScalar || isSimpleArray) {
                    result[key] = deepClone(value);
                }
            });
            return result;
        }

        function normalizeProcessCardForSummary(rawCard) {
            if (!isLikelyProcessCard(rawCard)) {
                return null;
            }
            const card = deepClone(rawCard);
            if (!card.tipo_de_acao_respostas || typeof card.tipo_de_acao_respostas !== 'object' || Array.isArray(card.tipo_de_acao_respostas)) {
                const mapped = {};
                GENERAL_CARD_FIELD_KEYS.forEach(key => {
                    const value = card[key];
                    if (hasMeaningfulResponseValue(value)) {
                        mapped[key] = deepClone(value);
                    }
                });
                card.tipo_de_acao_respostas = mapped;
            }

            if (!hasMeaningfulResponseValue(card.cnj)) {
                const fallbackCnj = getFallbackProcessCnj();
                if (fallbackCnj) {
                    card.cnj = fallbackCnj;
                }
            }

            if (!Array.isArray(card.contratos)) {
                let contracts = parseContractsField(card.contratos);
                if (!contracts.length && card.tipo_de_acao_respostas) {
                    contracts = parseContractsField(card.tipo_de_acao_respostas.contratos_para_monitoria);
                }
                card.contratos = Array.from(new Set(contracts.map(item => String(item).trim()).filter(Boolean)));
            }

            if (!card.analysis_type) {
                const snapshot = buildActiveAnalysisTypeSnapshot();
                if (snapshot) {
                    card.analysis_type = snapshot;
                }
            }
            if (!card.analysis_author) {
                const fallbackAuthor = resolveCardAnalysisAuthor(card, getCurrentAnalysisAuthorName());
                if (fallbackAuthor) {
                    card.analysis_author = fallbackAuthor;
                }
            }
            if (!card.updated_at && $responseField?.data('analise-updated-at')) {
                card.updated_at = $responseField.data('analise-updated-at');
            }
            if (typeof card.observacoes !== 'string') {
                const rootObservation = typeof userResponses.observacoes === 'string'
                    ? userResponses.observacoes.trim()
                    : '';
                if (rootObservation) {
                    card.observacoes = rootObservation;
                }
            }
            return card;
        }

        function buildLegacyRootSummaryCard() {
            const hasSaved = Array.isArray(userResponses[SAVED_PROCESSOS_KEY]) && userResponses[SAVED_PROCESSOS_KEY].length > 0;
            const hasActive = Array.isArray(userResponses.processos_vinculados) && userResponses.processos_vinculados.length > 0;
            if (hasSaved || hasActive) {
                return null;
            }
            const rootResponses = extractLegacyRootResponses();
            if (!Object.keys(rootResponses).length) {
                return null;
            }
            const contracts = parseContractsField(userResponses.contratos_para_monitoria || rootResponses.contratos_para_monitoria);
            const rawCard = {
                cnj: getFallbackProcessCnj() || 'Não informado',
                contratos: contracts,
                tipo_de_acao_respostas: rootResponses,
                observacoes: typeof userResponses.observacoes === 'string' ? userResponses.observacoes.trim() : '',
                analysis_type: buildActiveAnalysisTypeSnapshot(),
                analysis_author: getCurrentAnalysisAuthorName(),
                updated_at: $responseField?.data('analise-updated-at') || null
            };
            return normalizeProcessCardForSummary(rawCard);
        }

        function getSummaryCardIdentity(card, fallbackIndex = 0, fallbackSource = 'unknown') {
            if (!card || typeof card !== 'object') {
                return `${fallbackSource}:${fallbackIndex}`;
            }
            const cnjDigits = String(card.cnj || '').replace(/\D/g, '');
            if (cnjDigits) {
                return `cnj:${cnjDigits}`;
            }
            const contracts = Array.isArray(card.contratos)
                ? card.contratos.map(item => String(item).trim()).filter(Boolean).sort().join(',')
                : '';
            const payload = card.tipo_de_acao_respostas && typeof card.tipo_de_acao_respostas === 'object'
                ? JSON.stringify(card.tipo_de_acao_respostas)
                : '';
            if (contracts || payload) {
                return `payload:${contracts}:${payload}`;
            }
            return `${fallbackSource}:${fallbackIndex}`;
        }

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
                userResponses.processos_vinculados = coerceLegacyProcessCardList(userResponses.processos_vinculados);
            }
            if (!userResponses.hasOwnProperty('saved_entries_migrated')) {
                userResponses.saved_entries_migrated = false;
            }
            if (!userResponses.ativar_botao_monitoria) {
                userResponses.ativar_botao_monitoria = '';
            }
            if (typeof userResponses.supervision_date_nao_judicializado !== 'string') {
                userResponses.supervision_date_nao_judicializado = '';
            }
            if (!Array.isArray(userResponses[SAVED_PROCESSOS_KEY])) {
                userResponses[SAVED_PROCESSOS_KEY] = coerceLegacyProcessCardList(userResponses[SAVED_PROCESSOS_KEY]);
            }
            if (
                !userResponses.saved_entries_migrated &&
                !userResponses.processos_vinculados.length &&
                !userResponses[SAVED_PROCESSOS_KEY].length
            ) {
                const legacyFallbackCard = buildLegacyRootSummaryCard();
                if (legacyFallbackCard) {
                    userResponses[SAVED_PROCESSOS_KEY] = [legacyFallbackCard];
                }
            }

            // normaliza contratos_para_monitoria como array de strings únicos
            userResponses.contratos_para_monitoria = Array.from(
                new Set(
                    userResponses.contratos_para_monitoria
                        .filter(v => v != null)
                        .map(v => String(v))
                )
            );
            userResponses.supervision_date_nao_judicializado = normalizeIsoDateValue(
                userResponses.supervision_date_nao_judicializado
            );
        }

        function getProcessoVinculadoQuestionKey() {
            if (!treeConfig || typeof treeConfig !== 'object') {
                return null;
            }
            const direct = treeConfig.processos_vinculados;
            if (direct && direct.tipo_campo === 'PROCESSO_VINCULADO') {
                return 'processos_vinculados';
            }
            const keys = Object.keys(treeConfig);
            for (const key of keys) {
                const q = treeConfig[key];
                if (q && q.tipo_campo === 'PROCESSO_VINCULADO') {
                    return key;
                }
            }
            return null;
        }

        function syncProcessoVinculadoResponseKey(questionKey) {
            const key = questionKey || getProcessoVinculadoQuestionKey();
            if (!key) return;

            if (!Array.isArray(userResponses[key])) {
                userResponses[key] = [];
            }
            if (!Array.isArray(userResponses.processos_vinculados)) {
                userResponses.processos_vinculados = [];
            }

            // Mantém um único array compartilhado, porque outras partes do sistema
            // assumem `userResponses.processos_vinculados` (resumo/edição/supervisão).
            if (key !== 'processos_vinculados') {
                const preferred =
                    userResponses.processos_vinculados.length
                        ? userResponses.processos_vinculados
                        : userResponses[key];
                userResponses[key] = preferred;
                userResponses.processos_vinculados = preferred;
            }
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

        function getContractLabelForId(contractIdOrNumber) {
            if (contractIdOrNumber === undefined || contractIdOrNumber === null) {
                return '';
            }
            const candidateId = String(contractIdOrNumber).trim();
            if (!candidateId) {
                return '';
            }
            const matchById = allAvailableContratos.find(c => String(c.id) === candidateId);
            if (matchById && matchById.numero_contrato) {
                return matchById.numero_contrato;
            }
            const matchByNumber = allAvailableContratos.find(c => String(c.numero_contrato) === candidateId);
            if (matchByNumber && matchByNumber.numero_contrato) {
                return matchByNumber.numero_contrato;
            }
            return candidateId;
        }

        function getContractNumbersFromIds(contractIds) {
            if (!Array.isArray(contractIds)) {
                return [];
            }
            const seen = new Set();
            const numbers = [];
            contractIds.forEach(id => {
                const label = getContractLabelForId(id);
                if (!label) {
                    return;
                }
                const normalized = label.trim();
                if (!normalized || seen.has(normalized)) {
                    return;
                }
                seen.add(normalized);
                numbers.push(normalized);
            });
            return numbers;
        }

        function normalizeTextForComparison(value) {
            if (value === undefined || value === null) {
                return '';
            }
            const str = String(value)
                .replace(/[\u2013\u2014]/g, '-')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
            return str;
        }

        function getProcessoArquivoRowName(row) {
            if (!row) {
                return '';
            }
            if (row.classList.contains('empty-form') || row.classList.contains('empty-form-row')) {
                return '';
            }
            const rowId = row.getAttribute('id') || '';
            if (rowId && rowId.includes('__prefix__')) {
                return '';
            }
            const input = row.querySelector('input[name$="-nome"]');
            if (input && input.value.trim()) {
                return input.value.trim();
            }
            const cell = row.querySelector('td.field-nome');
            if (cell) {
                const text = cell.textContent.trim();
                if (text) {
                    return text;
                }
            }
            return row.textContent.trim();
        }

        function getProcessoArquivoNames() {
            const selectors = [
                '#processoarquivo_set-group tbody tr',
                '#arquivos-group tbody tr'
            ];
            const names = [];
            selectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(row => {
                    const name = getProcessoArquivoRowName(row);
                    if (name) {
                        names.push(name);
                    }
                });
            });
            return names;
        }

        function findContractsWithContratoArquivos(contractNumbers) {
            if (!Array.isArray(contractNumbers) || contractNumbers.length === 0) {
                return [];
            }
            const arquivoNames = getProcessoArquivoNames();
            if (!arquivoNames.length) {
                return [];
            }
            const normalizedArquivoNames = arquivoNames.map(name => normalizeTextForComparison(name));
            const matches = [];
            contractNumbers.forEach(number => {
                const digits = String(number).replace(/\D/g, '');
                if (!digits) {
                    return;
                }
                const pattern = new RegExp(`${digits}\\s*-\\s*contrato`);
                const hasMatch = normalizedArquivoNames.some(normalizedName => pattern.test(normalizedName));
                if (hasMatch) {
                    matches.push(number);
                }
            });
            return Array.from(new Set(matches));
        }

        function escapeHtml(value) {
            if (typeof value !== 'string') {
                return '';
            }
            return value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

function showCffSystemDialog(message, type = 'warning', onClose = null) {
            const existing = $('#cff-system-dialog');
            if (existing.length) {
                existing.remove();
            }
            const PARTES_TRIGGER = '(aba Partes)';
            const PARTES_PLACEHOLDER = '__CFF_PARTES_LINK__';
            let messageWithPlaceholder = message;
            let hasPartesLink = false;

            if (typeof messageWithPlaceholder === 'string' && messageWithPlaceholder.includes(PARTES_TRIGGER)) {
                hasPartesLink = true;
                messageWithPlaceholder = messageWithPlaceholder.replace(PARTES_TRIGGER, PARTES_PLACEHOLDER);
            }

            let safeMessage = escapeHtml(messageWithPlaceholder).replace(/\n/g, '<br>');

            if (hasPartesLink) {
                const partesHref = '#partes_processuais-group';
                const partesLink = `<a href="${partesHref}" class="cff-dialog-link">aba Partes</a>`;
                safeMessage = safeMessage.replace(PARTES_PLACEHOLDER, partesLink);
            }

            const $dialog = $(
                `<div id="cff-system-dialog" class="cff-dialog-overlay">
                    <div class="cff-dialog-box ${type}">
                        <div class="cff-dialog-title">CFF System</div>
                        <div class="cff-dialog-body">${safeMessage}</div>
                        <div class="cff-dialog-actions">
                            <button type="button" class="cff-dialog-ok">OK</button>
                        </div>
                    </div>
                </div>`
            );
            $('body').append($dialog);
            $dialog.find('.cff-dialog-link').on('click', function (event) {
                event.preventDefault();
                $dialog.remove();
                if (typeof window.__openInlineTab === 'function') {
                    window.__openInlineTab('Partes');
                } else {
                    const target = event.currentTarget.getAttribute('href');
                    if (target) {
                        const targetElement = document.querySelector(target);
                        if (targetElement) {
                            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }
                }
            });
                $dialog.find('.cff-dialog-ok').on('click', function () {
                    $dialog.remove();
                    if (typeof onClose === 'function') {
                        try {
                            onClose();
                        } catch (err) {
                            console.error('Erro ao executar callback do diálogo CFF System:', err);
                        }
                    }
                });
            }
        window.showCffSystemDialog = showCffSystemDialog;

        function showCffConfirmDialog(message, title = 'CFF System') {
            return new Promise(resolve => {
                const existing = document.getElementById('cff-system-confirm-dialog');
                if (existing) {
                    existing.remove();
                }
                const overlay = document.createElement('div');
                overlay.id = 'cff-system-confirm-dialog';
                overlay.className = 'cff-dialog-overlay';
                const dialog = document.createElement('div');
                dialog.className = 'cff-dialog-box warning';
                dialog.style.padding = '24px';
                dialog.style.maxWidth = '360px';
                dialog.style.margin = '0 auto';
                dialog.style.textAlign = 'left';
                const titleEl = document.createElement('div');
                titleEl.className = 'cff-dialog-title';
                titleEl.textContent = title;
                const bodyEl = document.createElement('div');
                bodyEl.className = 'cff-dialog-body';
                bodyEl.style.marginTop = '8px';
                bodyEl.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');
                const actionsEl = document.createElement('div');
                actionsEl.className = 'cff-dialog-actions';
                actionsEl.style.marginTop = '18px';

                const cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'cff-dialog-ok';
                cancelBtn.style.marginRight = '8px';
                cancelBtn.textContent = 'Cancelar';
                const okBtn = document.createElement('button');
                okBtn.type = 'button';
                okBtn.className = 'cff-dialog-ok';
                okBtn.textContent = 'OK';

                actionsEl.appendChild(cancelBtn);
                actionsEl.appendChild(okBtn);
                dialog.appendChild(titleEl);
                dialog.appendChild(bodyEl);
                dialog.appendChild(actionsEl);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);

                const handleKeydown = event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        okBtn.click();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelBtn.click();
                    }
                };

                const cleanup = () => {
                    document.removeEventListener('keydown', handleKeydown);
                    overlay.remove();
                };

                cancelBtn.addEventListener('click', () => {
                    cleanup();
                    resolve(false);
                });
                okBtn.addEventListener('click', () => {
                    cleanup();
                    resolve(true);
                });
                document.addEventListener('keydown', handleKeydown);
                okBtn.focus();
            });
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

            const combined = [];
            const seen = new Set();

            savedCards.forEach((card, idx) => {
                const normalizedCard = normalizeProcessCardForSummary(card);
                if (!normalizedCard) {
                    return;
                }
                const identity = getSummaryCardIdentity(normalizedCard, idx, 'saved');
                if (seen.has(identity)) {
                    return;
                }
                seen.add(identity);
                combined.push({
                    ...normalizedCard,
                    __savedIndex: idx,
                    __activeIndex: null,
                    __source: 'saved'
                });
            });

            if (!activeCards.length) {
                return combined;
            }

            activeCards.forEach((activeCard, idx) => {
                const normalizedCard = normalizeProcessCardForSummary(activeCard);
                if (!normalizedCard) {
                    return;
                }
                const identity = getSummaryCardIdentity(normalizedCard, idx, 'active');
                if (seen.has(identity)) {
                    return;
                }
                seen.add(identity);
                combined.push({
                    ...normalizedCard,
                    __savedIndex: null,
                    __activeIndex: idx,
                    __source: 'active'
                });
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
                'propor_monitoria',
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
            const supervision_date = normalizeIsoDateValue(snapshotResponses.supervision_date);
            const barrado = snapshotResponses.barrado
                ? deepClone(snapshotResponses.barrado)
                : { ativo: false, inicio: null, retorno_em: null };
            delete snapshotResponses.supervisionado;
            delete snapshotResponses.supervisor_status;
            delete snapshotResponses.awaiting_supervision_confirm;
            delete snapshotResponses.supervision_date;
            delete snapshotResponses.barrado;
            delete snapshotResponses.processos_vinculados;
            const analysisAuthor = getCurrentAnalysisAuthorName();
            return {
                cnj: formattedCnj || 'Não informado',
                contratos: contractIds,
                tipo_de_acao_respostas: snapshotResponses,
                supervisionado,
                supervisor_status,
                awaiting_supervision_confirm,
                supervision_date,
                barrado,
                analysis_author: analysisAuthor
            };
        }

        function buildProcessSnapshotFromCard(processo) {
            if (!processo || typeof processo !== 'object') {
                return null;
            }
            const contratoArray = Array.isArray(processo.contratos) ? processo.contratos : [];
            const respostaContratos =
                processo.tipo_de_acao_respostas &&
                Array.isArray(processo.tipo_de_acao_respostas.contratos_para_monitoria)
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
            const valorCausa =
                processo.valor_causa === undefined || processo.valor_causa === null
                    ? null
                    : parseCurrencyValue(processo.valor_causa);
            const barrado = processo.barrado
                ? deepClone(processo.barrado)
                : { ativo: false, inicio: null, retorno_em: null };
            const supervisionDate = normalizeIsoDateValue(processo.supervision_date);
            delete responses.processos_vinculados;
            return {
                cnj: cnjFormatted || 'Não informado',
                valor_causa: valorCausa,
                contratos: contractIds,
                tipo_de_acao_respostas: responses,
                analysis_type: processo.analysis_type ? deepClone(processo.analysis_type) : null,
                supervisionado: Boolean(processo.supervisionado),
                supervisor_status: processo.supervisor_status || 'pendente',
                awaiting_supervision_confirm: Boolean(processo.awaiting_supervision_confirm),
                supervision_date: supervisionDate,
                barrado,
                analysis_author: resolveCardAnalysisAuthor(processo),
                general_card_snapshot: false
            };
        }

        function buildSnapshotsFromProcessosVinculados() {
            if (!Array.isArray(userResponses.processos_vinculados)) {
                return [];
            }
            return userResponses.processos_vinculados
                .map(buildProcessSnapshotFromCard)
                .filter(Boolean);
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

        function syncEditingCardWithCurrentResponses() {
            if (
                !Number.isFinite(userResponses._editing_card_index) ||
                userResponses._editing_card_index < 0 ||
                !Array.isArray(userResponses.processos_vinculados) ||
                userResponses.processos_vinculados.length === 0
            ) {
                return null;
            }
            const card = userResponses.processos_vinculados[0];
            if (!card) {
                return null;
            }

            // Esta sincronização é específica do fluxo de "Não Judicializado" em Monitórias.
            // Em outros tipos (ex.: Passivas), não deve sobrescrever campos do card (como supervisão).
            const isMonitoria = activeAnalysisType && activeAnalysisType.slug === 'novas-monitorias';
            if (!isMonitoria || !isCardNonJudicialized(card)) {
                return card;
            }

            const monitoriaIds = Array.from(
                new Set(
                    (userResponses.contratos_para_monitoria || [])
                        .map(id => String(id).trim())
                        .filter(Boolean)
                )
            );
            card.contratos = monitoriaIds.slice();
            card.tipo_de_acao_respostas = card.tipo_de_acao_respostas || {};
            card.tipo_de_acao_respostas.contratos_para_monitoria = monitoriaIds.slice();
            const syncKeys = [
                'judicializado_pela_massa',
                'propor_monitoria',
                'tipo_de_acao',
                'julgamento',
                'transitado',
                'procedencia',
                'repropor_monitoria',
                'ativar_botao_monitoria'
            ];
            syncKeys.forEach(key => {
                if (Object.prototype.hasOwnProperty.call(userResponses, key)) {
                    card.tipo_de_acao_respostas[key] = deepClone(userResponses[key]);
                }
            });
            const supervisionado = Boolean(userResponses.supervisionado_nao_judicializado);
            const status = userResponses.supervisor_status_nao_judicializado || 'pendente';
            card.supervisionado = supervisionado;
            card.supervisor_status = status;
            card.awaiting_supervision_confirm = Boolean(userResponses.awaiting_supervision_confirm);
            card.supervision_date = normalizeIsoDateValue(
                userResponses.supervision_date_nao_judicializado
            );
            if (userResponses.barrado_nao_judicializado) {
                card.barrado = deepClone(userResponses.barrado_nao_judicializado);
            }
            return card;
        }

        function storeActiveAnalysisAsProcessCard() {
            ensureUserResponsesShape();
            const savedCards = userResponses[SAVED_PROCESSOS_KEY] || [];
            const editingIndex =
                Number.isFinite(userResponses._editing_card_index) &&
                userResponses._editing_card_index >= 0
                    ? Number(userResponses._editing_card_index)
                    : null;

            if (editingIndex !== null) {
                // Só sincroniza automaticamente o fluxo especial de "Não Judicializado" (Monitórias).
                // Para Passivas e demais tipos, as edições já estão em processos_vinculados[0].
                syncEditingCardWithCurrentResponses();
            }
            let snapshots = buildSnapshotsFromProcessosVinculados();
            if (editingIndex !== null && Array.isArray(snapshots) && snapshots.length > 1) {
                // Em modo de edição, só deve atualizar o card em edição.
                snapshots = [snapshots[0]];
            }
            if (!snapshots.length) {
                const fallback = captureActiveAnalysisSnapshot();
                if (fallback) {
                    snapshots = [fallback];
                }
            }
            if (!snapshots.length) {
                return false;
            }

            const timestamp = new Date().toISOString();
            const currentAnalysisAuthor = getCurrentAnalysisAuthorName();
            const analysisTypeSnapshot = activeAnalysisType && activeAnalysisType.id != null ? {
                id: activeAnalysisType.id,
                nome: activeAnalysisType.nome,
                slug: activeAnalysisType.slug,
                hashtag: activeAnalysisType.hashtag,
                versao: activeAnalysisType.versao
            } : null;

            const snapshotsToPersist = snapshots.slice();
            if (
                editingIndex !== null &&
                Number.isFinite(editingIndex) &&
                savedCards[editingIndex] &&
                snapshotsToPersist.length
            ) {
                const snapshotToUpdate = snapshotsToPersist.shift();
                snapshotToUpdate.saved_at = timestamp;
                snapshotToUpdate.updated_at = timestamp;
                if (analysisTypeSnapshot) {
                    snapshotToUpdate.analysis_type = analysisTypeSnapshot;
                }
                snapshotToUpdate.analysis_author = resolveCardAnalysisAuthor(
                    snapshotToUpdate,
                    currentAnalysisAuthor
                );
                snapshotToUpdate.general_card_snapshot =
                    savedCards[editingIndex].general_card_snapshot || false;
                savedCards[editingIndex] = snapshotToUpdate;
            }

            snapshotsToPersist.forEach(snapshot => {
                snapshot.saved_at = timestamp;
                snapshot.updated_at = timestamp;
                if (analysisTypeSnapshot) {
                    snapshot.analysis_type = analysisTypeSnapshot;
                }
                snapshot.analysis_author = resolveCardAnalysisAuthor(
                    snapshot,
                    currentAnalysisAuthor
                );
                appendProcessCardToHistory(snapshot);
            });

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

        function hasAnySpecificCardSelection() {
            if (!Array.isArray(userResponses.selected_analysis_cards)) {
                return false;
            }
            return userResponses.selected_analysis_cards.some(
                sel => typeof sel === 'string' && sel !== GENERAL_MONITORIA_CARD_KEY
            );
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
            delete userResponses.supervision_date_nao_judicializado;
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
            // Durante edição, mantemos o card ativo em processos_vinculados[0]
            // (evita array esparso que quebra a atualização do snapshot ao concluir).
            userResponses.processos_vinculados = [updatedCard];
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
                showCffConfirmDialog(
                    'Deseja cancelar a edição?\n\nAs alterações não salvas serão perdidas.'
                ).then(confirmar => {
                    if (confirmar) {
                        $('.edit-mode-indicator').remove();
                        delete userResponses._editing_card_index;
                        clearTreeResponsesForNewAnalysis();
                        renderDecisionTree();
                        saveResponses();
                        console.log('Edição cancelada');
                    }
                });
            });
    
            $indicator.find('.cancel-edit-btn').hover(
                function() { $(this).css('background', 'rgba(255, 255, 255, 0.3)'); },
                function() { $(this).css('background', 'rgba(255, 255, 255, 0.2)'); }
            );
        }

        function buildAnalysisTypeSnapshotFromType(typeData) {
            if (!typeData || typeData.id == null) {
                return null;
            }
            return {
                id: typeData.id,
                nome: typeData.nome || '',
                slug: typeData.slug || '',
                hashtag: typeData.hashtag || '',
                versao: typeData.versao != null ? typeData.versao : null
            };
        }

        function inferAnalysisTypeForCard(types, cardData) {
            const list = Array.isArray(types)
                ? types.filter(tipo => tipo && tipo.id != null)
                : [];
            if (!list.length) {
                return null;
            }
            if (list.length === 1) {
                return list[0];
            }

            const explicitTypeText = normalizeTextForComparison(
                `${cardData?.analysis_type?.slug || ''} ${cardData?.analysis_type?.nome || ''}`
            );
            if (explicitTypeText) {
                const directMatches = list.filter(tipo => {
                    const typeText = normalizeTextForComparison(`${tipo.slug || ''} ${tipo.nome || ''}`);
                    return typeText && (typeText.includes(explicitTypeText) || explicitTypeText.includes(typeText));
                });
                if (directMatches.length === 1) {
                    return directMatches[0];
                }
            }

            const responses =
                cardData && cardData.tipo_de_acao_respostas && typeof cardData.tipo_de_acao_respostas === 'object'
                    ? cardData.tipo_de_acao_respostas
                    : {};

            const hasMonitoriaSignals = [
                'judicializado_pela_massa',
                'propor_monitoria',
                'repropor_monitoria',
                'contratos_para_monitoria'
            ].some(key => Object.prototype.hasOwnProperty.call(responses, key));
            const hasPassivasSignals = [
                'procedencia',
                'cumprimento_de_sentenca',
                'data_de_transito',
                'transitado',
                'julgamento'
            ].some(key => Object.prototype.hasOwnProperty.call(responses, key));
            const tipoAcaoText = normalizeTextForComparison(
                (responses && responses.tipo_de_acao) || cardData?.tipo_de_acao || ''
            );

            const preferMonitoria = hasMonitoriaSignals || tipoAcaoText.includes('monitor');
            const preferPassivas = hasPassivasSignals || tipoAcaoText.includes('passiv');
            const keyword = preferMonitoria && !preferPassivas
                ? 'monitor'
                : (preferPassivas && !preferMonitoria ? 'passiv' : '');

            if (!keyword) {
                return null;
            }

            const keywordMatches = list.filter(tipo => {
                const typeText = normalizeTextForComparison(`${tipo.slug || ''} ${tipo.nome || ''}`);
                return typeText.includes(keyword);
            });
            if (keywordMatches.length === 1) {
                return keywordMatches[0];
            }
            return null;
        }

        function ensureDecisionTreeForCardEditing(cardData) {
            const deferred = $.Deferred();
            const cardTipoId = cardData && cardData.analysis_type && cardData.analysis_type.id != null
                ? String(cardData.analysis_type.id)
                : '';
            const cardTipoVersao = cardData && cardData.analysis_type ? cardData.analysis_type.versao : null;
            const currentTipoId = activeAnalysisType && activeAnalysisType.id != null
                ? String(activeAnalysisType.id)
                : '';
            const hasCurrentTreeConfig = Boolean(firstQuestionKey && treeConfig && treeConfig[firstQuestionKey]);

            const finalizeSuccess = (fallbackType = null) => {
                if (!cardData.analysis_type || cardData.analysis_type.id == null) {
                    const snapshot = buildActiveAnalysisTypeSnapshot() || buildAnalysisTypeSnapshotFromType(fallbackType);
                    if (snapshot) {
                        cardData.analysis_type = snapshot;
                    }
                }
                analysisTypeSelectionInProgress = false;
                updateActionButtons();
                deferred.resolve();
            };

            const finalizeFailure = (reason = null) => {
                analysisTypeSelectionInProgress = false;
                updateActionButtons();
                deferred.reject(reason || {});
            };

            const promptForTypeSelection = (contextMessage) => {
                fetchAnalysisTypes()
                    .done(types => {
                        const list = Array.isArray(types) ? types.filter(Boolean) : [];
                        if (!list.length) {
                            finalizeFailure({
                                message: 'Não foi possível carregar os tipos de análise disponíveis para este card.'
                            });
                            return;
                        }

                        const inferredType = inferAnalysisTypeForCard(list, cardData);
                        if (inferredType) {
                            loadTreeForType(inferredType, {
                                allowSelectionFallback: false,
                                failMessage: contextMessage || 'Não foi possível carregar a árvore do tipo inferido para este card.'
                            });
                            return;
                        }

                        promptSelectAnalysisType(list)
                            .done(selectedType => {
                                loadTreeForType(selectedType, {
                                    allowSelectionFallback: false,
                                    failMessage: contextMessage || 'Não foi possível carregar o tipo escolhido para este card.'
                                });
                            })
                            .fail(reason => {
                                if (reason && reason.cancelled) {
                                    finalizeFailure({ cancelled: true });
                                    return;
                                }
                                finalizeFailure({
                                    message: contextMessage || 'Não foi possível identificar o tipo de análise deste card.'
                                });
                            });
                    })
                    .fail(() => {
                        finalizeFailure({
                            message: contextMessage || 'Não foi possível carregar os tipos de análise.'
                        });
                    });
            };

            const loadTreeForType = (typeInfo, options = {}) => {
                const tipoId = typeInfo && typeInfo.id != null
                    ? String(typeInfo.id)
                    : '';
                if (!tipoId) {
                    finalizeFailure({ message: 'Tipo de análise não identificado para este card.' });
                    return;
                }
                const tipoVersao = typeInfo && typeInfo.versao != null ? typeInfo.versao : null;
                const forceReload = Boolean(options.forceReload);
                fetchDecisionTreeConfig({ tipoId: tipoId, tipoVersao: tipoVersao, forceReload: forceReload })
                    .done(() => finalizeSuccess(typeInfo))
                    .fail(() => {
                        if (options.allowSelectionFallback) {
                            promptForTypeSelection(options.failMessage);
                            return;
                        }
                        finalizeFailure({
                            message: options.failMessage || 'Não foi possível carregar a configuração da árvore para editar este card.'
                        });
                    });
            };

            analysisTypeSelectionInProgress = true;
            updateActionButtons();

            if (cardTipoId) {
                const loadLatestSameType = () => {
                    // Mantém o mesmo tipo do card, mas usa a versão mais recente disponível
                    // para garantir que novas opções (ex.: novas respostas) apareçam no Editar.
                    const latestSameType = analysisTypesById[String(cardTipoId)] || null;
                    const typeToLoad = latestSameType || cardData.analysis_type || { id: cardTipoId, versao: cardTipoVersao };
                    loadTreeForType(typeToLoad, {
                        allowSelectionFallback: true,
                        failMessage: 'Não foi possível carregar o tipo salvo neste card. Selecione o tipo de análise para editar.',
                        forceReload: true
                    });
                };

                if (analysisTypesById[String(cardTipoId)]) {
                    loadLatestSameType();
                } else {
                    fetchAnalysisTypes().always(loadLatestSameType);
                }
                return deferred.promise();
            }

            if (currentTipoId) {
                if (hasCurrentTreeConfig) {
                    finalizeSuccess(activeAnalysisType || null);
                } else {
                    loadTreeForType(activeAnalysisType || { id: currentTipoId }, {
                        allowSelectionFallback: true,
                        failMessage: 'Não foi possível restaurar a configuração atual. Selecione o tipo de análise para editar o card.'
                    });
                }
                return deferred.promise();
            }

            promptForTypeSelection('Este card legado não informa o tipo de análise. Selecione o tipo para editar.');
            return deferred.promise();
        }

        function restoreTreeFromCard(cardIndex) {
            analysisHasStarted = true;
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

            const startPopulationCascade = () => {
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
                                    console.log('  ⏭️ Campo já populado, pulando');
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
                                    console.log('  ✅ Novos campos criados! Continuando...');
                                    populateFieldsCascade(attempt + 1, maxAttempts);
                                } else {
                                    if (attempt < maxAttempts) {
                                        console.log('  ⚠️ Nenhum campo novo, mas tentando novamente...');
                                        populateFieldsCascade(attempt + 1, maxAttempts);
                                    } else {
                                        console.log('  ✅ Cascata finalizada');
                                        finalizarEdicao();
                                    }
                                }
                            }, 800);
                        } else {
                            console.log('  ✅ Cascata finalizada (sem mais campos para popular)');
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
            };

            const proceedRestore = () => {
                console.log('Card encontrado:', cardData);

                loadContratosFromDOM();
                clearTreeResponsesForNewAnalysis();
                userResponses.processos_vinculados = [deepClone(cardData)];
                syncProcessoVinculadoResponseKey();
                ensureUserResponsesShape();

                let savedResponses =
                    cardData && cardData.tipo_de_acao_respostas && typeof cardData.tipo_de_acao_respostas === 'object'
                        ? deepClone(cardData.tipo_de_acao_respostas)
                        : {};
                if (!Object.keys(savedResponses).length) {
                    GENERAL_CARD_FIELD_KEYS.forEach(key => {
                        if (hasMeaningfulResponseValue(cardData[key])) {
                            savedResponses[key] = deepClone(cardData[key]);
                        }
                    });
                    cardData.tipo_de_acao_respostas = deepClone(savedResponses);
                }
                const isMonitoria = activeAnalysisType && activeAnalysisType.slug === 'novas-monitorias';

                if (isMonitoria) {
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
                }

                console.log('Respostas salvas:', savedResponses);

                const processoListKey = getProcessoVinculadoQuestionKey();
                const reservedResponseKeys = new Set([
                    'processos_vinculados',
                    SAVED_PROCESSOS_KEY,
                    'selected_analysis_cards',
                    'contratos_status',
                    'general_card',
                    '_editing_card_index',
                    '__savedIndex',
                    '__source'
                ]);
                if (processoListKey) {
                    reservedResponseKeys.add(processoListKey);
                }

                Object.keys(savedResponses).forEach(key => {
                    if (reservedResponseKeys.has(key)) {
                        return;
                    }
                    userResponses[key] = deepClone(savedResponses[key]);
                    console.log(`Carregando: ${key} =`, savedResponses[key]);
                });

                // Garante que a pergunta PROCESSO_VINCULADO use somente o card em edição.
                syncProcessoVinculadoResponseKey(processoListKey);

                if (isMonitoria) {
                    const contratoArray = parseContractsField(cardData.contratos);
                    const contratoArrayNormalizado = Array.from(
                        new Set(
                            contratoArray
                                .map(resolveContratoCandidate)
                                .filter(Boolean)
                                .map(item => item.id)
                        )
                    );
                    userResponses.contratos_para_monitoria =
                        contratoArrayNormalizado.length > 0
                            ? contratoArrayNormalizado
                            : contratoArray;
                    userResponses.ativar_botao_monitoria = contratoArray.length ? 'SIM' : '';
                }

                console.log('UserResponses completo:', userResponses);

                console.log('Renderizando árvore...');
                renderDecisionTree();
                startPopulationCascade();
            };

            ensureDecisionTreeForCardEditing(cardData)
                .done(proceedRestore)
                .fail(reason => {
                    delete userResponses._editing_card_index;
                    if (reason && reason.cancelled) {
                        return;
                    }
                    const message = reason && reason.message
                        ? reason.message
                        : 'Não foi possível preparar o card para edição. Tente novamente.';
                    showCffSystemDialog(message, 'warning');
                });
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
	            analysisHasStarted = true;
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
                general_card_snapshot: true,
                analysis_type: activeAnalysisType && activeAnalysisType.id != null ? {
                    id: activeAnalysisType.id,
                    nome: activeAnalysisType.nome,
                    slug: activeAnalysisType.slug,
                    hashtag: activeAnalysisType.hashtag,
                    versao: activeAnalysisType.versao
                } : null
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
            loadContratosFromDOM();
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

        function saveResponses(options = {}) {
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
            if (!options.skipRender) {
                displayFormattedResponses(); // Isso vai recriar o botão, então o listener precisa ser global
            }
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

        function isNonJudicializedEntry(entry) {
            if (!entry || typeof entry !== 'object') {
                return false;
            }
            const statusValue = normalizeResponse(entry?.tipo_de_acao_respostas?.judicializado_pela_massa);
            return statusValue === 'NÃO';
        }

        function getProcessoCnjLabel(entry) {
            const cnjValue = String(entry?.cnj || '').trim();
            if (!cnjValue || isNonJudicializedEntry(entry)) {
                return 'Não informado';
            }
            const formatted = formatCnjDigits(cnjValue);
            return formatted || 'Não informado';
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

        function parseCurrencyValue(raw) {
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

        function findContractInlineRow(contractIdOrNumber) {
            const candidate = String(contractIdOrNumber || '').trim();
            if (!candidate) {
                return null;
            }
            const directIdInput = document.querySelector(`.dynamic-contratos input[name$="-id"][value="${candidate}"]`);
            if (directIdInput) {
                return directIdInput.closest('.dynamic-contratos');
            }
            const normalized = candidate.replace(/\D/g, '');
            const rows = Array.from(document.querySelectorAll('.dynamic-contratos'));
            for (const row of rows) {
                const rowId = String(row.querySelector('input[name$="-id"]')?.value || '').trim();
                const rowNumeroContrato = String(
                    row.querySelector('input[name$="-numero_contrato"]')?.value || ''
                ).trim();
                if (rowId && rowId === candidate) {
                    return row;
                }
                if (rowNumeroContrato && (rowNumeroContrato === candidate || rowNumeroContrato.replace(/\D/g, '') === normalized)) {
                    return row;
                }
            }
            return null;
        }

        function getContractSaldoAtualizadoFromRow(row) {
            if (!row) {
                return null;
            }
            const valorCausaInput = row.querySelector('input[name$="-valor_causa"]');
            return parseCurrencyValue(valorCausaInput ? valorCausaInput.value : null);
        }

        function waitForContractSaldoAtualizado(row, previousValue, timeoutMs = 12000) {
            return new Promise(resolve => {
                const startedAt = Date.now();
                const poll = () => {
                    const currentValue = getContractSaldoAtualizadoFromRow(row);
                    const nowlexBtn = row ? row.querySelector('.nowlex-valor-btn') : null;
                    const finished = !nowlexBtn || !nowlexBtn.disabled;
                    const hasPositiveValue = Number.isFinite(currentValue) && currentValue > 0;

                    if (hasPositiveValue && (previousValue == null || currentValue !== previousValue || previousValue <= 0)) {
                        resolve(currentValue);
                        return;
                    }
                    if (finished && Date.now() - startedAt > 1200) {
                        resolve(Number.isFinite(currentValue) ? currentValue : null);
                        return;
                    }
                    if (Date.now() - startedAt >= timeoutMs) {
                        resolve(Number.isFinite(currentValue) ? currentValue : null);
                        return;
                    }
                    setTimeout(poll, 250);
                };
                setTimeout(poll, 250);
            });
        }

        async function ensureContractSaldoAtualizado(contractIdOrNumber) {
            const row = findContractInlineRow(contractIdOrNumber);
            if (!row) {
                return null;
            }
            const currentValue = getContractSaldoAtualizadoFromRow(row);
            if (Number.isFinite(currentValue) && currentValue > 0) {
                return currentValue;
            }
            const nowlexBtn = row.querySelector('.nowlex-valor-btn');
            if (!nowlexBtn || nowlexBtn.disabled) {
                return currentValue;
            }
            nowlexBtn.click();
            return waitForContractSaldoAtualizado(row, currentValue);
        }

        function updateContractCustas(contractIdOrNumber, numericValue) {
            if (!contractIdOrNumber) return false;
            const inlineRow = findContractInlineRow(contractIdOrNumber);
            if (!inlineRow) return false;
            const resolvedId = String(inlineRow.querySelector('input[name$="-id"]')?.value || '').trim();
            const wrapperKey = resolvedId || String(contractIdOrNumber).trim();
            const wrapper = wrapperKey
                ? document.querySelector(`.contrato-item-wrapper[data-contrato-id="${wrapperKey}"]`)
                : null;
            if (wrapper) {
                wrapper.setAttribute('data-custas', numericValue != null ? numericValue : '');
            }
            const custasInput = inlineRow.querySelector('input[name$="-custas"]');
            if (!custasInput) return false;
            const formatted = numericValue == null ? '' : formatCurrency(numericValue);
            custasInput.value = formatted;
            custasInput.dispatchEvent(new Event('input', { bubbles: true }));
            custasInput.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        function parseContractsField(value) {
            if (!value) return [];

            const normalizeList = (items) => {
                const seen = new Set();
                return (items || [])
                    .map(item => String(item == null ? '' : item).trim())
                    .filter(Boolean)
                    .map(item => item.replace(/^['"]+|['"]+$/g, '').trim())
                    .filter(Boolean)
                    .filter(item => {
                        if (seen.has(item)) return false;
                        seen.add(item);
                        return true;
                    });
            };

            if (Array.isArray(value)) {
                return normalizeList(value);
            }

            if (typeof value === 'object') {
                if (Array.isArray(value.contratos)) {
                    return normalizeList(value.contratos);
                }
                if (Array.isArray(value.values)) {
                    return normalizeList(value.values);
                }
                if (Object.prototype.hasOwnProperty.call(value, 'id')) {
                    return normalizeList([value.id]);
                }
                return normalizeList(Object.values(value));
            }

            const raw = String(value).trim();
            if (!raw) return [];

            if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
                try {
                    const parsed = JSON.parse(raw);
                    return parseContractsField(parsed);
                } catch (error) {
                    // segue para parsing textual
                }
            }

            return normalizeList(
                raw
                    .split(/[;,]/)
                    .map(part => part.trim())
                    .map(part => part.replace(/^\[+|\]+$/g, '').trim())
            );
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

        function normalizeIsoDateValue(value) {
            if (value === undefined || value === null) {
                return '';
            }
            const raw = String(value).trim();
            if (!raw) {
                return '';
            }
            const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (isoMatch) {
                return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
            }
            const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (brMatch) {
                return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
            }
            const parsed = new Date(raw);
            if (Number.isNaN(parsed.getTime())) {
                return '';
            }
            const pad = n => (`0${n}`).slice(-2);
            return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
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

        function splitNotebookEntries(rawNotes) {
            if (!rawNotes) {
                return [];
            }
            const lines = rawNotes.split(/\r?\n/);
            const mentionLineRegex = /(#[nN][jJ]\d+)|\bcnj\b|\bcontratos?\b\s*:/i;
            const segments = [];
            let current = [];
            const commitCurrent = () => {
                if (current.some(line => line.trim())) {
                    segments.push(current.join('\n'));
                }
                current = [];
            };
            lines.forEach(line => {
                const trimmed = line.trim();
                const isMention = trimmed && mentionLineRegex.test(trimmed);
                if (isMention && current.some(entryLine => entryLine.trim())) {
                    commitCurrent();
                }
                current.push(line);
            });
            commitCurrent();
            return segments.map(segment => segment.trim()).filter(Boolean);
        }

        function getObservationEntriesForCnj(cnj, relatedContracts, options = {}) {
            if (!cnj && !options.mentionType) {
                return [];
            }
            const rawNotes = localStorage.getItem(notebookStorageKey) || '';
            if (!rawNotes.trim()) {
                return [];
            }
        const mentionType = options.mentionType || 'cnj';
        const normalizedTarget = String(cnj || '').trim();
        const mentionLabelRaw = String(options.mentionLabel || '').trim();
        const mentionLabelNormalized = mentionLabelRaw ? mentionLabelRaw.toLowerCase() : '';
        const normalizedCnjDigits =
            mentionType === 'cnj' && normalizedTarget ? normalizedTarget.replace(/\D/g, '') : '';
            const entries = splitNotebookEntries(rawNotes);

            function parseRawEntry(entryRaw) {
                const lines = entryRaw
                    .split('\n')
                    .map(line => line.trim());
                const mentionLines = lines.filter(line =>
                    /cnj/i.test(line) ||
                    /contratos?\s*:/i.test(line) ||
                    /#nj\d+/i.test(line)
                );
                const contentLines = lines.filter(line =>
                    line && !mentionLines.includes(line)
                );
                const summaryLine = contentLines[0] || mentionLines[0] || lines.find(Boolean) || '';
                return {
                    raw: entryRaw,
                    mentionLines,
                    contentLines,
                    summary: summaryLine,
                    cnjDigits: extractCnjDigits(entryRaw)
                };
            }

            const parsedEntries = entries.map(entry => parseRawEntry(entry));
            const normalizedEntries = [];
            for (let idx = 0; idx < parsedEntries.length; idx++) {
                let current = parsedEntries[idx];
                if (
                    mentionType === 'nj' &&
                    current.mentionLines.length &&
                    current.contentLines.length === 0
                ) {
                    let j = idx + 1;
                    while (
                        j < parsedEntries.length &&
                        parsedEntries[j].mentionLines.length === 0
                    ) {
                        current = parseRawEntry(`${current.raw}\n\n${parsedEntries[j].raw}`);
                        j += 1;
                    }
                    idx = j - 1;
                }
                normalizedEntries.push(current);
            }

            const entriesToReview = normalizedEntries.length ? normalizedEntries : parsedEntries;
            let matches = [];
            if (mentionType === 'cnj') {
                let capturing = false;
                entriesToReview.forEach((entry, idx) => {
                    const lowerRaw = (entry.raw || '').toLowerCase();
                    const hasTargetCnj = normalizedCnjDigits
                        ? entry.raw.replace(/\D/g, '').includes(normalizedCnjDigits)
                        : lowerRaw.includes((normalizedTarget || '').toLowerCase());
                    // Se o usuário escreveu uma hashtag/nota logo acima do "CNJ:", o split pode ter separado
                    // em dois blocos. Para exibir no post-it amarelo, reanexa o bloco anterior ao bloco do CNJ.
                    let effectiveEntry = entry;
                    if (hasTargetCnj && idx > 0) {
                        const prev = entriesToReview[idx - 1];
                        const prevRaw = (prev && prev.raw) ? String(prev.raw) : '';
                        const prevHasCnj = Boolean(extractCnjDigits(prevRaw));
                        const prevHasMentionLines =
                            prev && Array.isArray(prev.mentionLines) && prev.mentionLines.length > 0;
                        const prevHasMeaningfulContent =
                            prev && Array.isArray(prev.contentLines) && prev.contentLines.some(line => line.trim());
                        const prevHasHashtag = /(^|\n)\s*#\S+/m.test(prevRaw);
                        // Reanexa se o bloco anterior parece ser "conteúdo solto" (sem CNJ/contratos/#NJ),
                        // pois é comum o usuário escrever o texto e depois inserir a menção.
                        // Também cobre o caso do bloco ser apenas a hashtag do tipo.
                        if (!prevHasCnj && !prevHasMentionLines && (prevHasMeaningfulContent || prevHasHashtag)) {
                            effectiveEntry = parseRawEntry(`${prevRaw}\n${entry.raw}`);
                        }
                    }

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
                        matches.push(effectiveEntry);
                    }
                });
            } else {
                const targetLabel = mentionLabelNormalized || (normalizedTarget || '').trim().toLowerCase();
                if (targetLabel) {
                    matches = entriesToReview.filter(entry =>
                        (entry.mentionLines || []).some(line =>
                            line.toLowerCase().includes(targetLabel)
                        )
                    );
                }
            }

            if (!matches.length && mentionType === 'cnj' && relatedContracts && relatedContracts.length) {
                return entriesToReview.filter(entry =>
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

        function getCurrentAnalysisAuthorName() {
            const fromSessionUser = String(window.__analise_username || '').trim();
            if (fromSessionUser) {
                return fromSessionUser;
            }
            const fromWidget = String($responseField.data('analise-updated-by') || '').trim();
            return fromWidget;
        }

        function resolveCardAnalysisAuthor(processo, fallbackAuthor = '') {
            if (processo && typeof processo === 'object') {
                const candidates = [
                    processo.analysis_author,
                    processo.analise_autor,
                    processo.updated_by,
                    processo.supervisor_observacoes_autor
                ];
                for (const candidate of candidates) {
                    const normalized = String(candidate || '').trim();
                    if (normalized) {
                        return normalized;
                    }
                }
            }
            const normalizedFallback = String(fallbackAuthor || '').trim();
            if (normalizedFallback) {
                return normalizedFallback;
            }
            return getCurrentAnalysisAuthorName();
        }

        function resolveCardAnalysisDateRaw(processo, fallbackDateRaw = '') {
            if (processo && typeof processo === 'object') {
                const candidates = [
                    processo.updated_at,
                    processo.saved_at,
                    processo.updatedAt,
                    processo.savedAt
                ];
                for (const candidate of candidates) {
                    const normalized = String(candidate || '').trim();
                    if (normalized) {
                        return normalized;
                    }
                }
            }
            const normalizedFallback = String(fallbackDateRaw || '').trim();
            return normalizedFallback;
        }

        function formatAnalysisDateOnly(rawValue) {
            const raw = String(rawValue || '').trim();
            if (!raw) {
                return '';
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
                return formatDateIsoToBr(raw);
            }
            const date = new Date(raw);
            if (Number.isNaN(date.getTime())) {
                return '';
            }
            const pad = (value) => String(value).padStart(2, '0');
            return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
        }

        function buildAnalysisByline(authorName, rawDate) {
            const author = String(authorName || '').trim();
            if (!author) {
                return '';
            }
            const formattedDate = formatAnalysisDateOnly(rawDate);
            if (formattedDate) {
                return `Analisado por: ${author} em ${formattedDate}`;
            }
            return `Analisado por: ${author}`;
        }

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
                    const contratoInfo = allAvailableContratos.find(
                        c =>
                            String(c.id) === String(id) ||
                            String(c.numero_contrato) === String(id)
                    );
                    return contratoInfo ? contratoInfo.numero_contrato : `ID ${id}`;
                })
                .filter(Boolean);
        }

        function formatAnsweredValue(key, value, options = {}) {
            if (Array.isArray(value)) {
                if (key === 'contratos_para_monitoria') {
                    const contractNumbers =
                        options.contractInfos && options.contractInfos.length
                            ? options.contractInfos
                                  .map(ci => ci.numero_contrato || `ID ${ci.id}`)
                                  .filter(Boolean)
                            : getContractNumberDisplay(value);
                    return contractNumbers.length ? contractNumbers.join(', ') : value.join(', ');
                }
                return value.join(', ');
            }
            return String(value);
        }

        function formatDateIsoToBr(value) {
            const raw = String(value || '').trim();
            const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return raw;
            return `${match[3]}/${match[2]}/${match[1]}`;
        }

		        function getSnapshotDecisionTreeCacheKey(analysisType) {
		            const tipo = analysisType && typeof analysisType === 'object' ? analysisType : null;
		            const tipoId = tipo && tipo.id != null ? String(tipo.id) : '';
		            const tipoVersao = tipo && tipo.versao != null ? String(tipo.versao) : '';
		            if (!tipoId) return null;
		            const cacheKeyBase = `${DECISION_TREE_CACHE_KEY}:${tipoId}`;
		            return tipoVersao ? `${cacheKeyBase}:v${tipoVersao}` : cacheKeyBase;
		        }

		        function getTreeDataForSnapshotAnalysisType(analysisType) {
		            const cacheKey = getSnapshotDecisionTreeCacheKey(analysisType);
		            if (!cacheKey) return null;
		            const cached = readSessionCache(cacheKey, DECISION_TREE_CACHE_TTL_MS);
		            if (cached && cached.tree_data) {
		                return cached.tree_data || null;
		            }
		            return null;
		        }

		        const snapshotTreeFetchPromises = {};
		        const snapshotTreeFetchFailed = {};
		        const snapshotTreeFetchAttemptCounts = {};
		        function hasSnapshotTreeFetchFailed(analysisType) {
		            const cacheKey = getSnapshotDecisionTreeCacheKey(analysisType);
		            if (!cacheKey) return false;
		            return Boolean(snapshotTreeFetchFailed[cacheKey]);
		        }

		        function fetchDecisionTreeConfigForSnapshot(analysisType) {
		            const tipo = analysisType && typeof analysisType === 'object' ? analysisType : null;
		            const tipoId = tipo && tipo.id != null ? String(tipo.id) : '';
		            if (!tipoId) {
		                return $.Deferred().reject().promise();
		            }

		            const cacheKey = getSnapshotDecisionTreeCacheKey(tipo);
		            const cached = readSessionCache(cacheKey, DECISION_TREE_CACHE_TTL_MS);
		            if (cached && cached.tree_data) {
		                return $.Deferred().resolve(cached.tree_data).promise();
		            }

		            if (snapshotTreeFetchPromises[cacheKey]) {
		                return snapshotTreeFetchPromises[cacheKey];
		            }

		            snapshotTreeFetchAttemptCounts[cacheKey] = (snapshotTreeFetchAttemptCounts[cacheKey] || 0) + 1;
		            const deferred = $.Deferred();
		            snapshotTreeFetchPromises[cacheKey] = deferred.promise();

		            const markFailed = (reason) => {
		                snapshotTreeFetchFailed[cacheKey] = true;
		                deferred.reject(reason);
		            };

		            $.ajax({
		                url: decisionTreeApiUrl,
		                method: 'GET',
		                data: { tipo_id: tipoId },
		                dataType: 'json',
		                success: function (data) {
		                    if (data && data.status === 'success' && data.tree_data) {
		                        snapshotTreeFetchFailed[cacheKey] = false;
		                        writeSessionCache(cacheKey, {
		                            tree_data: data.tree_data || {},
		                            primeira_questao_chave: data.primeira_questao_chave || null,
		                            analysis_type: data.analysis_type || tipo || null
		                        });
		                        deferred.resolve(data.tree_data || {});
		                    } else {
		                        markFailed(data && data.message ? data.message : 'Erro ao carregar árvore.');
		                    }
		                },
		                error: function (xhr, status, error) {
		                    markFailed(error || status || 'Erro AJAX ao carregar árvore.');
		                },
		                complete: function () {
		                    delete snapshotTreeFetchPromises[cacheKey];
		                }
		            });

		            return deferred.promise();
		        }

	        function prefetchSnapshotTreesForCards(cards) {
	            const list = Array.isArray(cards) ? cards : [];
	            const byKey = {};
	            list.forEach(card => {
	                if (!card || typeof card !== 'object') return;
	                const tipo = card.analysis_type && typeof card.analysis_type === 'object'
	                    ? card.analysis_type
	                    : null;
	                const tipoId = tipo && tipo.id != null ? String(tipo.id) : '';
	                if (!tipoId) return;
	                byKey[tipoId] = tipo;
	            });

	            const tipos = Object.values(byKey);
	            const fetches = tipos
	                .filter(t => !getTreeDataForSnapshotAnalysisType(t))
	                .map(t => fetchDecisionTreeConfigForSnapshot(t));
	            if (!fetches.length) {
	                return $.Deferred().resolve().promise();
	            }
	            return $.when.apply($, fetches);
	        }

		        let snapshotTreesPrefetchScheduled = false;
		        function scheduleSnapshotTreePrefetch(cards) {
		            if (snapshotTreesPrefetchScheduled) {
		                return;
		            }
		            const list = Array.isArray(cards) ? cards : [];
		            const tipos = {};
		            list.forEach(card => {
		                const tipo = card && card.analysis_type && typeof card.analysis_type === 'object'
		                    ? card.analysis_type
		                    : null;
		                const tipoId = tipo && tipo.id != null ? String(tipo.id) : '';
		                if (!tipoId) return;
		                if (getTreeDataForSnapshotAnalysisType(tipo)) return;
		                const cacheKey = getSnapshotDecisionTreeCacheKey(tipo);
		                if (cacheKey && snapshotTreeFetchFailed[cacheKey]) return;
		                if (cacheKey && (snapshotTreeFetchAttemptCounts[cacheKey] || 0) >= 2) return;
		                tipos[tipoId] = tipo;
		            });
		            const missing = Object.values(tipos);
		            if (!missing.length) {
		                return;
		            }
	            snapshotTreesPrefetchScheduled = true;
	            prefetchSnapshotTreesForCards(list)
	                .always(() => {
	                    snapshotTreesPrefetchScheduled = false;
	                    // re-render para preencher rótulos/ordem do resumo
	                    setTimeout(() => {
	                        try {
	                            displayFormattedResponses();
	                        } catch (e) {
	                            // ignore
	                        }
	                    }, 0);
	                });
	        }

	        function getAnsweredFieldEntriesFromTree(processo, options = {}) {
	            if (!processo || typeof processo !== 'object') {
	                return [];
	            }
            const excludeFields = Array.isArray(options.excludeFields)
                ? options.excludeFields
                : [];
            const treeData = options.treeData || treeConfig || {};
            const responses = (processo && processo.tipo_de_acao_respostas) || processo || {};

            const keysOrdered = Object.keys(treeData || {})
                .filter(Boolean)
                .filter(k => {
                    const q = treeData[k];
                    if (!q) return false;
                    if (excludeFields.includes(k)) return false;
                    if (q.tipo_campo === 'PROCESSO_VINCULADO') return false;
                    if (q.tipo_campo === 'CONTRATOS_MONITORIA') return false;
                    // evita ruídos específicos de monitória
                    if (k === 'contratos_para_monitoria') return false;
                    if (k === 'ativar_botao_monitoria') return false;
                    return true;
                })
                .sort((a, b) => {
                    const oa = treeData[a]?.ordem ?? 9999;
                    const ob = treeData[b]?.ordem ?? 9999;
                    return oa - ob;
                });

            const entries = [];
            keysOrdered.forEach(key => {
                let value = responses[key];
                if (value === undefined || value === null || value === '') {
                    return;
                }
                const q = treeData[key];
                let displayValue = value;
                if (q?.tipo_campo === 'DATA') {
                    displayValue = formatDateIsoToBr(value);
                }
                entries.push({
                    label: q?.texto_pergunta || key,
                    value: formatAnsweredValue(key, displayValue, {
                        contractInfos: options.contractInfos
                    })
                });
            });
            return entries;
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
	                'habilitacao',
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
	                habilitacao: 'Habilitação',
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
                    value: formatAnsweredValue(key, value, {
                        contractInfos: options.contractInfos
                    })
                });
            });
            return entries;
        }

		        function buildProcessoDetailsSnapshot(processo, options = {}) {
            const cnjVinculado = processo.cnj || 'Não informado';
            const isNonJudicial = isCardNonJudicialized(processo);
            const mentionType = isNonJudicial ? 'nj' : 'cnj';
            if (isNonJudicial) {
                assignNjLabelToCard(processo);
            }
            const $ulDetalhes = $('<ul></ul>');
            const contratoIds = parseContractsField(processo.contratos);
            const contratoInfos = contratoIds.map(cId => {
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
            const monitoriaIds = parseContractsField(
                processo.tipo_de_acao_respostas &&
                processo.tipo_de_acao_respostas.contratos_para_monitoria
                    ? processo.tipo_de_acao_respostas.contratos_para_monitoria
                    : []
            );
            const monitoriaInfos = monitoriaIds.map(cId => {
                const prioritized = contratoInfos.find(
                    c =>
                        String(c.id) === String(cId) ||
                        String(c.numero_contrato) === String(cId)
                );
                if (prioritized) {
                    return prioritized;
                }
                const fallback = allAvailableContratos.find(
                    c =>
                        String(c.id) === String(cId) ||
                        String(c.numero_contrato) === String(cId)
                );
                if (fallback) {
                    return fallback;
                }
                const domFallback = fetchContractInfoFromDOM(cId);
                if (domFallback) {
                    return domFallback;
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

            const tipoSnapshotText = normalizeDecisionText(
                (processo?.analysis_type?.slug || processo?.analysis_type?.nome || activeAnalysisType?.slug || activeAnalysisType?.nome || '')
            );
            const isPassivasSnapshot = tipoSnapshotText.includes('PASSIV');

            const totalDevido = contratoInfos.reduce(
                (acc, c) => acc + (c.valor_total_devido || 0),
                0
            );
            const totalCausa = contratoInfos.reduce(
                (acc, c) => acc + (c.valor_causa || 0),
                0
            );
            const totalCustas = contratoInfos.reduce(
                (acc, c) => acc + (c.custas || 0),
                0
            );
            if (!isPassivasSnapshot) {
                const contratosCount = contratoInfos.length;
                const isSummed = contratosCount > 1;
                const contratosCountLabel = `${contratosCount} ${contratosCount === 1 ? 'contrato' : 'contratos'}`;
                const saldoDevedorLabel = isSummed
                    ? `Saldo devedor somado (${contratosCountLabel})`
                    : 'Saldo devedor';
                const saldoAtualizadoLabel = isSummed
                    ? `Saldo atualizado somado (${contratosCountLabel})`
                    : 'Saldo atualizado';
                $ulDetalhes.append(
                    `<li><strong>${saldoDevedorLabel}:</strong> ${formatCurrency(totalDevido)}</li>`
                );
                $ulDetalhes.append(
                    `<li><strong>${saldoAtualizadoLabel}:</strong> ${formatCurrency(totalCausa)}</li>`
                );
            } else {
                const valorCausaProcesso = parseCurrencyValue(processo?.valor_causa);
                const valorCausaDisplay =
                    valorCausaProcesso != null
                        ? formatCurrency(valorCausaProcesso)
                        : formatCurrency(0);
                $ulDetalhes.append(
                    `<li><strong>Valor da causa:</strong> ${valorCausaDisplay}</li>`
                );
            }
            const firstContractId = contratoInfos.length ? contratoInfos[0].id : null;
            const shouldSyncCustasToInline = contratoInfos.length === 1;
            const $custasInput = $('<input type="text" class="analise-custas-input">');
            $custasInput.val(formatCurrency(totalCustas));
            $custasInput.on('change', () => {
                const numeric = parseCurrencyValue($custasInput.val());
                $custasInput.val(formatCurrency(numeric));
                if (!shouldSyncCustasToInline) return;
                if (numeric != null && !firstContractId) return;
                updateContractCustas(firstContractId, numeric);
            });
            const $custasLine = $('<li class="analise-custas-line"><strong>Custas:</strong></li>');
            $custasLine.append($custasInput);
            if (!isPassivasSnapshot) {
                const $calc2Btn = $('<button type="button" class="analise-custas-calc-btn" title="Calcular 2% do saldo atualizado">Calc 2%</button>');
                $calc2Btn.on('click', async () => {
                    if ($calc2Btn.prop('disabled')) {
                        return;
                    }
                    const originalButtonText = $calc2Btn.text();
                    $calc2Btn.prop('disabled', true).text('Calc...');
                    try {
                        const targetInfosRaw = monitoriaInfos.length ? monitoriaInfos : contratoInfos;
                        const seenTargets = new Set();
                        const targetInfos = targetInfosRaw.filter(info => {
                            const key = String((info && (info.id || info.numero_contrato)) || '').trim();
                            if (!key || seenTargets.has(key)) {
                                return false;
                            }
                            seenTargets.add(key);
                            return true;
                        });
                        if (!targetInfos.length) {
                            showCffSystemDialog('Não há contratos selecionados para calcular custas.', 'warning');
                            return;
                        }
                        const contratosSemSaldoAtualizado = [];
                        let totalCustasCalculadas = 0;
                        for (const contratoInfo of targetInfos) {
                            const contractRef = contratoInfo && (contratoInfo.id || contratoInfo.numero_contrato);
                            const contractLabel = contratoInfo && (contratoInfo.numero_contrato || String(contractRef));
                            if (!contractRef) {
                                if (contractLabel) {
                                    contratosSemSaldoAtualizado.push(contractLabel);
                                }
                                continue;
                            }
                            let saldoAtualizadoContrato = Number(contratoInfo.valor_causa);
                            if (!(Number.isFinite(saldoAtualizadoContrato) && saldoAtualizadoContrato > 0)) {
                                saldoAtualizadoContrato = await ensureContractSaldoAtualizado(contractRef);
                            }
                            if (
                                !(Number.isFinite(saldoAtualizadoContrato) && saldoAtualizadoContrato > 0) &&
                                contratoInfo.numero_contrato &&
                                String(contratoInfo.numero_contrato) !== String(contractRef)
                            ) {
                                saldoAtualizadoContrato = await ensureContractSaldoAtualizado(contratoInfo.numero_contrato);
                            }
                            if (!(Number.isFinite(saldoAtualizadoContrato) && saldoAtualizadoContrato > 0)) {
                                const refreshedInfo =
                                    fetchContractInfoFromDOM(contractRef) ||
                                    fetchContractInfoFromDOM(contratoInfo.numero_contrato);
                                saldoAtualizadoContrato = Number(refreshedInfo && refreshedInfo.valor_causa);
                            }
                            if (!(Number.isFinite(saldoAtualizadoContrato) && saldoAtualizadoContrato > 0)) {
                                if (contractLabel) {
                                    contratosSemSaldoAtualizado.push(contractLabel);
                                }
                                continue;
                            }
                            const custasContrato = Math.round((saldoAtualizadoContrato * 0.02) * 100) / 100;
                            const updated =
                                updateContractCustas(contractRef, custasContrato) ||
                                updateContractCustas(contratoInfo.numero_contrato, custasContrato);
                            if (!updated) {
                                if (contractLabel) {
                                    contratosSemSaldoAtualizado.push(contractLabel);
                                }
                                continue;
                            }
                            totalCustasCalculadas += custasContrato;
                        }
                        $custasInput.val(formatCurrency(totalCustasCalculadas));
                        $custasInput.trigger('input');
                        if (contratosSemSaldoAtualizado.length) {
                            const pendentes = Array.from(new Set(contratosSemSaldoAtualizado)).join(', ');
                            showCffSystemDialog(
                                `Não foi possível calcular custas para: ${pendentes}. Verifique o saldo atualizado (use "Só valor" se necessário).`,
                                'warning'
                            );
                        }
                    } finally {
                        $calc2Btn.prop('disabled', false).text(originalButtonText);
                    }
                });
                $custasLine.append($calc2Btn);
            }
            $ulDetalhes.append($custasLine);

	            const snapshotTreeData = getTreeDataForSnapshotAnalysisType(processo?.analysis_type) || {};
	            const hasSnapshotTreeData = Boolean(snapshotTreeData && Object.keys(snapshotTreeData).length);

	            const fieldEntries = hasSnapshotTreeData
	                ? getAnsweredFieldEntriesFromTree(processo, {
	                    excludeFields: options.excludeFields || [],
	                    contractInfos: monitoriaInfos,
	                    treeData: snapshotTreeData
	                })
	                : getAnsweredFieldEntries(processo, {
	                    excludeFields: options.excludeFields || [],
	                    contractInfos: monitoriaInfos
	                });
	            if (fieldEntries.length) {
	                const $liAcao = $(
	                    `<li><strong>${isPassivasSnapshot ? 'Respostas da Análise:' : 'Resultado da Análise:'}</strong><ul></ul></li>`
	                );
                const $ulAcao = $liAcao.find('ul');
                fieldEntries.forEach(entry => {
                    $ulAcao.append(
                        `<li>${entry.label}: ${entry.value}</li>`
                    );
                });
	                $ulDetalhes.append($liAcao);
		            } else if (isPassivasSnapshot) {
		                const responses = processo && processo.tipo_de_acao_respostas ? processo.tipo_de_acao_respostas : {};
		                const hasAnyAnswer = Object.keys(responses || {}).some(k => {
		                    const v = responses[k];
		                    return v !== undefined && v !== null && v !== '';
		                });
			                if (hasAnyAnswer && !hasSnapshotTreeData) {
			                    const failed = hasSnapshotTreeFetchFailed(processo?.analysis_type);
			                    $ulDetalhes.append(
			                        failed
			                            ? '<li><strong>Respostas da Análise:</strong> <em>não foi possível carregar a árvore deste tipo.</em></li>'
		                            : '<li><strong>Respostas da Análise:</strong> <em>carregando...</em></li>'
		                    );
		                }
		            }

            const contractsReferenced = Array.from(
                new Set(contratoInfos.map(c => c.id))
            );
            const observationTarget = isNonJudicial
                ? (processo.nj_label || cnjVinculado)
                : cnjVinculado;

            const observationEntries = getObservationEntriesForCnj(
                observationTarget,
                contractsReferenced,
                { mentionType }
            );
            const fallbackText = processo && typeof processo.observacoes === 'string'
                ? processo.observacoes.trim()
                : '';
            const hasRenderableNotebookContent = getRenderableObservationLines(observationEntries).length > 0;
            const effectiveObservationEntries =
                hasRenderableNotebookContent
                    ? observationEntries
                    : (fallbackText ? [{ raw: fallbackText, mentionLines: [], contentLines: [fallbackText], summary: fallbackText }] : []);

            return {
                cnj: cnjVinculado,
                contratoInfos,
                contractIds: contractsReferenced,
                $detailsList: $ulDetalhes,
                observationEntries: effectiveObservationEntries,
                observationTarget,
                observationFallbackText: fallbackText
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

        function getRenderableObservationLines(observationEntries) {
            if (!Array.isArray(observationEntries) || !observationEntries.length) {
                return [];
            }
            const mentionLineRegex = /(#[nN][jJ]\d+)|\bcnj\b|\bcontratos?\b\s*:/i;
            const lines = [];
            observationEntries.forEach(entry => {
                const rawLines = String(entry && entry.raw ? entry.raw : '')
                    .split('\n')
                    .map(line => line.trim())
                    .filter(Boolean);
                if (rawLines.length) {
                    rawLines.forEach(line => {
                        if (!mentionLineRegex.test(line)) {
                            lines.push(line);
                        }
                    });
                    return;
                }
                const contentLines = Array.isArray(entry && entry.contentLines) ? entry.contentLines : [];
                contentLines
                    .map(line => String(line || '').trim())
                    .filter(Boolean)
                    .forEach(line => lines.push(line));
            });
            return lines;
        }

        function createObservationNoteElement(observationEntries) {
            if (!observationEntries || !observationEntries.length) {
                return null;
            }
            const populatedEntries = observationEntries.filter(entry =>
                (entry.contentLines && entry.contentLines.length) ||
                (entry.mentionLines && entry.mentionLines.length)
            );
            if (!populatedEntries.length) {
                return null;
            }
            const $note = $('<div class="analise-observation-note" role="status"></div>');
            $note.append('<span class="analise-observation-pin" aria-hidden="true"></span>');
            const $noteContent = $('<div class="analise-observation-content"></div>');
            $noteContent.append('<strong>Observações</strong>');
            const $noteTextarea = $('<textarea class="analise-observation-textarea" readonly></textarea>');
            const allLines = getRenderableObservationLines(populatedEntries);
            if (!allLines.length) {
                return null;
            }
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
            const observationTarget = options.observationTarget || options.cnj;
            if (observationTarget) {
                $notesColumn.attr('data-analise-cnj', observationTarget);
            }
            if (Array.isArray(options.contracts) && options.contracts.length) {
                $notesColumn.attr('data-analise-contracts', options.contracts.join(','));
            }
            if (options.mentionType) {
                $notesColumn.attr('data-analise-mention-type', options.mentionType);
            }
            const mentionLabel =
                options.mentionLabel || (options.mentionType === 'nj' ? observationTarget : '');
            if (mentionLabel) {
                $notesColumn.attr('data-analise-mention-label', mentionLabel);
            }
            if (typeof options.observationFallbackText === 'string' && options.observationFallbackText.trim()) {
                $notesColumn.data('analiseObservationFallback', options.observationFallbackText.trim());
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
                saveResponses({ skipRender: true });
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
            processo.supervision_date = normalizeIsoDateValue(processo.supervision_date);
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

        function initializePetitionsDropdown($wrap) {
            if (!$wrap || !$wrap.length) {
                return;
            }
            const wrapEl = $wrap[0];
            if (!wrapEl || wrapEl.dataset.petitionsInitialized === '1') {
                return;
            }
            wrapEl.dataset.petitionsInitialized = '1';

            const trigger = wrapEl.querySelector('.petitions-trigger');
            const panel = wrapEl.querySelector('.petitions-panel');
            const rail = wrapEl.querySelector('.petitions-rail');
            const indicator = wrapEl.querySelector('.petitions-indicator');
            if (!trigger || !panel || !rail || !indicator) {
                return;
            }
            const items = Array.from(rail.querySelectorAll('.petitions-item'));
            if (!items.length) {
                return;
            }
            const actionTarget = {
                monitoria: '#id_gerar_monitoria_btn',
                cobranca: '#id_gerar_cobranca_btn',
                habilitacao: '#id_gerar_habilitacao_btn'
            };

            const highlightClass = 'petitions-highlighted';
            const moveIndicator = (btn) => {
                if (!btn) {
                    return;
                }
                const railRect = rail.getBoundingClientRect();
                const btnRect = btn.getBoundingClientRect();
                const left = btnRect.left - railRect.left;
                const extraPadding = 4;
                const shiftLeft = btnRect.width * 0.14;
                indicator.style.width = `${btnRect.width + extraPadding * 2}px`;
                indicator.style.transform = `translateX(${left - extraPadding - shiftLeft}px)`;
                items.forEach(item => item.classList.remove(highlightClass));
                btn.classList.add(highlightClass);
            };

            const syncIndicatorToActive = () => {
                const active = panel.querySelector('.petitions-item.is-active') || items[0];
                moveIndicator(active);
            };

            const openPanel = (open) => {
                panel.classList.toggle('open', Boolean(open));
                trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
                panel.setAttribute('aria-hidden', open ? 'false' : 'true');
                if (open) {
                    requestAnimationFrame(syncIndicatorToActive);
                }
            };

            const closePanel = () => openPanel(false);

            trigger.addEventListener('click', (event) => {
                event.stopPropagation();
                openPanel(!panel.classList.contains('open'));
            });

            panel.addEventListener('click', (event) => {
                event.stopPropagation();
            });

            const handleDocumentClick = () => closePanel();
            const handleKeyDown = (event) => {
                if (event.key === 'Escape') {
                    closePanel();
                }
            };
            const handleResize = () => {
                if (panel.classList.contains('open')) {
                    syncIndicatorToActive();
                }
            };

            document.addEventListener('click', handleDocumentClick);
            document.addEventListener('keydown', handleKeyDown);
            window.addEventListener('resize', handleResize);

            items.forEach((btn) => {
                btn.addEventListener('mouseenter', () => moveIndicator(btn));
                btn.addEventListener('focus', () => moveIndicator(btn));
                btn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    items.forEach((item) => item.classList.remove('is-active'));
                    btn.classList.add('is-active');
                    moveIndicator(btn);
                    closePanel();
                    const action = btn.dataset.action;
                    const selector = actionTarget[action];
                    if (action === 'monitoria' && !hasAnySpecificCardSelection()) {
                        showCffSystemDialog(
                            'Selecione primeiro o card de uma análise antes de gerar a Petição Monitória Inicial.',
                            'warning'
                        );
                        return;
                    }
                    if (selector) {
                        const targetButton = document.querySelector(selector);
                        if (targetButton) {
                            targetButton.click();
                        }
                    }
                });
            });

            syncIndicatorToActive();
        }

        function displayFormattedResponses() {
            $formattedResponsesContainer.empty();
            ensureUserResponsesShape();
            if (!Array.isArray(allAvailableContratos) || allAvailableContratos.length === 0) {
                loadContratosFromDOM();
            }

            const hasSavedCards = getSavedProcessCards().length > 0;
            const hasActiveCards = Array.isArray(userResponses.processos_vinculados) && userResponses.processos_vinculados.length > 0;
            const hasGeneralSnapshot = Boolean(getGeneralCardSnapshot());
            if (
                suppressGeneralSummaryUntilFirstAnswer &&
                !userResponses.judicializado_pela_massa &&
                !hasSavedCards &&
                !hasActiveCards &&
                !hasGeneralSnapshot
            ) {
                return;
            }

            const $headerContainer = $('<div style="display: flex; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 10px;"></div>');
            $headerContainer.append('<h3>Respostas da Análise</h3>');
            $formattedResponsesContainer.append($headerContainer);

            const isCardPendingCompletion = (processo) => {
                const cardType = processo && processo.analysis_type;
                if (!cardType || cardType.id == null) {
                    return false;
                }
                const latest = analysisTypesById[String(cardType.id)];
                if (!latest || latest.versao == null || cardType.versao == null) {
                    return false;
                }
                return Number(cardType.versao) < Number(latest.versao);
            };

            const generalSnapshot = getGeneralCardSnapshot();
            const generalSnapshotReady = generalSnapshot &&
                Array.isArray(generalSnapshot.contracts) &&
                generalSnapshot.contracts.length > 0 &&
                !shouldSkipGeneralCard();
            const generalEligible = generalSnapshotReady;
            const combinedCards = getCombinedProcessCardsForSummary();
            const hasCombinedCards = Array.isArray(combinedCards) && combinedCards.length > 0;
            const temDadosRelevantes =
                generalSnapshotReady ||
                userResponses.judicializado_pela_massa ||
                Object.keys(userResponses.contratos_status || {}).length > 0 ||
                hasCombinedCards ||
                hasActiveAnalysisResponses();

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

	            scheduleSnapshotTreePrefetch(combinedCards);
	            const processosVinculados = Array.isArray(combinedCards) ? combinedCards : [];
	            const visibleProcessos = processosVinculados;
            if (Array.isArray(visibleProcessos) && visibleProcessos.length > 0) {
                visibleProcessos.forEach((processo, idx) => {
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
                    : null;
                    const snapshot = buildProcessoDetailsSnapshot(processo);
                    const $cardVinculado = $('<div class="analise-summary-card"></div>');
                    const $headerVinculado = $('<div class="analise-summary-card-header"></div>');
                    const $bodyVinculado = $('<div class="analise-summary-card-body"></div>');
                    const cardAnalysisAuthor = resolveCardAnalysisAuthor(processo, updatedBy);
                    const cardAnalysisDateRaw = resolveCardAnalysisDateRaw(processo, updatedAtRaw);
                    const cardAnalysisByline = buildAnalysisByline(cardAnalysisAuthor, cardAnalysisDateRaw);
                    const $titleColumnVinculado = $('<div class="analise-summary-card-title-column"></div>');
                    if (cardAnalysisByline) {
                        const $analysisAuthorByline = $('<small class="analise-summary-card-analyst"></small>');
                        $analysisAuthorByline.text(cardAnalysisByline);
                        $titleColumnVinculado.append($analysisAuthorByline);
                    }
                    const $cnjLine = $('<span class="analise-summary-card-cnj-line"></span>');
                    $cnjLine.append('Processo CNJ: ');
                    $cnjLine.append($('<strong></strong>').text(snapshot.cnj));
                    $titleColumnVinculado.append($cnjLine);
                    $headerVinculado.append($titleColumnVinculado);
                    const tipoAnaliseNome = processo && processo.analysis_type && processo.analysis_type.nome
                        ? String(processo.analysis_type.nome).trim()
                        : '';
                    if (tipoAnaliseNome) {
                        const $tipoBadge = $(`<small class="analise-type-badge" title="Tipo de Análise">${tipoAnaliseNome}</small>`);
                        $headerVinculado.append($tipoBadge);
                    }
	                    const tipoAnaliseHashtag = processo && processo.analysis_type && processo.analysis_type.hashtag
	                        ? String(processo.analysis_type.hashtag).trim()
	                        : '';
	                    const mentionContractNumbers = (() => {
	                        const fromSnapshotInfos = Array.isArray(snapshot.contratoInfos)
	                            ? snapshot.contratoInfos
	                                .map(c => String(c && c.numero_contrato ? c.numero_contrato : '').trim())
	                                .filter(Boolean)
	                            : [];
	                        if (fromSnapshotInfos.length) {
	                            return Array.from(new Set(fromSnapshotInfos));
	                        }
	                        const fromContractIds = Array.isArray(snapshot.contractIds)
	                            ? snapshot.contractIds
	                                .map(id => String(getContractLabelForId(id) || '').trim())
	                                .filter(Boolean)
	                            : [];
	                        return Array.from(new Set(fromContractIds));
	                    })();
	                    if (tipoAnaliseHashtag) {
	                        const $postit = $(
	                            `<button type="button" class="analise-hashtag-postit" title="Mencionar no caderno">${tipoAnaliseHashtag}</button>`
	                        );
	                        $postit.on('click', function (event) {
	                            event.stopPropagation();
	                            const contratosLine = mentionContractNumbers.length
	                                ? `Contratos: ${mentionContractNumbers.join(', ')}`
	                                : '';
	                            const mention = [tipoAnaliseHashtag, `CNJ: ${snapshot.cnj}`, contratosLine]
	                                .filter(Boolean)
	                                .join('\n');
                            if (typeof window.openNotebookWithMention === 'function') {
                                window.openNotebookWithMention(mention);
                                return;
                            }
                            const finish = () => showCffSystemDialog('Menção copiada para colar no caderno.', 'success');
                            if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                                navigator.clipboard.writeText(mention).then(finish).catch(() => {
                                    showCffSystemDialog('Não foi possível copiar automaticamente. Copie manualmente.', 'warning');
                                });
                            } else {
                                finish();
                            }
                        });
                        $headerVinculado.append($postit);
                    }
                    const latestTipo = processo && processo.analysis_type && processo.analysis_type.id != null
                        ? analysisTypesById[String(processo.analysis_type.id)]
                        : null;
                    const cardVersao = processo && processo.analysis_type ? Number(processo.analysis_type.versao) : NaN;
                    const latestVersao = latestTipo ? Number(latestTipo.versao) : NaN;
                    if (Number.isFinite(cardVersao) && Number.isFinite(latestVersao) && cardVersao < latestVersao) {
                        const $pendingBadge = $('<small class="analise-completar-badge" title="Há atualização pendente neste tipo de análise">Completar</small>');
                        $headerVinculado.append($pendingBadge);
                    }
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
                    const $copyBtn = $('<button type="button" class="analise-summary-card-copy" title="Copiar referência para colar no caderno">Copiar</button>');
                    $headerVinculado.append($copyBtn);
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
	                    $copyBtn.on('click', function (event) {
	                        event.stopPropagation();
	                        const contratosLine = mentionContractNumbers.length
	                            ? `Contratos: ${mentionContractNumbers.join(', ')}`
	                            : '';
	                        const text = [tipoAnaliseHashtag, `CNJ: ${snapshot.cnj}`, contratosLine]
	                            .filter(Boolean)
	                            .join('\n');
                        const finish = () => showCffSystemDialog('Referência copiada para colar no caderno.', 'success');
                        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(text).then(finish).catch(() => {
                                showCffSystemDialog('Não foi possível copiar automaticamente. Copie manualmente.', 'warning');
                            });
                        } else {
                            try {
                                const textarea = document.createElement('textarea');
                                textarea.value = text;
                                document.body.appendChild(textarea);
                                textarea.select();
                                document.execCommand('copy');
                                textarea.remove();
                                finish();
                            } catch (e) {
                                showCffSystemDialog('Não foi possível copiar automaticamente. Copie manualmente.', 'warning');
                            }
                        }
                    });
                    $deleteBtn.on('click', function () {
                        const tryMarkDeletion = (card) => {
                            if (card && card.nj_label && isCardNonJudicialized(card)) {
                                markNjObservationAsDeleted(card.nj_label);
                            }
                        };
                        const targetCard = normalizeProcessCardForSummary(processo) || processo;
                        const targetIdentity = getSummaryCardIdentity(targetCard, cardIndex, 'summary');
                        const targetCnjDigits = String((targetCard && targetCard.cnj) || '')
                            .replace(/\D/g, '');
                        const targetSource = String((processo && processo.__source) || '').trim();
                        const targetSavedIndex = Number.isFinite(processo && processo.__savedIndex)
                            ? Number(processo.__savedIndex)
                            : null;
                        const targetActiveIndex = Number.isFinite(processo && processo.__activeIndex)
                            ? Number(processo.__activeIndex)
                            : null;

                        const isSameCard = (candidate, idx, source) => {
                            if (source === 'saved' && targetSource === 'saved' && targetSavedIndex !== null && idx === targetSavedIndex) {
                                return true;
                            }
                            if (source === 'active' && targetSource === 'active' && targetActiveIndex !== null && idx === targetActiveIndex) {
                                return true;
                            }
                            const normalizedCandidate = normalizeProcessCardForSummary(candidate) || candidate;
                            const candidateIdentity = getSummaryCardIdentity(normalizedCandidate, idx, source);
                            if (targetIdentity && candidateIdentity === targetIdentity) {
                                return true;
                            }
                            if (targetCnjDigits) {
                                const candidateCnjDigits = String((normalizedCandidate && normalizedCandidate.cnj) || '')
                                    .replace(/\D/g, '');
                                if (candidateCnjDigits && candidateCnjDigits === targetCnjDigits) {
                                    return true;
                                }
                            }
                            return false;
                        };

                        if (Array.isArray(userResponses.processos_vinculados)) {
                            userResponses.processos_vinculados = userResponses.processos_vinculados.filter((candidate, idx) => {
                                const shouldRemove = isSameCard(candidate, idx, 'active');
                                if (shouldRemove) {
                                    tryMarkDeletion(candidate);
                                }
                                return !shouldRemove;
                            });
                        }

                        const savedCards = userResponses[SAVED_PROCESSOS_KEY] || [];
                        if (Array.isArray(savedCards) && savedCards.length) {
                            userResponses[SAVED_PROCESSOS_KEY] = savedCards.filter((candidate, idx) => {
                                const shouldRemove = isSameCard(candidate, idx, 'saved');
                                if (shouldRemove) {
                                    tryMarkDeletion(candidate);
                                }
                                return !shouldRemove;
                            });
                        }
                        if (Array.isArray(userResponses.selected_analysis_cards)) {
                            userResponses.selected_analysis_cards = userResponses.selected_analysis_cards.filter(sel => sel !== cardKey);
                        }
                        // Evita ressuscitar card legado após exclusão explícita do usuário.
                        userResponses.saved_entries_migrated = true;
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
                    appendNotesColumn(
                        $detailsRow,
                        [$noteElement, $supervisorNoteElement],
                        {
                            observationTarget: snapshot.observationTarget,
                            contracts: snapshot.contractIds,
                            mentionType: isCardNonJudicialized(processo) ? 'nj' : 'cnj',
                            mentionLabel: snapshot.observationTarget,
                            observationFallbackText: snapshot.observationFallbackText
                        }
                    );
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

            const handleAgendaStatusEvent = (event) => {
                const detail = event?.detail;
                if (!detail) return;
                const matchesProcessoId = detail.processo_id && String(detail.processo_id) === String(processo.processo_id);
                const matchesCnj = detail.cnj && String(detail.cnj).trim() === String(getProcessoCnjLabel(processo)).trim();
                if (matchesProcessoId || matchesCnj) {
                    processo.supervisor_status = detail.status || 'pendente';
                    updateStatusButton();
                }
            };
            const normalizeBarradoForStorage = (raw) => ({
                ativo: Boolean(raw?.ativo),
                inicio: raw?.inicio || null,
                retorno_em: raw?.retorno_em || null,
            });

            const syncBarradoToSavedResponses = (cnj, barrado) => {
                if (!cnj || !barrado) return;
                ensureUserResponsesShape();
                const normalizedTarget = String(cnj || '').trim().toLowerCase();
                if (!normalizedTarget) return;
                const updateList = (list) => {
                    if (!Array.isArray(list)) return false;
                    let changed = false;
                    list.forEach(entry => {
                        if (!entry || typeof entry !== 'object') return;
                        const entryCnj = String(entry.cnj || '').trim().toLowerCase();
                        if (!entryCnj || entryCnj !== normalizedTarget) return;
                        entry.barrado = normalizeBarradoForStorage(barrado);
                        changed = true;
                    });
                    return changed;
                };
                const hasChanges =
                    updateList(userResponses.processos_vinculados) ||
                    updateList(userResponses.saved_processos_vinculados);
                if (hasChanges) {
                    saveResponses({ skipRender: true });
                }
            };

            const handleAgendaBarradoEvent = (event) => {
                const detail = event?.detail;
                if (!detail) return;
                const matchesProcessoId = detail.processo_id && String(detail.processo_id) === String(processo.processo_id);
                const matchesCnj = detail.cnj && String(detail.cnj).trim() === String(getProcessoCnjLabel(processo)).trim();
                if (matchesProcessoId || matchesCnj) {
                    processo.barrado = detail.barrado || { ativo: false, inicio: null, retorno_em: null };
                    processo.barrado.ativo = Boolean(processo.barrado.ativo);
                    processo.barrado.inicio = processo.barrado.inicio || null;
                    processo.barrado.retorno_em = processo.barrado.retorno_em || null;
                    updateBarradoControls();
                    syncBarradoToSavedResponses(detail.cnj, processo.barrado);
                }
            };
            window.addEventListener('agenda:supervision-status-changed', handleAgendaStatusEvent);
            window.addEventListener('agenda:supervision-barrado-changed', handleAgendaBarradoEvent);

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

            $footer.on('remove', () => {
                window.removeEventListener('agenda:supervision-status-changed', handleAgendaStatusEvent);
                window.removeEventListener('agenda:supervision-barrado-changed', handleAgendaBarradoEvent);
            });

            return $footer;
        }

        function createSupervisionCard(processo, index) {
            const snapshot = buildProcessoDetailsSnapshot(processo);
            const $card = $('<div class="analise-supervision-card"></div>');
            const $header = $('<div class="analise-supervision-card-header"></div>');
            const headerLabel = getProcessoCnjLabel(processo);
            const $headerTitleColumn = $('<div class="analise-summary-card-title-column"></div>');
            const cardAnalysisAuthor = resolveCardAnalysisAuthor(processo);
            const cardAnalysisDateRaw = resolveCardAnalysisDateRaw(processo);
            const cardAnalysisByline = buildAnalysisByline(cardAnalysisAuthor, cardAnalysisDateRaw);
            if (cardAnalysisByline) {
                const $analysisAuthorByline = $('<small class="analise-summary-card-analyst"></small>');
                $analysisAuthorByline.text(cardAnalysisByline);
                $headerTitleColumn.append($analysisAuthorByline);
            }
            const $headerTitle = $('<span class="analise-summary-card-cnj-line"></span>');
            $headerTitle.append('Processo CNJ: ');
            $headerTitle.append($('<strong></strong>').text(headerLabel));
            $headerTitleColumn.append($headerTitle);
            const $statusBadge = $('<span class="analise-supervision-status-badge"></span>');

            const updateStatusBadge = (status) => {
                $statusBadge.text(SUPERVISION_STATUS_LABELS[status] || status);
                const allStatusClasses = Object.values(SUPERVISION_STATUS_CLASSES).join(' ');
                $statusBadge.removeClass(allStatusClasses);
                $statusBadge.addClass(SUPERVISION_STATUS_CLASSES[status]);
            };

            $header.append($headerTitleColumn);
            $header.append($statusBadge);
            $card.append($header);

            const $body = $('<div class="analise-supervision-card-body"></div>');
            const $detailsRow = $('<div class="analise-card-details-row"></div>');
            $detailsRow.append(snapshot.$detailsList);
            const $noteElement = createObservationNoteElement(snapshot.observationEntries);
            const $supervisorNoteElement = createSupervisorNoteElement(processo);
            appendNotesColumn($detailsRow, [$noteElement, $supervisorNoteElement], {
                observationTarget: snapshot.observationTarget,
                contracts: snapshot.contractIds,
                mentionType: isCardNonJudicialized(processo) ? 'nj' : 'cnj',
                mentionLabel: snapshot.observationTarget,
                observationFallbackText: snapshot.observationFallbackText
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
                const mentionType = $column.attr('data-analise-mention-type') || 'cnj';
                const mentionLabel = $column.attr('data-analise-mention-label') || '';
                const notebookEntries = getObservationEntriesForCnj(cnj, contracts, {
                    mentionType,
                    mentionLabel
                });
                const fallbackText = String($column.data('analiseObservationFallback') || '').trim();
                const entries =
                    getRenderableObservationLines(notebookEntries).length > 0
                        ? notebookEntries
                        : (fallbackText ? [{ raw: fallbackText, mentionLines: [], contentLines: [fallbackText], summary: fallbackText }] : []);
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
            const candidate = String(contractId || '').trim();
            if (!candidate) {
                return null;
            }

            const normalizedCandidate = candidate.replace(/\D/g, '');
            let $element = $(`.contrato-item-wrapper[data-contrato-id="${candidate}"]`).first();
            if (!$element.length && normalizedCandidate) {
                $element = $('.contrato-item-wrapper').filter(function () {
                    const $wrapper = $(this);
                    const rawId = String($wrapper.attr('data-contrato-id') || '').trim();
                    const numero = String($wrapper.find('.contrato-numero').first().text() || '')
                        .trim()
                        .split('\n')[0]
                        .trim();
                    return rawId === candidate ||
                        rawId.replace(/\D/g, '') === normalizedCandidate ||
                        numero.replace(/\D/g, '') === normalizedCandidate;
                }).first();
            }

            if ($element.length) {
                const resolvedId = String($element.attr('data-contrato-id') || candidate).trim();
                const numeroContrato = $element
                    .find('.contrato-numero')
                    .first()
                    .text()
                    .trim()
                    .split('\n')[0]
                    .trim();
                const valorTotalRaw = $element.attr('data-valor-total');
                const valorCausaRaw = $element.attr('data-valor-causa');
                const custasRaw = $element.attr('data-custas');
                return {
                    id: resolvedId || candidate,
                    numero_contrato: numeroContrato || (resolvedId || candidate),
                    is_prescrito: String($element.attr('data-is-prescrito') || '').toLowerCase() === 'true',
                    is_quitado: String($element.attr('data-is-quitado') || '').toLowerCase() === 'true',
                    valor_total_devido: parseDecimalValue(valorTotalRaw),
                    valor_causa: parseDecimalValue(valorCausaRaw),
                    custas: parseDecimalValue(custasRaw)
                };
            }

            const $idInput = $('.dynamic-contratos input[name$="-id"]').filter(function () {
                return String($(this).val() || '').trim() === candidate;
            }).first();
            if ($idInput.length) {
                const $row = $idInput.closest('.dynamic-contratos');
                const numeroContrato = String($row.find('input[name$="-numero_contrato"]').val() || '').trim();
                return {
                    id: candidate,
                    numero_contrato: numeroContrato || candidate,
                    is_prescrito: false,
                    is_quitado: false,
                    valor_total_devido: parseDecimalValue($row.find('input[name$="-valor_total_devido"]').val()),
                    valor_causa: parseDecimalValue($row.find('input[name$="-valor_causa"]').val()),
                    custas: parseDecimalValue($row.find('input[name$="-custas"]').val())
                };
            }

            return null;
        }

        function loadContratosFromDOM() {
            const statusMap = userResponses.contratos_status || {};
            const contractsById = new Map();

            const upsertContract = (raw) => {
                if (!raw || raw.id === undefined || raw.id === null || raw.id === '') {
                    return;
                }
                const contratoId = String(raw.id).trim();
                if (!contratoId) {
                    return;
                }
                const existing = contractsById.get(contratoId) || {};
                const status = statusMap[contratoId] || {};
                const numeroContrato = String(raw.numero_contrato || existing.numero_contrato || contratoId)
                    .trim();

                contractsById.set(contratoId, {
                    id: contratoId,
                    numero_contrato: numeroContrato || contratoId,
                    is_prescrito: Boolean(
                        raw.is_prescrito != null ? raw.is_prescrito : existing.is_prescrito
                    ),
                    is_quitado: typeof status.quitado === 'boolean'
                        ? status.quitado
                        : Boolean(raw.is_quitado != null ? raw.is_quitado : existing.is_quitado),
                    valor_total_devido: raw.valor_total_devido != null
                        ? raw.valor_total_devido
                        : (existing.valor_total_devido != null ? existing.valor_total_devido : null),
                    valor_causa: raw.valor_causa != null
                        ? raw.valor_causa
                        : (existing.valor_causa != null ? existing.valor_causa : null),
                    custas: raw.custas != null
                        ? raw.custas
                        : (existing.custas != null ? existing.custas : null)
                });
            };

            $('.contrato-item-wrapper').each(function () {
                const $wrapper = $(this);
                const rawId = String($wrapper.attr('data-contrato-id') || '').trim();
                if (!rawId) {
                    return;
                }
                const numeroContrato = $wrapper
                    .find('.contrato-numero')
                    .first()
                    .text()
                    .trim()
                    .split('\n')[0]
                    .trim();
                upsertContract({
                    id: rawId,
                    numero_contrato: numeroContrato,
                    is_prescrito: String($wrapper.attr('data-is-prescrito') || '').toLowerCase() === 'true',
                    is_quitado: String($wrapper.attr('data-is-quitado') || '').toLowerCase() === 'true',
                    valor_total_devido: parseDecimalValue($wrapper.attr('data-valor-total')),
                    valor_causa: parseDecimalValue($wrapper.attr('data-valor-causa')),
                    custas: parseDecimalValue($wrapper.attr('data-custas'))
                });
            });

            $('.dynamic-contratos').each(function () {
                const $row = $(this);
                const rowId = String($row.find('input[name$="-id"]').val() || '').trim();
                if (!rowId) {
                    return;
                }
                upsertContract({
                    id: rowId,
                    numero_contrato: String($row.find('input[name$="-numero_contrato"]').val() || '').trim(),
                    valor_total_devido: parseDecimalValue($row.find('input[name$="-valor_total_devido"]').val()),
                    valor_causa: parseDecimalValue($row.find('input[name$="-valor_causa"]').val()),
                    custas: parseDecimalValue($row.find('input[name$="-custas"]').val())
                });
            });

            allAvailableContratos = Array.from(contractsById.values());

            console.log(
                "DEBUG A_P_A: Contratos carregados do DOM (já considerando JSON.quitado):",
                JSON.stringify(allAvailableContratos)
            );
        }

        /* =========================================================
         * Carregar árvore do backend
         * ======================================================= */

	        function fetchDecisionTreeConfig() {
	            const options = arguments.length ? (arguments[0] || {}) : {};
	            const tipoId = options.tipoId != null ? String(options.tipoId) : '';
	            const tipoVersao = options.tipoVersao != null ? String(options.tipoVersao) : '';
	            const cacheKeyBase = tipoId ? `${DECISION_TREE_CACHE_KEY}:${tipoId}` : DECISION_TREE_CACHE_KEY;
	            const cacheKey = tipoVersao ? `${cacheKeyBase}:v${tipoVersao}` : cacheKeyBase;
	            const forceReload = Boolean(options.forceReload);
	            const deferredConfig = $.Deferred();
	            const cachedConfig = !forceReload ? readSessionCache(cacheKey, DECISION_TREE_CACHE_TTL_MS) : null;
            if (cachedConfig && cachedConfig.tree_data) {
                treeConfig = cachedConfig.tree_data || {};
                treeResponseKeys = Array.from(
                    new Set(
                        Object.values(treeConfig || {})
                            .map(question => question && question.chave)
                            .filter(Boolean)
                    )
                );
                firstQuestionKey = cachedConfig.primeira_questao_chave || null;
                activeAnalysisType = cachedConfig.analysis_type || null;
                deferredConfig.resolve();
                return deferredConfig.promise();
            }

            const seq = ++decisionTreeFetchSeq;
            decisionTreeLatestSeq = seq;

            $.ajax({
                url: decisionTreeApiUrl,
                method: 'GET',
                data: tipoId ? { tipo_id: tipoId } : {},
                dataType: 'json',
                success: function (data) {
                    if (seq !== decisionTreeLatestSeq) {
                        deferredConfig.reject();
                        return;
                    }
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
                        activeAnalysisType = data.analysis_type || null;
                        writeSessionCache(cacheKey, {
                            tree_data: treeConfig,
                            primeira_questao_chave: firstQuestionKey,
                            analysis_type: activeAnalysisType
                        });
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

        function fetchAnalysisTypes() {
            const deferred = $.Deferred();
            $.ajax({
                url: analysisTypesApiUrl,
                method: 'GET',
                dataType: 'json',
                success: function (data) {
                    if (data && data.status === 'success' && Array.isArray(data.types)) {
                        analysisTypesById = {};
                        data.types.forEach(tipo => {
                            if (tipo && tipo.id != null) {
                                analysisTypesById[String(tipo.id)] = tipo;
                            }
                        });
                        deferred.resolve(data.types);
                        return;
                    }
                    deferred.reject();
                },
                error: function () {
                    deferred.reject();
                }
            });
            return deferred.promise();
        }

        function promptSelectAnalysisType(types) {
            const deferred = $.Deferred();
            const list = (types || []).filter(Boolean);
            if (list.length === 0) {
                deferred.reject();
                return deferred.promise();
            }
            if (list.length === 1) {
                deferred.resolve(list[0]);
                return deferred.promise();
            }

            const overlay = document.createElement('div');
            overlay.className = 'cff-analysis-type-overlay';
            overlay.innerHTML = `
                <div class="cff-analysis-type-modal" role="dialog" aria-modal="true">
                    <h3>Selecione o Tipo de Análise</h3>
                    <select class="cff-analysis-type-select"></select>
                    <div class="cff-analysis-type-actions">
                        <button type="button" class="button button-secondary cff-analysis-type-cancel">Cancelar</button>
                        <button type="button" class="button cff-analysis-type-confirm">Continuar</button>
                    </div>
                </div>
            `;
            const select = overlay.querySelector('.cff-analysis-type-select');
            list.forEach(tipo => {
                const opt = document.createElement('option');
                opt.value = String(tipo.id);
                opt.textContent = tipo.nome || tipo.slug || `Tipo ${tipo.id}`;
                select.appendChild(opt);
            });
            if (activeAnalysisType && activeAnalysisType.id != null) {
                select.value = String(activeAnalysisType.id);
            }
            const cleanup = () => {
                overlay.remove();
            };
            overlay.querySelector('.cff-analysis-type-cancel').addEventListener('click', () => {
                cleanup();
                deferred.reject({ cancelled: true });
            });
            overlay.querySelector('.cff-analysis-type-confirm').addEventListener('click', () => {
                const selectedId = select.value;
                const selected = analysisTypesById[selectedId] || list.find(t => String(t.id) === String(selectedId));
                cleanup();
                if (selected) deferred.resolve(selected);
                else deferred.reject();
            });
            document.body.appendChild(overlay);
            return deferred.promise();
        }

        /* =========================================================
         * Renderização da árvore (RAIZ)
         * ======================================================= */

	        function renderDecisionTree() {
	            if (analysisTypeSelectionInProgress || !analysisHasStarted) {
	                return;
	            }
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
            markAnalysisReady();
        }

        /* =========================================================
         * Validação Data de Trânsito (5 anos) + Nó "Análise de Prescrição"
         * ======================================================= */

        function normalizeDecisionText(value) {
            return String(value || '')
                .trim()
                .toUpperCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
        }

        function findQuestionKeyByLabelContains(predicateFn) {
            const keys = Object.keys(treeConfig || {});
            return (
                keys.find(k => {
                    const q = treeConfig[k];
                    if (!q) return false;
                    const label = String(q.texto_pergunta || '').toLowerCase();
                    return predicateFn(label, q, k);
                }) || null
            );
        }

        function findCumprimentoSentencaQuestionKey() {
            if (treeConfig && treeConfig['cumprimento_de_sentenca']) {
                return 'cumprimento_de_sentenca';
            }
            const foundByLabel = findQuestionKeyByLabelContains((label, q) => {
                if (q?.tipo_campo !== 'OPCOES') return false;
                return label.includes('cumprimento') && label.includes('senten');
            });
            if (foundByLabel) return foundByLabel;
            const keys = Object.keys(treeConfig || {});
            return (
                keys.find(k =>
                    normalizeDecisionText(k).includes('CUMPRIMENTO')
                ) || null
            );
        }

        function findTransitDateQuestionKey() {
            if (treeConfig && treeConfig['data_de_transito']) {
                return 'data_de_transito';
            }
            const foundByLabel = findQuestionKeyByLabelContains((label, q) => {
                if (q?.tipo_campo !== 'DATA') return false;
                return (
                    label.includes('data do trânsito') ||
                    label.includes('data do transito') ||
                    label.includes('data de trânsito') ||
                    label.includes('data de transito')
                );
            });
            if (foundByLabel) return foundByLabel;
            const keys = Object.keys(treeConfig || {});
            return (
                keys.find(k => {
                    const keyLower = String(k || '').toLowerCase();
                    return keyLower.includes('transito') && keyLower.includes('data');
                }) || null
            );
        }

        function findProcedenciaQuestionKey() {
            if (treeConfig && treeConfig['procedencia']) return 'procedencia';
            return findQuestionKeyByLabelContains((label, q) => {
                if (q?.tipo_campo !== 'OPCOES') return false;
                return label.includes('proced');
            });
        }

        function findJulgamentoQuestionKey() {
            if (treeConfig && treeConfig['julgamento']) return 'julgamento';
            return findQuestionKeyByLabelContains((label, q) => {
                if (q?.tipo_campo !== 'OPCOES') return false;
                return label.includes('julg');
            });
        }

        function isIniciarCsOptionEl(optEl) {
            const value = normalizeDecisionText(optEl?.value || '');
            const text = normalizeDecisionText(optEl?.textContent || '');
            const normalized = `${value} ${text}`;
            return normalized.includes('CS') && normalized.includes('INICI');
        }

        function getProcedenciaScore(responses) {
            const key = findProcedenciaQuestionKey();
            const raw = key ? responses?.[key] : '';
            const text = normalizeDecisionText(raw);
            if (!text) return { score: null, label: null };
            if (text.includes('NAO JULGAD')) return { score: null, label: 'NAO_JULGADO' };
            if (text.includes('IMPROCED')) return { score: 100, label: 'IMPROCEDENTE' };
            if (text.includes('PARCIAL')) return { score: 50, label: 'PARCIAL' };
            if (text.includes('INTEGRAL')) return { score: 0, label: 'INTEGRAL' };
            return { score: null, label: 'OUTRO' };
        }

        function getJulgamentoStatus(responses) {
            const key = findJulgamentoQuestionKey();
            const raw = key ? responses?.[key] : '';
            const text = normalizeDecisionText(raw);
            if (!text) return { status: null };
            if (text.includes('NAO JULGAD')) return { status: 'NAO_JULGADO' };
            if (text.includes('SEM') && text.includes('MERIT')) return { status: 'SEM_MERITO' };
            return { status: 'COM_MERITO_OU_OUTRO' };
        }

        function getTransitDateValue(responses) {
            const key = findTransitDateQuestionKey();
            if (!key) return null;
            const val = responses ? responses[key] : null;
            return val || null;
        }

        function updateCumprimentoSentencaEligibility(currentResponses, cardIndex = null) {
            const prefix = cardIndex !== null ? `card_${cardIndex}_` : '';

            let $scope;
            if (cardIndex !== null) {
                $scope = $dynamicQuestionsContainer.find(
                    `.processo-card[data-card-index="${cardIndex}"]`
                );
                if (!$scope.length) $scope = $dynamicQuestionsContainer;
            } else {
                $scope = $dynamicQuestionsContainer;
            }

            $scope.find('.cs-eligibility-aviso').remove();

            const tipoText = normalizeDecisionText(
                (activeAnalysisType && (activeAnalysisType.slug || activeAnalysisType.nome)) || ''
            );
            const isPassivas = tipoText.includes('PASSIV');
            if (!isPassivas) return;

            const cumprimentoKey = findCumprimentoSentencaQuestionKey();
            if (!cumprimentoKey) return;

            const $cumprimentoField = $scope.find(
                `select[name="${prefix}${cumprimentoKey}"]`
            );
            if (!$cumprimentoField.length) return;

            const transitValue = getTransitDateValue(currentResponses);
            let transitTooOld = false;
            if (transitValue) {
                const dataSelecionada = new Date(transitValue);
                if (!isNaN(dataSelecionada.getTime())) {
                    const cincoAnosAtras = new Date();
                    cincoAnosAtras.setFullYear(cincoAnosAtras.getFullYear() - 5);
                    transitTooOld = dataSelecionada < cincoAnosAtras;
                }
            }

            const procedencia = getProcedenciaScore(currentResponses);
            const julgamento = getJulgamentoStatus(currentResponses);

            const shouldDisableCs = Boolean(transitTooOld);
            const disableReason = 'Prescrição: trânsito em julgado há mais de 5 anos.';

            const warnings = [];
            if (procedencia.score === 0) {
                warnings.push(
                    '⚠️ Procedência integral (desfavorável à B6): selecionar “Iniciar CS” aqui deve significar preparar defesa/impugnação no cumprimento de sentença.'
                );
            } else if (procedencia.score === 50) {
                warnings.push(
                    '⚠️ Procedência parcial: permitir “Iniciar CS”, mas revisar se há parte favorável executável e qual será a estratégia (defesa/execução).'
                );
            } else if (procedencia.score === null) {
                warnings.push(
                    '⚠️ Procedência não informada (ou “Não julgado”): revise antes de decidir por “Iniciar CS”.'
                );
            }
            if (julgamento.status === 'SEM_MERITO') {
                warnings.push(
                    '⚠️ Julgamento sem mérito: em regra não há título executivo de mérito; confirme o cabimento de CS/medida correlata.'
                );
            } else if (julgamento.status === 'NAO_JULGADO') {
                warnings.push(
                    '⚠️ Julgamento “Não julgado”: confirme o estágio processual antes de decidir por CS.'
                );
            }

            const $iniciarCsOptions = $cumprimentoField
                .find('option')
                .filter(function () {
                    return isIniciarCsOptionEl(this);
                });

            $iniciarCsOptions.each(function () {
                if (shouldDisableCs) {
                    $(this).prop('disabled', true).attr('title', disableReason);
                } else {
                    if (!transitTooOld) {
                        $(this).prop('disabled', false).removeAttr('title');
                    }
                }
            });

            const selectedOpt = $cumprimentoField.find('option:selected').get(0);
            if (selectedOpt && isIniciarCsOptionEl(selectedOpt) && shouldDisableCs) {
                $cumprimentoField.val('');
                currentResponses[cumprimentoKey] = '';
                saveResponses();
            }

            if (!shouldDisableCs && warnings.length) {
                $cumprimentoField.after(
                    `<p class="errornote cs-eligibility-aviso">${warnings.join('<br>')}</p>`
                );
            }
        }

	        function handleDataTransitoValidation(dataTransitoKey, selectedDate, currentResponses, cardIndex = null) {
	            const transitQuestion = treeConfig ? treeConfig[dataTransitoKey] : null;
	            const keyLower = String(dataTransitoKey || '').toLowerCase();
	            const labelLower = String(transitQuestion?.texto_pergunta || '').toLowerCase();

	            const isTransitDateField =
	                keyLower === 'data_de_transito' ||
	                labelLower.includes('data do trânsito') ||
	                labelLower.includes('data do transito') ||
	                labelLower.includes('data de trânsito') ||
	                labelLower.includes('data de transito') ||
	                (keyLower.includes('transito') && (keyLower.includes('data') || labelLower.includes('data')));

	            if (!isTransitDateField) return;

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

	            const cumprimentoKey = findCumprimentoSentencaQuestionKey();
	            const $cumprimentoField = cumprimentoKey
	                ? $scope.find(`select[name="${prefix}${cumprimentoKey}"]`)
	                : $();

	            const $iniciarCsOption = $cumprimentoField.length
	                ? $cumprimentoField.find('option').filter(function () {
	                    return isIniciarCsOptionEl(this);
	                })
	                : $();

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

	                if ($cumprimentoField.length) {
	                    $cumprimentoField.after(
	                        '<p class="errornote data-transito-aviso">⚠️ Prescrição: trânsito em julgado há mais de 5 anos. Em regra, não é adequado iniciar cumprimento de sentença.</p>'
	                    );
	                } else {
	                    $scope.append(
	                        '<p class="errornote data-transito-aviso">⚠️ Prescrição: trânsito em julgado há mais de 5 anos. Verifique risco de prescrição para cumprimento de sentença.</p>'
	                    );
	                }

	                const $csRow = cumprimentoKey
	                    ? $scope.find(`.form-row[data-question-key="${cumprimentoKey}"]`)
	                    : $();

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

	                if ($cumprimentoField.length) {
	                    const selectedOpt = $cumprimentoField.find('option:selected').get(0);
	                    if (selectedOpt && isIniciarCsOptionEl(selectedOpt)) {
	                        $cumprimentoField.val('');
	                        if (cumprimentoKey) {
	                            currentResponses[cumprimentoKey] = '';
	                        }
	                        saveResponses();
	                    }
	                }
	            } else {
	                $iniciarCsOption.prop('disabled', false).removeAttr('title');
	            }

                updateCumprimentoSentencaEligibility(currentResponses, cardIndex);
	        }

        /* =========================================================
         * Renderização genérica de perguntas
         * ======================================================= */

        function renderQuestion(questionKey, $container, currentResponses, cardIndex = null) {
            const question = treeConfig[questionKey];
            if (!question) return;

	            const getNextQuestionKeyByOrder = (currentKey) => {
	                const current = treeConfig[currentKey];
	                const currentOrder = current && typeof current.ordem === 'number' ? current.ordem : null;
	                if (currentOrder === null) {
	                    return null;
	                }
	                let best = null;
	                Object.keys(treeConfig || {}).forEach((key) => {
	                    const candidate = treeConfig[key];
	                    if (!candidate || typeof candidate.ordem !== 'number') {
	                        return;
	                    }
	                    if (candidate.ordem <= currentOrder) {
	                        return;
	                    }
	                    if (!best || candidate.ordem < best.ordem) {
	                        best = { key, ordem: candidate.ordem };
	                    }
	                });
	                return best ? best.key : null;
	            };

	            const isIniciarCsOption = (text) => {
	                const normalized = String(text || '')
	                    .trim()
	                    .toUpperCase()
	                    .normalize('NFD')
	                    .replace(/[\u0300-\u036f]/g, '');
	                return normalized.includes('CS') && normalized.includes('INICI');
	            };

	            const isCumprimentoSentencaQuestion = (q) => {
	                if (!q) return false;
	                const key = String(q.chave || '').toLowerCase();
	                const label = String(q.texto_pergunta || '').toLowerCase();
	                if (label.includes('cumprimento') && label.includes('senten')) return true;
	                if (key.includes('cumprimento') && key.includes('senten')) return true;
	                return false;
	            };

	            const getTransitDateValue = (responses) => {
	                const keys = Object.keys(treeConfig || {});
	                for (const key of keys) {
	                    const q = treeConfig[key];
	                    if (!q || q.tipo_campo !== 'DATA') continue;
	                    const labelLower = String(q.texto_pergunta || '').toLowerCase();
	                    const keyLower = String(q.chave || key || '').toLowerCase();
	                    const looksLikeTransit =
	                        labelLower.includes('data do trânsito') ||
	                        labelLower.includes('data do transito') ||
	                        labelLower.includes('data de trânsito') ||
	                        labelLower.includes('data de transito') ||
	                        (keyLower.includes('transito') && keyLower.includes('data'));
	                    if (!looksLikeTransit) continue;
	                    const val = responses ? responses[q.chave] : null;
	                    if (val) return val;
	                }
	                return null;
	            };

	            const isQuitado = areAnySelectedContractsQuitado();
            let $questionDiv;
            let $inputElement;
            let $nextHint = null;

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
                    syncProcessoVinculadoResponseKey(question.chave);
                    const resolvedKey = getProcessoVinculadoQuestionKey() || question.chave;
	                renderProcessoVinculadoEditor(resolvedKey, $container);

	                // Em Passivas, o PROCESSO_VINCULADO é o "container" da análise: as demais questões
	                // devem aparecer dentro dos cards (por CNJ). Não renderiza questões fora do card.
	                const tipoText = normalizeDecisionText(
	                    (activeAnalysisType && (activeAnalysisType.slug || activeAnalysisType.nome)) || ''
	                );
	                const isPassivas = tipoText.includes('PASSIV');
	                const isEditingSavedCard =
	                    Number.isFinite(userResponses && userResponses._editing_card_index) &&
	                    Number(userResponses._editing_card_index) >= 0;
	                if (isPassivas || isEditingSavedCard) {
	                    return;
	                }

	                const autoNextFromOptions = Array.isArray(question.opcoes)
	                    ? (question.opcoes.find(opt => opt && opt.proxima_questao_chave) || null)
	                    : null;
	                const autoNext =
	                    question.proxima_questao_chave ||
	                    (autoNextFromOptions ? autoNextFromOptions.proxima_questao_chave : null);
	                const resolvedNext =
	                    (autoNext && treeConfig[autoNext]) ? autoNext : getNextQuestionKeyByOrder(questionKey);
	                if (resolvedNext) {
	                    renderQuestion(resolvedNext, $container, currentResponses, cardIndex);
	                }
	                return;
	            }

            if (question.tipo_campo !== 'CONTRATOS_MONITORIA') {
                $questionDiv = $(
                    `<div class="form-row field-${question.chave}" data-question-key="${question.chave}"><label for="${fieldId}">${question.texto_pergunta}:</label></div>`
                );
                $container.append($questionDiv);
            }

	            switch (question.tipo_campo) {
	                case 'OPCOES':
	                    const transitValue = getTransitDateValue(currentResponses);
	                    const shouldDisableIniciarCs = isCumprimentoSentencaQuestion(question) && Boolean(transitValue);
	                    let transitTooOld = false;
	                    if (shouldDisableIniciarCs) {
	                        const dataSelecionada = new Date(transitValue);
	                        if (!isNaN(dataSelecionada.getTime())) {
	                            const cincoAnosAtras = new Date();
	                            cincoAnosAtras.setFullYear(cincoAnosAtras.getFullYear() - 5);
	                            transitTooOld = dataSelecionada < cincoAnosAtras;
	                        }
	                    }

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
	                        if (!disabled && transitTooOld && isIniciarCsOption(opcao.texto_resposta)) {
	                            disabled = true;
	                        }

	                        $inputElement.append(
	                            `<option value="${opcao.texto_resposta}" ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${opcao.texto_resposta}</option>`
	                        );
	                    });
	                    if (transitTooOld) {
	                        $inputElement.find('option').each(function () {
	                            const optText = $(this).text();
	                            if (isIniciarCsOption(optText)) {
	                                $(this).attr('title', 'Prescrição: Trânsito em julgado há mais de 5 anos.');
	                            }
	                        });
	                        const selectedText = $inputElement.find('option:selected').text();
	                        if (selectedText && isIniciarCsOption(selectedText)) {
	                            $inputElement.val('');
	                            currentResponses[question.chave] = '';
	                            saveResponses();
	                        }
	                    }
	                    break;

                case 'CONTRATOS_MONITORIA':
                    const $heading = $(
                        `<div class="form-row field-${question.chave}" data-question-key="${question.chave}">
                            <div class="monitoria-label-row">
                                <label>${question.texto_pergunta}:</label>
                                <button type="button" class="monitoria-hashtag-btn" aria-label="Mencionar caso não judicializado"></button>
                            </div>
                        </div>`
                    );
                    $container.append($heading);
                    const $hashtagBtn = $heading.find('.monitoria-hashtag-btn');
                    renderMonitoriaContractSelector(
                        question,
                        $heading,
                        currentResponses,
                        cardIndex,
                        () => refreshMonitoriaHashtag($hashtagBtn, currentResponses)
                    );
                    refreshMonitoriaHashtag($hashtagBtn, currentResponses);
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

                    // Controle discreto para avançar (evita depender de TAB/blur)
                    const hasExplicitNext = Boolean(question.proxima_questao_chave);
                    const canFallbackByOrder = Boolean(getNextQuestionKeyByOrder(questionKey));
                    if (hasExplicitNext || canFallbackByOrder) {
                        $nextHint = $(
                            `<button type="button" class="cff-next-hint" aria-label="Avançar para a próxima questão">Próximo &rsaquo;</button>`
                        );
                        $nextHint.on('click', function () {
                            const val = $inputElement.val();
                            currentResponses[question.chave] = val;
                            saveResponses();
                            renderNextQuestion(
                                questionKey,
                                val,
                                $container,
                                currentResponses,
                                cardIndex
                            );

                            // tenta focar o primeiro campo renderizado após avançar
                            setTimeout(() => {
                                const $rows = $container.find('.form-row');
                                const $currentRow = $rows
                                    .filter(`[data-question-key="${questionKey}"]`)
                                    .last();
                                const idx = $rows.index($currentRow);
                                if (idx >= 0) {
                                    const $nextRow = $rows.eq(idx + 1);
                                    const $focusable = $nextRow.find('input, select, textarea').first();
                                    if ($focusable.length) $focusable.trigger('focus');
                                }
                            }, 0);
                        });
                    }
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

                // aplica regras de elegibilidade do CS (procedência/julgamento/prescrição)
                updateCumprimentoSentencaEligibility(currentResponses, cardIndex);
            });

            $questionDiv.append($inputElement);
            if ($nextHint) {
                $questionDiv.append($nextHint);
            }

            // garante que regras de CS sejam aplicadas ao renderizar o campo
            updateCumprimentoSentencaEligibility(currentResponses, cardIndex);

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

            const clearResponsesForKey = (qKey) => {
                if (!qKey) return;
                delete currentResponses[qKey];
                if (qKey === 'selecionar_contratos_monitoria') {
                    currentResponses.contratos_para_monitoria = [];
                }
            };

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
                const selectedNormalized = normalizeDecisionText(selectedResponseText);
                const selectedOption = (currentQuestion.opcoes || []).find(opt => {
                    if (!opt) return false;
                    const optNormalized = normalizeDecisionText(opt.texto_resposta);
                    return optNormalized === selectedNormalized;
                });
                if (selectedOption) {
                    nextQuestionKey = selectedOption.proxima_questao_chave;
                }
            } else if (currentQuestion.proxima_questao_chave) {
                nextQuestionKey = currentQuestion.proxima_questao_chave;
            }

            // Remove blocos "abaixo" da pergunta atual baseado na ordem DOM, e evita duplicação
            // quando o próximo nó tem ordem menor (ex.: Sucumbências -> Cumprimento de Sentença).
            const $currentRow = $targetContainer
                .find(`.form-row[data-question-key="${currentQuestionKey}"]`)
                .last();
            const $allRows = $targetContainer.find('.form-row');
            const currentIndex = $currentRow.length ? $allRows.index($currentRow) : -1;
            const $afterRows =
                currentIndex >= 0 ? $allRows.slice(currentIndex + 1) : $allRows;

            const immediateNextKey = $afterRows.first().data('question-key');

            if (nextQuestionKey && immediateNextKey === nextQuestionKey) {
                // Mantém o próximo bloco já renderizado e remove apenas o que vem depois,
                // preservando valor selecionado e evitando duplicatas.
                const $rowsToRemove = $afterRows.slice(1);
                $rowsToRemove.each(function () {
                    const qKey = $(this).data('question-key');
                    clearResponsesForKey(qKey);
                });
                $rowsToRemove.remove();

                saveResponses();
                updateCumprimentoSentencaEligibility(currentResponses, cardIndex);
                return;
            }

            // Caso contrário, remove tudo que estiver renderizado após a pergunta atual
            $afterRows.each(function () {
                const qKey = $(this).data('question-key');
                clearResponsesForKey(qKey);
            });
            $afterRows.remove();

	            if (nextQuestionKey) {
	                if (!treeConfig[nextQuestionKey]) {
	                    if (currentQuestion.tipo_campo !== 'OPCOES') {
	                        const fallback = (() => {
	                            const currentOrder = typeof currentQuestion.ordem === 'number' ? currentQuestion.ordem : null;
	                            if (currentOrder === null) return null;
	                            let best = null;
	                            Object.keys(treeConfig || {}).forEach((key) => {
	                                const candidate = treeConfig[key];
	                                if (!candidate || typeof candidate.ordem !== 'number') return;
	                                if (candidate.ordem <= currentOrder) return;
	                                if (!best || candidate.ordem < best.ordem) {
	                                    best = { key, ordem: candidate.ordem };
	                                }
	                            });
	                            return best ? best.key : null;
	                        })();
	                        if (fallback) {
	                            renderQuestion(
	                                fallback,
	                                $targetContainer,
	                                currentResponses,
	                                cardIndex
	                            );
	                        } else {
	                            saveResponses();
	                        }
	                        return;
	                    }
	                    $targetContainer.append(
	                        '<p class="errornote">Configuração inválida: a próxima questão não existe neste Tipo de Análise.</p>'
	                    );
	                    saveResponses();
	                    return;
	                }
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
                const transitKey = findTransitDateQuestionKey() || 'data_de_transito';
                handleDataTransitoValidation(
                    transitKey,
                    currentResponses ? currentResponses[transitKey] : null,
                    currentResponses,
                    cardIndex
                );
            }

            updateCumprimentoSentencaEligibility(currentResponses, cardIndex);
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

            const tipoText = normalizeDecisionText(
                (activeAnalysisType && (activeAnalysisType.slug || activeAnalysisType.nome)) || ''
            );
            const isPassivas = tipoText.includes('PASSIV');

            const ensureDefaultCard = () => {
                if (!isPassivas) return;
                if (userResponses[questionKey].length > 0) return;

                userResponses[questionKey].push({
                    cnj: '',
                    valor_causa: null,
                    contratos: [],
                    tipo_de_acao_respostas: {},
                    supervisionado: false,
                    supervisor_status: 'pendente',
                    supervision_date: '',
                    analysis_author: getCurrentAnalysisAuthorName(),
                    barrado: {
                        ativo: false,
                        inicio: null,
                        retorno_em: null
                    }
                });
            };

            const migrateRootResponsesToFirstCard = () => {
                if (!isPassivas) return;
                if (!userResponses[questionKey].length) return;

                const firstCard = userResponses[questionKey][0];
                if (!firstCard || typeof firstCard !== 'object') return;
                firstCard.tipo_de_acao_respostas = firstCard.tipo_de_acao_respostas || {};

                // Migra apenas se o card ainda não tem respostas (evita sobrescrever).
                const alreadyHasAny = Object.keys(firstCard.tipo_de_acao_respostas || {}).some(k => {
                    const v = firstCard.tipo_de_acao_respostas[k];
                    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
                });
                if (alreadyHasAny) return;

                const keysToMove = Object.keys(treeConfig || {}).filter(k => {
                    if (k === questionKey) return false;
                    const q = treeConfig[k];
                    if (!q) return false;
                    // Só move campos simples/OPCOES usados no fluxo Passivas.
                    return q.tipo_campo !== 'PROCESSO_VINCULADO' && q.tipo_campo !== 'CONTRATOS_MONITORIA';
                });

                let movedAny = false;
                keysToMove.forEach(k => {
                    if (userResponses[k] !== undefined) {
                        firstCard.tipo_de_acao_respostas[k] = userResponses[k];
                        delete userResponses[k];
                        movedAny = true;
                    }
                });

                if (movedAny) {
                    saveResponses();
                }
            };

            ensureDefaultCard();
            migrateRootResponsesToFirstCard();

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
                    valor_causa: null,
                    contratos: [],
                    tipo_de_acao_respostas: {},
                    supervisionado: false,
                    supervisor_status: 'pendente',
                    supervision_date: '',
                    analysis_author: getCurrentAnalysisAuthorName(),
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
            if (cardData.valor_causa !== undefined && cardData.valor_causa !== null) {
                cardData.valor_causa = parseCurrencyValue(cardData.valor_causa);
            } else {
                cardData.valor_causa = null;
            }
            cardData.supervisionado = Boolean(cardData.supervisionado);
            cardData.supervisor_status = cardData.supervisor_status || 'pendente';
            cardData.supervision_date = normalizeIsoDateValue(cardData.supervision_date);
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
            const cardLabel = getProcessoCnjLabel(cardData);
            const $titleWrapper = $(
                `<div class="processo-card-title"><span>Processo CNJ: <strong>${cardLabel}</strong></span></div>`
            );
            const $cnjLabelStrong = $titleWrapper.find('strong');
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

            const $valorCausaInput = $(`
                <input type="text"
                       class="vTextField processo-valor-causa-input"
                       placeholder="Valor da causa"
                       inputmode="decimal"
                       aria-label="Valor da causa">
            `).val(cardData.valor_causa !== null ? formatCurrency(cardData.valor_causa) : '');

            $cnjInput.on('input', function () {
                const formatted = formatCnjDigits($(this).val());
                $(this).val(formatted);
                cardData.cnj = formatted;
                $cnjLabelStrong.text(formatted ? formatted : 'Não informado');
            });

            $cnjInput.on('blur', function () {
                const formatted = formatCnjDigits($(this).val());
                $(this).val(formatted);
                cardData.cnj = formatted;
                $cnjLabelStrong.text(formatted ? formatted : 'Não informado');
                if (formatted && !isValidCnj(formatted)) {
                    alert('CNJ inválido. Verifique o formato (0000000-00.0000.0.00.0000).');
                }
                saveResponses();
            });

            $cnjInputRow.append($cnjInput);
            const $valorCausaWrapper = $('<div class="valor-causa-wrapper"></div>');
            const $valorCausaSuffix = $('<span class="valor-causa-suffix">Valor da causa</span>');
            const refreshValorCausaSuffix = () => {
                const hasValue = Boolean(String($valorCausaInput.val() || '').trim());
                $valorCausaWrapper.toggleClass('has-value', hasValue);
            };
            $valorCausaWrapper.append($valorCausaInput).append($valorCausaSuffix);
            $cnjInputRow.append($valorCausaWrapper);
            const $removeBtnInline = $(
                '<button type="button" class="button button-secondary processo-card-remove-inline">×</button>'
            );
            $cnjInputRow.append($removeBtnInline);
            $cnjWrapper.append($cnjInputRow);
            const syncValorCausa = () => {
                cardData.valor_causa = parseCurrencyValue($valorCausaInput.val());
                saveResponses();
            };
            $valorCausaInput.on('change', syncValorCausa);
            $valorCausaInput.on('input', refreshValorCausaSuffix);
            $valorCausaInput.on('blur', function () {
                const parsed = parseCurrencyValue($(this).val());
                cardData.valor_causa = parsed;
                $(this).val(parsed !== null ? formatCurrency(parsed) : '');
                refreshValorCausaSuffix();
                saveResponses();
            });
            refreshValorCausaSuffix();
            $removeBtnInline.on('click', function () {
                if (!confirm('Remover este processo vinculado?')) return;
                const arr = userResponses[parentQuestionKey] || [];
                arr.splice(cardIndex, 1);
                userResponses[parentQuestionKey] = arr;
                saveResponses();
                renderDecisionTree();
            });
            $body.append($cnjWrapper);

            // Contratos vinculados a esse processo (opcional)
            const $contratosWrapper = $('<div class="field-contratos-vinculados"></div>');
            const $details = $(`
                <details class="processo-contratos-details">
                    <summary>Contratos vinculados a este processo (opcional)</summary>
                    <div class="processo-contratos-details-body"></div>
                </details>
            `);
            const $detailsBody = $details.find('.processo-contratos-details-body');

            const listaParaExibir = Array.isArray(allAvailableContratos) ? allAvailableContratos : [];
            const contratosCardNormalizados = Array.from(
                new Set(
                    parseContractsField(cardData.contratos)
                        .map(resolveContratoCandidate)
                        .filter(Boolean)
                        .map(item => item.id)
                )
            );
            if (contratosCardNormalizados.length > 0) {
                cardData.contratos = contratosCardNormalizados.slice();
            }
            const contratosCardSelecionados = parseContractsField(cardData.contratos);

            if (listaParaExibir.length === 0) {
                $detailsBody.append(
                    '<p>Nenhum contrato disponível. Verifique a aba "Contratos" ou salve o cadastro.</p>'
                );
            } else {
                listaParaExibir.forEach(contrato => {
                    const idStr = String(contrato.id);
                    const isChecked = contratosCardSelecionados
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
                        const current = Array.isArray(cardData.contratos) ? cardData.contratos : [];
                        if ($(this).is(':checked')) {
                            if (!current.map(String).includes(val)) {
                                current.push(val);
                            }
                            cardData.contratos = current;
                        } else {
                            cardData.contratos = current
                                .map(String)
                                .filter(id => id !== val);
                        }
                        saveResponses();
                    });

                    $row.append($chk).append($lbl);
                    $detailsBody.append($row);
                });
            }

            $contratosWrapper.append($details);
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
            const supervisionDateInputId = `supervision_date_${cardIndex}`;
            const $supervisionDateWrapper = $('<div class="supervision-date-wrapper"></div>');
            const $supervisionDateLabel = $(
                `<label class="supervision-date-label" for="${supervisionDateInputId}">Data S</label>`
            );
            const $supervisionDateInput = $(
                `<input type="date" id="${supervisionDateInputId}" class="supervision-date-input">`
            );
            $supervisionDateInput.val(cardData.supervision_date || '');
            $supervisionDateWrapper.append($supervisionDateLabel).append($supervisionDateInput);

            $supervisionWrapper.append($supervisionToggle);
            $supervisionWrapper.append($supervisionDateWrapper);
            $body.append($supervisionWrapper);

            const $supervisionInput = $supervisionToggle.find('.supervision-toggle-input');
            $supervisionInput.prop('checked', cardData.supervisionado);
            $supervisionDateInput.on('change', function () {
                const normalizedDate = normalizeIsoDateValue($(this).val());
                $(this).val(normalizedDate);
                cardData.supervision_date = normalizedDate;
                syncEditingCardWithSaved(cardData);
                userResponses.processos_vinculados = [cardData];
                saveResponses();
                renderSupervisionPanel();
            });
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

                // Mantém o card ativo sempre em processos_vinculados[0]
                // (evita array esparso que impede atualizar o snapshot ao concluir).
                userResponses.processos_vinculados = [cardData];

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

        function isCardNonJudicialized(card) {
            if (!card || typeof card !== 'object') return false;
            const status = normalizeResponse(card?.tipo_de_acao_respostas?.judicializado_pela_massa);
            if (status === 'NÃO') return true;
            const cnjValue = String(card?.cnj || '').trim();
            return !cnjValue || cnjValue.toLowerCase().includes('não');
        }

        function collectUsedNjIndices() {
            const indices = new Set();
            const appendFrom = entries => {
                if (!Array.isArray(entries)) return;
                entries.forEach(entry => {
                    if (!entry || typeof entry !== 'object') return;
                    if (!isCardNonJudicialized(entry)) return;
                    const idx = Number(entry.nj_index) || parseInt(String(entry.nj_label || '').replace(/[^0-9]/g, ''), 10);
                    if (Number.isFinite(idx)) {
                        indices.add(idx);
                    }
                });
            };
            appendFrom(userResponses.processos_vinculados);
            appendFrom(userResponses.saved_processos_vinculados);
            return indices;
        }

        function getNextAvailableNjIndex() {
            const used = collectUsedNjIndices();
            let idx = 1;
            while (used.has(idx)) {
                idx += 1;
            }
            return idx;
        }

        function assignNjLabelToCard(card) {
            if (!isCardNonJudicialized(card)) {
                return null;
            }
            if (card.nj_index && Number.isFinite(card.nj_index)) {
                return card.nj_index;
            }
            const nextIndex = getNextAvailableNjIndex();
            card.nj_index = nextIndex;
            card.nj_label = `#NJ${nextIndex}`;
            return nextIndex;
        }

        function markNjObservationAsDeleted(label) {
            const normalized = String(label || '').trim();
            if (!normalized) {
                return;
            }
            const existing = getNotebookText();
            if (!existing) {
                return;
            }
            const escapedLabel = normalized.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`(^.*${escapedLabel}.*$)`, 'mi');
            if (!regex.test(existing)) {
                return;
            }
            const updated = existing.replace(regex, match => {
                if (/Análise Deletada/i.test(match)) {
                    return match;
                }
                return `${match} — Análise Deletada`;
            });
            if (updated !== existing) {
                dispatchObservationUpdate(updated);
            }
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

        function mentionNaoJudInNotas(text) {
            if (typeof window.openNotebookWithMention !== 'function') {
                return;
            }
            const trimmed = String(text || '').trim();
            if (!trimmed) {
                return;
            }
            const existing = getNotebookText() || '';
            const needsSeparator = existing && !existing.endsWith('\n');
            const separator = needsSeparator ? '\n' : '';
            window.openNotebookWithMention(`${separator}${trimmed}`);
        }

        function isNaoJudicializadoActive() {
            return normalizeResponse(userResponses.judicializado_pela_massa) === 'NÃO';
        }

        function getNaoJudSequence() {
            return getNextAvailableNjIndex();
        }

        function buildContractsLabel(ids) {
            const contractNames = (ids || []).map(id => getContractLabelForId(id)).filter(Boolean);
            return contractNames.length > 0 ? contractNames.join(', ') : 'Nenhum contrato selecionado';
        }

        function resolveContratoCandidate(rawId) {
            const candidate = String(rawId || '').trim();
            if (!candidate) {
                return null;
            }
            const byId = allAvailableContratos.find(c => String(c.id) === candidate);
            const byNumber = allAvailableContratos.find(
                c => String(c.numero_contrato || '').trim() === candidate
            );
            const contratoInfo = byId || byNumber;
            if (!contratoInfo) {
                return null;
            }
            return {
                id: String(contratoInfo.id),
                numero_contrato: String(contratoInfo.numero_contrato || contratoInfo.id),
                is_prescrito: Boolean(contratoInfo.is_prescrito),
                is_quitado: Boolean(contratoInfo.is_quitado)
            };
        }

        function getSelectedContractIdsFromInfoCard() {
            const selected = new Set();

            const statusMap = userResponses.contratos_status || {};
            Object.keys(statusMap).forEach(key => {
                const status = statusMap[key];
                if (status && status.selecionado) {
                    selected.add(String(key));
                }
            });

            document.querySelectorAll('.contrato-item-wrapper').forEach(wrapper => {
                const contractId = String(wrapper.getAttribute('data-contrato-id') || '').trim();
                if (!contractId) return;
                const checkbox = wrapper.querySelector('input[type="checkbox"]');
                if (checkbox && checkbox.checked) {
                    selected.add(contractId);
                }
            });

            return Array.from(selected);
        }

        function refreshMonitoriaHashtag($button, currentResponses) {
            if (!$button || !$button.length) {
                return;
            }
            if (!isNaoJudicializadoActive()) {
                $button.hide();
                return;
            }
            const selection = Array.isArray(currentResponses.contratos_para_monitoria)
                ? currentResponses.contratos_para_monitoria
                : [];
            const contractsText = buildContractsLabel(selection);
            const label = `#NJ${getNaoJudSequence()}`;
            $button.text(label);
            $button.off('click').on('click', () => {
                mentionNaoJudInNotas(`${label} — Contratos: ${contractsText}`);
            });
            $button.show();
        }

        /* =========================================================
         * Seleção de contratos para Monitória ("Propor Monitória")
         * ======================================================= */

function renderMonitoriaContractSelector(question, $container, currentResponses, cardIndex = null, onSelectionChanged = null) {
            ensureUserResponsesShape();

            const $selectorDiv = $('<div class="form-row field-contratos-monitoria"></div>');

            const selectedInInfoCard = getSelectedContractIdsFromInfoCard();
            const rawSelection = Array.isArray(currentResponses.contratos_para_monitoria)
                ? currentResponses.contratos_para_monitoria
                : [];
            const processo = (cardIndex !== null && cardIndex >= 0 && Array.isArray(userResponses.processos_vinculados))
                ? userResponses.processos_vinculados[cardIndex] || null
                : null;

            const normalizedSelection = Array.from(
                new Set(
                    rawSelection
                        .map(resolveContratoCandidate)
                        .filter(Boolean)
                        .map(c => c.id)
                )
            );
            currentResponses.contratos_para_monitoria = normalizedSelection;

            // Conjunto final: mantém os já marcados e os selecionados no info-card,
            // mas só renderiza candidatos que existem de fato no cadastro atual.
            const rawCandidates = Array.from(new Set([
                ...(processo && Array.isArray(processo.contratos) ? processo.contratos : []),
                ...normalizedSelection,
                ...selectedInInfoCard,
            ].map(id => String(id))));

            const resolvedCandidates = [];
            const seenCandidateIds = new Set();
            rawCandidates.forEach(rawId => {
                const resolved = resolveContratoCandidate(rawId);
                if (!resolved) {
                    return;
                }
                if (seenCandidateIds.has(resolved.id)) {
                    return;
                }
                seenCandidateIds.add(resolved.id);
                resolvedCandidates.push(resolved);
            });

            if (resolvedCandidates.length === 0) {
                $selectorDiv.append(
                    '<p>Nenhum contrato selecionado para monitória.</p>'
                );
                $container.append($selectorDiv);
                return;
            }

            resolvedCandidates.forEach(function (contratoInfo) {
                const idStr = String(contratoInfo.id);
                const isChecked = normalizedSelection.includes(idStr);
                const isDisabled = contratoInfo.is_prescrito || contratoInfo.is_quitado;

                let label = `${contratoInfo.numero_contrato}`;
                if (contratoInfo.is_prescrito) {
                    label += ' <span style="color:#c62828;font-style:italic;">(Prescrito)</span>';
                } else if (contratoInfo.is_quitado) {
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

                if (typeof onSelectionChanged === 'function') {
                    onSelectionChanged();
                }

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
            const existingNaoJudCard = Array.isArray(userResponses.processos_vinculados)
                ? userResponses.processos_vinculados.find(
                    p => p && typeof p === 'object' && String(p.cnj || '').trim().toLowerCase() === 'não judicializado'
                )
                : null;
            const initialSupervisionDate = normalizeIsoDateValue(
                userResponses.supervision_date_nao_judicializado ||
                (existingNaoJudCard && existingNaoJudCard.supervision_date)
            );
            userResponses.supervision_date_nao_judicializado = initialSupervisionDate;

            const $wrapper = $('<div class="field-supervision nao-judicializado-supervisionize"></div>');
            const $toggle = $(`
                <label class="supervision-toggle nao-judicializado-supervision-toggle" title="Ao concluir esta análise, encaminhe para supervisão.">
                    <input type="checkbox" class="supervision-toggle-input">
                    <span class="supervision-switch" aria-hidden="true"></span>
                    <span class="supervision-label-text">Supervisionar</span>
                </label>
            `);
            const naoJudDateInputId = `supervision_date_nao_judicializado_${Math.random().toString(36).slice(2, 8)}`;
            const $dateWrap = $('<div class="supervision-date-wrapper"></div>');
            const $dateLabel = $(
                `<label class="supervision-date-label" for="${naoJudDateInputId}">Data S</label>`
            );
            const $dateInput = $(
                `<input type="date" id="${naoJudDateInputId}" class="supervision-date-input supervision-date-input--compact">`
            );
            $dateInput.val(initialSupervisionDate);
            $dateWrap.append($dateLabel).append($dateInput);
            const $input = $toggle.find('.supervision-toggle-input');
            $input.prop(
                'checked',
                Boolean(userResponses.supervisionado_nao_judicializado || (existingNaoJudCard && existingNaoJudCard.supervisionado))
            );
            $dateInput.on('change', function () {
                const normalizedDate = normalizeIsoDateValue($(this).val());
                $(this).val(normalizedDate);
                userResponses.supervision_date_nao_judicializado = normalizedDate;
                if (Array.isArray(userResponses.processos_vinculados)) {
                    userResponses.processos_vinculados.forEach(card => {
                        if (card && typeof card === 'object' && String(card.cnj || '').trim().toLowerCase() === 'não judicializado') {
                            card.supervision_date = normalizedDate;
                        }
                    });
                }
                saveResponses();
            });
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
                            supervision_date: normalizeIsoDateValue(userResponses.supervision_date_nao_judicializado),
                            analysis_author: getCurrentAnalysisAuthorName(),
                            barrado: { ativo: false, inicio: null, retorno_em: null },
                            awaiting_supervision_confirm: false,
                            analysis_type: activeAnalysisType && activeAnalysisType.id != null ? {
                                id: activeAnalysisType.id,
                                nome: activeAnalysisType.nome,
                                slug: activeAnalysisType.slug,
                                hashtag: activeAnalysisType.hashtag,
                                versao: activeAnalysisType.versao
                            } : null
                        };
                        assignNjLabelToCard(card);
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
            $wrapper.append($dateWrap);
            $container.append($wrapper);
        }

        /* =========================================================
         * Eventos globais
         * ======================================================= */

		        let analysisBootObserver = null;
		        let analysisInitialized = false;
		        let analysisTypeSelectionInProgress = false;
		        let analysisHasStarted = false;

        const isDecisionTreeReady = () => {
            return Boolean(firstQuestionKey && treeConfig && treeConfig[firstQuestionKey]);
        };

        const attemptAnalysisBoot = ({ force = false } = {}) => {
            if (analysisInitialized) {
                return;
            }
            if (!force && !$inlineGroup.hasClass('active')) {
                return;
            }
            analysisInitialized = true;
            loadExistingResponses();
            loadContratosFromDOM();
            if (analysisBootObserver) {
                analysisBootObserver.disconnect();
                analysisBootObserver = null;
            }
        };

        const ensureAnalysisBooted = () => {
            attemptAnalysisBoot();
            return analysisInitialized;
        };

        const scheduleAnalysisBoot = (force = false) => {
            attemptAnalysisBoot({ force });
            if (analysisInitialized || !$inlineGroup.length) {
                return;
            }
            if (analysisBootObserver) {
                return;
            }
            const observerTarget = $inlineGroup.get(0);
            if (!observerTarget) {
                return;
            }
            analysisBootObserver = new MutationObserver(() => {
                attemptAnalysisBoot();
                if (analysisInitialized && analysisBootObserver) {
                    analysisBootObserver.disconnect();
                    analysisBootObserver = null;
                }
            });
            analysisBootObserver.observe(observerTarget, { attributes: true, attributeFilter: ['class'] });
        };

		        let analysisReady = false;
		        const updateActionButtons = () => {
		            $saveAnalysisButton.prop('disabled', !analysisReady);
		            if (analysisTypeSelectionInProgress) {
		                $startAnalysisButton.prop('disabled', true);
		                $startAnalysisButton.text('Carregando...');
		                return;
		            }

		            const canChangeType = analysisReady && isDecisionTreeReady();
		            $startAnalysisButton.prop('disabled', false);
		            $startAnalysisButton.text(canChangeType ? 'Alterar tipo' : 'Começar');
		        };

	        const resetDecisionTreeState = () => {
	            treeConfig = {};
	            treeResponseKeys = [];
	            firstQuestionKey = null;
	            activeAnalysisType = null;
	        };

		        const markAnalysisReady = () => {
		            if (analysisTypeSelectionInProgress || !analysisHasStarted) {
		                return;
		            }
		            if (analysisReady) {
		                return;
		            }
		            analysisReady = true;
		            updateActionButtons();
		        };

		        const runSelectAnalysisTypeFlow = () => {
		            analysisReady = false;
		            analysisHasStarted = false;
		            analysisTypeSelectionInProgress = true;
		            resetDecisionTreeState();
		            updateActionButtons();

		            scheduleAnalysisBoot(true);

		            $dynamicQuestionsContainer.empty().html('<p>Selecione o tipo de análise...</p>');

		            fetchAnalysisTypes()
		                .then(types => promptSelectAnalysisType(types))
		                .then(selectedType => {
		                    $dynamicQuestionsContainer.html('<p>Carregando tipo de análise...</p>');
		                    return fetchDecisionTreeConfig({ tipoId: selectedType.id, tipoVersao: selectedType.versao, forceReload: false })
		                        .then(() => {
		                            analysisTypeSelectionInProgress = false;
		                            analysisHasStarted = true;
		                            updateActionButtons();
		                            const isMonitoria = activeAnalysisType && activeAnalysisType.slug === 'novas-monitorias';
		                            startNewAnalysis({ skipGeneralSnapshot: !isMonitoria, suppressSummary: true });
		                        });
		                })
		                .fail((reason) => {
		                    analysisTypeSelectionInProgress = false;
		                    analysisReady = false;
		                    updateActionButtons();

		                    if (reason && reason.cancelled) {
		                        $dynamicQuestionsContainer.empty();
		                        return;
		                    }
		                    $dynamicQuestionsContainer.html(
		                        '<p class="errornote">Não foi possível iniciar a Análise (falha ao carregar tipos ou árvore).</p>'
		                    );
		                });
		        };

		        $startAnalysisButton.on('click', () => {
		            ensureAnalysisBooted();
		            const isChanging = analysisReady && isDecisionTreeReady();

		            if (!isChanging) {
		                runSelectAnalysisTypeFlow();
		                return;
		            }

		            const isEditingCard = userResponses && userResponses._editing_card_index != null;
		            const hasDataToDiscard = isEditingCard || hasActiveAnalysisResponses();
		            if (!hasDataToDiscard) {
		                runSelectAnalysisTypeFlow();
		                return;
		            }

		            showCffConfirmDialog(
		                'Alterar o Tipo de Análise?\n\nIsso vai descartar as respostas em andamento desta análise.\n\nOs cards já concluídos não serão alterados.'
		            ).then(confirmar => {
		                if (!confirmar) {
		                    updateActionButtons();
		                    return;
		                }
		                delete userResponses._editing_card_index;
		                clearTreeResponsesForNewAnalysis();
		                saveResponses();
		                displayFormattedResponses();
		                runSelectAnalysisTypeFlow();
		            });
		        });

        // RECARREGA JSON AO MUDAR STATUS DO CONTRATO (Q, seleção etc.)
        $(document).on('contratoStatusChange', function () {
            ensureAnalysisBooted();
            if (!analysisInitialized) {
                return;
            }
            try {
                const data = $responseField.val();
                userResponses = data ? JSON.parse(data) : {};
            } catch (e) {
                console.error("DEBUG A_P_A: erro ao reparsear userResponses no evento contratoStatusChange:", e);
                userResponses = {};
            }

            ensureUserResponsesShape();
            loadContratosFromDOM();
            if (isDecisionTreeReady()) {
                renderDecisionTree();
            }
            updateContractStars();
            updateGenerateButtonState();
            displayFormattedResponses();
        });

        /* =========================================================
         * Inicialização
         * ======================================================= */

        const startAnalysisLazy = () => {
            scheduleAnalysisBoot();
            updateActionButtons();
        };

        // Carrega imediatamente os cards de análises concluídas, mesmo antes de clicar em "Começar"
        loadExistingResponses();
        fetchAnalysisTypes().done(() => {
            displayFormattedResponses();
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startAnalysisLazy);
        } else {
            startAnalysisLazy();
        }

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
            if (!hasAnySpecificCardSelection()) {
                showCffSystemDialog(
                    'Selecione primeiro o card de uma análise antes de gerar a Petição Monitória Inicial.',
                    'warning'
                );
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
            const url = `/contratos/processo/${currentProcessoId}/gerar-monitoria/`;

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
                    startCountdown(5);
                },
                success: function (data) {
                    const msg = data && data.message ? data.message : 'Operação concluída.';
                    let details = [];
                    if (data && data.monitoria) {
                        if (data.monitoria.ok) {
                            details.push('Monitória: OK');
                        } else {
                            details.push(`Monitória: Erro${data.monitoria.error ? ` - ${data.monitoria.error}` : ''}`);
                        }
                    }
                    if (data && data.extrato) {
                        if (data.extrato.ok) {
                            details.push('Extrato Titularidade: OK');
                        } else {
                            details.push(`Extrato Titularidade: Erro${data.extrato.error ? ` - ${data.extrato.error}` : ''}`);
                        }
                    }
                const successLines = [];
                if (data && data.monitoria) {
                    successLines.push('Monitória: Gerada Corretamente - Salva em Arquivos');
                }
                if (data && data.extrato) {
                    if (data.extrato.ok) {
                        successLines.push('Extrato de titularidade OK');
                    } else {
                        const messageRaw = data.extrato.error || 'Erro desconhecido';
                        const message = messageRaw.replace(/\.?\s*Não é possível emitir o extrato da titularidade\.?/i, '');
                        successLines.push(`Extrato de titularidade: Não gerado - ${message}`);
                    }
                }
                const handleReload = () => {
                    if ('scrollRestoration' in history) {
                        history.scrollRestoration = 'manual';
                    }
                    sessionStorage.setItem('scrollPosition', window.scrollY || document.documentElement.scrollTop || 0);
                    window.location.reload();
                };
                showCffSystemDialog(successLines.join('\n'), 'success', handleReload);
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
                    stopCountdown();
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
            if (!hasAnySummaryCardSelection()) {
                showCffSystemDialog(
                    'Selecione primeiro o card de uma análise antes de gerar a Cobrança Judicial.',
                    'warning'
                );
                return;
            }
            const aggregatedContratoIds = getMonitoriaContractIds({
                includeGeneralSnapshot: true,
                includeSummaryCardContracts: true
            });
            if (aggregatedContratoIds.length === 0) {
                alert('Selecione pelo menos um contrato antes de gerar a petição de cobrança.');
                return;
            }
            const contractNumbers = getContractNumbersFromIds(aggregatedContratoIds);
            const contractsWithArquivos = findContractsWithContratoArquivos(contractNumbers);
            if (contractsWithArquivos.length > 0) {
                const lista = contractsWithArquivos.join(', ');
                showCffSystemDialog(
                    `Já existem arquivos de "Contrato" para o(s) contrato(s) ${lista}. Recomendamos gerar a Petição Monitória antes de partir para a Cobrança Judicial.`
                );
                return;
            }

            const csrftoken = $('input[name="csrfmiddlewaretoken"]').val();
            const url = `/contratos/processo/${currentProcessoId}/gerar-cobranca-judicial/`;

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
            $('#id_gerar_cobranca_btn')
                        .prop('disabled', true)
                        .text('Gerando cobrança...');
                    startCountdown(5);
                },
                success: function (data) {
                const successLines = [];
                if (data && data.cobranca) {
                    if (data.cobranca.ok) {
                        successLines.push('Cobrança Judicial OK - Salvo em Arquivos');
                    } else {
                        successLines.push('Cobrança Judicial gerada - Salva em Arquivos');
                    }
                } else if (data && data.message) {
                    successLines.push(data.message);
                } else {
                    successLines.push('Cobrança Judicial OK - Salvo em Arquivos');
                }
                if (data && data.extrato) {
                    if (data.extrato.ok) {
                        successLines.push('Extrato de titularidade OK');
                    } else {
                        const rawMessage = data.extrato.error || '';
                        const cleaned = rawMessage
                            .replace(/\.?\s*Não é possível emitir o extrato da titularidade\.?/i, '')
                            .replace(/^NowLex/i, 'A NowLex')
                            .trim();
                        const finalMessage = cleaned || 'A NowLex não possui o cadastro do contrato solicitado';
                        successLines.push(`Extrato de titularidade: Não gerado - ${finalMessage}.`);
                    }
                }
                const handleReload = () => {
                    if ('scrollRestoration' in history) {
                        history.scrollRestoration = 'manual';
                    }
                    sessionStorage.setItem('scrollPosition', window.scrollY || document.documentElement.scrollTop || 0);
                    window.location.reload();
                };
                showCffSystemDialog(successLines.join('\n'), 'success', handleReload);
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
                    stopCountdown();
                    $('#id_gerar_cobranca_btn')
                        .prop('disabled', false)
                        .text('Petição Cobrança Judicial (PDF)');
                }
            });
        });

        $(document).on('click', '#id_gerar_habilitacao_btn', function (e) {
            e.preventDefault();

            if (!currentProcessoId) {
                alert('Erro: ID do processo não encontrado para gerar a habilitação.');
                return;
            }

            const csrftoken = $('input[name="csrfmiddlewaretoken"]').val();
            const url = `/contratos/processo/${currentProcessoId}/gerar-habilitacao/`;

            $.ajax({
                url: url,
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken },
                data: {
                    processo_id: currentProcessoId
                },
                dataType: 'json',
                beforeSend: function () {
                    $('#id_gerar_habilitacao_btn')
                        .prop('disabled', true)
                        .text('Gerando habilitação...');
                    startCountdown(5);
                },
                success: function (data) {
                    const lines = [];
                    if (data && data.habilitacao) {
                        if (data.habilitacao.ok) {
                            lines.push('Habilitação OK - Salvo em Arquivos');
                        } else {
                            lines.push('Habilitação gerada - Salva em Arquivos');
                        }
                    } else if (data && data.message) {
                        lines.push(data.message);
                    } else {
                        lines.push('Habilitação OK - Salvo em Arquivos');
                    }
                    const handleReload = () => {
                        if ('scrollRestoration' in history) {
                            history.scrollRestoration = 'manual';
                        }
                        sessionStorage.setItem('scrollPosition', window.scrollY || document.documentElement.scrollTop || 0);
                        window.location.reload();
                    };
                    showCffSystemDialog(lines.join('\n'), 'success', handleReload);
                },
                error: function (xhr, status, error) {
                    let errorMessage = 'Erro ao gerar petição de habilitação. Tente novamente.';
                    if (xhr.responseJSON && xhr.responseJSON.message) {
                        errorMessage = xhr.responseJSON.message;
                    } else if (xhr.responseText) {
                        errorMessage = xhr.responseText;
                    }
                    showCffSystemDialog(errorMessage, 'warning');
                    console.error('Erro na geração da habilitação:', status, error, xhr);
                },
                complete: function () {
                    stopCountdown();
                    $('#id_gerar_habilitacao_btn')
                        .prop('disabled', false)
                        .text('Gerar Petição de Habilitação (PDF)');
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
            const url = `/contratos/processo/${currentProcessoId}/gerar-monitoria-docx/`;

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
