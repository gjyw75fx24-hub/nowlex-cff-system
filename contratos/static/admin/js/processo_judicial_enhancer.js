document.addEventListener('DOMContentLoaded', function() {

    // --- Seletores Globais ---
    const form = document.getElementById('processojudicial_form');
    const cnjInput = document.getElementById('id_cnj');
    const ufInput = document.getElementById('id_uf');
    const tribunalInput = document.getElementById('id_tribunal');
    const varaInput = document.getElementById('id_vara');
    const valorCausaInput = document.getElementById('id_valor_causa');
    const statusSelect = document.getElementById('id_status');

    const carteiraSelect = document.getElementById('id_carteira');
    let prevButton = null;
    let nextButton = null;
    let addButton = null;
    let deleteButton = null;
    const entryStates = [];
    let currentEntryIndex = -1;
    const ensureHiddenInput = (name) => {
        if (!form) {
            return null;
        }
        let input = form.querySelector(`input[name="${name}"]`);
        if (!input) {
            input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.id = `id_${name}`;
            form.appendChild(input);
        } else if (!input.id) {
            input.id = `id_${name}`;
        }
        return input;
    };
    const cnjEntriesInput = ensureHiddenInput('cnj_entries_data');
    const cnjActiveIndexInput = ensureHiddenInput('cnj_active_index');
    const dedupeEntryStates = () => {
        const seen = new Set();
        const filtered = [];
        entryStates.forEach((entry) => {
            const key = entry.cnj ? entry.cnj.trim() : '';
            if (!key || seen.has(key)) {
                return;
            }
            seen.add(key);
            filtered.push(entry);
        });
        entryStates.splice(0, entryStates.length, ...filtered);
        if (entryStates.length === 0) {
            currentEntryIndex = -1;
        } else {
            currentEntryIndex = Math.min(currentEntryIndex, entryStates.length - 1);
        }
    };

    const syncHiddenEntries = () => {
        if (cnjEntriesInput) {
            cnjEntriesInput.value = JSON.stringify(entryStates);
        }
        if (cnjActiveIndexInput) {
            cnjActiveIndexInput.value = currentEntryIndex;
        }
    };
    const hydrateInitialEntries = () => {
        const initialEntries = Array.isArray(window.__cnj_entries) ? window.__cnj_entries : [];
        const desiredIndex = Number.isInteger(window.__cnj_active_index) ? window.__cnj_active_index : 0;
        initialEntries.forEach((entry) => {
            entryStates.push({
                id: entry.id,
                cnj: entry.cnj || '',
                uf: entry.uf || '',
                valor_causa: entry.valor_causa || '',
                status: entry.status || '',
                carteira: entry.carteira || '',
                vara: entry.vara || '',
                tribunal: entry.tribunal || '',
            });
        });
        dedupeEntryStates();
        if (entryStates.length > 0) {
            currentEntryIndex = Math.min(Math.max(0, desiredIndex), entryStates.length - 1);
            applyEntryState(entryStates[currentEntryIndex]);
        }
        syncHiddenEntries();
        updateNavButtons();
    };

    const ensureEntriesHydrated = () => {
        if (entryStates.length > 0) {
            return;
        }
        const initialEntries = Array.isArray(window.__cnj_entries) ? window.__cnj_entries : [];
        if (initialEntries.length === 0) {
            return;
        }
        const desiredIndex = Number.isInteger(window.__cnj_active_index) ? window.__cnj_active_index : 0;
        initialEntries.forEach((entry) => {
            entryStates.push({
                id: entry.id,
                cnj: entry.cnj || '',
                uf: entry.uf || '',
                valor_causa: entry.valor_causa || '',
                status: entry.status || '',
                carteira: entry.carteira || '',
                vara: entry.vara || '',
                tribunal: entry.tribunal || '',
            });
        });
        dedupeEntryStates();
        if (entryStates.length > 0) {
            currentEntryIndex = Math.min(Math.max(0, desiredIndex), entryStates.length - 1);
            applyEntryState(entryStates[currentEntryIndex]);
        }
        syncHiddenEntries();
    };

    const buildEntryState = () => {
        const currentId = currentEntryIndex >= 0 && entryStates[currentEntryIndex] ? entryStates[currentEntryIndex].id : null;
        return {
            id: currentId,
            cnj: cnjInput.value.trim(),
            uf: ufInput.value.trim(),
            valor_causa: valorCausaInput.value.trim(),
            status: statusSelect ? statusSelect.value : '',
            carteira: carteiraSelect ? carteiraSelect.value : '',
            vara: varaInput ? varaInput.value.trim() : '',
            tribunal: tribunalInput ? tribunalInput.value.trim() : '',
        };
    };

    const HEADER_TITLE = 'Dados do Processo';
    const normalizeHeaderText = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const findHeaderElement = () => {
        const headings = Array.from(document.querySelectorAll('#content-main h2'));
        const target = normalizeHeaderText(HEADER_TITLE);
        const directMatch = headings.find((heading) => normalizeHeaderText(heading.textContent).includes(target));
        if (directMatch) {
            return directMatch;
        }
        const cnjInput = document.getElementById('id_cnj');
        const fieldset = cnjInput?.closest('fieldset');
        if (fieldset) {
            return fieldset.querySelector('h2') || null;
        }
        return null;
    };
    let headerElement = findHeaderElement();
    const headerTitleSpan = document.createElement('span');
    const headerControls = document.createElement('div');
    const storageKey = `dados_processo_state_${window.location.pathname}`;
    const loadCollapsedPreference = () => {
        try {
            return window.localStorage?.getItem(storageKey);
        } catch (error) {
            return null;
        }
    };
    const saveCollapsedPreference = (value) => {
        try {
            window.localStorage?.setItem(storageKey, value ? 'collapsed' : 'expanded');
        } catch (error) {
            // ignore storage errors
        }
    };

    const ensureHeaderLayout = () => {
        if (!headerElement) {
            headerElement = findHeaderElement();
        }
        if (!headerElement) {
            return null;
        }
        if (!headerElement.dataset.processoHeaderEnhanced) {
            headerElement.dataset.processoHeaderEnhanced = 'true';
            headerElement.innerHTML = '';
            headerElement.style.display = 'flex';
            headerElement.style.alignItems = 'center';
            headerElement.style.justifyContent = 'space-between';
            headerElement.style.gap = '0.6rem';
            headerTitleSpan.className = 'processo-header-title';
            headerControls.className = 'processo-header-controls';
            headerControls.style.display = 'inline-flex';
            headerControls.style.alignItems = 'center';
            headerControls.style.gap = '0.35rem';
            headerControls.style.marginLeft = 'auto';
            headerControls.style.marginRight = '0';
            headerControls.style.padding = '0';
            headerElement.appendChild(headerTitleSpan);
            headerElement.appendChild(headerControls);
        }
        return headerElement.closest('fieldset');
    };

    // Add minimize/maximize buttons for the Dados do Processo section.
    const setupCollapseControls = (() => {
        let initialized = false;
        const createControlButton = (symbol, title) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'button tertiary';
            button.textContent = symbol;
            button.title = title;
            button.setAttribute('aria-label', title);
            button.style.padding = '0 0.65rem';
            button.style.height = '32px';
            button.style.minWidth = '32px';
            button.style.display = 'inline-flex';
            button.style.alignItems = 'center';
            button.style.justifyContent = 'center';
            button.style.fontSize = '1.25rem';
            button.style.lineHeight = '1';
            return button;
        };
        return (fieldset) => {
            if (initialized || !fieldset || !headerElement) {
                return;
            }
            const contentNodes = Array.from(fieldset.children).filter((node) => node !== headerElement);
            if (contentNodes.length === 0) {
                return;
            }
            contentNodes.forEach((node) => {
                if (typeof node.dataset.originalDisplay === 'undefined') {
                    node.dataset.originalDisplay = node.style.display || '';
                }
            });
            const minimizeButton = createControlButton('-', 'Minimizar dados do processo');
            const maximizeButton = createControlButton('+', 'Maximizar dados do processo');
            const setCollapsed = (value) => {
                contentNodes.forEach((node) => {
                    node.style.display = value ? 'none' : (node.dataset.originalDisplay || '');
                });
                minimizeButton.disabled = value;
                maximizeButton.disabled = !value;
                headerElement.dataset.processSectionCollapsed = value ? 'true' : 'false';
                saveCollapsedPreference(value);
            };
            minimizeButton.addEventListener('click', () => setCollapsed(true));
            maximizeButton.addEventListener('click', () => setCollapsed(false));
            headerControls.appendChild(minimizeButton);
            headerControls.appendChild(maximizeButton);
            const stored = loadCollapsedPreference();
            const initialCollapsed = stored === 'collapsed';
            setCollapsed(initialCollapsed);
            initialized = true;
        };
    })();

    const setActiveCnjText = () => {
        const fieldset = ensureHeaderLayout();
        headerTitleSpan.textContent = HEADER_TITLE;
        const collapseContainer = fieldset || headerElement?.parentElement;
        if (collapseContainer) {
            setupCollapseControls(collapseContainer);
        }
        if (window.__setActiveCnjHeader) {
            window.__setActiveCnjHeader(HEADER_TITLE);
        }
        if (typeof window.__cnj_active_display !== 'undefined') {
            window.__cnj_active_display = HEADER_TITLE;
        }
    };

    const applyEntryState = (entry) => {
        cnjInput.value = entry.cnj;
        if (ufInput) ufInput.value = entry.uf;
        if (valorCausaInput) valorCausaInput.value = entry.valor_causa;
        if (statusSelect) statusSelect.value = entry.status;
        if (carteiraSelect) carteiraSelect.value = entry.carteira;
        if (varaInput) varaInput.value = entry.vara;
        if (tribunalInput) tribunalInput.value = entry.tribunal;
        cnjInput.focus();
        setActiveCnjText();
    };

    const updateNavButtons = () => {
        ensureEntriesHydrated();
        if (prevButton) {
            prevButton.disabled = currentEntryIndex <= 0 || entryStates.length <= 1;
        }
        if (nextButton) {
            nextButton.disabled = entryStates.length <= 1 || currentEntryIndex < 0 || currentEntryIndex >= entryStates.length - 1;
        }
        if (deleteButton) {
            deleteButton.disabled = entryStates.length === 0;
        }
    };

    const storeCurrentEntry = () => {
        const currentState = buildEntryState();
        if (currentEntryIndex >= 0) {
            entryStates[currentEntryIndex] = currentState;
        } else if (currentState.cnj) {
            entryStates.push(currentState);
            currentEntryIndex = entryStates.length - 1;
        }
        dedupeEntryStates();
        syncHiddenEntries();
    };

    // --- 1. Criação do Botão "Dados Online" ---
    if (cnjInput && !document.getElementById('btn_buscar_cnj')) {
        const searchButton = document.createElement('button');
        searchButton.id = 'btn_buscar_cnj';
        searchButton.type = 'button';
        searchButton.className = 'button';
        searchButton.innerHTML = '🌐';
        searchButton.title = 'Buscar dados online (API Escavador)';
        searchButton.setAttribute('aria-label', 'Buscar dados online (API Escavador)');
        searchButton.style.marginLeft = '6px';
        searchButton.style.padding = '0';
        searchButton.style.minWidth = '32px';
        searchButton.style.width = '32px';
        searchButton.style.height = '32px';
        searchButton.style.lineHeight = '32px';
        searchButton.style.display = 'inline-flex';
        searchButton.style.alignItems = 'center';
        searchButton.style.justifyContent = 'center';
        searchButton.style.borderRadius = '4px';

        const cnjInputParent = cnjInput.parentNode;
        const inlineGroup = document.createElement('div');
        inlineGroup.className = 'cnj-inline-group';
        inlineGroup.style.display = 'inline-flex';
        inlineGroup.style.alignItems = 'center';
        inlineGroup.style.gap = '6px';
        inlineGroup.style.flexWrap = 'nowrap';
        cnjInputParent.insertBefore(inlineGroup, cnjInput);
        inlineGroup.appendChild(cnjInput);
        inlineGroup.appendChild(searchButton);

        addButton = document.createElement('button');
        addButton.id = 'btn_add_cnj';
        addButton.type = 'button';
        addButton.className = 'button secondary';
        addButton.innerHTML = '+';
        addButton.title = 'Adicionar novo Número CNJ';
        addButton.setAttribute('aria-label', 'Adicionar novo Número CNJ');
        addButton.style.padding = '0 .75rem';
        addButton.style.minWidth = '34px';
        addButton.style.height = '32px';
        inlineGroup.appendChild(addButton);

        prevButton = document.createElement('button');
        prevButton.id = 'btn_prev_cnj';
        prevButton.type = 'button';
        prevButton.className = 'button tertiary';
        prevButton.innerHTML = '‹';
        prevButton.title = 'Ir para CNJ anterior';
        prevButton.style.padding = '0 .65rem';
        prevButton.style.minWidth = '34px';
        prevButton.style.height = '32px';
        prevButton.disabled = true;
        inlineGroup.appendChild(prevButton);

        nextButton = document.createElement('button');
        nextButton.id = 'btn_next_cnj';
        nextButton.type = 'button';
        nextButton.className = 'button tertiary';
        nextButton.innerHTML = '›';
        nextButton.title = 'Ir para próximo CNJ';
        nextButton.style.padding = '0 .65rem';
        nextButton.style.minWidth = '34px';
        nextButton.style.height = '32px';
        nextButton.disabled = true;
        inlineGroup.appendChild(nextButton);

        deleteButton = document.createElement('button');
        deleteButton.id = 'btn_delete_cnj';
        deleteButton.type = 'button';
        deleteButton.className = 'button destructive';
        deleteButton.innerHTML = '×';
        deleteButton.title = 'Remover CNJ ativo';
        deleteButton.setAttribute('aria-label', 'Remover CNJ ativo');
        deleteButton.style.padding = '0 .75rem';
        deleteButton.style.minWidth = '34px';
        deleteButton.style.height = '32px';
        inlineGroup.appendChild(deleteButton);

        const clearFields = () => {
        cnjInput.value = '';
        if (ufInput) ufInput.value = '';
        if (valorCausaInput) valorCausaInput.value = '';
            if (statusSelect) statusSelect.selectedIndex = 0;
            if (varaInput) varaInput.value = '';
            if (tribunalInput) tribunalInput.value = '';
        if (carteiraSelect) carteiraSelect.selectedIndex = 0;
        cnjInput.focus();
        setActiveCnjText();
        };

        deleteButton.addEventListener('click', () => {
            if (currentEntryIndex < 0 || entryStates.length === 0) {
                return;
            }
            entryStates.splice(currentEntryIndex, 1);
            if (entryStates.length === 0) {
                currentEntryIndex = -1;
                clearFields();
            } else {
                currentEntryIndex = Math.min(currentEntryIndex, entryStates.length - 1);
                applyEntryState(entryStates[currentEntryIndex]);
            }
            dedupeEntryStates();
            syncHiddenEntries();
            updateNavButtons();
        });

        addButton.addEventListener('click', () => {
            storeCurrentEntry();
            clearFields();
            currentEntryIndex = -1;
            syncHiddenEntries();
            updateNavButtons();
        });

        prevButton.addEventListener('click', () => {
            ensureEntriesHydrated();
            if (currentEntryIndex > 0) {
                storeCurrentEntry();
                currentEntryIndex -= 1;
                applyEntryState(entryStates[currentEntryIndex]);
                updateNavButtons();
                syncHiddenEntries();
            }
        });

        nextButton.addEventListener('click', () => {
            ensureEntriesHydrated();
            if (currentEntryIndex < entryStates.length - 1) {
                storeCurrentEntry();
                currentEntryIndex += 1;
                applyEntryState(entryStates[currentEntryIndex]);
                updateNavButtons();
                syncHiddenEntries();
            }
        });

        hydrateInitialEntries();

        const feedbackDiv = document.createElement('div');
        feedbackDiv.id = 'cnj_feedback';
        feedbackDiv.style.marginTop = '5px';
        feedbackDiv.style.fontWeight = 'bold';
        inlineGroup.parentNode.parentNode.appendChild(feedbackDiv);

        hydrateInitialEntries();
    }

    if (cnjInput) {
        setActiveCnjText();
    }

    const searchButton = document.getElementById('btn_buscar_cnj');
    const cnjFeedback = document.getElementById('cnj_feedback');

    // --- 2. Prevenção de Envio com Enter ---
    if (form) {
        form.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
                event.preventDefault();
            }
        });
        form.addEventListener('submit', function() {
            storeCurrentEntry();
            syncHiddenEntries();
            console.debug('cnj_entries submit', entryStates);
        });
    }

    // --- 3. Lógica do Botão "Preencher UF" ---
    if (ufInput && !document.getElementById("btn_preencher_uf")) {
        const botao = document.createElement("button");
        botao.id = "btn_preencher_uf";
        botao.type = "button";
        botao.innerText = "Preencher UF";
        botao.className = "button";
        botao.style.marginLeft = "10px";

        botao.onclick = function () {
            if (!cnjInput.value) {
                alert("Por favor, insira um número de CNJ.");
                return;
            }

            const valorLimpo = cnjInput.value.replace(/[^\d]/g, "");
            let codUF = null;

            if (valorLimpo.length >= 20) {
                const j = valorLimpo.substring(13, 14);
                const tr = valorLimpo.substring(14, 16);
                codUF = `${j}.${tr}`;
            }

            const mapaUF = {
                "8.01": "AC", "8.02": "AL", "8.03": "AP", "8.04": "AM", "8.05": "BA",
                "8.06": "CE", "8.07": "DF", "8.08": "ES", "8.09": "GO", "8.10": "MA",
                "8.11": "MT", "8.12": "MS", "8.13": "MG", "8.14": "PA", "8.15": "PB",
                "8.16": "PR", "8.17": "PE", "8.18": "PI", "8.19": "RJ", "8.20": "RN",
                "8.21": "RS", "8.22": "RO", "8.23": "RR", "8.24": "SC", "8.25": "SE",
                "8.26": "SP", "8.27": "TO"
            };

            const uf = mapaUF[codUF];
            if (uf) {
                ufInput.value = uf;
                if (tribunalInput) tribunalInput.value = "TJ" + uf;
            } else {
                alert("Não foi possível extrair a UF a partir do CNJ informado. Verifique se o número possui 20 dígitos.");
            }
        };
        ufInput.parentNode.insertBefore(botao, ufInput.nextSibling);
    }

    if (ufInput) {
        ufInput.setAttribute('maxlength', '2');
        ufInput.style.maxWidth = '70px';
        ufInput.style.width = '70px';
        ufInput.style.textTransform = 'uppercase';
        ufInput.style.letterSpacing = '0.08em';
        ufInput.style.fontSize = '0.95rem';
    }

    // --- 4. Lógica do Botão de Busca Online ---
    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }
    const csrftoken = getCookie('csrftoken');
    const AGENDA_SUPERVISION_STATUS_SEQUENCE = ['pendente', 'aprovado', 'reprovado'];
    const AGENDA_SUPERVISION_STATUS_LABELS = {
        pendente: 'Pendente de Supervisão',
        aprovado: 'Aprovado',
        reprovado: 'Reprovado',
    };
    const AGENDA_SUPERVISION_STATUS_CLASSES = {
        pendente: 'status-pendente',
        aprovado: 'status-aprovado',
        reprovado: 'status-reprovado',
    };
    const AGENDA_SUPERVISION_STATUS_URL = '/api/agenda/supervision/status/';
    const AGENDA_SUPERVISION_BARRADO_URL = '/api/agenda/supervision/barrado/';

    function clearInlineDuplicateValidationErrors() {
        document.querySelectorAll('.dynamic-andamento').forEach(row => {
            const errorList = row.querySelector('.errorlist');
            if (errorList && /Andamento Processual com este Processo/.test(errorList.textContent)) {
                errorList.remove();
            }
            const erroredRows = row.querySelectorAll('.errors');
            erroredRows.forEach(errorNode => {
                errorNode.classList.remove('errors');
            });
        });
    }

    function deduplicateInlineAndamentos() {
        const seen = new Set();
        let removedCount = 0;
        document.querySelectorAll('.dynamic-andamento').forEach(row => {
            const deleteCheckbox = row.querySelector('input[id$="-DELETE"]');
            const dataInput = row.querySelector('input[id$="-data_0"]');
            const timeInput = row.querySelector('input[id$="-data_1"]');
            const descricaoInput = row.querySelector('textarea[id$="-descricao"]');

            const dataValue = (dataInput?.value || '').trim();
            const timeValue = (timeInput?.value || '').trim();
            const descricaoValue = (descricaoInput?.value || '').replace(/\s+/g, ' ').trim();

            if (!dataValue && !descricaoValue) {
                return;
            }

            const key = `${dataValue}||${timeValue}||${descricaoValue}`;
            if (seen.has(key)) {
                if (deleteCheckbox && !deleteCheckbox.checked) {
                    deleteCheckbox.checked = true;
                    row.classList.add('andamento-duplicate-marked');
                    row.style.display = 'none';
                    removedCount += 1;
                }
            } else {
                seen.add(key);
            }
        });
        if (removedCount > 0) {
            clearInlineDuplicateValidationErrors();
        }
        return removedCount;
    }

    const createSystemAlert = (title, message) => {
        const existing = document.getElementById('cff-system-alert');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'cff-system-alert';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '50%';
        overlay.style.transform = 'translateX(-50%)';
        overlay.style.background = '#fff';
        overlay.style.border = '1px solid #dcdcdc';
        overlay.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
        overlay.style.borderRadius = '8px';
        overlay.style.padding = '16px 24px';
        overlay.style.zIndex = 2200;
        overlay.style.minWidth = '280px';
        overlay.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        const titleEl = document.createElement('div');
        titleEl.style.fontWeight = 'bold';
        titleEl.style.marginBottom = '8px';
        titleEl.textContent = title;
        overlay.appendChild(titleEl);

        const msgEl = document.createElement('div');
        msgEl.style.marginBottom = '12px';
        msgEl.style.fontSize = '0.95rem';
        msgEl.textContent = message;
        overlay.appendChild(msgEl);

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'OK';
        button.style.border = 'none';
        button.style.background = '#0d6efd';
        button.style.color = '#fff';
        button.style.padding = '6px 12px';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            overlay.remove();
        });
        overlay.appendChild(button);

        document.body.appendChild(overlay);
        const calendarGridEl = overlay.querySelector('[data-calendar-placeholder]');
        const detailList = overlay.querySelector('.agenda-panel__details-list-inner');
        const detailCardBody = overlay.querySelector('.agenda-panel__details-card-body');
        if (detailCardBody && detailList && calendarGridEl) {
            detailCardBody.style.maxHeight = '320px';
            detailCardBody.style.display = 'block';
            detailCardBody.style.overflowY = 'auto';
            detailCardBody.style.overflowX = 'hidden';
            detailCardBody.style.paddingRight = '0.5rem';
            renderCalendarDays(calendarGridEl, detailList, detailCardBody, null, null, () => {});
        }
    };

    let observationTooltip = null;
    let tooltipVisibilityInput = null;
    let tooltipHideTimeout = null;

    const ensureObservationTooltip = () => {
        if (!observationTooltip) {
            observationTooltip = document.createElement('div');
            observationTooltip.className = 'checagem-observation-tooltip';
            observationTooltip.style.display = 'none';
            document.body.appendChild(observationTooltip);
            observationTooltip.addEventListener('mouseenter', () => {
                cancelScheduledTooltipHide();
            });
            observationTooltip.addEventListener('mouseleave', () => {
                scheduleObservationTooltipHide();
            });
        }
        return observationTooltip;
    };

    const cancelScheduledTooltipHide = () => {
        if (tooltipHideTimeout) {
            clearTimeout(tooltipHideTimeout);
            tooltipHideTimeout = null;
        }
    };

    const showObservationTooltip = (input) => {
        if (!input || !input.value.trim()) {
            return;
        }
        const tooltip = ensureObservationTooltip();
        tooltip.textContent = input.value;
        const rect = input.getBoundingClientRect();
        tooltip.style.left = `${rect.right + 10}px`;
        tooltip.style.top = `${rect.top}px`;
        tooltip.style.display = 'block';
        tooltipVisibilityInput = input;
        const overflowBottom = rect.top + tooltip.offsetHeight - window.innerHeight;
        if (overflowBottom > 0) {
            tooltip.style.top = `${Math.max(8, rect.top - overflowBottom - 8)}px`;
        }
        cancelScheduledTooltipHide();
    };

    const hideObservationTooltip = () => {
        if (observationTooltip) {
            observationTooltip.style.display = 'none';
            tooltipVisibilityInput = null;
            cancelScheduledTooltipHide();
        }
    };

    const scheduleObservationTooltipHide = () => {
        cancelScheduledTooltipHide();
        tooltipHideTimeout = setTimeout(() => {
            hideObservationTooltip();
        }, 220);
    };

    const showObservationTooltipForTarget = (target, text) => {
        if (!target || !text) {
            return;
        }
        const tooltip = ensureObservationTooltip();
        tooltip.textContent = text;
        const rect = target.getBoundingClientRect();
        tooltip.style.left = `${rect.right + 10}px`;
        tooltip.style.top = `${rect.top}px`;
        tooltip.style.display = 'block';
        tooltipVisibilityInput = target;
        const overflowBottom = rect.top + tooltip.offsetHeight - window.innerHeight;
        if (overflowBottom > 0) {
            tooltip.style.top = `${Math.max(8, rect.top - overflowBottom - 8)}px`;
        }
        cancelScheduledTooltipHide();
    };

    const insertAgendaSidebarPlaceholder = () => {
        const navSidebar = document.getElementById('nav-sidebar');
        if (!navSidebar || navSidebar.querySelector('.agenda-placeholder-row')) {
            return;
        }
        const processoRow = navSidebar.querySelector('tr.model-processojudicial');
        if (!processoRow) {
            return;
        }
        const placeholderRow = document.createElement('tr');
        placeholderRow.className = 'agenda-placeholder-row';
        const placeholderCell = document.createElement('td');
        placeholderCell.setAttribute('colspan', '3');
        placeholderCell.setAttribute('aria-hidden', 'true');
        placeholderCell.innerHTML = `
            <div class="agenda-placeholder-card" role="presentation">
                <div class="agenda-placeholder-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 36 36" role="presentation" focusable="false">
                        <rect x="2" y="4" width="32" height="28" rx="4" ry="4" stroke="rgba(255,255,255,0.6)" stroke-width="1.8" fill="none"></rect>
                        <line x1="2" y1="10" x2="34" y2="10" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"></line>
                        <line x1="10" y1="2" x2="10" y2="8" stroke="#e2f1ff" stroke-width="2"></line>
                        <line x1="26" y1="2" x2="26" y2="8" stroke="#e2f1ff" stroke-width="2"></line>
                        <rect x="5" y="12" width="6" height="6" rx="1.2" ry="1.2" fill="#e2f1ff"></rect>
                        <rect x="15" y="12" width="6" height="6" rx="1.2" ry="1.2" fill="#e2f1ff"></rect>
                        <rect x="25" y="12" width="6" height="6" rx="1.2" ry="1.2" fill="#e2f1ff"></rect>
                        <rect x="5" y="22" width="6" height="6" rx="1.2" ry="1.2" fill="#e2f1ff"></rect>
                        <rect x="15" y="22" width="6" height="6" rx="1.2" ry="1.2" fill="#e2f1ff"></rect>
                        <rect x="25" y="22" width="6" height="6" rx="1.2" ry="1.2" fill="#e2f1ff"></rect>
                    </svg>
                </div>
                <div class="agenda-placeholder-card__body">
                    <p class="agenda-placeholder-card__title">Agenda Geral</p>
                    <p class="agenda-placeholder-card__text">Tarefas e prazos reunidos em um só calendário.</p>
                    <p class="agenda-placeholder-card__note">Área em construção para centralizar compromissos.</p>
                    <div class="agenda-placeholder-card__actions">
                        <button type="button" class="agenda-placeholder-card__btn" data-agenda-action="tarefas">Tarefas</button>
                        <button type="button" class="agenda-placeholder-card__btn" data-agenda-action="prazos">Prazos</button>
                    </div>
                </div>
            </div>
        `;
        placeholderRow.appendChild(placeholderCell);
        processoRow.parentNode.insertBefore(placeholderRow, processoRow.nextSibling);
    };
    insertAgendaSidebarPlaceholder();

    const insertMinhasAcoesLink = () => {
        const navSidebar = document.getElementById('nav-sidebar');
        if (!navSidebar) return;
        const usersLink = Array.from(navSidebar.querySelectorAll('a'))
            .find((link) => link.textContent.trim() === 'Usuários');
        const userRow = usersLink?.closest('tr');
        if (!userRow || userRow.nextElementSibling?.classList.contains('minhas-acoes-row')) {
            return;
        }
        const row = document.createElement('tr');
        row.className = 'minhas-acoes-row';
        const th = document.createElement('th');
        th.scope = 'row';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'minhas-acoes-trigger';
        button.textContent = 'Minhas ações';
        th.appendChild(button);
        const td = document.createElement('td');
        row.append(th, td);
        userRow.parentNode.insertBefore(row, userRow.nextSibling);
        button.addEventListener('click', () => toggleMinhasAcoesPanel());
    };

    const removeViewSiteLink = () => {
        const userTools = document.getElementById('user-tools');
        if (!userTools) return;
        const link = Array.from(userTools.querySelectorAll('a'))
            .find((anchor) => anchor.textContent.trim().toLowerCase() === 'ver o site'
                || anchor.textContent.trim().toLowerCase() === 'view site');
        if (!link) return;
        const previous = link.previousSibling;
        const next = link.nextSibling;
        link.remove();
        if (previous && previous.nodeType === Node.TEXT_NODE && previous.textContent.includes('/')) {
            previous.remove();
        } else if (next && next.nodeType === Node.TEXT_NODE && next.textContent.includes('/')) {
            next.remove();
        }
    };

    const createMinhasAcoesPanel = () => {
        if (document.querySelector('.minhas-acoes-panel')) {
            return document.querySelector('.minhas-acoes-panel');
        }
        const panel = document.createElement('aside');
        panel.className = 'minhas-acoes-panel';
        panel.innerHTML = `
            <div class="minhas-acoes-panel__header">
                <strong>Minhas ações</strong>
                <button type="button" class="minhas-acoes-panel__close" aria-label="Fechar">×</button>
            </div>
            <div class="minhas-acoes-panel__body">
                <p class="minhas-acoes-panel__loading">Carregando ações...</p>
            </div>
        `;
        document.body.appendChild(panel);
        panel.querySelector('.minhas-acoes-panel__close').addEventListener('click', () => {
            panel.classList.remove('minhas-acoes-panel--open');
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                panel.classList.remove('minhas-acoes-panel--open');
            }
        });
        return panel;
    };

    const renderMinhasAcoes = (panel, items) => {
        const body = panel.querySelector('.minhas-acoes-panel__body');
        if (!body) return;
        if (!items.length) {
            body.innerHTML = '<p class="minhas-acoes-panel__empty">Nenhuma ação recente.</p>';
            return;
        }
        const list = document.createElement('div');
        list.className = 'minhas-acoes-panel__list';
        items.forEach((item) => {
            const entry = document.createElement(item.change_url ? 'a' : 'div');
            entry.className = 'minhas-acoes-panel__item';
            if (item.change_url) {
                entry.href = item.change_url;
                entry.target = '_blank';
                entry.rel = 'noopener noreferrer';
            }
            const title = document.createElement('span');
            title.className = 'minhas-acoes-panel__item-title';
            title.textContent = item.object_repr || 'Registro';
            const meta = document.createElement('span');
            meta.className = 'minhas-acoes-panel__item-meta';
            const typeLabel = item.content_type ? `${item.content_type} · ` : '';
            meta.textContent = `${typeLabel}${item.action_time_display || ''}`;
            entry.append(title, meta);
            if (item.change_message) {
                const desc = document.createElement('span');
                desc.className = 'minhas-acoes-panel__item-desc';
                desc.textContent = item.change_message;
                entry.appendChild(desc);
            }
            list.appendChild(entry);
        });
        body.innerHTML = '';
        body.appendChild(list);
    };

    const loadMinhasAcoes = (panel) => {
        const body = panel.querySelector('.minhas-acoes-panel__body');
        if (body) {
            body.innerHTML = '<p class="minhas-acoes-panel__loading">Carregando ações...</p>';
        }
        fetch('/admin/minhas-acoes/')
            .then((response) => response.json())
            .then((data) => {
                renderMinhasAcoes(panel, Array.isArray(data.items) ? data.items : []);
            })
            .catch(() => {
                if (body) {
                    body.innerHTML = '<p class="minhas-acoes-panel__empty">Não foi possível carregar as ações.</p>';
                }
            });
    };

    const positionMinhasAcoesPanel = (panel, trigger) => {
        if (!panel || !trigger) return;
        const rect = trigger.getBoundingClientRect();
        const sidebar = document.getElementById('nav-sidebar');
        const sidebarRect = sidebar?.getBoundingClientRect();
        const left = (sidebarRect ? sidebarRect.left : rect.left) - 6;
        panel.style.left = `${Math.max(0, left)}px`;
        panel.style.top = `${rect.bottom + 6}px`;
        panel.style.right = 'auto';
        const maxLeft = window.innerWidth - panel.offsetWidth - 12;
        if (panel.offsetWidth && left > maxLeft) {
            panel.style.left = `${Math.max(0, maxLeft)}px`;
        }
    };

    const toggleMinhasAcoesPanel = () => {
        const panel = createMinhasAcoesPanel();
        panel.classList.toggle('minhas-acoes-panel--open');
        if (panel.classList.contains('minhas-acoes-panel--open')) {
            positionMinhasAcoesPanel(panel, document.querySelector('.minhas-acoes-trigger'));
            loadMinhasAcoes(panel);
        }
    };

    insertMinhasAcoesLink();
    removeViewSiteLink();

    const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const getMonthLabel = (state) => {
        const monthName = MONTHS[state.monthIndex % MONTHS.length];
        const year = state.year || new Date().getFullYear();
        if (state.mode === 'weekly') {
            const weekNumber = Math.floor(state.weekOffset / 7) + 1;
            return `Semana ${weekNumber} · ${monthName} ${year}`;
        }
        return `${monthName} ${year}`;
    };
    const clampWeekOffset = (offset, state) => {
        const grid = buildMonthGrid(state.monthIndex, state.year || new Date().getFullYear());
        const maxOffset = Math.max(0, grid.length - 7);
        const normalized = Math.max(0, Math.min(offset, maxOffset));
        return normalized - (normalized % 7);
    };

    const parseDateInputValue = (value) => {
        if (!value) return null;
        const normalized = value.trim();
        const isoMatch = normalized.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
            return {
                year: Number(isoMatch[1]),
                monthIndex: Number(isoMatch[2]) - 1,
                day: Number(isoMatch[3]),
            };
        }
        const brMatch = normalized.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (brMatch) {
            return {
                year: Number(brMatch[3]),
                monthIndex: Number(brMatch[2]) - 1,
                day: Number(brMatch[1]),
            };
        }
        const parsed = new Date(normalized);
        if (!Number.isNaN(parsed.getTime())) {
            return {
                year: parsed.getFullYear(),
                monthIndex: parsed.getMonth(),
                day: parsed.getDate(),
            };
        }
        return null;
    };
    const formatDateIso = (year, monthIndex, day) => {
        const y = String(year).padStart(4, '0');
        const m = String(monthIndex + 1).padStart(2, '0');
        const d = String(day).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    const formatDateLabel = (isoDate) => {
        if (!isoDate) return '';
        const raw = String(isoDate).trim().split('T')[0];
        const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            return raw;
        }
        const [, year, month, day] = match;
        return `${day}/${month}/${year}`;
    };
    const normalizeNumericCurrency = (value) => {
        if (value === undefined || value === null) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        let normalized = raw.replace(/\u00A0/g, '');
        normalized = normalized.replace(/R\$/g, '');
        normalized = normalized.replace(/\s/g, '');
        const hasComma = normalized.includes(',');
        const hasDot = normalized.includes('.');
        if (hasComma && hasDot) {
            normalized = normalized.replace(/\./g, '');
            normalized = normalized.replace(',', '.');
        } else if (hasComma) {
            normalized = normalized.replace(',', '.');
        }
        if (!/[0-9]/.test(normalized)) return null;
        const parsed = Number(normalized);
        if (Number.isNaN(parsed)) {
            return null;
        }
        return parsed;
    };
    const formatCurrencyBrl = (value) => {
        const numeric = normalizeNumericCurrency(value);
        if (numeric === null) return '';
        return numeric.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });
    };
    const fetchContractInfoFromDOM = (contractId) => {
        if (!contractId) return null;
        const idStr = String(contractId).trim();
        if (!idStr) return null;
        let wrapper = document.querySelector(`.contrato-item-wrapper[data-contrato-id="${idStr}"]`);
        if (!wrapper) {
            const norm = idStr.replace(/\D/g, '');
            wrapper = Array.from(document.querySelectorAll('.contrato-item-wrapper')).find(element => {
                const numEl = element.querySelector('.contrato-numero');
                if (!numEl) return false;
                const numText = (numEl.textContent || '').trim().split('\n')[0].trim();
                return norm && numText.replace(/\D/g, '') === norm;
            });
        }
        if (!wrapper) return null;
        const numeroEl = wrapper.querySelector('.contrato-numero');
        const numero = (numeroEl?.textContent || '').trim().split('\n')[0].trim();
        let custasRaw = wrapper.getAttribute('data-custas') || wrapper.dataset.custas || '';
        const custasInput = wrapper.querySelector('input[name$="-custas"]');
        if (custasInput && custasInput.value) {
            custasRaw = custasInput.value;
        }
        const custasValue = normalizeNumericCurrency(custasRaw || '');
        return {
            numero_contrato: numero || idStr,
            custas: Number.isFinite(custasValue) ? custasValue : 0,
        };
    };
    const getCustasFromContracts = (contractNumbers) => {
        const seen = new Set();
        let total = 0;
        if (!contractNumbers || !contractNumbers.length) {
            return { total, items: [] };
        }
        contractNumbers.forEach(ref => {
            if (!ref) return;
            const info = fetchContractInfoFromDOM(ref);
            if (!info) return;
            const key = info.numero_contrato || ref;
            if (seen.has(key)) return;
            seen.add(key);
            const numeric = Number(info.custas);
            if (Number.isFinite(numeric)) {
                total += numeric;
            }
        });
        return { total, items: Array.from(seen) };
    };
    const NOWLEX_PROCESSO_ID = (() => {
        const match = window.location.pathname.match(/\/processojudicial\/(\d+)/i);
        return match ? match[1] : null;
    })();
    const NOWLEX_CALC_ENDPOINT = NOWLEX_PROCESSO_ID
        ? `/api/processo/${NOWLEX_PROCESSO_ID}/nowlex-valor-causa/`
        : null;

    const setNowlexStatus = (el, text, variant) => {
        if (!el) return;
        const states = ['loading', 'success', 'error', 'hint'];
        el.textContent = text || '';
        states.forEach(state => el.classList.remove(`nowlex-status--${state}`));
        if (variant && states.includes(variant)) {
            el.classList.add(`nowlex-status--${variant}`);
        }
    };
    const formatTodayDate = () => {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear());
        return `${day}/${month}/${year}`;
    };
    const formatTodayIso = () => {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear());
        return `${year}-${month}-${day}`;
    };
    const formatDateForStamp = (isoValue) => {
        if (!isoValue) return '';
        const raw = String(isoValue);
        if (raw.includes('/')) {
            return raw;
        }
        const parts = raw.split('-');
        if (parts.length !== 3) return raw;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    };
    const ensureNowlexInputWrap = (input) => {
        if (!input) return null;
        const existingWrap = input.closest('.nowlex-input-wrap');
        if (existingWrap) {
            return existingWrap;
        }
        const wrap = document.createElement('div');
        wrap.className = 'nowlex-input-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const stamp = document.createElement('span');
        stamp.className = 'nowlex-updated-at';
        wrap.appendChild(stamp);
        return wrap;
    };

    const enhanceNowlexRow = (row) => {
        if (!row || row.dataset.nowlexEnhanced === '1') return;
        const valorField = row.querySelector('.field-valor_causa');
        if (!valorField) return;
        const fieldBox = valorField.querySelector('.field-box') || valorField;
        const valorInput = row.querySelector('input[name$="-valor_causa"]');
        ensureNowlexInputWrap(valorInput);
        const dateInput = row.querySelector('input[name$="-data_saldo_atualizado"]');
        const existingStamp = row.querySelector('.nowlex-updated-at');
        if (dateInput && existingStamp && dateInput.value) {
            const displayDate = formatDateForStamp(dateInput.value);
            existingStamp.textContent = displayDate;
            existingStamp.setAttribute('title', `Atualizado em ${displayDate}`);
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'nowlex-action-buttons';
        const statusEl = document.createElement('span');
        statusEl.className = 'nowlex-status';
        const btnValor = document.createElement('button');
        btnValor.type = 'button';
        btnValor.className = 'nowlex-action-btn nowlex-valor-btn';
        btnValor.textContent = 'Só valor';
        const btnPdf = document.createElement('button');
        btnPdf.type = 'button';
        btnPdf.className = 'nowlex-action-btn nowlex-pdf-btn';
        btnPdf.textContent = 'Valor + PDF';
        wrapper.append(statusEl, btnValor, btnPdf);
        fieldBox.appendChild(wrapper);

        const contratoId = row.querySelector('input[name$="-id"]')?.value;
        const shouldDisable = !contratoId;
        [btnValor, btnPdf].forEach(btn => {
            btn.disabled = shouldDisable;
            if (shouldDisable) {
                btn.title = 'Salve o contrato para habilitar o NowLex.';
            }
        });
        if (shouldDisable) {
            setNowlexStatus(statusEl, 'Salve o contrato para usar.', 'hint');
        }

        btnValor.addEventListener('click', () => handleNowlexAction(row, false));
        btnPdf.addEventListener('click', () => handleNowlexAction(row, true));
        row.dataset.nowlexEnhanced = '1';
    };

    const handleNowlexAction = async (row, gerarPdf) => {
        if (!NOWLEX_CALC_ENDPOINT) return;
        const statusEl = row.querySelector('.nowlex-status');
        const buttons = Array.from(row.querySelectorAll('.nowlex-action-btn'));
        const contratoInput = row.querySelector('input[name$="-id"]');
        const contratoId = contratoInput?.value;
        if (!contratoId) {
            setNowlexStatus(statusEl, 'Salve o contrato antes de usar.', 'error');
            return;
        }
        try {
            buttons.forEach(btn => btn.disabled = true);
            setNowlexStatus(statusEl, gerarPdf ? 'Gerando PDF...' : 'Atualizando valor...', 'loading');
            const response = await fetch(NOWLEX_CALC_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken || '',
                },
                body: JSON.stringify({
                    contrato_id: contratoId,
                    action: gerarPdf ? 'valor_pdf' : 'valor',
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) {
                const message = data.error || response.statusText || 'Erro inesperado.';
                throw new Error(message);
            }
            const formatted = formatCurrencyBrl(data.valor_causa || '');
            const valorInput = row.querySelector('input[name$="-valor_causa"]');
            if (valorInput) {
                valorInput.value = formatted;
                valorInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const stamp = row.querySelector('.nowlex-updated-at');
            const dateInput = row.querySelector('input[name$="-data_saldo_atualizado"]');
            const todayIso = formatTodayIso();
            const todayDisplay = formatTodayDate();
            if (dateInput) {
                dateInput.value = todayIso;
                dateInput.dispatchEvent(new Event('input', { bubbles: true }));
                dateInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (stamp) {
                const display = dateInput?.value ? formatDateForStamp(dateInput.value) : todayDisplay;
                stamp.textContent = display;
                stamp.setAttribute('title', `Atualizado em ${display}`);
            }
            if (valorCausaInput) {
                valorCausaInput.value = formatted;
                valorCausaInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            setNowlexStatus(
                statusEl,
                gerarPdf ? 'Valor + PDF atualizados. PDF salvo em Arquivos.' : 'Valor atualizado.',
                'success'
            );
            if (gerarPdf) {
                setNowlexStatus(statusEl, 'PDF salvo, atualizando aba Arquivos...', 'loading');
                setTimeout(() => window.location.reload(), 900);
            }
        } catch (error) {
            const message = (error && error.message) ? error.message : 'Erro inesperado.';
            setNowlexStatus(statusEl, message, 'error');
        } finally {
            const stillDisable = !row.querySelector('input[name$="-id"]')?.value;
            buttons.forEach(btn => {
                btn.disabled = stillDisable;
            });
        }
    };

    const initNowlexControls = () => {
        if (!NOWLEX_CALC_ENDPOINT) return;
        const contractRows = document.querySelectorAll('#contratos-group .inline-related, .dynamic-contratos');
        contractRows.forEach(enhanceNowlexRow);
    };

    if (NOWLEX_CALC_ENDPOINT) {
        initNowlexControls();
        if (window.django && window.django.jQuery) {
            window.django.jQuery(document).on('formset:added', (event, row, formsetName) => {
        if (formsetName !== 'contratos') {
            if (!formsetName || !formsetName.toLowerCase().includes('contrato')) return;
        }
                const element = row && row.jquery ? row[0] : row;
                enhanceNowlexRow(element);
            });
        }
    }
    const entryOrigins = new Map();
    const getOriginKey = (entry) => {
        if (!entry) return null;
        if (entry.backendId) return `${entry.type || ''}-${entry.backendId}`;
        return entry.id ? `local-${entry.id}` : null;
    };
    const rememberOrigin = (entry) => {
        const key = getOriginKey(entry);
        if (!key) return;
        if (!entryOrigins.has(key)) {
            const originDate = entry.originalDate || formatDateIso(entry.year, entry.monthIndex, entry.day);
            entryOrigins.set(key, originDate || entry.originalDay || entry.day);
        }
    };

    const shouldIncludeEntryForActiveUser = (entry, activeUserId) => {
        if (!activeUserId) {
            return true;
        }
        if (entry?.type === 'S') {
            return true;
        }
        return `${entry?.responsavel?.id || ''}` === `${activeUserId}`;
    };
    const applyOriginFromMap = (entry) => {
        const key = getOriginKey(entry);
        if (!key) return;
        if (entryOrigins.has(key)) {
            const storedOrigin = entryOrigins.get(key);
            if (typeof storedOrigin === 'string' && storedOrigin.includes('-')) {
                entry.originalDate = storedOrigin;
                const parsed = parseDateInputValue(storedOrigin);
                if (parsed) {
                    entry.originalDay = parsed.day;
                }
            } else {
                entry.originalDay = storedOrigin;
            }
        }
    };
    let updateAgendaEntryDate = () => {};
    let moveAgendaEntries = () => {};

    const getTypeKey = (type) => {
        if (type === 'P') return 'tasksP';
        if (type === 'S') return 'tasksS';
        return 'tasksT';
    };

    const getTypePrefix = (type) => {
        if (type === 'P') return 'Prazo';
        if (type === 'S') return 'Supervisão';
        return 'Tarefa';
    };

    const getPrescricaoLimit = (entry) => {
        const raw = entry?.prescricao_date;
        if (!raw) return null;
        return parseDateInputValue(raw);
    };

    const isSupervisionDropAllowedForEntry = (entry, targetDayInfo) => {
        if (!entry || entry.type !== 'S') {
            return true;
        }
        const limit = getPrescricaoLimit(entry);
        if (!limit) {
            return true;
        }
        const targetDate = new Date(targetDayInfo.year, targetDayInfo.monthIndex, targetDayInfo.day);
        const limitDate = new Date(limit.year, limit.monthIndex, limit.day);
        return targetDate < limitDate;
    };

    const showSupervisionLimitViolation = (entry) => {
        if (!entry?.prescricao_date) return;
        const limitLabel = formatDateLabel(entry.prescricao_date) || entry.prescricao_date;
        createSystemAlert('Agenda Geral', `S não pode ser movido após ${limitLabel}.`);
    };

    const normalizeEntryMetadata = (dayInfo, type) => {
        const taskKey = getTypeKey(type);
        const list = dayInfo[taskKey];
        if (!list) return;
        list.forEach((entry, index) => {
            const prefix = getTypePrefix(type);
            entry.id = entry.id || `${type.toLowerCase()}-${dayInfo.day}-${index + 1}`;
            entry.label = type === 'S' ? 'S' : `${index + 1}`;
            const baseDescription = entry.description || entry.descricao || entry.titulo || entry.title;
            entry.description = baseDescription || `${prefix} ${dayInfo.day}.${index + 1}`;
            entry.originalDay = entry.originalDay || dayInfo.day;
            entry.originalDate = entry.originalDate || formatDateIso(dayInfo.year, dayInfo.monthIndex, dayInfo.day);
        });
    };

    const createCalendarDays = (monthIndex, year = new Date().getFullYear()) => {
        const days = new Date(year, monthIndex + 1, 0).getDate();
        return Array.from({ length: days }, (_, index) => {
            return {
                day: index + 1,
                tasksT: [],
                tasksP: [],
                tasksS: [],
                monthIndex,
                year,
            };
        });
    };
    const calendarMonths = {};
    const resetCalendarMonths = () => {
        Object.keys(calendarMonths).forEach((key) => delete calendarMonths[key]);
    };
    const getMonthData = (monthIndex, year = new Date().getFullYear()) => {
        const key = `${year}-${monthIndex}`;
        if (!calendarMonths[key]) {
            calendarMonths[key] = createCalendarDays(monthIndex, year);
        }
        return calendarMonths[key];
    };
    const buildMonthGrid = (monthIndex, year = new Date().getFullYear()) => {
        const days = getMonthData(monthIndex, year);
        const firstWeekday = new Date(year, monthIndex, 1).getDay();
        const leading = Array(firstWeekday).fill(null);
        const total = leading.length + days.length;
        const trailing = (7 - (total % 7)) % 7;
        return [...leading, ...days, ...Array(trailing).fill(null)];
    };

    const processMatch = window.location.pathname.match(/processojudicial\/(\d+)\/change/);
    const currentProcessId = processMatch ? processMatch[1] : null;

    const collectAgendaEntriesFromInline = () => {
        const entries = [];
        const appendEntry = (entry) => {
            if (!entry) return;
            entries.push(entry);
        };
        document.querySelectorAll('#tarefas-group .dynamic-tarefas').forEach((row, index) => {
            if (row.classList.contains('empty-form')) return;
            const deleteCheckbox = row.querySelector('input[id$="-DELETE"]');
            if (deleteCheckbox?.checked) return;
            const doneCheckbox = row.querySelector('input[id$="-concluida"]');
            if (doneCheckbox && doneCheckbox.checked) return;
            const dateInput = row.querySelector('input[id$="-data"]');
            const descInput = row.querySelector('input[id$="-descricao"]');
            const obsInput = row.querySelector('textarea[id$="-observacoes"]') || row.querySelector('input[id$="-observacoes"]');
            const priorityInput = row.querySelector('select[id$="-prioridade"]') || row.querySelector('input[id$="-prioridade"]');
            const responsavelInput = row.querySelector('select[id$="-responsavel"]') || row.querySelector('input[id$="-responsavel"]');
            const parsedDate = parseDateInputValue(dateInput?.value);
            if (!parsedDate) return;
            const idInput = row.querySelector('input[id$="-id"]');
            const entry = {
                type: 'T',
                id: idInput?.value ? `t-${idInput.value}` : `t-${index + 1}-${parsedDate.day}`,
                backendId: idInput?.value ? Number(idInput.value) : null,
                label: `${index + 1}`,
                description: (descInput?.value || '').trim(),
                detail: (obsInput?.value || '').trim(),
                priority: (priorityInput?.value || '').trim(),
                originalDay: parsedDate.day,
                day: parsedDate.day,
                monthIndex: parsedDate.monthIndex,
                year: parsedDate.year,
                admin_url: currentProcessId ? `/admin/contratos/processojudicial/${currentProcessId}/change/` : '',
                processo_id: currentProcessId ? Number(currentProcessId) : null,
                responsavel: responsavelInput?.value ? { id: Number(responsavelInput.value) } : null,
            };
            hydrateEntryProcessMeta(entry);
            rememberOrigin(entry);
            appendEntry(entry);
        });
        document.querySelectorAll('#prazos-group .dynamic-prazos').forEach((row, index) => {
            if (row.classList.contains('empty-form')) return;
            const deleteCheckbox = row.querySelector('input[id$="-DELETE"]');
            if (deleteCheckbox?.checked) return;
            const doneCheckbox = row.querySelector('input[id$="-concluido"]');
            if (doneCheckbox && doneCheckbox.checked) return;
            const dateInput = row.querySelector('input[id$="-data_limite_0"]') || row.querySelector('input[id$="-data_limite"]');
            const parsedDate = parseDateInputValue(dateInput?.value);
            if (!parsedDate) return;
            const titleInput = row.querySelector('input[id$="-titulo"]');
            const obsInput = row.querySelector('textarea[id$="-observacoes"]') || row.querySelector('input[id$="-observacoes"]');
            const idInput = row.querySelector('input[id$="-id"]');
            const responsavelInput = row.querySelector('select[id$="-responsavel"]') || row.querySelector('input[id$="-responsavel"]');
            const entry = {
                type: 'P',
                id: idInput?.value ? `p-${idInput.value}` : `p-${index + 1}-${parsedDate.day}`,
                backendId: idInput?.value ? Number(idInput.value) : null,
                label: `${index + 1}`,
                description: (titleInput?.value || '').trim(),
                detail: (obsInput?.value || '').trim(),
                originalDay: parsedDate.day,
                day: parsedDate.day,
                monthIndex: parsedDate.monthIndex,
                year: parsedDate.year,
                admin_url: currentProcessId ? `/admin/contratos/processojudicial/${currentProcessId}/change/` : '',
                processo_id: currentProcessId ? Number(currentProcessId) : null,
                responsavel: responsavelInput?.value ? { id: Number(responsavelInput.value) } : null,
            };
            hydrateEntryProcessMeta(entry);
            rememberOrigin(entry);
            appendEntry(entry);
        });
        return entries;
    };

    const dedupeEntries = (entries = []) => {
        const seen = new Set();
        return entries.filter((entry) => {
            const key = entry.id || `${entry.type}-${entry.processo_id || 'x'}-${entry.day}-${entry.monthIndex}-${entry.year}-${entry.label}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };
    const mergeEntriesByBackend = (primary = [], secondary = []) => {
        const map = new Map();
        const add = (entry, prefer = false) => {
            const normalizedType = entry.type === 'P' ? 'p' : entry.type === 'S' ? 's' : 't';
            const key = entry.backendId ? `b-${normalizedType}-${entry.backendId}` : `i-${entry.id}`;
            if (!prefer && map.has(key)) return;
            map.set(key, entry);
        };
        primary.forEach(entry => add(entry, true));
        secondary.forEach(entry => add(entry, false));
        return Array.from(map.values());
    };
    const rebuildAgendaEntriesFromCalendar = () => {
        const rebuilt = [];
        Object.keys(calendarMonths).forEach(key => {
            const days = calendarMonths[key] || [];
            days.forEach(day => {
                const common = { monthIndex: day.monthIndex, year: day.year, day: day.day };
                day.tasksT.forEach(entry => rebuilt.push({ ...entry, ...common, type: 'T' }));
                day.tasksP.forEach(entry => rebuilt.push({ ...entry, ...common, type: 'P' }));
                day.tasksS.forEach(entry => rebuilt.push({ ...entry, ...common, type: 'S' }));
            });
        });
        return rebuilt;
    };
    const persistEntryDate = (entryData, targetDayInfo) => {
        if (!entryData?.backendId || !targetDayInfo) return;
        if (entryData.type === 'S') return;
        const payloadDate = formatDateIso(targetDayInfo.year, targetDayInfo.monthIndex, targetDayInfo.day);
        const isTask = entryData.type === 'T';
        const url = isTask
            ? `/api/agenda/tarefa/${entryData.backendId}/update-date/`
            : `/api/agenda/prazo/${entryData.backendId}/update-date/`;
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrftoken || '',
            },
            body: JSON.stringify({ date: payloadDate }),
        }).catch(() => {});
    };
    const debounce = (fn, delay = 300) => {
        let timer = null;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    };

    const applyEntriesToCalendar = (entries = []) => {
        entries.forEach((entry) => {
            const days = getMonthData(entry.monthIndex, entry.year);
            const dayInfo = days[entry.day - 1];
            if (!dayInfo) return;
            const entryType = entry.type === 'P'
                ? 'P'
                : entry.type === 'S'
                    ? 'S'
                    : 'T';
            entry.type = entryType;
            const targetList = dayInfo[getTypeKey(entryType)];
            targetList.push(entry);
            normalizeEntryMetadata(dayInfo, entry.type);
        });
    };

    const hydrateAgendaFromInlineData = () => {
        const entries = collectAgendaEntriesFromInline();
        applyEntriesToCalendar(entries);
        return entries;
    };

    const normalizeApiEntry = (item) => {
        if (!item) return null;
        const type = item.type === 'P'
            ? 'P'
            : item.type === 'S'
                ? 'S'
                : 'T';
        const parsed = parseDateInputValue(item.date || item.data_limite || item.data);
        if (!parsed) return null;
        const originalRaw = item.original_date || item.data_origem || item.data_limite_origem;
        const originalParsed = parseDateInputValue(originalRaw);
        const originalDate = originalParsed
            ? formatDateIso(originalParsed.year, originalParsed.monthIndex, originalParsed.day)
            : formatDateIso(parsed.year, parsed.monthIndex, parsed.day);
        const parteInfo = item.parte || item.parte_info || item.parteInfo || item.cadastro || item.cliente || null;
        const parteNome = item.nome
            || item.parte_nome
            || item.name
            || item.cadastro_nome
            || item.cliente_nome
            || item.nome_cadastro
            || parteInfo?.nome
            || parteInfo?.name
            || '';
        const parteCpf = item.cpf
            || item.parte_cpf
            || item.documento
            || item.cadastro_cpf
            || item.cliente_cpf
            || item.cpf_cadastro
            || parteInfo?.cpf
            || parteInfo?.documento
            || '';
        const entry = {
            type,
            id: `${type.toLowerCase()}-${item.id || `${parsed.day}`}`,
            backendId: item.id || null,
            label: item.label || (
                type === 'S'
                        ? 'S'
                        : (item.id ? `${item.id}` : `${parsed.day}`)
                ),
            nome: parteNome,
            parte_nome: parteNome,
            cpf: parteCpf,
            parte_cpf: parteCpf,
            documento: parteCpf || item.documento || '',
                description: item.description
                    || item.descricao
                    || item.title
                || item.titulo
                || '',
            detail: item.detail || item.observacoes || '',
            priority: type === 'T' ? (item.prioridade || '') : '',
            originalDay: originalParsed ? originalParsed.day : parsed.day,
            originalDate,
            day: parsed.day,
            monthIndex: parsed.monthIndex,
            year: parsed.year,
            admin_url: item.admin_url || '',
            processo_id: item.processo_id,
            responsavel: item.responsavel || null,
            contract_numbers: Array.isArray(item.contract_numbers)
                ? item.contract_numbers.filter(Boolean)
                : [],
            valor_causa: item.valor_causa ?? null,
            status_label: item.status_label || '',
            viabilidade: item.viabilidade || '',
            viabilidade_label: item.viabilidade_label || '',
            analysis_lines: Array.isArray(item.analysis_lines)
                ? item.analysis_lines.filter(line => line !== null && line !== undefined && line !== '')
                : [],
            prescricao_date: item.prescricao_date || null,
            expired: Boolean(item.expired),
            active: Boolean(item.active),
            barrado: item.barrado && typeof item.barrado === 'object'
                ? {
                    ativo: Boolean(item.barrado.ativo),
                    inicio: item.barrado.inicio || null,
                    retorno_em: item.barrado.retorno_em || null,
                }
                : { ativo: false, inicio: null, retorno_em: null },
            cnj_label: item.cnj_label || item.cnj || '',
            analise_id: item.analise_id || item.analiseId || null,
            card_source: item.card_source || item.cardSource || '',
            card_index: typeof item.card_index !== 'undefined'
                ? item.card_index
                : (typeof item.cardIndex !== 'undefined' ? item.cardIndex : null),
            supervisor_status: item.supervisor_status || item.supervisorStatus || '',
        };
        hydrateEntryProcessMeta(entry);
        const hasApiOrigin = Boolean(originalRaw);
        if (hasApiOrigin) {
            const key = getOriginKey(entry);
            if (key) {
                entryOrigins.set(key, originalDate);
            }
        } else {
            applyOriginFromMap(entry);
        }
        rememberOrigin(entry);
        return entry;
    };

    const hydrateAgendaFromApi = (inlineEntries = [], calendarStateRef = null, renderFn = null, setEntriesRef = null, preferApiOnly = false) => {
        const statusParam = calendarStateRef?.showCompleted ? 'completed' : 'pending';
        const url = `/api/agenda/geral/?status=${statusParam}`;
        fetch(url)
            .then((response) => {
                if (!response.ok) throw new Error();
                return response.json();
            })
            .then((data) => {
                const apiEntries = Array.isArray(data) ? data.map(normalizeApiEntry).filter(Boolean) : [];
                if (preferApiOnly) {
                    entryOrigins.clear();
                }
                const combined = preferApiOnly ? apiEntries : mergeEntriesByBackend(apiEntries, inlineEntries);
                resetCalendarMonths();
                if (setEntriesRef) {
                    setEntriesRef(combined);
                }
                restoreActiveEntryReference(combined);
                let filtered = combined;
                const activeUserId = calendarStateRef?.activeUser?.id;
                if (activeUserId) {
                    filtered = filtered.filter(entry => shouldIncludeEntryForActiveUser(entry, activeUserId));
                }
                if (calendarStateRef?.focused && currentProcessId) {
                    filtered = combined.filter(entry => `${entry.processo_id || ''}` === `${currentProcessId}`);
                }
                applyEntriesToCalendar(filtered);
                if (calendarStateRef && filtered.length) {
                    const first = filtered
                        .slice()
                        .sort((a, b) => new Date(a.year, a.monthIndex, a.day) - new Date(b.year, b.monthIndex, b.day))[0];
                    if (first) {
                        calendarStateRef.monthIndex = first.monthIndex;
                        calendarStateRef.year = first.year;
                    }
                }
                renderFn && renderFn();
            })
            .catch(() => {
                resetCalendarMonths();
                let filtered = inlineEntries;
                if (calendarStateRef?.focused && currentProcessId) {
                    filtered = inlineEntries.filter(entry => `${entry.processo_id || ''}` === `${currentProcessId}`);
                }
                applyEntriesToCalendar(filtered);
                renderFn && renderFn();
            });
    };

    const populateDetailEntries = (dayData, type, detailList, detailCardBody, setDetailTitle, isCompletedMode = false, onEntrySelect = null) => {
        setDetailTitle?.(dayData?.day, type);
        if (typeof onEntrySelect === 'function') {
            onEntrySelect(null, null);
        }
        const navWrap = detailList?.__navWrap;
        const navPrev = detailList?.__navPrev;
        const navNext = detailList?.__navNext;
        const entries = type === 'T'
            ? dayData.tasksT
            : type === 'P'
                ? dayData.tasksP
                : dayData.tasksS;
        if (navWrap) {
            navWrap.style.display = 'none';
        }
        if (!entries.length) {
            detailList.innerHTML = '<p class="agenda-panel__details-empty">Nenhuma atividade registrada.</p>';
            detailCardBody.textContent = 'Selecione um item para visualizar mais informações.';
            return;
        }
        detailList.innerHTML = '';
        const entryElements = [];
        let activeIndex = -1;
        const setActiveDetailItem = (target, index) => {
            activeIndex = index;
            entryElements.forEach((item) => item.classList.remove('agenda-panel__details-item--active'));
            target?.classList.add('agenda-panel__details-item--active');
            if (navPrev && navNext) {
                navPrev.disabled = activeIndex <= 0;
                navNext.disabled = activeIndex >= entryElements.length - 1;
            }
        };
        const selectEntryAt = (index) => {
            const target = entryElements[index];
            if (!target) return;
            target.click();
            target.scrollIntoView({ block: 'nearest' });
        };
        entries.forEach(entryData => {
            const entry = document.createElement('div');
            entry.className = 'agenda-panel__details-item';
            entry.tabIndex = 0;
            if (type === 'T' || type === 'P') {
                entry.classList.add('agenda-panel__details-item--task');
            }
            const priorityCode = (entryData.priority || '').toUpperCase();
            const priorityClass = priorityCode === 'A'
                ? 'agenda-panel__details-item--priority-high'
                : priorityCode === 'M'
                    ? 'agenda-panel__details-item--priority-medium'
                    : priorityCode === 'B'
                        ? 'agenda-panel__details-item--priority-low'
                        : '';
            if (priorityClass) {
                entry.classList.add(priorityClass);
            }
            const label = document.createElement('span');
            label.className = 'agenda-panel__details-item-label';
            const isSupervision = type === 'S';
            if (isSupervision) {
                const viabilityText = entryData.viabilidade_label || 'Viabilidade';
                label.textContent = viabilityText;
                label.classList.add('agenda-panel__details-item-label--viabilidade');
                const normalized = (entryData.viabilidade || '').toLowerCase();
                if (normalized) {
                    label.classList.add(`agenda-panel__details-item-label--${normalized}`);
                }
            } else {
                label.textContent = entryData.label;
                entry.appendChild(label);
            }
            console.log('entryData S', entryData.id, entryData.nome, entryData.cpf);
            const titleRow = buildEntryTitleRow(entryData);
            if (titleRow) {
                entry.appendChild(titleRow);
            }
            let footer = null;
            if (type !== 'S') {
                const text = document.createElement('span');
                text.className = 'agenda-panel__details-item-text';
                text.textContent = entryData.description || entryData.detail || entryData.label || '';
                entry.appendChild(text);
            } else {
                entry.classList.add('agenda-panel__details-item--supervision');
                const meta = document.createElement('div');
                meta.className = 'agenda-panel__details-item-meta';
                const renderMetaRow = (labelText, valueText) => {
                    if (!valueText) return;
                    const row = document.createElement('div');
                    row.className = 'agenda-panel__details-item-meta-row';
                    const labelEl = document.createElement('span');
                    labelEl.className = 'agenda-panel__details-item-meta-label';
                    labelEl.textContent = `${labelText}:`;
                    const valueEl = document.createElement('span');
                    valueEl.className = 'agenda-panel__details-item-meta-value';
                    valueEl.textContent = valueText;
                    row.append(labelEl, valueEl);
                    meta.appendChild(row);
                };
                if (entryData.contract_numbers && entryData.contract_numbers.length) {
                    renderMetaRow('Contratos', entryData.contract_numbers.join(', '));
                }
                renderMetaRow('Saldo atualizado', formatCurrencyBrl(entryData.valor_causa));
                const custasSummary = getCustasFromContracts(entryData.contract_numbers);
                if (custasSummary.items.length) {
                    renderMetaRow('Custas', formatCurrencyBrl(custasSummary.total));
                }
                renderMetaRow('Prescrição', formatDateLabel(entryData.prescricao_date));
                if (entryData.status_label) {
                    renderMetaRow('Status', entryData.status_label);
                }
                if (meta.children.length) {
                    entry.appendChild(meta);
                }
                if (entryData.expired) {
                    entry.classList.add('agenda-panel__details-item--supervision-expired');
                }
                footer = document.createElement('div');
                footer.className = 'agenda-panel__details-item-footer';
                const footerGroup = document.createElement('div');
                footerGroup.className = 'agenda-panel__details-item-footer-group';
                const actions = document.createElement('div');
                actions.className = 'agenda-panel__details-item-actions';
                const checagemButton = document.createElement('button');
                checagemButton.type = 'button';
                checagemButton.className = 'agenda-checagem-trigger';
                checagemButton.innerHTML = `<span class="agenda-checagem-trigger__icon">
                        <img src="${AGENDA_CHECAGEM_LOGO}" alt="Checagem de Sistemas">
                    </span>`;
                checagemButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    openAgendaChecagemFromEntry(entryData, checagemButton);
                });
                actions.appendChild(checagemButton);
                footerGroup.appendChild(actions);
                footerGroup.appendChild(label);
                footer.appendChild(footerGroup);
                entry.appendChild(footer);
            }
            const currentDate = formatDateIso(dayData.year, dayData.monthIndex, dayData.day);
            if (entryData.originalDate) {
                const original = document.createElement('span');
                original.className = type === 'S'
                    ? 'agenda-panel__details-item-origin'
                    : 'agenda-panel__details-original';
                original.textContent = `Origem: ${formatDateLabel(entryData.originalDate)}`;
                if (footer) {
                    footer.appendChild(original);
                } else {
                    entry.appendChild(original);
                }
            }
            entry.addEventListener('click', () => {
                const index = entryElements.indexOf(entry);
                if (index !== -1) {
                    setActiveDetailItem(entry, index);
                }
                const detail = entryData.detail || entryData.observacoes || entryData.description;
                detailCardBody.innerHTML = '';
                if (type === 'S') {
                    if (detail) {
                        const paragraph = document.createElement('p');
                        paragraph.textContent = detail;
                        detailCardBody.appendChild(paragraph);
                    }
                    if (entryData.analysis_lines && entryData.analysis_lines.length) {
                        const list = document.createElement('ul');
                        list.className = 'agenda-panel__details-card-list';
                        entryData.analysis_lines.forEach(line => {
                            if (!line) return;
                            const item = document.createElement('li');
                            item.textContent = line;
                            list.appendChild(item);
                        });
                    detailCardBody.appendChild(list);
                }
                if (!detailCardBody.textContent.trim()) {
                    detailCardBody.textContent = 'Sem observações adicionais.';
                }
            } else {
                detailCardBody.textContent = detail || 'Sem observações adicionais.';
            }
            if (typeof onEntrySelect === 'function') {
                onEntrySelect(entryData, type, entry);
            }
            });
            entry.addEventListener('dblclick', () => {
                const url = entryData.admin_url || entryData.url;
                if (url) {
                    window.open(url, '_blank');
                }
            });
            entry.dataset.type = type;
            entry.dataset.entryId = entryData.id;
            entry.dataset.day = dayData.day;
            entryElements.push(entry);
            const canDragDetailEntry = !isCompletedMode && !(type === 'S' && entryData.expired);
            entry.draggable = Boolean(canDragDetailEntry);
            if (canDragDetailEntry) {
                entry.addEventListener('dragstart', (event) => {
                    event.dataTransfer.setData('text/plain', JSON.stringify({
                        source: 'detail',
                        type,
                        day: dayData.day,
                        monthIndex: dayData.monthIndex,
                        year: dayData.year,
                        entry: {
                            id: entryData.id,
                            backendId: entryData.backendId,
                            type,
                        },
                    }));
                    event.dataTransfer.effectAllowed = 'move';
                });
            }
            detailList.appendChild(entry);
        });
        const enableNav = (type === 'T' || type === 'P') && entryElements.length > 1;
        if (navWrap) {
            navWrap.style.display = enableNav ? 'inline-flex' : 'none';
        }
        if (navPrev && navNext) {
            navPrev.onclick = enableNav
                ? () => selectEntryAt(Math.max(0, activeIndex - 1))
                : null;
            navNext.onclick = enableNav
                ? () => selectEntryAt(Math.min(entryElements.length - 1, activeIndex + 1))
                : null;
            navPrev.disabled = !enableNav;
            navNext.disabled = !enableNav;
        }
        if (enableNav && entryElements.length) {
            selectEntryAt(0);
        }
    };

    const renderCalendarDays = (gridElement, detailList, detailCardBody, state, rerender, setDetailTitle, onEntrySelect = null) => {
        if (!gridElement || !detailList || !detailCardBody) {
            return;
        }
        const todayFallback = new Date();
        const effectiveState = state || { mode: 'monthly', weekOffset: 0, monthIndex: todayFallback.getMonth(), year: todayFallback.getFullYear() };
        const isCompletedMode = Boolean(state?.showCompleted);
        const resetDetailCardBody = () => {
            detailCardBody.innerHTML = '';
            detailCardBody.textContent = 'Selecione um item para visualizar mais informações.';
            if (typeof onEntrySelect === 'function') {
                onEntrySelect(null, null);
            }
        };
        gridElement.innerHTML = '';
        detailList.innerHTML = '<p class="agenda-panel__details-empty">Clique em T, P ou S para ver as tarefas, prazos e supervisões.</p>';
        resetDetailCardBody();
        setDetailTitle?.(null, null);
        gridElement.classList.toggle('agenda-panel__calendar-grid--weekly', effectiveState.mode === 'weekly');
        let activeDayCell = null;
        const recordActiveDay = (dayInfo, type) => {
            if (!state) return;
            state.activeDay = { day: dayInfo.day, monthIndex: dayInfo.monthIndex, year: dayInfo.year };
            state.activeType = type || state.activeType || null;
        };
        const setActiveDay = (cell) => {
            if (activeDayCell) {
                activeDayCell.classList.remove('agenda-panel__day--active');
            }
            activeDayCell = cell;
            if (activeDayCell) {
                activeDayCell.classList.add('agenda-panel__day--active');
            }
        };
        WEEKDAYS.forEach(weekday => {
            const label = document.createElement('div');
            label.className = 'agenda-panel__weekday';
            label.textContent = weekday;
            gridElement.appendChild(label);
        });
        const calendarGrid = buildMonthGrid(effectiveState.monthIndex, effectiveState.year || new Date().getFullYear());
        const baseDays = effectiveState.mode === 'weekly'
            ? calendarGrid.slice(effectiveState.weekOffset, effectiveState.weekOffset + 7)
            : calendarGrid;
        const filler = effectiveState.mode === 'weekly'
            ? Math.max(0, 7 - baseDays.length)
            : 0;
        const daysToRender = effectiveState.mode === 'weekly'
            ? [...baseDays, ...Array(filler).fill(null)]
            : baseDays;
        const showHistory = effectiveState.showHistory;
        daysToRender.forEach((dayInfo) => {
            const dayCell = document.createElement('div');
            dayCell.className = 'agenda-panel__day';
            if (effectiveState.mode === 'weekly') {
                dayCell.classList.add('agenda-panel__day--weekly');
            }
            if (!dayInfo) {
                const placeholder = document.createElement('div');
                placeholder.className = 'agenda-panel__day-number';
                placeholder.innerHTML = '&nbsp;';
                dayCell.appendChild(placeholder);
                dayCell.classList.add('agenda-panel__day--placeholder');
                gridElement.appendChild(dayCell);
                return;
            }
            const number = document.createElement('div');
            number.className = 'agenda-panel__day-number';
            number.textContent = dayInfo.day;
            const tagsWrapper = document.createElement('div');
            tagsWrapper.className = 'agenda-panel__day-tags';
            const cardsWrapper = document.createElement('div');
            cardsWrapper.className = 'agenda-panel__day-cards';
            const currentDate = formatDateIso(dayInfo.year, dayInfo.monthIndex, dayInfo.day);
            const hasHistory = [...dayInfo.tasksT, ...dayInfo.tasksP, ...dayInfo.tasksS]
                .some(entry => entry.originalDate && entry.originalDate !== currentDate);
            if (showHistory && hasHistory) {
                dayCell.classList.add('agenda-panel__day--history');
            } else {
                dayCell.classList.remove('agenda-panel__day--history');
            }
            const renderTag = (type, entries) => {
                if (!entries.length) {
                    return;
                }
                const tag = document.createElement('span');
                tag.className = 'agenda-panel__day-tag';
                tag.dataset.type = type;
                const draggableEntries = entries.filter(entry => !(type === 'S' && entry.expired));
                tag.draggable = !isCompletedMode && Boolean(draggableEntries.length);
                const label = document.createElement('span');
                label.className = 'agenda-panel__day-tag-letter';
                label.textContent = type;
                const count = document.createElement('span');
                count.className = 'agenda-panel__day-tag-count';
                count.textContent = entries.length;
                tag.appendChild(label);
                tag.appendChild(count);
                tag.addEventListener('click', (event) => {
                    event.stopPropagation();
                    resetDetailCardBody();
                    populateDetailEntries(dayInfo, type, detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                    recordActiveDay(dayInfo, type);
                    setActiveDay(dayCell);
                });
                if (!isCompletedMode && draggableEntries.length) {
                    tag.addEventListener('dragstart', (event) => {
                        const listKey = getTypeKey(type);
                        const payloadEntries = draggableEntries.map(entry => {
                            entry.type = entry.type || type;
                            return {
                                id: entry.id,
                                backendId: entry.backendId,
                                type: entry.type,
                                prescricao_date: entry.prescricao_date || null,
                                day: entry.day,
                                monthIndex: entry.monthIndex,
                                year: entry.year,
                            };
                        });
                        const payload = {
                            source: 'calendar',
                            day: dayInfo.day,
                            monthIndex: dayInfo.monthIndex,
                            year: dayInfo.year,
                            type,
                            entries: payloadEntries,
                        };
                        const clone = tag.cloneNode(true);
                        clone.style.position = 'absolute';
                        clone.style.top = '-999px';
                        document.body.appendChild(clone);
                        const rect = clone.getBoundingClientRect();
                        event.dataTransfer.setDragImage(clone, rect.width / 2, rect.height / 2);
                        event.dataTransfer.setData('text/plain', JSON.stringify(payload));
                        event.dataTransfer.effectAllowed = 'move';
                        setTimeout(() => document.body.removeChild(clone), 0);
                    });
                }
                tagsWrapper.appendChild(tag);
            };
            renderTag('T', dayInfo.tasksT);
            renderTag('P', dayInfo.tasksP);
            renderTag('S', dayInfo.tasksS);
            const shortenName = (value, maxWords = 2) => {
                if (!value) return '';
                const parts = String(value).trim().split(/\s+/).filter(Boolean);
                if (!parts.length) return '';
                return parts.slice(0, maxWords).join(' ');
            };
            const getEntryNameCpf = (entry, shortName = false) => {
                hydrateEntryProcessMeta(entry);
                const cardMeta = entry?.processo_id ? getParteInfoFromCard(entry.processo_id) : {};
                const rawName = entry?.nome || entry?.name || entry?.parte_nome || cardMeta.name || '';
                const name = shortName ? shortenName(rawName, 2) : rawName;
                const cpfCandidates = [
                    entry?.cpf,
                    entry?.parte_cpf,
                    entry?.documento,
                    entry?.cpf_falecido,
                    entry?.cpf_representante,
                    cardMeta.cpf,
                ];
                const cpfRaw = cpfCandidates.find(Boolean) || '';
                const digits = String(cpfRaw || '').replace(/\D/g, '');
                const formattedCpf = digits.length === 11
                    ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
                    : '';
                if (!name && !formattedCpf) return '';
                const suffix = formattedCpf ? `CPF ${formattedCpf}` : '';
                return [name, suffix].filter(Boolean).join(' · ').trim();
            };
            const getEntryTaskTitle = (entry) => {
                const candidates = [
                    entry?.description,
                    entry?.detail,
                    entry?.title,
                    entry?.titulo,
                    entry?.label,
                    entry?.cnj_label,
                ];
                const text = candidates.find(value => (value || '').trim());
                return text ? String(text).trim() : '';
            };
            const buildEntryCardLabel = (entry, type, shortName = false) => {
                if (type === 'T' || type === 'P') {
                    return getEntryNameCpf(entry, shortName) || getEntryTaskTitle(entry) || 'Item';
                }
                const candidates = [
                    entry?.description,
                    entry?.detail,
                    entry?.nome,
                    entry?.parte_nome,
                    entry?.cnj_label,
                    entry?.label,
                ];
                const text = candidates.find(value => (value || '').trim());
                return text ? String(text).trim() : 'Item';
            };
            const renderDayCards = () => {
                const allEntries = [
                    ...dayInfo.tasksT.map(entry => ({ entry, type: 'T' })),
                    ...dayInfo.tasksP.map(entry => ({ entry, type: 'P' })),
                    ...dayInfo.tasksS.map(entry => ({ entry, type: 'S' })),
                ];
                if (!allEntries.length) {
                    return;
                }
                const maxCards = effectiveState.mode === 'weekly' ? 5 : 3;
                const visibleEntries = allEntries.slice(0, maxCards);
                visibleEntries.forEach(({ entry, type }) => {
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = `agenda-panel__day-card agenda-panel__day-card--${type.toLowerCase()}`;
                    if (type === 'S' && entry.expired) {
                        card.classList.add('agenda-panel__day-card--expired');
                    }
                    const priorityCode = (entry?.priority || '').toUpperCase();
                    if (priorityCode === 'A') {
                        card.classList.add('agenda-panel__day-card--priority-high');
                    } else if (priorityCode === 'M') {
                        card.classList.add('agenda-panel__day-card--priority-medium');
                    } else if (priorityCode === 'B') {
                        card.classList.add('agenda-panel__day-card--priority-low');
                    }
                    const typeEl = document.createElement('span');
                    typeEl.className = 'agenda-panel__day-card-type';
                    typeEl.textContent = type;
                    const textEl = document.createElement('span');
                    textEl.className = 'agenda-panel__day-card-text';
                    const labelText = buildEntryCardLabel(entry, type, true);
                    if (type === 'T' || type === 'P') {
                        const taskTitle = getEntryTaskTitle(entry);
                        const nameCpf = getEntryNameCpf(entry, true);
                        const titleLine = taskTitle || labelText;
                        const metaLine = nameCpf && nameCpf !== titleLine ? nameCpf : '';
                        textEl.classList.add('agenda-panel__day-card-text--stacked');
                        if (titleLine) {
                            const primary = document.createElement('span');
                            primary.className = 'agenda-panel__day-card-text-primary';
                            primary.textContent = titleLine;
                            textEl.appendChild(primary);
                        }
                        if (metaLine) {
                            const secondary = document.createElement('span');
                            secondary.className = 'agenda-panel__day-card-text-secondary';
                            secondary.textContent = metaLine;
                            textEl.appendChild(secondary);
                        }
                        card.title = [titleLine, metaLine].filter(Boolean).join(' · ');
                    } else {
                        textEl.textContent = labelText;
                        card.title = labelText;
                    }
                    card.append(typeEl, textEl);
                    card.addEventListener('click', (event) => {
                        event.stopPropagation();
                        resetDetailCardBody();
                        populateDetailEntries(dayInfo, type, detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                        recordActiveDay(dayInfo, type);
                        setActiveDay(dayCell);
                        const detailEntry = detailList.querySelector(`[data-entry-id="${entry.id}"]`);
                        if (detailEntry) {
                            detailEntry.click();
                            detailEntry.scrollIntoView({ block: 'nearest' });
                        }
                    });
                    cardsWrapper.appendChild(card);
                });
                const overflow = allEntries.length - visibleEntries.length;
                if (overflow > 0) {
                    const moreCard = document.createElement('button');
                    moreCard.type = 'button';
                    moreCard.className = 'agenda-panel__day-card agenda-panel__day-card--more';
                    moreCard.textContent = `+${overflow}`;
                    moreCard.addEventListener('click', (event) => {
                        event.stopPropagation();
                        dayCell.click();
                    });
                    cardsWrapper.appendChild(moreCard);
                }
            };
            renderDayCards();
            dayCell.append(number, tagsWrapper, cardsWrapper);
            dayCell.addEventListener('click', () => {
                resetDetailCardBody();
                if (dayInfo.tasksS.length) {
                    populateDetailEntries(dayInfo, 'S', detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                    recordActiveDay(dayInfo, 'S');
                } else if (dayInfo.tasksT.length) {
                    populateDetailEntries(dayInfo, 'T', detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                    recordActiveDay(dayInfo, 'T');
                } else if (dayInfo.tasksP.length) {
                    populateDetailEntries(dayInfo, 'P', detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                    recordActiveDay(dayInfo, 'P');
                } else {
                    detailList.innerHTML = '<p class="agenda-panel__details-empty">Nenhuma atividade registrada.</p>';
                    detailCardBody.textContent = 'Selecione um item para visualizar mais informações.';
                    setDetailTitle?.(dayInfo.day, null);
                    recordActiveDay(dayInfo, null);
                }
                setActiveDay(dayCell);
            });
            const isActiveDay =
                state?.activeDay &&
                state.activeDay.day === dayInfo.day &&
                state.activeDay.monthIndex === dayInfo.monthIndex &&
                state.activeDay.year === dayInfo.year;
            const setupDropZone = () => {
                if (isCompletedMode) {
                    return;
                }
                const handleDrop = (event) => {
                    event.preventDefault();
                    dayCell.classList.remove('agenda-panel__day--drag-over');
                    const payload = event.dataTransfer.getData('text/plain');
                    if (!payload) return;
                    let parsed;
                    try {
                        parsed = JSON.parse(payload);
                    } catch {
                        return;
                    }
                    if (!parsed || parsed.day === dayInfo.day) return;
                    const typeKey = getTypeKey(parsed.type);
                    const sourceMonth = getMonthData(parsed.monthIndex ?? effectiveState.monthIndex, parsed.year || effectiveState.year || new Date().getFullYear());
                    const sourceDay = sourceMonth.find(d => d.day === parsed.day);
                    if (!sourceDay) {
                        return;
                    }
                    if (parsed.source === 'detail') {
                        if (!isSupervisionDropAllowedForEntry(parsed.entry, dayInfo)) {
                            showSupervisionLimitViolation(parsed.entry);
                            return;
                        }
                        const sourceList = sourceDay[typeKey];
                        const entryIndex = sourceList.findIndex(entry => entry.id === parsed.entry?.id);
                        if (entryIndex === -1) return;
                        const [movedEntry] = sourceList.splice(entryIndex, 1);
                        dayInfo[typeKey].push(movedEntry);
                        normalizeEntryMetadata(sourceDay, parsed.type);
                        normalizeEntryMetadata(dayInfo, parsed.type);
                        persistEntryDate(movedEntry, dayInfo);
                        moveAgendaEntries([movedEntry], dayInfo);
                    } else if (parsed.source === 'calendar') {
                        const entriesPayload = Array.isArray(parsed.entries) ? parsed.entries.filter(Boolean) : [];
                        if (!entriesPayload.length) return;
                        const blocked = entriesPayload.find(entry => !isSupervisionDropAllowedForEntry(entry, dayInfo));
                        if (blocked) {
                            showSupervisionLimitViolation(blocked);
                            return;
                        }
                        const movedEntries = [];
                        const validPayload = [];
                        entriesPayload.forEach(payloadEntry => {
                            const index = sourceDay[typeKey].findIndex(entry => entry.id === payloadEntry.id);
                            if (index === -1) return;
                            const [removed] = sourceDay[typeKey].splice(index, 1);
                            movedEntries.push(removed);
                            validPayload.push(payloadEntry);
                        });
                        if (!movedEntries.length) return;
                        dayInfo[typeKey].push(...movedEntries);
                        normalizeEntryMetadata(sourceDay, parsed.type);
                        normalizeEntryMetadata(dayInfo, parsed.type);
                        validPayload.forEach(entry => persistEntryDate(entry, dayInfo));
                        moveAgendaEntries(validPayload, dayInfo);
                    }
                    agendaEntries = dedupeEntries(rebuildAgendaEntriesFromCalendar());
                    if (state) {
                        state.activeDay = { day: dayInfo.day, monthIndex: dayInfo.monthIndex, year: dayInfo.year };
                        state.activeType = parsed.type;
                    }
                    rerender && rerender();
                };
                dayCell.addEventListener('dragover', (event) => {
                    event.preventDefault();
                    dayCell.classList.add('agenda-panel__day--drag-over');
                });
                dayCell.addEventListener('dragleave', () => {
                    dayCell.classList.remove('agenda-panel__day--drag-over');
                });
                dayCell.addEventListener('drop', handleDrop);
            };
            setupDropZone();
            dayCell.appendChild(number);
            dayCell.appendChild(tagsWrapper);
            gridElement.appendChild(dayCell);
            if (isActiveDay) {
                setActiveDay(dayCell);
                const preferredType = state.activeType;
                if (preferredType === 'S' && dayInfo.tasksS.length) {
                    populateDetailEntries(dayInfo, 'S', detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                } else if (preferredType === 'T' && dayInfo.tasksT.length) {
                    populateDetailEntries(dayInfo, 'T', detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                } else if (preferredType === 'P' && dayInfo.tasksP.length) {
                    populateDetailEntries(dayInfo, 'P', detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                } else if (dayInfo.tasksS.length) {
                    populateDetailEntries(dayInfo, 'S', detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                    recordActiveDay(dayInfo, 'S');
                } else if (dayInfo.tasksT.length) {
                    populateDetailEntries(dayInfo, 'T', detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                    recordActiveDay(dayInfo, 'T');
                } else if (dayInfo.tasksP.length) {
                    populateDetailEntries(dayInfo, 'P', detailList, detailCardBody, setDetailTitle, isCompletedMode, onEntrySelect);
                    recordActiveDay(dayInfo, 'P');
                }
            }
        });
    };

    const createAgendaPanel = () => {
        if (document.querySelector('.agenda-panel-overlay')) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'agenda-panel-overlay';
        overlay.innerHTML = `
            <div class="agenda-panel">
                <div class="agenda-panel__header">
                    <div>
                        <span class="agenda-panel__badge">Agenda Geral</span>
                        <p class="agenda-panel__subtitle">Expandida para duas telas ou modal.</p>
                    </div>
                    <div class="agenda-panel__header-actions">
                        <span class="agenda-panel__year-label" aria-live="polite"></span>
                        <button type="button" class="agenda-panel__refresh-btn" aria-label="Atualizar agenda">↻</button>
                        <button type="button" class="agenda-panel__close" aria-label="Fechar agenda">×</button>
                    </div>
                </div>
                <div class="agenda-panel__controls">
                    <div class="agenda-panel__controls-left">
                        <button type="button" class="agenda-panel__cycle-btn" data-months="1">1 Calendário</button>
                        <button type="button" class="agenda-panel__cycle-mode" data-mode="monthly">Mensal</button>
                        <button type="button" class="agenda-panel__users-toggle" data-view="users" aria-pressed="false">Usuários</button>
                    </div>
                    <div class="agenda-panel__controls-right">
                        <div class="agenda-panel__month-heading">
                            <strong class="agenda-panel__month-title">Janeiro 2025</strong>
                        </div>
                        <div class="agenda-panel__month-switches">
                            <button type="button">Jan</button>
                            <button type="button">Fev</button>
                            <button type="button">Mar</button>
                            <button type="button">Abr</button>
                            <button type="button">Mai</button>
                            <button type="button">Jun</button>
                            <button type="button">Jul</button>
                            <button type="button">Ago</button>
                            <button type="button">Set</button>
                            <button type="button">Out</button>
                            <button type="button">Nov</button>
                            <button type="button">Dez</button>
                        </div>
                    </div>
                </div>
                <div class="agenda-panel__body">
                    <div class="agenda-panel__calendar-wrapper">
                        <div class="agenda-panel__calendar-inner">
                            <div class="agenda-panel__calendar-grid-wrapper">
                                <button type="button" class="agenda-panel__calendar-nav agenda-panel__calendar-nav--prev" data-direction="prev" aria-label="Voltar">
                                    ‹
                                </button>
                                <div class="agenda-panel__calendar-grid" data-calendar-placeholder></div>
                                <button type="button" class="agenda-panel__calendar-nav agenda-panel__calendar-nav--next" data-direction="next" aria-label="Avançar">
                                    ›
                                </button>
                            </div>
                            <div class="agenda-panel__details">
                                <div class="agenda-panel__details-list">
                                    <p class="agenda-panel__details-title">Eventos do dia</p>
                                    <div class="agenda-panel__details-list-inner">
                                        <p class="agenda-panel__details-empty">Clique em T, P ou S para ver as tarefas, prazos e supervisões.</p>
                                    </div>
                                </div>
                                <div class="agenda-panel__details-card">
                                    <div class="agenda-panel__details-card-header">
                                        <p class="agenda-panel__details-card-title">Descrição detalhada</p>
                                        <button type="button" class="agenda-panel__details-card-status-btn" style="display:none;">Status: Pendente</button>
                                    </div>
                                    <div class="agenda-panel__details-card-body" data-agenda-detail-scroll>Selecione um item para visualizar mais informações.</div>
                                    <div class="agenda-panel__details-card-footer">
                                        <div class="agenda-panel__details-card-footer-row">
                                            <div class="agenda-panel__details-card-barrar">
                                                <button type="button" class="agenda-panel__details-card-barrar-btn">Barrar</button>
                                                <input type="date" class="agenda-panel__details-card-barrar-date">
                                            </div>
                                            <span class="agenda-panel__details-card-barrado-note"></span>
                                        </div>
                                        <div class="agenda-panel__details-card-analyst">
                                            <span class="agenda-panel__details-card-analyst-text"></span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="agenda-panel__footer">
                    <button type="button" class="agenda-panel__form-btn" data-form="tarefas">Tarefas</button>
                    <button type="button" class="agenda-panel__form-btn" data-form="prazos">Prazos</button>
                    <button type="button" class="agenda-panel__split" aria-pressed="false">Abrir em tela cheia</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.body.classList.add('agenda-panel-open');
        const closeButton = overlay.querySelector('.agenda-panel__close');
        const refreshButton = overlay.querySelector('.agenda-panel__refresh-btn');
        const cycleBtn = overlay.querySelector('.agenda-panel__cycle-btn');
        const modeButton = overlay.querySelector('.agenda-panel__cycle-mode');
        const prevNavBtn = overlay.querySelector('[data-direction="prev"]');
        const nextNavBtn = overlay.querySelector('[data-direction="next"]');
        const monthTitleEl = overlay.querySelector('.agenda-panel__month-title');
        const monthYearEl = overlay.querySelector('.agenda-panel__year-label');
        const detailList = overlay.querySelector('.agenda-panel__details-list-inner');
        const fullscreenButton = overlay.querySelector('.agenda-panel__split');
        const detailCardBody = overlay.querySelector('.agenda-panel__details-card-body');
        const detailTitleWrapper = overlay.querySelector('.agenda-panel__details-title');
        const detailTitleText = document.createElement('span');
        detailTitleText.className = 'agenda-panel__details-title-text';
        const detailTitleType = document.createElement('span');
        detailTitleType.className = 'agenda-panel__details-type';
        const detailNav = document.createElement('div');
        detailNav.className = 'agenda-panel__details-nav';
        const detailNavPrev = document.createElement('button');
        detailNavPrev.type = 'button';
        detailNavPrev.className = 'agenda-panel__details-nav-btn';
        detailNavPrev.textContent = '‹';
        detailNavPrev.setAttribute('aria-label', 'Anterior');
        const detailNavNext = document.createElement('button');
        detailNavNext.type = 'button';
        detailNavNext.className = 'agenda-panel__details-nav-btn';
        detailNavNext.textContent = '›';
        detailNavNext.setAttribute('aria-label', 'Próximo');
        detailNav.append(detailNavPrev, detailNavNext);
        detailTitleWrapper.textContent = '';
        detailTitleWrapper.append(detailTitleText, detailTitleType, detailNav);
        const detailStatusButton = overlay.querySelector('.agenda-panel__details-card-status-btn');
        const detailBarrarGroup = overlay.querySelector('.agenda-panel__details-card-barrar');
        const detailBarrarButton = overlay.querySelector('.agenda-panel__details-card-barrar-btn');
        const detailBarrarDate = overlay.querySelector('.agenda-panel__details-card-barrar-date');
        const detailBarradoNote = overlay.querySelector('.agenda-panel__details-card-barrado-note');
        const detailAnalystText = overlay.querySelector('.agenda-panel__details-card-analyst-text');
        let activeSupervisionEntry = null;
        let persistedSupervisionEntryId = null;
        if (detailList) {
            detailList.__navWrap = detailNav;
            detailList.__navPrev = detailNavPrev;
            detailList.__navNext = detailNavNext;
        }
        const setFullscreenState = (enabled) => {
            if (!fullscreenButton) return;
            overlay.classList.toggle('agenda-panel-overlay--fullscreen', enabled);
            fullscreenButton.textContent = enabled ? 'Sair da tela cheia' : 'Abrir em tela cheia';
            fullscreenButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        };
        fullscreenButton?.addEventListener('click', () => {
            const isFullscreen = overlay.classList.contains('agenda-panel-overlay--fullscreen');
            setFullscreenState(!isFullscreen);
        });

        const hideDetailStatusButton = () => {
            if (!detailStatusButton) return;
            detailStatusButton.style.display = 'none';
            detailStatusButton.disabled = false;
            detailStatusButton.dataset.statusKey = '';
            detailStatusButton.dataset.analiseId = '';
            detailStatusButton.dataset.cardSource = '';
            detailStatusButton.dataset.cardIndex = '';
        };

        const buildBarradoNote = (barrado) => {
            if (!barrado || !barrado.inicio) return '';
            const inicio = formatDateLabel(barrado.inicio) || barrado.inicio;
            const retorno = barrado.retorno_em
                ? (formatDateLabel(barrado.retorno_em) || barrado.retorno_em)
                : 'sem data definida';
            return `Barrado de ${inicio} a ${retorno}`;
        };

        const hideBarrarControls = () => {
            if (!detailBarrarGroup) return;
            detailBarrarGroup.style.display = 'none';
            if (detailBarrarButton) {
                detailBarrarButton.disabled = false;
                detailBarrarButton.textContent = 'Barrar';
            }
            if (detailBarrarDate) {
                detailBarrarDate.value = '';
                detailBarrarDate.disabled = false;
            }
            if (detailBarradoNote) {
                detailBarradoNote.textContent = '';
                detailBarradoNote.style.display = 'none';
            }
        };

        const updateDetailBarrarControls = (entryData, type) => {
            if (!detailBarrarGroup || !detailBarrarButton) {
                return;
            }
            if (!entryData || type !== 'S') {
                hideBarrarControls();
                return;
            }
            const barrado = entryData.barrado || { ativo: false, inicio: null, retorno_em: null };
            detailBarrarGroup.style.display = 'flex';
            detailBarrarButton.textContent = barrado.ativo ? 'Desbloquear' : 'Barrar';
            if (detailBarrarDate) {
                detailBarrarDate.value = barrado.retorno_em || '';
                detailBarrarDate.disabled = false;
            }
            if (detailBarradoNote) {
                const note = buildBarradoNote(barrado);
                detailBarradoNote.textContent = note;
                detailBarradoNote.style.display = note ? 'block' : 'none';
            }
        };

        const updateDetailAnalystLabel = (entryData, type) => {
            if (!detailAnalystText) return;
            if (!entryData || type !== 'S') {
                detailAnalystText.textContent = '';
                detailAnalystText.style.display = 'none';
                return;
            }
            const name = formatResponsavelName(entryData.responsavel);
            if (!name) {
                detailAnalystText.textContent = '';
                detailAnalystText.style.display = 'none';
                return;
            }
            detailAnalystText.textContent = `Analisado por: ${name}`;
            detailAnalystText.style.display = 'inline-flex';
        };

        const updateDetailMetaStatusRow = (entryId, label) => {
            if (!entryId || !label) return;
            const entryEl = detailList.querySelector(`[data-entry-id="${entryId}"]`);
            if (!entryEl) return;
            entryEl.querySelectorAll('.agenda-panel__details-item-meta-row').forEach(row => {
                const labelEl = row.querySelector('.agenda-panel__details-item-meta-label');
                if (labelEl && labelEl.textContent.trim().toLowerCase().startsWith('status')) {
                    const valueEl = row.querySelector('.agenda-panel__details-item-meta-value');
                    if (valueEl) {
                        valueEl.textContent = label;
                    }
                }
            });
        };

        const updateDetailStatusButton = (entryData, type) => {
            if (!detailStatusButton) return;
            if (!entryData || type !== 'S') {
                activeSupervisionEntry = null;
                hideDetailStatusButton();
                return;
            }
            const statusKey = (entryData.supervisor_status || 'pendente').toLowerCase();
            const statusLabel = entryData.status_label || AGENDA_SUPERVISION_STATUS_LABELS[statusKey] || statusKey;
            detailStatusButton.textContent = `Status: ${statusLabel}`;
            detailStatusButton.dataset.statusKey = statusKey;
            detailStatusButton.dataset.analiseId = entryData.analise_id || '';
            detailStatusButton.dataset.cardSource = entryData.card_source || '';
            detailStatusButton.dataset.cardIndex = entryData.card_index ?? '';
            const statusClasses = Object.values(AGENDA_SUPERVISION_STATUS_CLASSES);
            detailStatusButton.classList.remove(...statusClasses);
            detailStatusButton.classList.add(AGENDA_SUPERVISION_STATUS_CLASSES[statusKey]);
            detailStatusButton.style.display = 'inline-flex';
            activeSupervisionEntry = entryData;
        };

        const handleDetailStatusClick = () => {
            if (!activeSupervisionEntry || !detailStatusButton) {
                return;
            }
            const payload = {
                analise_id: activeSupervisionEntry.analise_id,
                source: activeSupervisionEntry.card_source,
                index: activeSupervisionEntry.card_index,
            };
            if (!payload.analise_id || !payload.source || payload.index === undefined || payload.index === null) {
                console.warn('Agenda geral: status change blocked por dados incompletos', payload);
                return;
            }
            console.debug('Agenda geral: status change payload', payload);
            detailStatusButton.disabled = true;
            fetch(AGENDA_SUPERVISION_STATUS_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken,
                },
                body: JSON.stringify(payload),
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Falha ao alterar status');
                    }
                    return response.json();
                })
                .then((data) => {
                    const newStatus = (data.supervisor_status || 'pendente').toLowerCase();
                    const newLabel = data.status_label || AGENDA_SUPERVISION_STATUS_LABELS[newStatus] || newStatus;
                    activeSupervisionEntry.supervisor_status = newStatus;
                    activeSupervisionEntry.status_label = newLabel;
                    updateDetailStatusButton(activeSupervisionEntry, 'S');
                    updateDetailMetaStatusRow(activeSupervisionEntry.id, newLabel);
                    const eventDetail = {
                        analise_id: activeSupervisionEntry.analise_id,
                        processo_id: activeSupervisionEntry.processo_id,
                        cnj: activeSupervisionEntry.cnj_label,
                        status: newStatus,
                    };
                    if (eventDetail.analise_id) {
                        window.dispatchEvent(new CustomEvent('agenda:supervision-status-changed', { detail: eventDetail }));
                    }
                })
                .catch(() => {
                    createSystemAlert('Agenda Geral', 'Não foi possível atualizar o status de supervisão.');
                })
                .finally(() => {
                    detailStatusButton.disabled = false;
                });
        };

        const sendBarradoUpdate = (payload) => {
            if (!payload) return;
            if (detailBarrarButton) {
                detailBarrarButton.disabled = true;
            }
            if (detailBarrarDate) {
                detailBarrarDate.disabled = true;
            }
            fetch(AGENDA_SUPERVISION_BARRADO_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken,
                },
                body: JSON.stringify(payload),
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Falha ao alterar barrado');
                    }
                    return response.json();
                })
                .then((data) => {
                    const newBarrado = data.barrado || {};
                    if (activeSupervisionEntry) {
                        activeSupervisionEntry.barrado = {
                            ativo: Boolean(newBarrado.ativo),
                            inicio: newBarrado.inicio || null,
                            retorno_em: newBarrado.retorno_em || null,
                        };
                        updateDetailBarrarControls(activeSupervisionEntry, 'S');
                        const eventDetail = {
                            analise_id: activeSupervisionEntry.analise_id,
                            processo_id: activeSupervisionEntry.processo_id,
                            cnj: activeSupervisionEntry.cnj_label,
                            barrado: { ...activeSupervisionEntry.barrado },
                        };
                        if (eventDetail.analise_id) {
                            window.dispatchEvent(new CustomEvent('agenda:supervision-barrado-changed', { detail: eventDetail }));
                        }
                    }
                })
                .catch(() => {
                    createSystemAlert('Agenda Geral', 'Não foi possível atualizar o bloqueio da supervisão.');
                })
                .finally(() => {
                    if (detailBarrarButton) {
                        detailBarrarButton.disabled = false;
                    }
                    if (detailBarrarDate) {
                        detailBarrarDate.disabled = false;
                    }
                });
        };

        const buildCommonBarradoPayload = () => {
            if (!activeSupervisionEntry) return null;
            const payload = {
                analise_id: activeSupervisionEntry.analise_id,
                source: activeSupervisionEntry.card_source,
                index: activeSupervisionEntry.card_index,
            };
            if (!payload.analise_id || !payload.source || payload.index === undefined || payload.index === null) {
                return null;
            }
            return payload;
        };

        const handleBarrarToggleClick = () => {
            if (!detailBarrarButton) return;
            const payload = buildCommonBarradoPayload();
            if (!payload) {
                console.warn('Agenda geral: barrado change blocked por dados incompletos', payload);
                return;
            }
            const isActive = Boolean(activeSupervisionEntry?.barrado?.ativo);
            payload.toggle_active = !isActive;
            sendBarradoUpdate(payload);
        };

        const handleBarrarDateChange = () => {
            if (!detailBarrarDate) return;
            const payload = buildCommonBarradoPayload();
            if (!payload) {
                console.warn('Agenda geral: barrado change blocked por dados incompletos', payload);
                return;
            }
            payload.retorno_em = detailBarrarDate.value || null;
            sendBarradoUpdate(payload);
        };

        detailBarrarButton?.addEventListener('click', handleBarrarToggleClick);
        detailBarrarDate?.addEventListener('change', handleBarrarDateChange);
        detailStatusButton?.addEventListener('click', handleDetailStatusClick);
        hideDetailStatusButton();
        hideBarrarControls();
        const handleDetailEntrySelect = (entryData, type) => {
            persistedSupervisionEntryId = entryData?.id || null;
            updateDetailStatusButton(entryData, type);
            updateDetailBarrarControls(entryData, type);
            updateDetailAnalystLabel(entryData, type);
        };

        const restoreActiveDetailControls = () => {
            if (!activeSupervisionEntry) return;
            updateDetailStatusButton(activeSupervisionEntry, 'S');
            updateDetailBarrarControls(activeSupervisionEntry, 'S');
        };

        const restoreActiveEntryReference = (entries) => {
            if (!persistedSupervisionEntryId) return;
            const collection = Array.isArray(entries) ? entries : agendaEntries;
            const restored = collection.find(item => item && item.id === persistedSupervisionEntryId);
            if (restored) {
                activeSupervisionEntry = restored;
            }
        };
        const setDetailTitle = (dayNumber, type) => {
            const base = dayNumber ? `Eventos do dia ${dayNumber}` : 'Eventos do dia';
            detailTitleText.textContent = base;
            const typeLabel = type === 'T'
                ? 'Tarefa'
                : type === 'P'
                    ? 'Prazo'
                    : type === 'S'
                        ? 'Supervisão'
                        : '';
            detailTitleType.textContent = typeLabel;
            detailTitleType.dataset.type = type || '';
            detailTitleType.style.visibility = typeLabel ? 'visible' : 'hidden';
        };
        setDetailTitle(null, null);
        const calendarGridEl = overlay.querySelector('[data-calendar-placeholder]');
        const usersToggle = overlay.querySelector('.agenda-panel__users-toggle');
        const subtitleEl = overlay.querySelector('.agenda-panel__subtitle');
        let focusToggle = null;
        if (currentProcessId) {
            focusToggle = document.createElement('button');
            focusToggle.type = 'button';
            focusToggle.className = 'agenda-panel__focus-toggle';
            focusToggle.textContent = 'Agenda Focada';
            focusToggle.title = 'Mostrar apenas itens deste processo';
            subtitleEl.parentNode.insertBefore(focusToggle, subtitleEl.nextSibling);
        }
        const summaryBar = document.createElement('div');
        summaryBar.className = 'agenda-panel__summary';
        summaryBar.style.fontSize = '12px';
        summaryBar.style.color = '#4b5563';
        summaryBar.style.marginTop = '2px';
        subtitleEl.parentNode.insertBefore(summaryBar, subtitleEl.nextSibling);
        const footer = overlay.querySelector('.agenda-panel__footer');
        const historyButton = document.createElement('button');
        historyButton.type = 'button';
        historyButton.className = 'agenda-panel__history-toggle';
        historyButton.innerHTML = '<span class="agenda-panel__history-icon">🕒</span>';
        historyButton.title = 'Mostrar histórico de alterações';
        historyButton.addEventListener('click', () => {
            calendarState.showHistory = !calendarState.showHistory;
            historyButton.classList.toggle('agenda-panel__history-toggle--active', calendarState.showHistory);
            renderCalendar();
        });
        const completedButton = document.createElement('button');
        completedButton.type = 'button';
        completedButton.className = 'agenda-panel__history-toggle agenda-panel__completed-toggle';
        completedButton.textContent = 'Concluídos';
        completedButton.title = 'Alternar visualização de concluídos';
        completedButton.addEventListener('click', () => {
            calendarState.showCompleted = !calendarState.showCompleted;
            completedButton.classList.toggle('agenda-panel__history-toggle--active', calendarState.showCompleted);
            refreshAgendaData(true);
        });
        const firstFormBtn = footer.querySelector('.agenda-panel__form-btn');
        footer.insertBefore(completedButton, firstFormBtn);
        footer.insertBefore(historyButton, completedButton);
        const monthButtons = Array.from(overlay.querySelectorAll('.agenda-panel__month-switches button'));
        const capitalizeLabel = (value) => {
            if (!value) return '';
            return value
                .split(' ')
                .filter(Boolean)
                .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
                .join(' ');
        };
        const getDefaultUserLabel = () => {
            const userTools = document.getElementById('user-tools');
            if (!userTools) return null;
            const strong = userTools.querySelector('strong');
            if (strong?.textContent?.trim()) {
                return capitalizeLabel(strong.textContent);
            }
            const anchor = userTools.querySelector('a');
            if (anchor?.textContent?.trim()) {
                return capitalizeLabel(anchor.textContent);
            }
            return null;
        };
        const today = new Date();
        const calendarState = {
            mode: 'monthly',
            months: 1,
            monthIndex: today.getMonth(),
            year: today.getFullYear(),
            weekOffset: 0,
            showHistory: false,
            showCompleted: false,
            view: 'calendar',
            activeUser: null,
            focused: false,
            activeDay: null,
            activeType: null,
            preserveView: false,
            lastAppliedEntries: [],
            users: [],
            usersLoading: false,
            usersLoaded: false,
            usersError: false,
            defaultUserLabel: getDefaultUserLabel(),
        };
        const getInlineEntries = () => dedupeEntries(hydrateAgendaFromInlineData());
        let agendaEntries = getInlineEntries();
        updateAgendaEntryDate = (entryId, backendId, type, targetDayInfo) => {
            if (!targetDayInfo) return;
            agendaEntries = agendaEntries.map(item => {
                const matchesBackend = backendId && item.backendId && `${item.backendId}` === `${backendId}`;
                const matchesId = entryId && item.id === entryId;
                if (!(matchesBackend || matchesId)) return item;
                const newType = item.type || type;
                return {
                    ...item,
                    type: newType,
                    day: targetDayInfo.day,
                    monthIndex: targetDayInfo.monthIndex,
                    year: targetDayInfo.year,
                };
            });
        };
        moveAgendaEntries = (entriesToMove = [], targetDayInfo) => {
            if (!targetDayInfo || !entriesToMove.length) return;
            const backendPairs = entriesToMove
                .filter(e => e.backendId !== null && e.backendId !== undefined && e.backendId !== '')
                .map(e => `${e.type || ''}-${e.backendId}`);
            const backendSet = new Set(backendPairs);
            const idSet = new Set(entriesToMove.map(e => e.id));
            agendaEntries = agendaEntries.map(item => {
                const key = item.backendId ? `${item.type || ''}-${item.backendId}` : null;
                const matchesBackend = key && backendSet.has(key);
                const matchesId = idSet.has(item.id);
                if (matchesBackend || matchesId) {
                    const newOrigin = item.originalDate || formatDateIso(item.year, item.monthIndex, item.day);
                    rememberOrigin({
                        backendId: item.backendId,
                        originalDate: newOrigin,
                        year: item.year,
                        monthIndex: item.monthIndex,
                        day: item.day,
                    });
                    return {
                        ...item,
                        day: targetDayInfo.day,
                        monthIndex: targetDayInfo.monthIndex,
                        year: targetDayInfo.year,
                        type: item.type || entriesToMove[0]?.type,
                    };
                }
                return item;
            });
        };
        const formatUserLabel = (user) => {
            if (!user) return '';
            const firstName = (user.first_name || '').trim();
            const lastName = (user.last_name || '').trim();
            const fullName = [firstName, lastName].filter(Boolean).join(' ');
            if (fullName) return capitalizeLabel(fullName);
            if (user.username) {
                return capitalizeLabel(user.username);
            }
            return 'Usuário';
        };
        const getUserInitials = (user) => {
            if (!user) return '';
            const label = formatUserLabel(user);
            if (!label) return (user.username || 'U').slice(0, 2).toUpperCase();
            const parts = label.split(' ');
            if (parts.length === 1) {
                return parts[0].slice(0, 2).toUpperCase();
            }
            const first = parts[0][0];
            const last = parts[parts.length - 1][0];
            return `${first || ''}${last || ''}`.toUpperCase();
        };
        const updateSubtitleText = () => {
            const focusedLabel = calendarState.activeUser
                ? formatUserLabel(calendarState.activeUser)
                : calendarState.defaultUserLabel;
            if (focusedLabel) {
                subtitleEl.textContent = `Agenda de ${focusedLabel}`;
            } else {
                subtitleEl.textContent = 'Expandida para duas telas ou modal.';
            }
        };
        const normalizeMonthIndex = (value) => ((value % MONTHS.length) + MONTHS.length) % MONTHS.length;
        const setActiveMonthButton = (index) => {
            const normalized = normalizeMonthIndex(index);
            monthButtons.forEach((btn, idx) => {
                btn.classList.toggle('agenda-panel__month-switches-btn--active', idx === normalized);
            });
        };
        const renderSummaryBar = (entries = []) => {
            if (!summaryBar) return;
            const counters = {
                T: { month: 0, total: 0 },
                P: { month: 0, total: 0 },
            };
            const monthIdx = calendarState.monthIndex;
            const year = calendarState.year;
            entries.forEach((entry) => {
                const type = entry.type === 'P' ? 'P' : 'T';
                counters[type].total += 1;
                if (entry.monthIndex === monthIdx && entry.year === year) {
                    counters[type].month += 1;
                }
            });
            const modeLabel = calendarState.showCompleted ? 'Concluídos' : 'Pendentes';
            summaryBar.textContent = `${modeLabel} — Mês: T ${counters.T.month} · P ${counters.P.month} | Total: T ${counters.T.total} · P ${counters.P.total}`;
        };
    const applyAgendaEntriesToState = () => {
        resetCalendarMonths();
        let entriesToApply = agendaEntries;
        const activeUserId = calendarState.activeUser?.id;
        if (activeUserId) {
            entriesToApply = entriesToApply.filter(entry =>
                shouldIncludeEntryForActiveUser(entry, activeUserId)
            );
        }
        if (calendarState.focused && currentProcessId) {
            entriesToApply = entriesToApply.filter(
                entry => `${entry.processo_id || ''}` === `${currentProcessId}`
            );
        }
        applyEntriesToCalendar(entriesToApply);
        calendarState.lastAppliedEntries = entriesToApply;
        if (!calendarState.preserveView) {
            if (entriesToApply.length) {
                const focusEntries = entriesToApply.filter(entry => !(entry.type === 'S' && entry.expired));
                if (focusEntries.length) {
                    const first = focusEntries
                        .slice()
                        .sort((a, b) => new Date(a.year, a.monthIndex, a.day) - new Date(b.year, b.monthIndex, b.day))[0];
                    if (first) {
                        calendarState.monthIndex = first.monthIndex;
                        calendarState.year = first.year;
                    }
                } else {
                    const todayFallback = new Date();
                    calendarState.monthIndex = todayFallback.getMonth();
                    calendarState.year = todayFallback.getFullYear();
                }
            } else {
                const todayFallback = new Date();
                calendarState.monthIndex = todayFallback.getMonth();
                calendarState.year = todayFallback.getFullYear();
            }
        }
        calendarState.preserveView = false;
    };
        const updateMonthTitle = () => {
            if (!monthTitleEl) return;
            const yearText = `${calendarState.year || new Date().getFullYear()}`;
            if (calendarState.view === 'users') {
                monthTitleEl.textContent = 'Usuários';
                monthTitleEl.style.display = '';
                monthYearEl?.classList.remove('agenda-panel__year-label--visible');
            } else {
                monthTitleEl.textContent = '';
                monthTitleEl.style.display = 'none';
                monthYearEl?.classList.add('agenda-panel__year-label--visible');
            }
            if (monthYearEl) {
                monthYearEl.textContent = yearText;
            }
        };
        const renderUserSelectionGrid = () => {
            calendarGridEl.innerHTML = '';
            calendarGridEl.classList.remove('agenda-panel__calendar-grid--weekly');
            detailList.innerHTML = '<p class="agenda-panel__details-empty">Clique em um usuário para abrir a agenda dele.</p>';
            detailCardBody.textContent = 'Selecione um usuário para exibir a agenda geral dele.';
            setDetailTitle(null, null);
            if (calendarState.usersLoading) {
                const spinner = document.createElement('div');
                spinner.className = 'agenda-panel__users-loading';
                spinner.textContent = 'Carregando usuários...';
                calendarGridEl.appendChild(spinner);
                return;
            }
            if (calendarState.usersError) {
                const message = document.createElement('div');
                message.className = 'agenda-panel__users-error';
                message.textContent = 'Não foi possível carregar os usuários. Tente novamente.';
                calendarGridEl.appendChild(message);
                return;
            }
            if (!calendarState.users.length) {
                const emptyMessage = document.createElement('p');
                emptyMessage.className = 'agenda-panel__details-empty';
                emptyMessage.textContent = 'Nenhum usuário cadastrado foi encontrado.';
                calendarGridEl.appendChild(emptyMessage);
                return;
            }
            calendarState.users.forEach((user) => {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'agenda-panel__user-card';
                if (calendarState.activeUser?.id === user.id) {
                    card.classList.add('agenda-panel__user-card--active');
                }
                const initials = document.createElement('span');
                initials.className = 'agenda-panel__user-card-initials';
                initials.textContent = getUserInitials(user);
                const username = document.createElement('span');
                username.className = 'agenda-panel__user-card-username';
                username.textContent = user.username || formatUserLabel(user);
                const counters = document.createElement('div');
                counters.className = 'agenda-panel__user-card-counts';
                counters.style.fontSize = '11px';
                counters.style.color = '#4b5563';
                const isCompletedMode = calendarState.showCompleted;
                const taskCount = isCompletedMode ? (user.completed_tasks || 0) : (user.pending_tasks || 0);
                const prazoCount = isCompletedMode ? (user.completed_prazos || 0) : (user.pending_prazos || 0);
                const label = isCompletedMode ? 'Concluídos' : 'Pendentes';
                counters.textContent = `${label} — T ${taskCount} · P ${prazoCount}`;
                card.append(initials, username, counters);
                card.addEventListener('click', () => {
                    calendarState.activeUser = user;
                    calendarState.view = 'calendar';
                    calendarState.weekOffset = 0;
                    usersToggle?.classList.remove('agenda-panel__users-toggle--active');
                    renderCalendar();
                });
                calendarGridEl.appendChild(card);
            });
        };
        const loadAgendaUsers = () => {
            if (calendarState.usersLoaded || calendarState.usersLoading) {
                return;
            }
            calendarState.usersLoading = true;
            calendarState.usersError = false;
            fetch('/api/agenda/users/')
                .then((response) => {
                    if (!response.ok) {
                        throw new Error('Falha ao buscar usuários');
                    }
                    return response.json();
                })
                .then((data) => {
                    calendarState.users = Array.isArray(data) ? data : [];
                    calendarState.usersLoaded = true;
                    calendarState.usersLoading = false;
                    calendarState.usersError = false;
                    renderCalendar();
                })
                .catch(() => {
                    calendarState.users = [];
                    calendarState.usersLoading = false;
                    calendarState.usersLoaded = true;
                    calendarState.usersError = true;
                    renderCalendar();
                });
        };
        const renderCalendar = () => {
            resetCalendarMonths();
            updateMonthTitle();
            updateSubtitleText();
            setActiveMonthButton(calendarState.monthIndex);
            overlay.classList.toggle('agenda-panel--weekly', calendarState.mode === 'weekly');
            overlay.classList.toggle('agenda-panel--history', calendarState.showHistory);
            const isUserView = calendarState.view === 'users';
            usersToggle?.classList.toggle('agenda-panel__users-toggle--active', isUserView);
            calendarGridEl.classList.toggle('agenda-panel__users-grid--active', isUserView);
            usersToggle?.setAttribute('aria-pressed', `${isUserView}`);
            if (isUserView) {
                renderUserSelectionGrid();
                return;
            }
            applyAgendaEntriesToState();
            renderCalendarDays(calendarGridEl, detailList, detailCardBody, calendarState, renderCalendar, setDetailTitle, handleDetailEntrySelect);
            renderSummaryBar(calendarState.lastAppliedEntries || []);
        };
        if (focusToggle) {
            focusToggle.addEventListener('click', () => {
                calendarState.focused = !calendarState.focused;
                focusToggle.classList.toggle('agenda-panel__focus-toggle--active', calendarState.focused);
                applyAgendaEntriesToState();
                renderCalendar();
            });
        }
        const refreshAgendaData = () => {
            if (refreshButton) {
                refreshButton.disabled = true;
            }
            const inline = calendarState.showCompleted ? [] : getInlineEntries();
            const preferApiOnly = calendarState.showCompleted || false;
        hydrateAgendaFromApi(inline, calendarState, () => {
            applyAgendaEntriesToState();
            renderCalendar();
            restoreActiveDetailControls();
            if (refreshButton) {
                refreshButton.disabled = false;
            }
            }, (combined) => {
                agendaEntries = combined;
            }, preferApiOnly);
        };
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                refreshAgendaData();
            });
        }
        hydrateAgendaFromApi(agendaEntries, calendarState, () => {
            applyAgendaEntriesToState();
            renderCalendar();
        }, (combined) => {
            agendaEntries = combined;
        });
        const handleNavigation = (direction) => {
            if (calendarState.mode === 'weekly') {
                const step = 7;
                const delta = direction === 'next' ? step : -step;
                calendarState.weekOffset = clampWeekOffset(calendarState.weekOffset + delta, calendarState);
            } else {
                const delta = direction === 'next' ? 1 : -1;
                let monthIndex = calendarState.monthIndex + delta;
                let year = calendarState.year;
                if (monthIndex > 11) {
                    monthIndex = 0;
                    year += 1;
                } else if (monthIndex < 0) {
                    monthIndex = 11;
                    year -= 1;
                }
                calendarState.monthIndex = monthIndex;
                calendarState.year = year;
            }
            calendarState.preserveView = true;
            renderCalendar();
        };
        closeButton.addEventListener('click', () => closeAgendaPanel());
        cycleBtn.addEventListener('click', () => {
            const current = Number(cycleBtn.dataset.months) || 1;
            const next = current === 3 ? 1 : current + 1;
            cycleBtn.dataset.months = next;
            cycleBtn.textContent = `${next} Calendário${next === 1 ? '' : 's'}`;
            if (modeButton.dataset.mode !== 'monthly' && next !== 1) {
                modeButton.dataset.mode = 'monthly';
                modeButton.textContent = 'Mensal';
            }
        });
        modeButton.addEventListener('click', () => {
            const sequence = ['monthly', 'weekly'];
            const labels = {
                monthly: 'Mensal',
                weekly: 'Semanal',
            };
            const current = modeButton.dataset.mode || 'monthly';
            const index = sequence.indexOf(current);
            const next = sequence[(index + 1) % sequence.length];
            modeButton.dataset.mode = next;
            modeButton.textContent = labels[next];
            calendarState.mode = next;
            if (next === 'weekly') {
                calendarState.weekOffset = clampWeekOffset(calendarState.weekOffset, calendarState);
            } else {
                calendarState.weekOffset = 0;
            }
            if (next !== 'monthly') {
                cycleBtn.dataset.months = 1;
                cycleBtn.textContent = '1 Calendário';
            }
            renderCalendar();
        });
        usersToggle?.addEventListener('click', () => {
            const nextView = calendarState.view === 'users' ? 'calendar' : 'users';
            calendarState.view = nextView;
            if (nextView === 'users') {
                calendarState.usersLoaded = false;
                calendarState.usersError = false;
                loadAgendaUsers();
            }
            renderCalendar();
        });
        prevNavBtn.addEventListener('click', () => handleNavigation('prev'));
        nextNavBtn.addEventListener('click', () => handleNavigation('next'));
        overlay.querySelectorAll('.agenda-panel__month-switches button').forEach((btn, index) => {
            btn.addEventListener('click', () => {
                calendarState.monthIndex = index;
                if (calendarState.mode === 'weekly') {
                    calendarState.weekOffset = clampWeekOffset(calendarState.weekOffset, calendarState);
                }
                calendarState.preserveView = true;
                renderCalendar();
            });
        });
        renderCalendar();
    };

    const closeAgendaPanel = () => {
        const overlay = document.querySelector('.agenda-panel-overlay');
        if (!overlay) {
            return;
        }
        closeChecagemModal();
        overlay.remove();
        document.body.classList.remove('agenda-panel-open');
    };

    const handleAgendaPanelEscape = (event) => {
        if (event.key !== 'Escape') {
            return;
        }
        const checagemOverlay = document.getElementById('checagem-modal-overlay');
        if (checagemOverlay && checagemOverlay.getAttribute('aria-hidden') === 'false') {
            closeChecagemModal();
            return;
        }
        closeAgendaPanel();
    };
    document.addEventListener('keydown', handleAgendaPanelEscape);

    const createAgendaFormModal = (type) => {
        if (document.querySelector(`.agenda-form-modal[data-form="${type}"]`)) {
            return;
        }
        const modal = document.createElement('div');
        modal.className = 'agenda-form-modal';
        modal.dataset.form = type;
        modal.innerHTML = `
            <div class="agenda-form-modal__card">
                <div class="agenda-form-modal__header">
                    <strong>${type === 'tarefas' ? 'Nova Tarefa' : 'Novo Prazo'}</strong>
                    <button type="button" class="agenda-form-modal__close">×</button>
                </div>
                <div class="agenda-form-modal__body">
                    <label>Contrato / processo
                        <input type="text" placeholder="Informe o contrato ou processo">
                    </label>
                    <label>${type === 'tarefas' ? 'Descrição' : 'Título'}
                        <textarea placeholder="Digite ${type === 'tarefas' ? 'a descrição da tarefa' : 'o título do prazo'}"></textarea>
                    </label>
                    <div class="agenda-form-modal__row">
                        <label>Data
                            <input type="date">
                        </label>
                        <label>Hora
                            <input type="time" step="600">
                        </label>
                    </div>
                    <label>Responsável
                        <input type="text" placeholder="Selecione responsável">
                    </label>
                </div>
                <div class="agenda-form-modal__footer">
                    <button type="button" class="agenda-form-modal__submit">Salvar</button>
                    <button type="button" class="agenda-form-modal__cancel">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('.agenda-form-modal__close').addEventListener('click', () => modal.remove());
        modal.querySelector('.agenda-form-modal__cancel').addEventListener('click', () => modal.remove());
    };

    const openAgendaPanel = () => {
        createAgendaPanel();
    };

    const openAgendaForm = (type) => {
        createAgendaFormModal(type);
    };

    const attachAgendaActions = () => {
        const placeholder = document.querySelector('.agenda-placeholder-card');
        if (!placeholder) return;
        placeholder.addEventListener('click', (event) => {
            event.preventDefault();
            if (document.querySelector('.agenda-panel-overlay')) {
                closeAgendaPanel();
                return;
            }
            openAgendaPanel();
        });
        placeholder.querySelectorAll('[data-agenda-action]').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const type = btn.getAttribute('data-agenda-action');
                openAgendaForm(type);
            });
        });
    };
    attachAgendaActions();

    const getAndamentosActionBar = () => {
        const group = document.getElementById('andamentos-group');
        if (!group) return null;
        let bar = group.querySelector('.andamentos-action-bar');
        if (bar) return bar;
        bar = document.createElement('div');
        bar.className = 'andamentos-action-bar analise-inner-tab-navigation';
        const title = group.querySelector('h2');
        if (title && title.parentElement === group) {
            group.insertBefore(bar, title);
        } else if (group.firstChild) {
            group.insertBefore(bar, group.firstChild);
        } else {
            group.appendChild(bar);
        }
        return bar;
    };

    const showCffConfirm = (title, message) => {
        return new Promise(resolve => {
            const existing = document.getElementById('cff-system-confirm');
            if (existing) {
                existing.remove();
            }
            const overlay = document.createElement('div');
            overlay.id = 'cff-system-confirm';
            overlay.style.position = 'fixed';
            overlay.style.top = '50%';
            overlay.style.left = '50%';
            overlay.style.transform = 'translate(-50%, -50%)';
            overlay.style.background = '#fff';
            overlay.style.border = '1px solid #dcdcdc';
            overlay.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
            overlay.style.borderRadius = '8px';
            overlay.style.padding = '16px 24px';
            overlay.style.zIndex = 2000;
            overlay.style.minWidth = '320px';

            const titleEl = document.createElement('div');
            titleEl.style.fontWeight = 'bold';
            titleEl.style.marginBottom = '8px';
            titleEl.textContent = title;
            overlay.appendChild(titleEl);

            const msgEl = document.createElement('div');
            msgEl.style.marginBottom = '12px';
            msgEl.style.fontSize = '0.95rem';
            msgEl.textContent = message;
            overlay.appendChild(msgEl);

            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.justifyContent = 'flex-end';
            actions.style.gap = '8px';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.style.border = 'none';
            cancelBtn.style.background = '#e2e8f0';
            cancelBtn.style.color = '#1e293b';
            cancelBtn.style.padding = '6px 12px';
            cancelBtn.style.borderRadius = '4px';
            cancelBtn.style.cursor = 'pointer';
            cancelBtn.addEventListener('click', () => {
                overlay.remove();
                resolve(false);
            });

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.textContent = 'OK';
            okBtn.style.border = 'none';
            okBtn.style.background = '#0d6efd';
            okBtn.style.color = '#fff';
            okBtn.style.padding = '6px 12px';
            okBtn.style.borderRadius = '4px';
            okBtn.style.cursor = 'pointer';
            okBtn.addEventListener('click', () => {
                overlay.remove();
                resolve(true);
            });

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            overlay.appendChild(actions);

            document.body.appendChild(overlay);
        });
    };

    // Botões relacionados a andamentos processuais
    const buscaAtivaInput = document.getElementById('id_busca_ativa');
    const andamentosActionsContainer = getAndamentosActionBar();
    if (!document.getElementById('btn_atualizar_andamentos')) {
        const actionHost = andamentosActionsContainer || buscaAtivaInput?.parentNode;
        if (!actionHost) {
            return;
        }
        const btn = document.createElement('button');
        btn.id = 'btn_atualizar_andamentos';
        btn.type = 'button';
        btn.className = 'button analise-inner-tab-button';
        btn.innerText = '🔄 Buscar andamentos agora';

        actionHost.appendChild(btn);

        const removeDuplicatesBtn = document.createElement('button');
        removeDuplicatesBtn.id = 'btn_remover_andamentos_duplicados';
        removeDuplicatesBtn.type = 'button';
        removeDuplicatesBtn.className = 'button analise-inner-tab-button';
        removeDuplicatesBtn.innerText = '🧹 Limpar duplicados';

        actionHost.appendChild(removeDuplicatesBtn);

        if (buscaAtivaInput) {
            const buscaField = buscaAtivaInput.closest('.field-busca_ativa') || buscaAtivaInput.closest('.form-row');
            if (buscaField) {
                buscaField.style.display = 'none';
            }
            buscaAtivaInput.classList.add('supervision-toggle-input');
            const toggleWrapper = document.createElement('label');
            toggleWrapper.className = 'protocol-toggle andamentos-busca-toggle';
            const switchSpan = document.createElement('span');
            switchSpan.className = 'supervision-switch';
            const labelSpan = document.createElement('span');
            labelSpan.className = 'supervision-label-text';
            labelSpan.innerText = 'Busca ativa';
            toggleWrapper.appendChild(buscaAtivaInput);
            toggleWrapper.appendChild(switchSpan);
            toggleWrapper.appendChild(labelSpan);

            actionHost.appendChild(toggleWrapper);
        }

        btn.addEventListener('click', () => {
            const match = window.location.pathname.match(/processojudicial\/(\d+)\/change/);
            if (!match) {
                createSystemAlert('CFF System', 'Salve o processo antes de atualizar andamentos.');
                return;
            }
            const objectId = match[1];
            const originalText = btn.innerText;
            btn.disabled = true;
            btn.innerText = 'Buscando andamentos...';

            fetch(`/admin/contratos/processojudicial/${objectId}/atualizar-andamentos/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken }
            }).then(resp => {
                if (!resp.ok) throw new Error('Erro ao acionar atualização.');
                window.location.reload();
            }).catch(err => {
                createSystemAlert('CFF System', err.message || 'Falha ao atualizar andamentos.');
            }).finally(() => {
                btn.disabled = false;
                btn.innerText = originalText;
            });
        });
        removeDuplicatesBtn.addEventListener('click', async () => {
            const match = window.location.pathname.match(/processojudicial\/(\d+)\/change/);
            if (!match) {
                createSystemAlert('CFF System', 'Salve o processo antes de remover duplicados.');
                return;
            }

            const objectId = match[1];
            const originalText = removeDuplicatesBtn.innerText;
            removeDuplicatesBtn.disabled = true;
            removeDuplicatesBtn.innerText = 'Removendo duplicados...';
            const inlineRemoved = deduplicateInlineAndamentos();

            try {
                const response = await fetch(`/admin/contratos/processojudicial/${objectId}/remover-andamentos-duplicados/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': csrftoken },
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.message || 'Erro ao remover duplicados.');
                }
                const removed = data.removed || 0;
                const defaultServerMessage = removed ? `${removed} andamento(s) duplicado(s) removido(s).` : 'Não foram encontrados andamentos duplicados.';
                const serverMessage = data.message || defaultServerMessage;
                const messageParts = [];
                if (inlineRemoved > 0) {
                    messageParts.push(`${inlineRemoved} andamento(s) duplicado(s) foram marcados para remoção no formulário. Salve para confirmar a exclusão.`);
                }
                if (removed > 0) {
                    messageParts.push(serverMessage);
                } else if (inlineRemoved === 0) {
                    messageParts.push(serverMessage);
                }
                if (!messageParts.length) {
                    messageParts.push('Nenhum andamento duplicado encontrado.');
                }
                createSystemAlert('CFF System', messageParts.join(' '));

                if (inlineRemoved === 0 && removed > 0) {
                    const redirectUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
                    window.location.assign(redirectUrl);
                }
            } catch (err) {
                const messageParts = [];
                messageParts.push(err.message || 'Falha ao remover duplicados.');
                if (inlineRemoved > 0) {
                    messageParts.push(`${inlineRemoved} andamento(s) duplicado(s) foram marcados para remoção no formulário. Salve para confirmar a exclusão.`);
                }
                createSystemAlert('CFF System', messageParts.join(' '));
            } finally {
                removeDuplicatesBtn.disabled = false;
                removeDuplicatesBtn.innerText = originalText;
            }
        });
    }

    const excluirBtn = document.getElementById('btn_excluir_andamentos_selecionados');
    if (excluirBtn) {
        excluirBtn.addEventListener('click', async (e) => {
            if (excluirBtn.dataset.skipConfirm === 'true') {
                excluirBtn.dataset.skipConfirm = '';
                return;
            }
            e.preventDefault();
            const confirmed = await showCffConfirm('CFF System', 'Tem certeza que deseja excluir os andamentos selecionados?');
            if (confirmed) {
                excluirBtn.dataset.skipConfirm = 'true';
                excluirBtn.click();
            }
        });
        const andamentosGroup = document.getElementById('andamentos-group');
        const submitRow = excluirBtn.closest('.submit-row');
        if (andamentosGroup && submitRow) {
            const updateVisibility = () => {
                submitRow.style.display = andamentosGroup.classList.contains('active') ? '' : 'none';
            };
            updateVisibility();
            const tabsContainer = document.querySelector('.inline-group-tabs');
            if (tabsContainer) {
                tabsContainer.addEventListener('click', (event) => {
                    const target = event.target;
                    if (target && target.tagName === 'BUTTON') {
                        window.requestAnimationFrame(updateVisibility);
                    }
                });
            }
            const observer = new MutationObserver(updateVisibility);
            observer.observe(andamentosGroup, { attributes: true, attributeFilter: ['class'] });
        }
    }

    // Máscara e formatação CNJ no input principal
    if (cnjInput) {
        const formatCnj = (raw) => {
            const d = (raw || '').replace(/\D/g, '').slice(0, 20);
            const parts = [
                d.slice(0, 7),
                d.slice(7, 9),
                d.slice(9, 13),
                d.slice(13, 14),
                d.slice(14, 16),
                d.slice(16, 20),
            ];
            if (d.length <= 7) return d;
            return `${parts[0]}-${parts[1]}${parts[2] ? '.' + parts[2] : ''}${parts[3] ? '.' + parts[3] : ''}${parts[4] ? '.' + parts[4] : ''}${parts[5] ? '.' + parts[5] : ''}`;
        };

        cnjInput.addEventListener('input', (e) => {
            const pos = e.target.selectionStart;
            const formatted = formatCnj(e.target.value);
            e.target.value = formatted;
            // Best effort to keep cursor near the end
            e.target.setSelectionRange(formatted.length, formatted.length);
        });
    }

    if (form) {
        let lastSubmitButton = null;
        form.addEventListener('submit', () => {
            deduplicateInlineAndamentos();
        });
        form.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const button = target.closest('input[type="submit"], button[type="submit"]');
            if (!button || !form.contains(button)) return;
            lastSubmitButton = button;
        }, { capture: true });
        form.addEventListener('submit', (event) => {
            const submitter = event.submitter && form.contains(event.submitter)
                ? event.submitter
                : lastSubmitButton;
            if (!submitter) return;
            const activeButton = submitter.closest('input[type="submit"], button[type="submit"]');
            if (!activeButton) return;
            const originalLabel = activeButton.tagName === 'INPUT'
                ? activeButton.value
                : activeButton.textContent;
            activeButton.dataset.originalLabel = originalLabel;
            if (activeButton.tagName === 'INPUT') {
                activeButton.value = 'Salvando...';
            } else {
                activeButton.textContent = 'Salvando...';
            }
        }, { capture: true });
        const continueButtons = form.querySelectorAll('input[name="_continue"], button[name="_continue"]');
        continueButtons.forEach((button) => {
            button.style.display = 'none';
        });
    }

    const removeInlineRelatedLinks = (root = document) => {
        ['tarefas-group', 'listas-group', 'prazos-group'].forEach(groupId => {
            const group = document.getElementById(groupId);
            if (!group) return;
            const cleanup = (target = group) => {
                target.querySelectorAll('a.related-widget-wrapper-link').forEach(el => el.remove());
            };
            cleanup(root === document ? group : root);
            const observer = new MutationObserver(() => cleanup(group));
            observer.observe(group, { childList: true, subtree: true });
        });
    };

    removeInlineRelatedLinks();

    if (window.django && window.django.jQuery) {
        window.django.jQuery(document).on('formset:added', (event, row, formsetName) => {
            if (formsetName && (formsetName === 'tarefas' || formsetName === 'listas' || formsetName === 'prazos')) {
                removeInlineRelatedLinks(row);
            }
        });
    }

    const wrapInlineTableForScroll = () => {
        ['tarefas-group', 'prazos-group'].forEach(groupId => {
            const group = document.getElementById(groupId);
            if (!group) return;
            const tabular = group.querySelector('.tabular');
            if (!tabular || tabular.parentElement.classList.contains('inline-scroll-container')) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'inline-scroll-container';
            tabular.classList.add('inline-scroll-inner');
            tabular.parentNode.insertBefore(wrapper, tabular);
            wrapper.appendChild(tabular);
        });
    };
    wrapInlineTableForScroll();

    const makeInfoCardSticky = () => {
        const card = document.querySelector('.info-card');
        if (!card) return;
        card.classList.add('info-card-floating');
    };
    makeInfoCardSticky();

    const normalizeCpf = (value) => (value || '').replace(/\D/g, '');
    const formatResponsavelName = (responsavel) => {
        if (!responsavel) return '';
        const { first_name, last_name, username } = responsavel;
        const names = [first_name, last_name].filter(Boolean);
        return names.join(' ') || username || '';
    };
    const getParteInfoFromCard = (processoId) => {
        if (!processoId) return {};
        const selector = `.info-card[data-processo-id="${processoId}"]`;
        const card = document.querySelector(selector);
        if (!card) return {};
        const nameEl = card.querySelector('.parte-nome');
        const documentoEl = card.querySelector('.parte-documento');
        const name = nameEl ? nameEl.textContent.trim() : '';
        const cpfFromDataset = card.dataset.parteCpf || '';
        const cpfText = documentoEl ? documentoEl.textContent.trim() : '';
        const cpf = cpfFromDataset || cpfText;
        return { name, cpf };
    };
    const agendaProcessMetaCache = new Map();
    const normalizeProcessId = (value) => {
        if (value === null || value === undefined || value === '') return '';
        return String(value);
    };
    const storeAgendaProcessMeta = (processoId, name, cpf) => {
        const key = normalizeProcessId(processoId);
        if (!key) return;
        const current = agendaProcessMetaCache.get(key) || {};
        const next = {
            name: name || current.name || '',
            cpf: cpf || current.cpf || '',
        };
        if (next.name || next.cpf) {
            agendaProcessMetaCache.set(key, next);
        }
    };
    const getAgendaProcessMeta = (processoId) => {
        const key = normalizeProcessId(processoId);
        if (!key) return {};
        if (agendaProcessMetaCache.has(key)) {
            return agendaProcessMetaCache.get(key) || {};
        }
        const info = getParteInfoFromCard(key);
        if (info?.name || info?.cpf) {
            agendaProcessMetaCache.set(key, info);
        }
        return info || {};
    };
    const hydrateEntryProcessMeta = (entry) => {
        if (!entry) return entry;
        const processoId = normalizeProcessId(entry.processo_id ?? entry.processoId);
        if (!processoId) return entry;
        entry.processo_id = entry.processo_id ?? entry.processoId;
        const entryName = entry.nome || entry.name || entry.parte_nome || '';
        const entryCpf = entry.cpf || entry.parte_cpf || entry.documento || '';
        if (entryName || entryCpf) {
            storeAgendaProcessMeta(processoId, entryName, entryCpf);
            return entry;
        }
        const meta = getAgendaProcessMeta(processoId);
        if (meta?.name) {
            entry.nome = meta.name;
            entry.parte_nome = entry.parte_nome || meta.name;
        }
        if (meta?.cpf) {
            entry.cpf = meta.cpf;
            entry.parte_cpf = entry.parte_cpf || meta.cpf;
            entry.documento = entry.documento || meta.cpf;
        }
        return entry;
    };
    const parseEnderecoString = (value) => {
        const output = { A: '', B: '', C: '', D: '', E: '', F: '', G: '', H: '' };
        if (!value) return output;
        const getPart = (letter) => {
            const re = new RegExp(`${letter}:\\s*([\\s\\S]*?)(?=\\s*-\\s*[A-H]:|$)`, 'i');
            const match = value.match(re);
            return match ? match[1].trim() : '';
        };
        Object.keys(output).forEach((key) => {
            output[key] = getPart(key);
        });
        return output;
    };
    const buildEnderecoString = (parts) => {
        const fields = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
        return fields.map((field) => `${field}: ${parts[field] || ''}`).join(' - ');
    };
    const createEnderecoWidget = (idPrefix, initialValue = '') => {
        const wrapper = document.createElement('div');
        wrapper.className = 'herdeiros-endereco';
        wrapper.innerHTML = `
            <textarea class="herdeiros-endereco-raw" id="${idPrefix}_raw" style="display:none;"></textarea>
            <div class="endereco-fields-grid">
                <div class="form-group">
                    <label for="${idPrefix}_A">A (Rua ou Av)</label>
                    <input type="text" id="${idPrefix}_A" data-part="A">
                </div>
                <div class="form-group">
                    <label for="${idPrefix}_B">B (Número)</label>
                    <input type="text" id="${idPrefix}_B" data-part="B">
                </div>
                <div class="form-group">
                    <label for="${idPrefix}_C">C (Complemento)</label>
                    <input type="text" id="${idPrefix}_C" data-part="C">
                </div>
                <div class="form-group">
                    <label for="${idPrefix}_D">D (Bairro)</label>
                    <input type="text" id="${idPrefix}_D" data-part="D">
                </div>
                <div class="form-group">
                    <label for="${idPrefix}_E">E (Cidade)</label>
                    <input type="text" id="${idPrefix}_E" data-part="E">
                </div>
                <div class="form-group">
                    <label for="${idPrefix}_F">F (Estado)</label>
                    <input type="text" id="${idPrefix}_F" data-part="F">
                </div>
                <div class="form-group">
                    <label for="${idPrefix}_G">G (CEP)</label>
                    <input type="text" id="${idPrefix}_G" data-part="G" maxlength="9">
                </div>
                <div class="form-group">
                    <label for="${idPrefix}_H">H (UF)</label>
                    <input type="text" id="${idPrefix}_H" data-part="H" maxlength="2">
                </div>
            </div>
        `;
        const rawTextarea = wrapper.querySelector('.herdeiros-endereco-raw');
        const inputs = Array.from(wrapper.querySelectorAll('input[data-part]'));
        const populate = (value) => {
            const parts = parseEnderecoString(value);
            inputs.forEach((input) => {
                input.value = parts[input.dataset.part] || '';
            });
            rawTextarea.value = buildEnderecoString(parts);
        };
        const updateRaw = () => {
            const parts = {};
            inputs.forEach((input) => {
                parts[input.dataset.part] = input.value || '';
            });
            rawTextarea.value = buildEnderecoString(parts);
        };
        inputs.forEach((input) => {
            input.addEventListener('input', updateRaw);
        });
        const cepInput = wrapper.querySelector('input[data-part="G"]');
        if (cepInput) {
            cepInput.addEventListener('input', (event) => {
                let cep = event.target.value.replace(/\D/g, '').substring(0, 8);
                if (cep.length > 5) {
                    cep = cep.replace(/^(\d{5})(\d)/, '$1-$2');
                }
                event.target.value = cep;
            });
        }
        populate(initialValue);
        return wrapper;
    };
    const formatCpfValue = (rawValue) => {
        const digits = (rawValue || '').replace(/\D/g, '').slice(0, 11);
        if (digits.length !== 11) {
            return digits;
        }
        return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    };
    const attachCpfMaskAndCopy = (input) => {
        if (!input || input.dataset.cpfBound === 'true') return;
        input.dataset.cpfBound = 'true';
        const applyMask = () => {
            const formatted = formatCpfValue(input.value);
            input.value = formatted;
        };
        input.addEventListener('input', applyMask);
        input.addEventListener('blur', applyMask);
        input.addEventListener('click', () => {
            const digitsOnly = (input.value || '').replace(/\D/g, '');
            if (digitsOnly.length !== 11) {
                return;
            }
            navigator.clipboard.writeText(digitsOnly).then(() => {
                input.title = 'CPF copiado sem formatação';
                input.classList.add('cpf-copy-field');
                input.classList.add('copied');
                setTimeout(() => {
                    input.classList.remove('copied');
                }, 1200);
            }).catch(() => {});
        });
        applyMask();
    };
    
    function buildEntryTitleRow(entryData) {
        if (!entryData) return null;
        hydrateEntryProcessMeta(entryData);
        const cardMeta = entryData.processo_id ? getParteInfoFromCard(entryData.processo_id) : {};
        const name = entryData.nome || entryData.name || entryData.parte_nome || cardMeta.name || '';
        const cpfCandidates = [
            entryData.cpf,
            entryData.parte_cpf,
            entryData.documento,
            entryData.cpf_falecido,
            entryData.cpf_representante,
            cardMeta.cpf,
        ];
        const cpfRaw = cpfCandidates.find(Boolean) || '';
        const normalizedCpf = normalizeCpf(cpfRaw);
        if (!name && !normalizedCpf) {
            return null;
        }
        const row = document.createElement('div');
        row.className = 'agenda-panel__details-item-title';
        if (name) {
            const nameSpan = document.createElement('span');
            nameSpan.className = 'agenda-panel__details-item-title-name';
            nameSpan.textContent = name;
            row.appendChild(nameSpan);
        }
        if (normalizedCpf) {
            const cpfSpan = document.createElement('span');
            cpfSpan.className = 'agenda-panel__details-item-title-cpf';
            cpfSpan.textContent = `CPF: ${formatCpfValue(normalizedCpf)}`;
            cpfSpan.setAttribute('title', 'Clique para copiar o CPF sem formatação');
            cpfSpan.addEventListener('click', () => {
                navigator.clipboard?.writeText(normalizedCpf)?.then(() => {
                    cpfSpan.classList.add('copied');
                    setTimeout(() => cpfSpan.classList.remove('copied'), 1000);
                }).catch(() => {});
            });
            row.appendChild(cpfSpan);
        }
        return row;
    }
    const herdeirosCache = new Map();
    const OBITO_UFS = ['', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
        'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
    let obitoModal = null;
    const buildAdminRoot = (() => {
        const path = window.location.pathname;
        if (!path.includes('/admin')) {
            return '/admin';
        }
        return path.split('/admin')[0] + '/admin';
    })();
    const buildObitoUrl = (parteId) => `${window.location.origin}${buildAdminRoot}/contratos/processojudicial/parte/${parteId}/obito-info/`;
    const formatDateForTooltip = (isoValue) => {
        if (!isoValue) {
            return '';
        }
        if (/^\d{4}-01-01$/.test(isoValue)) {
            return isoValue.slice(0, 4);
        }
        const parts = isoValue.split('-');
        if (parts.length !== 3) {
            return isoValue;
        }
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    };
    const formatDateForInput = (isoValue) => {
        if (!isoValue) {
            return '';
        }
        if (/^\d{4}-01-01$/.test(isoValue)) {
            return isoValue.slice(0, 4);
        }
        const parts = isoValue.split('-');
        if (parts.length !== 3) {
            return isoValue;
        }
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    };
    const normalizeObitoDateInput = (value) => {
        const trimmed = (value || '').trim();
        if (!trimmed) {
            return '';
        }
        const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (slashMatch) {
            const day = slashMatch[1].padStart(2, '0');
            const month = slashMatch[2].padStart(2, '0');
            const year = slashMatch[3];
            return `${year}-${month}-${day}`;
        }
        if (/^\d{4}$/.test(trimmed)) {
            return `${trimmed}-01-01`;
        }
        if (/^\d{4}-\d{2}$/.test(trimmed)) {
            return `${trimmed}-01`;
        }
        return trimmed;
    };
    const computeObitoTooltipText = (card) => {
        if (!card) return '';
        const dateValue = card.dataset.obitoData;
        const cidade = card.dataset.obitoCidade || '';
        const uf = card.dataset.obitoUf || '';
        const idade = card.dataset.obitoIdade || '';
        const parts = [];
        if (dateValue) {
            parts.push(`Data: ${formatDateForTooltip(dateValue)}`);
        }
        if (cidade) {
            parts.push(`Cidade: ${cidade}`);
        }
        if (uf) {
            parts.push(`UF: ${uf}`);
        }
        if (idade) {
            parts.push(`Idade: ${idade}`);
        }
        return parts.join(' · ');
    };
    const ensureObitoModal = () => {
        if (obitoModal) {
            return obitoModal;
        }
        obitoModal = document.createElement('div');
        obitoModal.className = 'obito-modal';
        obitoModal.setAttribute('aria-hidden', 'true');
        obitoModal.innerHTML = `
            <div class="obito-modal__panel">
                <div class="obito-modal__header" style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>Detalhes do Óbito</strong>
                    <button type="button" class="obito-modal__close" aria-label="Fechar">&times;</button>
                </div>
                <form class="obito-modal__form">
                    <label>
                        Data do óbito
                        <input type="text" name="obito_data" inputmode="numeric" placeholder="DD/MM/AAAA ou AAAA">
                    </label>
                    <label>
                        Cidade
                        <input type="text" name="obito_cidade" placeholder="Cidade">
                    </label>
                    <label>
                        UF
                        <select name="obito_uf"></select>
                    </label>
                    <label>
                        Idade
                        <input type="number" name="obito_idade" min="0" max="120" placeholder="Idade no óbito">
                    </label>
                    <div class="obito-modal__actions">
                        <button type="button" class="button button-primary obito-modal__save">Salvar</button>
                        <button type="button" class="button obito-modal__cancel">Cancelar</button>
                    </div>
                </form>
            </div>
        `;
        const select = obitoModal.querySelector('select[name="obito_uf"]');
        if (select) {
            OBITO_UFS.forEach((uf) => {
                const option = document.createElement('option');
                option.value = uf;
                option.textContent = uf || 'Selecione a UF';
                select.appendChild(option);
            });
        }
        document.body.appendChild(obitoModal);
        const closeHandler = () => {
            obitoModal.setAttribute('aria-hidden', 'true');
        };
        obitoModal.querySelector('.obito-modal__close')?.addEventListener('click', closeHandler);
        obitoModal.querySelector('.obito-modal__cancel')?.addEventListener('click', closeHandler);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' || event.key === 'Esc') {
                if (obitoModal.getAttribute('aria-hidden') === 'false') {
                    closeHandler();
                }
            }
        });
        return obitoModal;
    };
    const openObitoModal = (card) => {
        if (!card) return;
        const modal = ensureObitoModal();
        const form = modal.querySelector('.obito-modal__form');
        if (!form) return;
        const setFieldValue = (input, value) => {
            if (!input) return;
            const val = value ?? '';
            if (input.tagName.toLowerCase() === 'select') {
                const hasOption = Array.from(input.options || []).some((opt) => opt.value === val);
                if (!hasOption && val) {
                    const option = document.createElement('option');
                    option.value = val;
                    option.textContent = val;
                    input.appendChild(option);
                }
            }
            input.value = val;
            input.setAttribute('value', val);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const dateInput = form.querySelector('input[name="obito_data"]');
        const cidadeInput = form.querySelector('input[name="obito_cidade"]');
        const ufSelect = form.querySelector('select[name="obito_uf"]');
        const idadeInput = form.querySelector('input[name="obito_idade"]');
        setFieldValue(dateInput, formatDateForInput(card.dataset.obitoData || ''));
        setFieldValue(cidadeInput, card.dataset.obitoCidade || '');
        setFieldValue(ufSelect, card.dataset.obitoUf || '');
        setFieldValue(idadeInput, card.dataset.obitoIdade || '');
        modal.dataset.parteId = card.dataset.parteId || '';
        modal.setAttribute('aria-hidden', 'false');
        dateInput?.focus();
        if (modal.dataset.parteId) {
            fetch(buildObitoUrl(modal.dataset.parteId), {
                method: 'GET',
                headers: {
                    'X-CSRFToken': csrftoken || '',
                },
            })
                .then((response) => (response.ok ? response.json() : null))
                .then((data) => {
                    if (!data) return;
                    updateCardObitoData(card, data);
                    setFieldValue(dateInput, formatDateForInput(data.obito_data || ''));
                    setFieldValue(cidadeInput, data.obito_cidade || '');
                    setFieldValue(ufSelect, data.obito_uf || '');
                    setFieldValue(idadeInput, data.obito_idade || '');
                })
                .catch(() => {});
        }
    };
    const hideObitoModal = () => {
        if (obitoModal) {
            obitoModal.setAttribute('aria-hidden', 'true');
        }
    };
    const updateCardObitoData = (card, payload = {}) => {
        if (!card) return;
        if (typeof payload.obito_data !== 'undefined') {
            card.dataset.obitoData = payload.obito_data || '';
        }
        if (typeof payload.obito_cidade !== 'undefined') {
            card.dataset.obitoCidade = payload.obito_cidade || '';
        }
        if (typeof payload.obito_uf !== 'undefined') {
            card.dataset.obitoUf = payload.obito_uf || '';
        }
        if (typeof payload.obito_idade !== 'undefined') {
            card.dataset.obitoIdade = payload.obito_idade || '';
        }
    };
    const setupObitoModalActions = () => {
        const modal = ensureObitoModal();
        const saveButton = modal.querySelector('.obito-modal__save');
        const form = modal.querySelector('.obito-modal__form');
        const getFormValue = (name) => form?.querySelector(`[name="${name}"]`)?.value || '';
        if (!saveButton || !form) return;
        saveButton.addEventListener('click', () => {
            const parteId = modal.dataset.parteId;
            if (!parteId) {
                return;
            }
            const payload = {
                data_obito: normalizeObitoDateInput(getFormValue('obito_data')),
                cidade: getFormValue('obito_cidade'),
                uf: getFormValue('obito_uf'),
                idade: getFormValue('obito_idade'),
            };
            saveButton.disabled = true;
            fetch(buildObitoUrl(parteId), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken || '',
                },
                body: JSON.stringify(payload),
            })
                .then((response) => {
                    if (!response.ok) {
                        const contentType = response.headers.get('content-type') || '';
                        if (contentType.includes('application/json')) {
                            return response.json().then((err) => {
                                throw new Error(err.error || 'Não foi possível salvar os dados do óbito.');
                            });
                        }
                        return response.text().then((text) => {
                            throw new Error(text || 'Não foi possível salvar os dados do óbito.');
                        });
                    }
                    return response.json();
                })
                .then((data) => {
                    const card = document.querySelector(`.info-card[data-parte-id="${parteId}"]`);
                    if (card) {
                        card.dataset.obito = '1';
                    }
                    updateCardObitoData(card, data);
                    hideObitoModal();
                    createSystemAlert('Óbito', 'Dados atualizados com sucesso.');
                })
                .catch((error) => {
                    createSystemAlert('Óbito', error.message || 'Erro ao salvar os dados do óbito.');
                })
                .finally(() => {
                    saveButton.disabled = false;
                });
        });
    };
    const buildHerdeirosCacheKey = (cpf, parteId = '', processoId = '') => {
        return `${cpf}:${parteId || ''}:${processoId || ''}`;
    };
    const fetchHerdeiros = (cpf, parteId = '', processoId = '') => {
        const normalized = normalizeCpf(cpf);
        if (!normalized) {
            return Promise.resolve({ cpf_falecido: '', herdeiros: [] });
        }
        const cacheKey = buildHerdeirosCacheKey(normalized, parteId, processoId);
        if (herdeirosCache.has(cacheKey)) {
            return herdeirosCache.get(cacheKey);
        }
        const query = new URLSearchParams({ cpf_falecido: normalized });
        if (parteId) {
            query.set('parte_id', parteId);
        }
        if (processoId) {
            query.set('processo_id', processoId);
        }
        const promise = fetch(`/api/herdeiros/?${query.toString()}`)
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Falha ao buscar herdeiros.');
                }
                return response.json();
            })
            .catch((error) => {
                herdeirosCache.delete(cacheKey);
                throw error;
            });
        herdeirosCache.set(cacheKey, promise);
        return promise;
    };
    const updateHerdeirosBadge = (card, hasEntries) => {
        if (!card) return;
        const trigger = card.querySelector('.herdeiros-trigger');
        if (!trigger) return;
        trigger.classList.toggle('has-herdeiros', hasEntries);
    };
    const buildHerdeirosModal = () => {
        let modal = document.getElementById('herdeiros-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'herdeiros-modal';
        modal.className = 'herdeiros-modal';
        modal.setAttribute('aria-hidden', 'true');
        modal.innerHTML = `
            <div class="herdeiros-modal__panel" role="dialog" aria-modal="true">
                <div class="herdeiros-modal__header">
                    <span>Herdeiros cadastrados</span>
                    <button type="button" class="herdeiros-modal__close" aria-label="Fechar">×</button>
                </div>
                <div class="herdeiros-modal__body">
                    <div class="herdeiros-empty">Nenhum herdeiro informado ainda.</div>
                </div>
                <div class="herdeiros-modal__heritage-form" hidden>
                    <label>
                        Valor da herança
                        <input type="text" name="heranca_valor" placeholder="R$ 0,00">
                    </label>
                    <label>
                        Descrição
                        <input type="text" name="heranca_descricao" placeholder="Ex: Terreno, cota...">
                    </label>
                    <div class="herdeiros-modal__heritage-form-actions">
                        <button type="button" class="herdeiros-modal__heritage-apply">Aplicar</button>
                        <button type="button" class="herdeiros-modal__heritage-cancel">Cancelar</button>
                    </div>
                </div>
                <div class="herdeiros-modal__footer">
                    <div class="herdeiros-modal__footer-actions">
                        <button type="button" class="herdeiros-modal__add">+ Adicionar herdeiro</button>
                        <button type="button" class="herdeiros-modal__heritage-toggle">Informar Herança</button>
                        <span class="herdeiros-modal__heritage-summary" aria-live="polite" hidden></span>
                    </div>
                    <button type="button" class="herdeiros-modal__save">Salvar herdeiros</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.setAttribute('aria-hidden', 'true');
            }
        });
        modal.querySelector('.herdeiros-modal__close').addEventListener('click', () => {
            modal.setAttribute('aria-hidden', 'true');
        });
        const attachDescricaoTooltip = () => {
            const descriptionInput = modal.querySelector('.herdeiros-modal__heritage-form input[name=heranca_descricao]');
            if (!descriptionInput) return;
            descriptionInput.addEventListener('mouseenter', () => showObservationTooltip(descriptionInput));
            descriptionInput.addEventListener('focus', () => showObservationTooltip(descriptionInput));
            descriptionInput.addEventListener('mouseleave', () => scheduleObservationTooltipHide());
            descriptionInput.addEventListener('blur', () => hideObservationTooltip());
        };
        attachDescricaoTooltip();
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && modal.getAttribute('aria-hidden') !== 'true') {
                modal.setAttribute('aria-hidden', 'true');
            }
        });
        return modal;
    };
    const getHerancaNumericValue = (modal) => {
        if (!modal || !modal.dataset) return null;
        const raw = modal.dataset.herancaValue;
        if (!raw) return null;
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? numeric : null;
    };
    const updateHerancaSummary = (modal) => {
        if (!modal) return;
        const summary = modal.querySelector('.herdeiros-modal__heritage-summary');
        if (!summary) return;
        const value = getHerancaNumericValue(modal);
        if (!value) {
            summary.textContent = '';
            summary.hidden = true;
            return;
        }
        const description = (modal.dataset.herancaDescription || '').trim();
        const parts = [];
        if (description) {
            parts.push(description);
        }
        summary.textContent = parts.join(' · ');
        summary.hidden = false;
    };
    const updatePartilhaFields = (modal) => {
        if (!modal) return;
        const body = modal.querySelector('.herdeiros-modal__body');
        if (!body) return;
        const entries = Array.from(body.querySelectorAll('.herdeiros-entry'));
        const herancaValue = getHerancaNumericValue(modal);
        const share = herancaValue && entries.length ? herancaValue / entries.length : null;
        entries.forEach((entry) => {
            const partilhaInput = entry.querySelector('input[name=partilha]');
            if (!partilhaInput) return;
            partilhaInput.value = share ? formatCurrencyBrl(share) : '';
        });
    };
    const setHerancaState = (modal, numericValue, description) => {
        if (!modal) return;
        if (numericValue !== null) {
            modal.dataset.herancaValue = String(numericValue);
        } else {
            delete modal.dataset.herancaValue;
        }
        if (description) {
            modal.dataset.herancaDescription = description;
        } else {
            delete modal.dataset.herancaDescription;
        }
        const heritageForm = modal.querySelector('.herdeiros-modal__heritage-form');
        if (heritageForm) {
            const valorInput = heritageForm.querySelector('input[name="heranca_valor"]');
            const descInput = heritageForm.querySelector('input[name="heranca_descricao"]');
            if (valorInput) {
                valorInput.value = numericValue !== null ? formatCurrencyBrl(numericValue) : '';
            }
            if (descInput) {
                descInput.value = description || '';
            }
        }
        updateHerancaSummary(modal);
        updatePartilhaFields(modal);
        const cardSelector = modal.dataset.parteId
            ? `.info-card[data-parte-id="${modal.dataset.parteId}"]`
            : null;
        const card = cardSelector ? document.querySelector(cardSelector) : null;
        if (card) {
            if (modal.dataset.herancaValue) {
                card.dataset.herancaValue = modal.dataset.herancaValue;
            } else {
                delete card.dataset.herancaValue;
            }
            if (modal.dataset.herancaDescription) {
                card.dataset.herancaDescription = modal.dataset.herancaDescription;
            } else {
                delete card.dataset.herancaDescription;
            }
        }
    };
    const refreshHerancaInputs = (modal) => {
        if (!modal) return;
        const form = modal.querySelector('.herdeiros-modal__heritage-form');
        if (!form) return;
        const valorInput = form.querySelector('input[name=heranca_valor]');
        const descInput = form.querySelector('input[name=heranca_descricao]');
        const value = getHerancaNumericValue(modal);
        if (valorInput) {
            valorInput.value = value ? formatCurrencyBrl(value) : '';
        }
        if (descInput) {
            descInput.value = modal.dataset.herancaDescription || '';
        }
    };
    const renderHerdeiroEntry = (data = {}, index = 0) => {
        const entry = document.createElement('div');
        entry.className = 'herdeiros-entry';
        entry.dataset.index = `${index}`;
        entry.innerHTML = `
            <div class="herdeiros-entry__row">
                <label>Nome completo
                    <input type="text" name="nome_completo">
                </label>
                <label>CPF
                    <input type="text" name="cpf">
                </label>
                <label>RG
                    <input type="text" name="rg">
                </label>
                <label>Grau de parentesco
                    <input type="text" name="grau_parentesco">
                </label>
                <label class="herdeiros-entry__partilha">Partilha
                    <input type="text" name="partilha" readonly>
                </label>
            </div>
            <div class="herdeiros-entry__actions">
                <label class="herdeiros-entry__citado">
                    <input type="checkbox" name="herdeiro_citado">
                    Herdeiro citado
                </label>
                <button type="button" class="herdeiros-entry__remove">Remover</button>
            </div>
        `;
        const setValue = (name, value) => {
            const input = entry.querySelector(`input[name="${name}"]`);
            if (input) {
                input.value = value || '';
            }
        };
        setValue('nome_completo', data.nome_completo);
        setValue('cpf', data.cpf);
        setValue('rg', data.rg);
        setValue('grau_parentesco', data.grau_parentesco);
        const citadoInput = entry.querySelector('input[name="herdeiro_citado"]');
        if (citadoInput) {
            citadoInput.checked = !!data.herdeiro_citado;
        }
        const enderecoWrapper = createEnderecoWidget(`herdeiros_endereco_${Date.now()}_${index}`, data.endereco || '');
        entry.appendChild(enderecoWrapper);
        const cpfInput = entry.querySelector('input[name="cpf"]');
        attachCpfMaskAndCopy(cpfInput);
        return entry;
    };
    const collectHerdeirosFromModal = (modal) => {
        const entries = [];
        modal.querySelectorAll('.herdeiros-entry').forEach((entryEl) => {
            const nome = entryEl.querySelector('input[name="nome_completo"]')?.value?.trim() || '';
            const cpf = entryEl.querySelector('input[name="cpf"]')?.value?.trim() || '';
            const rg = entryEl.querySelector('input[name="rg"]')?.value?.trim() || '';
            const grau = entryEl.querySelector('input[name="grau_parentesco"]')?.value?.trim() || '';
            const citado = !!entryEl.querySelector('input[name="herdeiro_citado"]')?.checked;
            const endereco = entryEl.querySelector('.herdeiros-endereco-raw')?.value || '';
            if (!nome && !cpf && !rg && !grau && !endereco) {
                return;
            }
            entries.push({
                nome_completo: nome,
                cpf,
                rg,
                grau_parentesco: grau,
                herdeiro_citado: citado,
                endereco,
            });
        });
        return entries;
    };
    const renderHerdeirosModal = (modal, herdeiros = []) => {
        const body = modal.querySelector('.herdeiros-modal__body');
        if (!body) return;
        body.innerHTML = '';
        if (!herdeiros.length) {
            body.innerHTML = '<div class="herdeiros-empty">Nenhum herdeiro informado ainda.</div>';
            return;
        }
        herdeiros.forEach((herdeiro, index) => {
            const entry = renderHerdeiroEntry(herdeiro, index);
            body.appendChild(entry);
        });
        body.querySelectorAll('input[name="herdeiro_citado"]').forEach((checkbox) => {
            checkbox.addEventListener('change', (event) => {
                if (!event.target.checked) return;
                body.querySelectorAll('input[name="herdeiro_citado"]').forEach((other) => {
                    if (other !== event.target) {
                        other.checked = false;
                    }
                });
            });
        });
        body.querySelectorAll('.herdeiros-entry__remove').forEach((button) => {
            button.addEventListener('click', () => {
                button.closest('.herdeiros-entry')?.remove();
                if (!body.querySelector('.herdeiros-entry')) {
                    body.innerHTML = '<div class="herdeiros-empty">Nenhum herdeiro informado ainda.</div>';
                }
                updatePartilhaFields(modal);
            });
        });
        updatePartilhaFields(modal);
    };
    const openHerdeirosModal = (card) => {
        const cpfRaw = card?.dataset?.parteCpf || '';
        const cpf = normalizeCpf(cpfRaw);
        if (!cpf) {
            createSystemAlert('CFF System', 'CPF do falecido não encontrado para cadastrar herdeiros.');
            return;
        }
        const modal = buildHerdeirosModal();
        modal.dataset.cpf = cpf;
        if (card?.dataset?.parteId) {
            modal.dataset.parteId = card.dataset.parteId;
        }
        if (card?.dataset?.processoId) {
            modal.dataset.processoId = card.dataset.processoId;
        }
        const heritageForm = modal.querySelector('.herdeiros-modal__heritage-form');
        if (card) {
            modal.dataset.herancaValue = card.dataset.herancaValue || '';
            modal.dataset.herancaDescription = card.dataset.herancaDescription || '';
        } else {
            delete modal.dataset.herancaValue;
            delete modal.dataset.herancaDescription;
        }
        if (heritageForm) {
            heritageForm.hidden = true;
            heritageForm.classList.remove('herdeiros-modal__heritage-form--visible');
        }
        updateHerancaSummary(modal);
        refreshHerancaInputs(modal);
        updatePartilhaFields(modal);
        modal.setAttribute('aria-hidden', 'false');
        const body = modal.querySelector('.herdeiros-modal__body');
        if (body) {
            body.innerHTML = '<div class="herdeiros-empty">Carregando herdeiros...</div>';
        }
        const parteId = card?.dataset?.parteId || '';
        const processoId = card?.dataset?.processoId || '';
        fetchHerdeiros(cpf, parteId, processoId)
            .then((data) => {
                if (data && (data.heranca_valor || data.heranca_descricao)) {
                    const parsedValue = data.heranca_valor ? Number(data.heranca_valor) : null;
                    setHerancaState(modal, Number.isFinite(parsedValue) ? parsedValue : null, data.heranca_descricao || '');
                }
                renderHerdeirosModal(modal, data.herdeiros || []);
            })
            .catch(() => {
                if (body) {
                    body.innerHTML = '<div class="herdeiros-empty">Não foi possível carregar os herdeiros.</div>';
                }
            });
    };
    const setupHerdeirosModalActions = () => {
        const modal = buildHerdeirosModal();
        const addButton = modal.querySelector('.herdeiros-modal__add');
        const saveButton = modal.querySelector('.herdeiros-modal__save');
        const body = modal.querySelector('.herdeiros-modal__body');
        const heritageToggle = modal.querySelector('.herdeiros-modal__heritage-toggle');
        const heritageForm = modal.querySelector('.herdeiros-modal__heritage-form');
        const heritageValueInput = heritageForm?.querySelector('input[name="heranca_valor"]');
        const heritageDescriptionInput = heritageForm?.querySelector('input[name="heranca_descricao"]');
        const heritageApply = heritageForm?.querySelector('.herdeiros-modal__heritage-apply');
        const heritageCancel = heritageForm?.querySelector('.herdeiros-modal__heritage-cancel');
        const isHerdeiroFilled = (entry) => {
            if (!entry) return false;
            const nome = entry.querySelector('input[name="nome_completo"]')?.value?.trim() || '';
            const cpf = entry.querySelector('input[name="cpf"]')?.value?.trim() || '';
            const rg = entry.querySelector('input[name="rg"]')?.value?.trim() || '';
            const grau = entry.querySelector('input[name="grau_parentesco"]')?.value?.trim() || '';
            const enderecoRaw = entry.querySelector('.herdeiros-endereco-raw')?.value || '';
            const enderecoParts = parseEnderecoString(enderecoRaw);
            const enderecoHasValue = Object.values(enderecoParts).some((value) => (value || '').trim());
            return Boolean(nome || cpf || rg || grau || enderecoHasValue);
        };
        const showHerancaForm = () => {
            if (!heritageForm) return;
            heritageForm.hidden = false;
            heritageForm.classList.add('herdeiros-modal__heritage-form--visible');
            refreshHerancaInputs(modal);
            heritageValueInput?.focus();
        };
        const hideHerancaForm = () => {
            if (!heritageForm) return;
            heritageForm.hidden = true;
            heritageForm.classList.remove('herdeiros-modal__heritage-form--visible');
        };
        if (heritageToggle && heritageForm) {
            heritageToggle.addEventListener('click', () => {
                if (heritageForm.hidden) {
                    showHerancaForm();
                } else {
                    hideHerancaForm();
                }
            });
        }
        if (heritageApply) {
            heritageApply.addEventListener('click', () => {
                const raw = heritageValueInput?.value || '';
                if (!raw.trim()) {
                    setHerancaState(modal, null, '');
                    hideHerancaForm();
                    return;
                }
                const parsed = normalizeNumericCurrency(raw);
                if (parsed === null) {
                    createSystemAlert('Informar Herança', 'Informe um valor válido para a herança.');
                    heritageValueInput?.focus();
                    return;
                }
                const description = (heritageDescriptionInput?.value || '').trim();
                setHerancaState(modal, parsed, description);
                hideHerancaForm();
            });
        }
        if (heritageCancel) {
            heritageCancel.addEventListener('click', () => {
                hideHerancaForm();
            });
        }
        if (addButton) {
            addButton.addEventListener('click', () => {
                if (!body) return;
                const entries = Array.from(body.querySelectorAll('.herdeiros-entry'));
                const lastEntry = entries[entries.length - 1];
                if (lastEntry && !isHerdeiroFilled(lastEntry)) {
                    createSystemAlert('CFF System', 'Preencha o herdeiro atual antes de adicionar outro.');
                    lastEntry.querySelector('input[name="nome_completo"]')?.focus();
                    return;
                }
                const entry = renderHerdeiroEntry({}, body.querySelectorAll('.herdeiros-entry').length);
                if (body.querySelector('.herdeiros-empty')) {
                    body.innerHTML = '';
                }
                body.appendChild(entry);
                entry.querySelectorAll('input[name="herdeiro_citado"]').forEach((checkbox) => {
                    checkbox.addEventListener('change', (event) => {
                        if (!event.target.checked) return;
                        body.querySelectorAll('input[name="herdeiro_citado"]').forEach((other) => {
                            if (other !== event.target) {
                                other.checked = false;
                            }
                        });
                    });
                });
                entry.querySelector('.herdeiros-entry__remove')?.addEventListener('click', () => {
                    entry.remove();
                    if (!body.querySelector('.herdeiros-entry')) {
                        body.innerHTML = '<div class="herdeiros-empty">Nenhum herdeiro informado ainda.</div>';
                    }
                    updatePartilhaFields(modal);
                });
                updatePartilhaFields(modal);
            });
        }
        if (saveButton) {
            saveButton.addEventListener('click', () => {
                const cpf = modal.dataset.cpf;
                const herdeiros = collectHerdeirosFromModal(modal);
                if (!cpf) {
                    createSystemAlert('CFF System', 'CPF do falecido não encontrado para salvar herdeiros.');
                    return;
                }
                saveButton.disabled = true;
                const herancaValue = modal.dataset.herancaValue || '';
                const herancaDescription = modal.dataset.herancaDescription || '';
                fetch('/api/herdeiros/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrftoken || '',
                    },
                    body: JSON.stringify({
                        cpf_falecido: cpf,
                        herdeiros,
                        parte_id: modal.dataset.parteId || '',
                        processo_id: modal.dataset.processoId || '',
                        heranca_valor: herancaValue,
                        heranca_descricao: herancaDescription,
                    }),
                })
                    .then((response) => {
                        if (!response.ok) {
                            throw new Error('Falha ao salvar herdeiros.');
                        }
                        return response.json();
                    })
                    .then((data) => {
                        modal.setAttribute('aria-hidden', 'true');
                        const cacheKey = buildHerdeirosCacheKey(
                            cpf,
                            modal.dataset.parteId || '',
                            modal.dataset.processoId || ''
                        );
                        herdeirosCache.set(cacheKey, Promise.resolve(data));
                        const card = modal.dataset.parteId
                            ? document.querySelector(`.info-card[data-parte-id="${modal.dataset.parteId}"]`)
                            : null;
                        updateHerdeirosBadge(card, (data.herdeiros || []).length > 0);
                        if (card) {
                            if (typeof data.heranca_valor !== 'undefined') {
                                card.dataset.herancaValue = data.heranca_valor || '';
                            }
                            if (typeof data.heranca_descricao !== 'undefined') {
                                card.dataset.herancaDescription = data.heranca_descricao || '';
                            }
                        }
                        if (data.heranca_valor || data.heranca_descricao) {
                            const parsedValue = data.heranca_valor ? Number(data.heranca_valor) : null;
                            setHerancaState(modal, Number.isFinite(parsedValue) ? parsedValue : null, data.heranca_descricao || '');
                        }
                        createSystemAlert('CFF System', 'Herdeiros salvos com sucesso.');
                    })
                    .catch(() => {
                        createSystemAlert('CFF System', 'Não foi possível salvar os herdeiros.');
                    })
                    .finally(() => {
                        saveButton.disabled = false;
                    });
            });
        }
    };
    const infoCards = document.querySelectorAll('.info-card');
    const hasHerdeirosTrigger = document.querySelector('.herdeiros-trigger');
    if (hasHerdeirosTrigger) {
        setupHerdeirosModalActions();
        infoCards.forEach((card) => {
            const hasObito = card.dataset.obito === '1';
            const trigger = card.querySelector('.herdeiros-trigger');
            if (trigger) {
                trigger.addEventListener('click', () => openHerdeirosModal(card));
            }
            if (hasObito && card.dataset.parteCpf) {
                const cpf = normalizeCpf(card.dataset.parteCpf);
                if (cpf) {
                    const parteId = card.dataset.parteId || '';
                    const processoId = card.dataset.processoId || '';
                    fetchHerdeiros(cpf, parteId, processoId)
                        .then((data) => {
                            updateHerdeirosBadge(card, (data.herdeiros || []).length > 0);
                        })
                        .catch(() => {});
                }
            }
        });
    } else {
        infoCards.forEach((card) => {
            const hasObito = card.dataset.obito === '1';
            if (hasObito && card.dataset.parteCpf) {
                const cpf = normalizeCpf(card.dataset.parteCpf);
                if (cpf) {
                    const parteId = card.dataset.parteId || '';
                    const processoId = card.dataset.processoId || '';
                    fetchHerdeiros(cpf, parteId, processoId)
                        .then((data) => {
                            updateHerdeirosBadge(card, (data.herdeiros || []).length > 0);
                        })
                        .catch(() => {});
                }
            }
        });
    }

    const setupObitoRibbonHandlers = () => {
        setupObitoModalActions();
        const cards = document.querySelectorAll('.info-card');
        cards.forEach((card) => {
            const button = card.querySelector('.parte-luto-ribbon');
            if (!button) return;
            button.addEventListener('click', () => openObitoModal(card));
            const handleTooltip = () => {
                const text = computeObitoTooltipText(card);
                if (text) {
                    showObservationTooltipForTarget(button, text);
                }
            };
            button.addEventListener('mouseenter', handleTooltip);
            button.addEventListener('focus', handleTooltip);
            button.addEventListener('mouseleave', scheduleObservationTooltipHide);
            button.addEventListener('blur', hideObservationTooltip);
        });
    };
    setupObitoRibbonHandlers();

    const repositionHistoryLink = () => {
        const historyLink = document.querySelector('#content-main .object-tools li .historylink');
        const delegarTool = document.getElementById('delegar-tool');
        if (!historyLink || !delegarTool) return;
        const historyLi = historyLink.closest('li');
        if (!historyLi) return;
        delegarTool.parentNode.insertBefore(historyLi, delegarTool.nextSibling);
    };
    repositionHistoryLink();

    if (cnjInput && searchButton) {
        const toggleButtonState = () => {
            const cnjLimpo = cnjInput.value.replace(/\D/g, '');
            searchButton.disabled = cnjLimpo.length < 10;
        };
        toggleButtonState();
        cnjInput.addEventListener('input', toggleButtonState);

        searchButton.addEventListener('click', function() {
            const cnj = cnjInput.value.trim().replace(/\D/g, ''); // Limpa o CNJ para garantir que só números sejam enviados
            if (!cnj) {
                setFeedback('Por favor, insira um número de CNJ.', 'error');
                return;
            }

            const url = `/api/buscar-dados-escavador/${cnj}/`;
            setFeedback('Buscando dados online...', 'loading');

            fetch(url, {
                method: 'GET',
                headers: {
                    'X-CSRFToken': csrftoken,
                }
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => {
                        throw new Error(err.message || `Erro ${response.status}: ${response.statusText}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'success') {
                    setFeedback(data.message, 'success');
                    fillFormFields(data.processo, data.partes, data.andamentos);
                } else {
                    throw new Error(data.message);
                }
            })
            .catch(error => {
                console.error('Erro na requisição:', error);
                setFeedback(error.message || 'Ocorreu um erro inesperado.', 'error');
            });
        });
    }

    function setFeedback(message, type) {
        if (cnjFeedback) {
            cnjFeedback.textContent = message;
            cnjFeedback.style.color = type === 'success' ? 'green' : (type === 'error' ? 'red' : 'orange');
        }
    }

    // --- Funções Auxiliares para Inlines de Parte ---

    // Função para aplicar máscara de CPF/CNPJ
    function maskCpfCnpj(value) {
        let cleaned = value.replace(/\D/g, '');
        if (cleaned.length <= 11) { // CPF
            cleaned = cleaned.replace(/(\d{3})(\d)/, '$1.$2');
            cleaned = cleaned.replace(/(\d{3})(\d)/, '$1.$2');
            cleaned = cleaned.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        } else { // CNPJ
            cleaned = cleaned.replace(/^(\d{2})(\d)/, '$1.$2');
            cleaned = cleaned.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
            cleaned = cleaned.replace(/\.(\d{3})(\d)/, '.$1/$2');
            cleaned = cleaned.replace(/(\d{4})(\d)/, '$1-$2');
        }
        return cleaned;
    }

    // Atualiza o estado visual da inline de parte (ex: cor de fundo, visibilidade do botão CIA)
    function updateParteDisplay(parteInline) {
        const tipoPoloSelect = parteInline.querySelector('[id$="-tipo_polo"]');
        const enderecoField = parteInline.querySelector('.field-endereco');
        const enderecoGrid = enderecoField ? enderecoField.querySelector('.endereco-fields-grid') : null;
        const toggleBtn = enderecoField ? enderecoField.querySelector('.endereco-toggle-button') : null;
        const clearBtn = enderecoField ? enderecoField.querySelector('.endereco-clear-button') : null;
        const dataNascimentoField = parteInline.querySelector('.field-data_nascimento');
        const isPassive = tipoPoloSelect && tipoPoloSelect.value === 'PASSIVO';

        if (isPassive) {
            parteInline.style.backgroundColor = 'rgba(220, 230, 255, 0.5)'; // Azul claro sutil
        } else {
            parteInline.style.backgroundColor = ''; // Remove cor se não for passivo
        }

        // Minimiza endereço para polo ativo, expande para passivo
        if (enderecoGrid) {
            const showGrid = isPassive;
            enderecoGrid.style.display = showGrid ? 'grid' : 'none';
            if (toggleBtn) toggleBtn.style.display = 'inline-block';
            if (clearBtn) clearBtn.style.display = showGrid ? 'inline-block' : 'none';
        }

        if (dataNascimentoField) {
            dataNascimentoField.style.display = isPassive ? '' : 'none';
        }

        setupCiaButton(parteInline); // Garante que o botão CIA seja atualizado
    }

    // Configura o botão CIA (Completar Informações de Endereço) para uma inline de parte
    function setupCiaButton(parteInline) {
        const enderecoInput = parteInline.querySelector('[id$="-endereco"]');
        const tipoPoloSelect = parteInline.querySelector('[id$="-tipo_polo"]');
        const documentoInput = parteInline.querySelector('[id$="-documento"]'); // Necessário para a API do CIA
        let ciaButton = parteInline.querySelector('.cia-button');
        let clearButton = parteInline.querySelector('.endereco-clear-button');

        const isPassive = tipoPoloSelect && tipoPoloSelect.value === 'PASSIVO';

        if (enderecoInput) {
            if (isPassive && !ciaButton) {
                // Cria o botão se for polo passivo e ainda não existir
                ciaButton = document.createElement('button');
                ciaButton.type = 'button';
                ciaButton.className = 'button cia-button';
                ciaButton.innerText = 'CEP';
                ciaButton.style.marginLeft = '5px';
                enderecoInput.parentNode.appendChild(ciaButton);
            } else if (!isPassive && ciaButton) {
                // Remove o botão se não for polo passivo e ele existir
                ciaButton.remove();
                ciaButton = null;
            }

            const fetchEnderecoCIA = () => {
                const cpfCnpj = documentoInput ? documentoInput.value.replace(/\D/g, '') : '';
                if (!cpfCnpj || cpfCnpj.length < 11) {
                    return;
                }
                const url = `/api/fetch-address/${cpfCnpj}/`;
                fetch(url)
                    .then(response => response.json())
                    .then(data => {
                        if (data.endereco_formatado) {
                            enderecoInput.value = data.endereco_formatado;
                            enderecoInput.dispatchEvent(new Event('change', { bubbles: true }));
                        } else if (data.error) {
                            console.warn('Erro ao buscar endereço:', data.error);
                        }
                    })
                    .catch(error => {
                        console.error('Erro na requisição da API de endereço:', error);
                    });
            };

            if (ciaButton) {
                // Configura o handler do botão (se ele existir)
                ciaButton.onclick = function() {
                    const cpfCnpj = documentoInput ? documentoInput.value.replace(/\D/g, '') : '';
                    if (!cpfCnpj) {
                        alert('Por favor, informe o CPF/CNPJ da parte para buscar o endereço.');
                        return;
                    }
                    fetchEnderecoCIA();
                };
            }

            // Dispara automaticamente ao preencher o CPF/CNPJ do polo passivo (menos cliques)
            if (documentoInput) {
                documentoInput.addEventListener('blur', () => {
                    if (tipoPoloSelect && tipoPoloSelect.value === 'PASSIVO') {
                        fetchEnderecoCIA();
                    }
                });
            }

            // Botão de limpar endereço (sempre disponível)
            if (!clearButton) {
                clearButton = document.createElement('button');
                clearButton.type = 'button';
                clearButton.className = 'button endereco-clear-button';
                clearButton.innerText = '🧹';
                clearButton.title = 'Limpar endereço';
                clearButton.style.marginLeft = '5px';
                clearButton.style.background = 'transparent';
                clearButton.style.border = 'none';
                clearButton.style.color = '#555';
                clearButton.style.cursor = 'pointer';
                clearButton.style.float = 'right';
                enderecoInput.parentNode.appendChild(clearButton);
            }
            clearButton.onclick = function() {
                enderecoInput.value = '';
                const fieldWrapper = enderecoInput.closest('.field-endereco');
                if (fieldWrapper) {
                    fieldWrapper.querySelectorAll('input[data-part]').forEach(inp => {
                        inp.value = '';
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                }
                enderecoInput.dispatchEvent(new Event('change', { bubbles: true }));
            };
        }
    }


    // Configura campo de documento (máscara e tipo de pessoa) para uma inline de parte
    function setupDocumentoField(parteInline) {
        const documentoInput = parteInline.querySelector('[id$="-documento"]');
        const tipoPessoaSelect = parteInline.querySelector('[id$="-tipo_pessoa"]');

        if (documentoInput) {
            // Aplica máscara inicial e atualiza no input
            documentoInput.value = maskCpfCnpj(documentoInput.value);

            documentoInput.addEventListener('input', function() {
                const cleanedValue = this.value.replace(/\D/g, '');
                this.value = maskCpfCnpj(cleanedValue);

                // Auto-set tipo_pessoa
                if (tipoPessoaSelect) {
                    if (cleanedValue.length > 0 && cleanedValue.length <= 11) {
                        tipoPessoaSelect.value = 'PF'; // Pessoa Física
                    } else if (cleanedValue.length > 11) {
                        tipoPessoaSelect.value = 'PJ'; // Pessoa Jurídica
                    } else {
                        tipoPessoaSelect.value = ''; // Limpa se vazio
                    }
                }
            });
        }
    }

    // Função principal para configurar uma inline de parte
    const DEMANDAS_CPF_ENDPOINT = '/api/demandas/cpf/';
    const DEMANDAS_CPF_PREVIEW_ENDPOINT = '/api/demandas/cpf/preview';
    const DEMANDAS_CPF_IMPORT_ENDPOINT = '/api/demandas/cpf/import';

    const normalizeCpfDigits = (value) => String(value || '').replace(/\D/g, '');

    const findEmptyContratoRow = () => {
        const rows = Array.from(document.querySelectorAll('#contratos-group .dynamic-contratos'))
            .filter(row => !row.classList.contains('empty-form'));
        return rows.find(row => {
            const numeroInput = row.querySelector('input[id$="-numero_contrato"]');
            return numeroInput && !numeroInput.value;
        }) || null;
    };

    const getExistingContratoNumbers = () => {
        const numbers = new Set();
        document.querySelectorAll('#contratos-group input[id$="-numero_contrato"]').forEach(input => {
            const val = (input.value || '').trim();
            if (val) numbers.add(val);
        });
        return numbers;
    };

    const fillContratoRow = (row, contrato) => {
        if (!row || !contrato) return;
        const numeroInput = row.querySelector('input[id$="-numero_contrato"]');
        const valorTotalInput = row.querySelector('input[id$="-valor_total_devido"]');
        const valorCausaInput = row.querySelector('input[id$="-valor_causa"]');
        const parcelasInput = row.querySelector('input[id$="-parcelas_em_aberto"]');
        const prescricaoInput = row.querySelector('input[id$="-data_prescricao"]');
        if (numeroInput && contrato.numero_contrato) {
            numeroInput.value = contrato.numero_contrato;
            numeroInput.dispatchEvent(new Event('input', { bubbles: true }));
            numeroInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const valorBase = contrato.valor_total_devido || contrato.valor_causa || '';
        if (valorTotalInput) {
            valorTotalInput.value = formatCurrencyBrl(valorBase);
            valorTotalInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (valorCausaInput) {
            valorCausaInput.value = formatCurrencyBrl(valorBase);
            valorCausaInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (parcelasInput && typeof contrato.parcelas_em_aberto !== 'undefined') {
            parcelasInput.value = contrato.parcelas_em_aberto;
            parcelasInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (prescricaoInput && contrato.data_prescricao) {
            prescricaoInput.value = contrato.data_prescricao;
            prescricaoInput.dispatchEvent(new Event('input', { bubbles: true }));
            prescricaoInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    const appendContratosFromDemandas = (contratos = []) => {
        if (!contratos.length) return;
        const addButton = document.querySelector('#contratos-group .add-row a');
        const existing = getExistingContratoNumbers();
        const pendentes = contratos.filter(contract => contract.numero_contrato && !existing.has(contract.numero_contrato));
        if (!pendentes.length) return;
        pendentes.forEach(contract => {
            let row = findEmptyContratoRow();
            if (!row && addButton) {
                addButton.click();
                const rows = Array.from(document.querySelectorAll('#contratos-group .dynamic-contratos'))
                    .filter(r => !r.classList.contains('empty-form'));
                row = rows[rows.length - 1] || null;
            }
            if (row) {
                fillContratoRow(row, contract);
            }
        });
    };

    const applyDemandasDataToParte = (parteInline, data) => {
        if (!parteInline || !data) return;
        const nomeInput = parteInline.querySelector('[id$="-nome"]');
        const documentoInput = parteInline.querySelector('[id$="-documento"]');
        const tipoPessoaSelect = parteInline.querySelector('[id$="-tipo_pessoa"]');
        const tipoPoloSelect = parteInline.querySelector('[id$="-tipo_polo"]');
        const enderecoInput = parteInline.querySelector('[id$="-endereco"]');
        if (tipoPoloSelect && !tipoPoloSelect.value) {
            tipoPoloSelect.value = 'PASSIVO';
            tipoPoloSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (nomeInput && data.nome) {
            nomeInput.value = data.nome;
            nomeInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (documentoInput && data.documento) {
            documentoInput.value = data.documento;
            documentoInput.dispatchEvent(new Event('input', { bubbles: true }));
            documentoInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (tipoPessoaSelect && data.tipo_pessoa) {
            tipoPessoaSelect.value = data.tipo_pessoa;
            tipoPessoaSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (enderecoInput && data.endereco) {
            enderecoInput.value = data.endereco;
            enderecoInput.dispatchEvent(new Event('input', { bubbles: true }));
            enderecoInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        appendContratosFromDemandas(data.contratos || []);
    };

    const fetchDemandasCpf = async (cpfDigits, carteiraId = '') => {
        if (!cpfDigits) {
            throw new Error('Informe um CPF válido.');
        }
        const url = `${DEMANDAS_CPF_ENDPOINT}${cpfDigits}/` + (carteiraId ? `?carteira_id=${carteiraId}` : '');
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || 'Não foi possível buscar o CPF.');
        }
        const payload = await response.json();
        if (payload.status !== 'success') {
            throw new Error(payload.error || 'CPF não encontrado.');
        }
        return payload.data;
    };

    const parseCpfBatch = (value) => {
        const digits = String(value || '').split(/\s|,|;|\t|\n/);
        const normalized = digits
            .map(item => item.replace(/\D/g, ''))
            .filter(item => item.length >= 11);
        return Array.from(new Set(normalized));
    };

    const formatCpfLabel = (cpf) => {
        const digits = String(cpf || '').replace(/\D/g, '');
        if (digits.length !== 11) return cpf;
        return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
    };

    const fetchDemandasBatchPreview = async (cpfs, carteiraId = '') => {
        const response = await fetch(DEMANDAS_CPF_PREVIEW_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrftoken || '',
            },
            body: JSON.stringify({ cpfs, carteira_id: carteiraId || '' }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.status !== 'success') {
            throw new Error(payload.error || 'Não foi possível gerar o preview.');
        }
        return payload;
    };

    const fetchDemandasBatchImport = async (cpfs, etiquetaNome, carteiraId = '') => {
        const response = await fetch(DEMANDAS_CPF_IMPORT_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrftoken || '',
            },
            body: JSON.stringify({ cpfs, etiqueta_nome: etiquetaNome, carteira_id: carteiraId || '' }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.status !== 'success') {
            throw new Error(payload.error || 'Não foi possível importar os CPFs.');
        }
        return payload;
    };

    const openDemandasBatchModal = () => {
        if (document.querySelector('.cpf-demandas-modal')) return;
        const overlay = document.createElement('div');
        overlay.className = 'cpf-demandas-modal';
        overlay.innerHTML = `
            <div class="cpf-demandas-modal__card">
                <div class="cpf-demandas-modal__header">
                    <strong>Importar CPFs (lote)</strong>
                    <button type="button" class="cpf-demandas-modal__close">×</button>
                </div>
                <div class="cpf-demandas-modal__body">
                    <label>CPFs (cole da planilha)</label>
                    <textarea class="cpf-demandas-modal__textarea" placeholder="Cole aqui os CPFs separados por linha ou vírgula"></textarea>
                    <button type="button" class="button cpf-demandas-modal__preview-btn">Pré-visualizar</button>
                    <div class="cpf-demandas-modal__preview"></div>
                    <div class="cpf-demandas-modal__etiqueta">
                        <label>Lote/Etiqueta</label>
                        <input type="text" class="cpf-demandas-modal__etiqueta-input" placeholder="Ex: Precatórios Jan">
                    </div>
                </div>
                <div class="cpf-demandas-modal__footer">
                    <button type="button" class="button cpf-demandas-modal__import">Importar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const closeButton = overlay.querySelector('.cpf-demandas-modal__close');
        const previewBtn = overlay.querySelector('.cpf-demandas-modal__preview-btn');
        const importBtn = overlay.querySelector('.cpf-demandas-modal__import');
        const textarea = overlay.querySelector('.cpf-demandas-modal__textarea');
        const previewBox = overlay.querySelector('.cpf-demandas-modal__preview');
        if (previewBox) {
            previewBox.style.display = 'block';
        }
        const etiquetaInput = overlay.querySelector('.cpf-demandas-modal__etiqueta-input');

        const close = () => overlay.remove();
        closeButton?.addEventListener('click', close);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });

        const renderPreview = (rows = []) => {
            previewBox.style.display = 'block';
            if (!rows.length) {
                previewBox.innerHTML = '<p>Nenhum CPF encontrado.</p>';
                return;
            }
            const header = `
                <div class="cpf-demandas-preview-row cpf-demandas-preview-row--head">
                    <span>CPF</span>
                    <span>Nome</span>
                    <span>Contratos</span>
                    <span>Total em aberto</span>
                    <span>Prescrição</span>
                </div>
            `;
            const body = rows.map(row => `
                <div class="cpf-demandas-preview-row">
                    <span>${row.cpf || formatCpfLabel(row.cpf_raw)}</span>
                    <span>${row.nome || ''}</span>
                    <span>${row.contratos || 0}</span>
                    <span>${row.total_aberto || ''}</span>
                    <span>${row.prescricao_ativadora || ''}</span>
                </div>
            `).join('');
            previewBox.innerHTML = header + body;
        };

            previewBtn?.addEventListener('click', async () => {
                const cpfs = parseCpfBatch(textarea?.value);
                if (!cpfs.length) {
                    createSystemAlert('Demandas', 'Cole ao menos um CPF.');
                    return;
                }
                previewBtn.disabled = true;
                previewBtn.textContent = 'Carregando...';
                try {
                    const carteiraId = document.getElementById('id_carteira')?.value || '';
                    const payload = await fetchDemandasBatchPreview(cpfs, carteiraId);
                    renderPreview(payload.rows || []);
                    previewBox.dataset.cpfs = JSON.stringify(cpfs);
                } catch (error) {
                    createSystemAlert('Demandas', error.message || 'Falha ao gerar preview.');
                    previewBox.innerHTML = '';
                    previewBox.style.display = 'none';
                } finally {
                    previewBtn.disabled = false;
                    previewBtn.textContent = 'Pré-visualizar';
                }
            });

        importBtn?.addEventListener('click', async () => {
            const cpfs = JSON.parse(previewBox.dataset.cpfs || '[]');
            if (!cpfs.length) {
                createSystemAlert('Demandas', 'Faça o preview antes de importar.');
                return;
            }
            const etiqueta = etiquetaInput?.value?.trim();
            if (!etiqueta) {
                createSystemAlert('Demandas', 'Informe um Lote/Etiqueta.');
                return;
            }
            importBtn.disabled = true;
            importBtn.textContent = 'Importando...';
            try {
                const carteiraId = document.getElementById('id_carteira')?.value || '';
                const result = await fetchDemandasBatchImport(cpfs, etiqueta, carteiraId);
                createSystemAlert('Demandas', `Importação concluída: ${result.imported || 0} importados, ${result.skipped || 0} ignorados.`);
                close();
            } catch (error) {
                createSystemAlert('Demandas', error.message || 'Falha ao importar.');
            } finally {
                importBtn.disabled = false;
                importBtn.textContent = 'Importar';
            }
        });
    };

    const handleDemandasCpfClick = async (button) => {
        const row = button.closest('.form-row.field-cpf-demandas') || button.closest('.cpf-demandas-group');
        const input = row?.querySelector('.cpf-demandas-input');
        const parteInline = button.closest('.dynamic-partes') || button.closest('.inline-related');
        const cpfDigits = normalizeCpfDigits(input?.value);
        if (!cpfDigits || cpfDigits.length < 11) {
            createSystemAlert('Demandas', 'Informe um CPF válido.');
            return;
        }
        const carteiraId = document.getElementById('id_carteira')?.value || '';
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = 'Buscando...';
        try {
            const data = await fetchDemandasCpf(cpfDigits, carteiraId);
            applyDemandasDataToParte(parteInline, data);
            createSystemAlert('Demandas', 'Cadastro importado com sucesso.');
        } catch (error) {
            createSystemAlert('Demandas', error.message || 'Não foi possível buscar o CPF.');
            console.error('[Demandas CPF] erro', error);
        } finally {
            button.disabled = false;
            button.textContent = originalText || 'Buscar';
        }
    };

    function setupParteInline(parteInline) {
        setupDocumentoField(parteInline);

        // Cria toggle para endereço (minimiza por padrão no polo ativo)
        const enderecoField = parteInline.querySelector('.field-endereco');
        if (enderecoField && !enderecoField.querySelector('.endereco-toggle-button')) {
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'button endereco-toggle-button';
            toggleBtn.innerText = '▸';
            toggleBtn.title = 'Expandir endereço';
            toggleBtn.style.marginLeft = '5px';
            toggleBtn.style.background = 'transparent';
            toggleBtn.style.border = 'none';
            toggleBtn.style.color = '#555';
            toggleBtn.style.cursor = 'pointer';
            toggleBtn.addEventListener('click', () => {
                const grid = enderecoField.querySelector('.endereco-fields-grid');
                const clearBtn = enderecoField.querySelector('.endereco-clear-button');
                if (!grid) return;
                const showing = grid.style.display !== 'none';
                const willShow = !showing;
                grid.style.display = willShow ? 'grid' : 'none';
                if (clearBtn) clearBtn.style.display = willShow ? 'inline-block' : 'none';
                toggleBtn.innerText = willShow ? '▾' : '▸';
                toggleBtn.title = willShow ? 'Recolher endereço' : 'Expandir endereço';
            });
            enderecoField.querySelector('label')?.appendChild(toggleBtn);
        }

        const tipoPoloSelect = parteInline.querySelector('[id$="-tipo_polo"]');
        if (tipoPoloSelect) {
            tipoPoloSelect.addEventListener('change', () => updateParteDisplay(parteInline));
        }
        updateParteDisplay(parteInline); // Atualiza no carregamento inicial

        let cpfRow = parteInline.querySelector('.form-row.field-cpf-demandas');
        if (!cpfRow) {
            const nomeField = parteInline.querySelector('.form-row.field-nome');
            const enderecoField = parteInline.querySelector('.field-endereco');
            const row = document.createElement('div');
            row.className = 'form-row field-cpf-demandas';
            row.innerHTML = `
                <div class="flex-container">
                    <label>CPF</label>
                    <div class="cpf-demandas-group">
                        <div class="cpf-demandas-actions">
                            <input type="text" class="cpf-demandas-input" placeholder="Buscar cadastro por CPF">
                            <button type="button" class="button cpf-demandas-btn">Buscar</button>
                            <button type="button" class="button cpf-demandas-batch">Lote</button>
                        </div>
                    </div>
                </div>
            `;
            if (enderecoField && enderecoField.parentNode) {
                enderecoField.parentNode.insertBefore(row, enderecoField);
            } else if (nomeField && nomeField.parentNode) {
                nomeField.parentNode.insertBefore(row, nomeField.nextSibling);
            } else {
                parteInline.appendChild(row);
            }
            cpfRow = row;
        }

        const input = cpfRow?.querySelector('.cpf-demandas-input');
        const button = cpfRow?.querySelector('.cpf-demandas-btn');
        let batchButton = cpfRow?.querySelector('.cpf-demandas-batch');
        if (cpfRow && !batchButton) {
            batchButton = document.createElement('button');
            batchButton.type = 'button';
            batchButton.className = 'button cpf-demandas-batch';
            batchButton.textContent = 'Lote';
            cpfRow.querySelector('.cpf-demandas-actions')?.appendChild(batchButton);
        }
        if (input && !input.dataset.maskBound) {
            input.dataset.maskBound = 'true';
            input.addEventListener('input', () => {
                input.value = maskCpfCnpj(input.value);
            });
        }
        if (button && !button.dataset.fetchBound) {
            button.dataset.fetchBound = 'true';
        }
        if (batchButton && !batchButton.dataset.batchBound) {
            batchButton.dataset.batchBound = 'true';
            batchButton.addEventListener('click', (event) => {
                event.preventDefault();
                openDemandasBatchModal();
            });
        }
    }

    if (!document.body.dataset.cpfDemandasGlobal) {
        document.body.dataset.cpfDemandasGlobal = 'true';
        document.body.addEventListener('click', (event) => {
            const button = event.target.closest('.cpf-demandas-btn');
            if (!button) return;
            event.preventDefault();
            handleDemandasCpfClick(button);
        });
        document.body.addEventListener('click', (event) => {
            const button = event.target.closest('.cpf-demandas-batch');
            if (!button) return;
            event.preventDefault();
            openDemandasBatchModal();
        });
    }


    // --- 5. Preenchimento de Campos do Formulário ---
    function fillFormFields(processo, partes, andamentos) {
        console.log("--- Iniciando fillFormFields ---");
        console.log("Dados do processo recebidos:", processo);
        console.log("Dados das partes recebidos:", partes);

        // Mapeamento dos valores de tipo_pessoa da API para os valores do campo no Django
        const tipoPessoaMap = {
            'JURIDICA': 'PJ',
            'FISICA': 'PF'
        };


        if (processo) { // Adiciona uma verificação de segurança
            console.log("Preenchendo campos do processo principal...");
            if (varaInput) varaInput.value = processo.vara || '';
            if (tribunalInput) tribunalInput.value = processo.tribunal || '';
            
            // CORRIGIDO: Agora espera o valor numérico do backend.
            if (valorCausaInput) {
                const formattedValorCausa = formatCurrencyBrl(processo.valor_causa);
                valorCausaInput.value = formattedValorCausa || '';
            }

            if (ufInput && !ufInput.value) ufInput.value = processo.uf || '';

            const statusId = processo.status_id;
            const statusNome = processo.status_nome;

            if (statusSelect && statusId && statusNome) {
                console.log(`Tentando definir Classe para: ID=${statusId}, Nome=${statusNome}`);
                let optionExists = Array.from(statusSelect.options).some(opt => opt.value == statusId);
                if (!optionExists) {
                    console.log("Opção de Classe não existe, criando uma nova.");
                    const newOption = new Option(statusNome, statusId, true, true);
                    statusSelect.appendChild(newOption);
                }
                statusSelect.value = statusId;
            }
        } else {
            console.warn("Objeto 'processo' é nulo ou indefinido. Pulando preenchimento dos campos principais.");
        }

        if (partes && partes.length > 0) {
            const addParteButton = document.querySelector('#partes_processuais-group .add-row a');
            let totalFormsInput = document.querySelector('#id_partes_processuais-TOTAL_FORMS');
            let totalForms = parseInt(totalFormsInput.value);
            
            console.log(`Encontradas ${totalForms} inlines de partes. Recebidas ${partes.length} partes.`);

            // Adiciona novas inlines se necessário
            for (let i = totalForms; i < partes.length; i++) {
                if (addParteButton) {
                    console.log("Adicionando nova inline de parte...");
                    addParteButton.click();
                }
            }
            
            // Lógica para esconder inlines extras
            totalForms = parseInt(totalFormsInput.value); // Re-ler o total
            for (let i = partes.length; i < totalForms; i++) {
                 const inlineToDelete = document.getElementById(`partes_processuais-${i}`);
                 if (inlineToDelete) {
                    const deleteCheckbox = inlineToDelete.querySelector('input[id$="-DELETE"]');
                    if(deleteCheckbox) deleteCheckbox.checked = true;
                    inlineToDelete.style.display = 'none';
                 }
            }


            // Aumentado o timeout para garantir a renderização de novas inlines
            setTimeout(() => {
                console.log("Iniciando preenchimento das inlines de partes após timeout.");
                
                // Itera sobre os dados das partes recebidas para preencher as inlines correspondentes
                for (let i = 0; i < partes.length; i++) {
                    const inline = document.getElementById(`partes_processuais-${i}`);
                    if (!inline) {
                        console.error(`Não foi possível encontrar a inline de parte #${i} para preencher. O formulário pode não ter sido adicionado a tempo.`);
                        continue;
                    }
                    
                    const parte = partes[i];
                    console.log(`Processando inline #${i} com dados:`, parte);

                    const prefix = `id_partes_processuais-${i}-`;
                    const tipoPoloSelect = inline.querySelector(`#${prefix}tipo_polo`);
                    const nomeInput = inline.querySelector(`#${prefix}nome`);
                    const tipoPessoaSelect = inline.querySelector(`#${prefix}tipo_pessoa`);
                    const documentoInput = inline.querySelector(`#${prefix}documento`);
                    const enderecoInput = inline.querySelector(`#${prefix}endereco`);

                    if (nomeInput) nomeInput.value = parte.nome || '';
                                            if (tipoPoloSelect) tipoPoloSelect.value = parte.tipo_polo || '';
                                            if (tipoPessoaSelect) {
                                                const apiTipoPessoa = parte.tipo_pessoa ? parte.tipo_pessoa.toUpperCase() : '';
                                                tipoPessoaSelect.value = tipoPessoaMap[apiTipoPessoa] || '';
                                            }
                                            if (documentoInput) {                        documentoInput.value = parte.documento || '';
                        documentoInput.dispatchEvent(new Event('input', { bubbles: true })); 
                    }
                    if (enderecoInput) enderecoInput.value = parte.endereco || '';

                    // Garante que o checkbox de deleção esteja desmarcado para as partes que estamos preenchendo
                    const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                    if (deleteCheckbox) deleteCheckbox.checked = false;
                    inline.style.display = 'block'; // Garante que a inline esteja visível
                }
            }, 500); 
        }

        if (andamentos && andamentos.length > 0) {
            const addAndamentoButton = document.querySelector('#andamentos-group .add-row a');
            const totalAndamentosForms = document.querySelectorAll('.dynamic-andamentos').length;

            for (let i = totalAndamentosForms; i < andamentos.length; i++) {
                if (addAndamentoButton) {
                    addAndamentoButton.click();
                }
            }

            setTimeout(() => {
                document.querySelectorAll('.dynamic-andamentos').forEach((inline, i) => {
                    if (i < andamentos.length) {
                        const andamento = andamentos[i];
                        const prefix = `id_andamentos-${i}-`;
                        const dataInput = inline.querySelector(`#${prefix}data_0`);
                        const horaInput = inline.querySelector(`#${prefix}data_1`);
                        const descricaoInput = inline.querySelector(`#${prefix}descricao`);

                        if (dataInput && horaInput && andamento.data) {
                            const dateTime = new Date(andamento.data);
                            dataInput.value = dateTime.toLocaleDateString('pt-BR');
                            horaInput.value = dateTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        }
                        if (descricaoInput) descricaoInput.value = andamento.descricao || '';

                        const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                        if (deleteCheckbox) deleteCheckbox.checked = false;
                    }
                });
            }, 500);
        }
    }

    // --- Inicialização de Inlines existentes ---
    document.querySelectorAll('.dynamic-partes').forEach(setupParteInline);

    // --- Configuração para novas inlines adicionadas dinamicamente ---
    const CHECAGEM_STORAGE_KEY = 'checagem_de_sistemas_state_v1';
const CHECAGEM_SECTIONS = [
        {
            title: 'Litispendência',
            questions: [
                { key: 'juridico_isj', label: 'JURÍDICO ISJ' },
                { key: 'judicase', label: 'JUDICASE' },
                { key: 'jusbr', label: 'JUS.BR' },
                { key: 'tribunal', label: 'TRIBUNAL' },
            ],
        },
        {
            title: 'Óbito',
            questions: [
                { key: 'nowlex', label: 'NOWLEX' },
                { key: 'censec', label: 'CENSEC' },
                { key: 'qualificacao_herdeiros', label: 'QUALIFICAÇÃO HERDEIROS' },
                { key: 'cert_obt', label: 'CERT OBT' },
        ],
    },
    {
        title: 'Adv. Analista',
        questions: [
            { key: 'google', label: 'GOOGLE' },
            { key: 'transparencia', label: 'TRANSPARÊNCIA' },
            { key: 'cargo', label: 'CARGO' },
        ],
    },
];
const AGENDA_CHECAGEM_LINK_ICON = '/static/images/Link_Logo.png';
const AGENDA_CHECAGEM_LOGO = '/static/images/Checagem_de_Sistemas_Logo.png';

    const normalizeLinkValue = (value) => {
        const trimmed = (value || '').trim();
        if (!trimmed) {
            return '';
        }
        if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
            return trimmed;
        }
        return `https://${trimmed}`;
    };

    const resolveChecagemStorageKey = ({ processoId, cardId }) => {
        if (processoId) {
            return `processo-${processoId}`;
        }
        if (cardId) {
            return `${cardId}`;
        }
        return 'global';
    };

    const readChecagemStorage = () => {
        try {
            const raw = localStorage.getItem(CHECAGEM_STORAGE_KEY);
            if (raw) {
                return JSON.parse(raw);
            }
        } catch (error) {
            console.warn('Não foi possível ler o estado da checagem:', error);
        }
        return { cards: {} };
    };

    const writeChecagemStorage = (state) => {
        try {
            localStorage.setItem(CHECAGEM_STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('Não foi possível salvar o estado da checagem:', error);
        }
    };

    const persistChecagemQuestion = (storageKey, questionKey, updates) => {
        const state = readChecagemStorage();
        const cardKey = storageKey || 'global';
        state.cards = state.cards || {};
        if (!state.cards[cardKey]) {
            state.cards[cardKey] = { questions: {} };
        }
        const cardState = state.cards[cardKey];
        cardState.questions = cardState.questions || {};
        cardState.questions[questionKey] = {
            ...(cardState.questions[questionKey] || {}),
            ...updates,
        };
        writeChecagemStorage(state);
        return cardState.questions[questionKey];
    };

    const getCachedQuestion = (storageKey, questionKey) => {
        const state = readChecagemStorage();
        const cardKey = storageKey || 'global';
        const cardState = (state.cards || {})[cardKey] || {};
        return (cardState.questions || {})[questionKey] || {};
    };

    let activeChecagemTrigger = null;
    let modalBlocker = null;
    let checagemOverlay = null;
    let checagemKeyHandlerAttached = false;

    const removeChecagemModalBlockers = () => {
        if (modalBlocker) {
            modalBlocker.remove();
            modalBlocker = null;
        }
    };

    const ensureModal = () => {
        if (checagemOverlay) {
            return checagemOverlay;
        }
        checagemOverlay = document.createElement('div');
        checagemOverlay.id = 'checagem-modal-overlay';
        checagemOverlay.className = 'checagem-modal-overlay';
        checagemOverlay.setAttribute('aria-hidden', 'true');
        checagemOverlay.innerHTML = `
            <div class="checagem-modal" role="dialog" aria-modal="true">
                <div class="checagem-modal__header">
                    <h2 class="checagem-modal__title">Checagem de Sistemas</h2>
                    <button type="button" class="checagem-modal__close" aria-label="Fechar">×</button>
                </div>
                <div class="checagem-modal__body">
                    <div class="checagem-modal__questions"></div>
                </div>
                <div class="checagem-modal__footer">
                    <span class="checagem-footer-hint">As observações são salvas automaticamente.</span>
                    <button type="button" class="checagem-modal__close-btn">Fechar</button>
                </div>
            </div>
        `;
        document.body.appendChild(checagemOverlay);
        checagemOverlay.addEventListener('click', (event) => {
            if (event.target === checagemOverlay) {
                closeChecagemModal();
            }
        });
        checagemOverlay.querySelectorAll('.checagem-modal__close').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                closeChecagemModal();
            });
        });
        checagemOverlay.querySelectorAll('.checagem-modal__close-btn').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                closeChecagemModal();
            });
        });
        if (!checagemKeyHandlerAttached) {
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && checagemOverlay?.getAttribute('aria-hidden') === 'false') {
                    closeChecagemModal();
                }
            });
            checagemKeyHandlerAttached = true;
        }
        return checagemOverlay;
    };

    const updateLinkIndicatorText = (indicator, button, hasLink, link) => {
        if (indicator) {
            indicator.textContent = '';
            indicator.title = hasLink ? (link || '') : '';
        }
        if (button) {
            button.classList.toggle('checagem-link-button--active', hasLink);
        }
    };

    const autoResizeObservationTextarea = (textarea) => {
        if (!textarea) {
            return;
        }
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    };

    const resetObservationTextareaHeight = (textarea) => {
        if (!textarea) {
            return;
        }
        textarea.style.height = '';
    };

    const buildQuestionRow = (storageKey, question, linkIcon) => {
        const questionData = { ...getCachedQuestion(storageKey, question.key) };
        const labelValue = questionData.label || question.label;

        const row = document.createElement('div');
        row.className = 'checagem-question';
        row.dataset.questionKey = question.key;

        const linkWrapper = document.createElement('div');
        linkWrapper.className = 'checagem-question-actions';
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'checagem-confirm-toggle';
        confirmButton.setAttribute('aria-label', `Confirmar acesso a ${labelValue}`);
        confirmButton.dataset.confirmed = questionData.confirmed ? '1' : '0';
        confirmButton.innerHTML = '<span></span>';
        const linkButton = document.createElement('button');
        linkButton.type = 'button';
        linkButton.className = 'checagem-link-button';
        linkButton.setAttribute('aria-label', `Abrir link para ${labelValue}`);
        linkButton.innerHTML = `<img src="${linkIcon}" alt="Link externo">`;
        linkWrapper.append(confirmButton, linkButton);

        const questionBody = document.createElement('div');
        questionBody.className = 'checagem-question-body';

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'checagem-question-title checagem-question-label';
        labelInput.value = labelValue;
        labelInput.setAttribute('aria-label', `Título da questão ${labelValue}`);

        const indicator = document.createElement('span');
        indicator.className = 'checagem-link-indicator';
        updateLinkIndicatorText(
            indicator,
            linkButton,
            Boolean(questionData.link),
            questionData.link
        );

        const editTrigger = document.createElement('button');
        editTrigger.type = 'button';
        editTrigger.className = 'checagem-link-edit-trigger';
        editTrigger.setAttribute('title', 'Editar link');
        const editarLinkIcon = '/static/images/editar_link.png';
        editTrigger.innerHTML = `<img src="${editarLinkIcon}" alt="Editar link">`;

        const editorWrapper = document.createElement('div');
        editorWrapper.className = 'checagem-link-editor';
        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.placeholder = 'Cole ou atualize o link';
        urlInput.value = questionData.link || '';
        urlInput.setAttribute('aria-label', `Link externo para ${labelValue}`);

        editorWrapper.append(urlInput);

        const observationInput = document.createElement('textarea');
        observationInput.className = 'checagem-question-observation';
        observationInput.placeholder = 'Notas ou status';
        observationInput.value = questionData.notes || '';
        observationInput.setAttribute('aria-label', `Observações para ${labelValue}`);
        observationInput.rows = 1;

        const questionContent = document.createElement('div');
        questionContent.className = 'checagem-question-content';

        const topRow = document.createElement('div');
        topRow.className = 'checagem-question-top';
        topRow.append(linkWrapper, labelInput, observationInput, indicator, editTrigger);

        questionContent.append(topRow, editorWrapper);
        questionBody.appendChild(questionContent);

        const toggleEditor = () => {
            editorWrapper.classList.toggle('visible');
            if (editorWrapper.classList.contains('visible')) {
                urlInput.focus();
            }
        };

        editTrigger.addEventListener('click', (event) => {
            event.preventDefault();
            toggleEditor();
        });

        linkButton.addEventListener('click', (event) => {
            event.preventDefault();
            const freshData = getCachedQuestion(storageKey, question.key);
            if (freshData.link) {
                window.open(freshData.link, '_blank');
                return;
            }
            toggleEditor();
        });

        const persistAndRefresh = (partial) => {
            let updated = persistChecagemQuestion(storageKey, question.key, partial);
            if (!updated) {
                updated = getCachedQuestion(storageKey, question.key);
            }
            updateLinkIndicatorText(indicator, linkButton, Boolean(updated.link), updated.link);
            return updated;
        };

        const toggleConfirm = () => {
            const current = Boolean(questionData.confirmed);
            const updated = persistAndRefresh({ confirmed: !current });
            questionData.confirmed = Boolean(updated.confirmed);
            confirmButton.dataset.confirmed = questionData.confirmed ? '1' : '0';
        };

        confirmButton.addEventListener('click', (event) => {
            event.preventDefault();
            toggleConfirm();
        });

        labelInput.addEventListener('input', () => {
            persistAndRefresh({ label: labelInput.value });
        });

        observationInput.addEventListener('input', () => {
            persistAndRefresh({ notes: observationInput.value });
            autoResizeObservationTextarea(observationInput);
        });

        const handleObservationFocus = () => {
            autoResizeObservationTextarea(observationInput);
            showObservationTooltip(observationInput);
        };

        observationInput.addEventListener('mouseenter', () => showObservationTooltip(observationInput));
        observationInput.addEventListener('focus', handleObservationFocus);
        observationInput.addEventListener('mouseleave', scheduleObservationTooltipHide);
        observationInput.addEventListener('blur', () => {
            resetObservationTextareaHeight(observationInput);
            scheduleObservationTooltipHide();
        });

        const syncLinkValue = () => {
            const normalized = normalizeLinkValue(urlInput.value);
            const updated = persistAndRefresh({ link: normalized });
            if (normalized) {
                urlInput.value = updated.link;
            }
        };

        urlInput.addEventListener('change', syncLinkValue);
        urlInput.addEventListener('blur', syncLinkValue);
        urlInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                urlInput.blur();
            }
        });

        row.appendChild(questionBody);
        return row;
    };

    const renderChecagemModal = (cardContext, linkIcon) => {
        const overlay = ensureModal();
        const title = overlay.querySelector('.checagem-modal__title');
        const pool = overlay.querySelector('.checagem-modal__questions');
        title.textContent = 'Checagem de Sistemas';
        pool.innerHTML = '';
        const storageKey = resolveChecagemStorageKey(cardContext);
        CHECAGEM_SECTIONS.forEach((section) => {
            const sectionBlock = document.createElement('section');
            sectionBlock.className = 'checagem-section';
            const heading = document.createElement('div');
            heading.className = 'checagem-section-title';
            heading.textContent = section.title;
            sectionBlock.appendChild(heading);
            const questionsWrapper = document.createElement('div');
            questionsWrapper.className = 'checagem-questions';
            section.questions.forEach((question) => {
                questionsWrapper.appendChild(buildQuestionRow(storageKey, question, linkIcon));
            });
            sectionBlock.appendChild(questionsWrapper);
            pool.appendChild(sectionBlock);
        });
    };

    const positionChecagemModal = (trigger) => {
        const overlay = document.getElementById('checagem-modal-overlay');
        const modal = overlay?.querySelector('.checagem-modal');
        if (!trigger || !modal) {
            return;
        }
        const modalRect = modal.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        let left = triggerRect.left - modalRect.width - 12;
        if (left < 12) {
            left = 12;
        }
        if (left + modalRect.width > window.innerWidth - 12) {
            left = Math.max(12, window.innerWidth - modalRect.width - 12);
        }
        let top = triggerRect.top;
        const maxTop = window.innerHeight - modalRect.height - 12;
        if (top > maxTop) {
            top = Math.max(12, maxTop);
        }
        if (top < 12) {
            top = 12;
        }
        modal.style.position = 'absolute';
        modal.style.left = `${left}px`;
        modal.style.top = `${top}px`;
        if (modalBlocker) {
            modalBlocker.remove();
        }
        modalBlocker = document.createElement('div');
        modalBlocker.className = 'checagem-modal-blocker';
        modalBlocker.style.position = 'absolute';
        modalBlocker.style.left = `${left}px`;
        modalBlocker.style.top = `${top}px`;
        modalBlocker.style.width = `${modalRect.width}px`;
        modalBlocker.style.height = `${modalRect.height}px`;
        modalBlocker.style.pointerEvents = 'auto';
        modalBlocker.style.borderRadius = '26px';
        document.body.appendChild(modalBlocker);
    };

    const openChecagemModal = (card, trigger, fallbackContext = {}) => {
        const overlay = ensureModal();
        const wasVisible = overlay.getAttribute('aria-hidden') === 'false';
        if (wasVisible && activeChecagemTrigger === trigger) {
            closeChecagemModal();
            return;
        }
        const cardId = card?.dataset?.parteId || fallbackContext.cardId || 'global';
        const processoId = card?.dataset?.processoId || fallbackContext.processoId;
        const cardName = card?.querySelector('.parte-nome')?.textContent?.trim()
            || fallbackContext.cardName
            || '';
        const linkIcon =
            document
                .querySelector('.checagem-sistemas-trigger')
                ?.dataset?.linkIcon || '/static/images/Link_Logo.png';
        renderChecagemModal({ cardId, cardName, processoId }, linkIcon);
        positionChecagemModal(trigger);
        activeChecagemTrigger = trigger;
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('checagem-modal-open');
    };

    const destroyObservationTooltip = () => {
        if (observationTooltip) {
            observationTooltip.remove();
            observationTooltip = null;
            tooltipVisibilityInput = null;
        }
    };

    const destroyChecagemOverlay = () => {
        if (checagemOverlay) {
            checagemOverlay.remove();
            checagemOverlay = null;
        }
    };

    const closeChecagemModal = () => {
        if (!checagemOverlay) {
            return;
        }
        const trigger = activeChecagemTrigger;
        activeChecagemTrigger = null;
        const focused = document.activeElement;
        if (focused && checagemOverlay.contains(focused)) {
            focused.blur();
        }
        checagemOverlay.setAttribute('aria-hidden', 'true');
        removeChecagemModalBlockers();
        hideObservationTooltip();
        destroyObservationTooltip();
        document.body.classList.remove('checagem-modal-open');
        setTimeout(() => {
            trigger?.focus();
        }, 0);
        destroyChecagemOverlay();
    };

    const openAgendaChecagemFromEntry = (entryData, trigger) => {
        const processId = entryData?.processo_id ?? entryData?.processoId;
        const canonicalCard = processId
            ? document.querySelector(`.info-card[data-processo-id="${processId}"]`)
            : null;
        if (canonicalCard) {
            openChecagemModal(canonicalCard, trigger);
            return;
        }
        const cardName = entryData?.viabilidade_label || entryData?.label || '';
        const fallbackContext = {
            cardId: entryData?.cardId ?? `agenda-supervision-${entryData?.backendId ?? processId ?? 'global'}`,
            processoId: processId,
            cardName,
        };
        openChecagemModal(null, trigger, fallbackContext);
    };

    document.body.addEventListener('click', (event) => {
        const trigger = event.target.closest('.checagem-sistemas-trigger');
        if (!trigger) {
            return;
        }
        event.preventDefault();
        const card = trigger.closest('.info-card');
        openChecagemModal(card, trigger);
    });

    if (typeof jQuery !== 'undefined') {
        jQuery(document).on('formset:added', function(event, $row, formsetName) {
            // Verifica se a nova linha pertence ao formset 'partes_processuais'
            if (formsetName === 'partes_processuais') {
                // $row é um objeto jQuery, pegamos o elemento DOM com [0]
                if ($row && $row.length) {
                    setupParteInline($row[0]);
                }
            }
        });
    }

});
