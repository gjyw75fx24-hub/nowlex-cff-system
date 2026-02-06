(function () {
    'use strict';

    const TIPOS_CACHE_TTL_MS = 15 * 60 * 1000;
    const buildTiposCacheKey = (apiUrl) => `nowlex_cache_v1:tipos_peticao:${encodeURIComponent(apiUrl || '')}`;
    const DOCUMENTO_PETICOES_CSS_URL = window.__documento_peticoes_css_url || '/static/admin/css/documento_modelo_peticoes.css';
    const ensureDocumentoPeticoesStyles = () => {
        if (!DOCUMENTO_PETICOES_CSS_URL) {
            return;
        }
        if (document.querySelector('link[data-documento-peticoes-css="1"]')) {
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = DOCUMENTO_PETICOES_CSS_URL;
        link.dataset.documentoPeticoesCss = '1';
        document.head.appendChild(link);
    };
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

    const getPreviewApiUrl = () => window.__tipos_peticao_preview_url || '';
    const getGenerateApiUrl = () => window.__tipos_peticao_generate_url || '';
    const getCsrfToken = () => {
        const match = document.cookie.match(/csrftoken=([^;]+)/);
        if (match) {
            return match[1];
        }
        return window.__tipos_peticao_csrf_token || '';
    };
    const csrfApiToken = window.__tipos_peticao_csrf_token || '';
    const createDropdown = () => {
        const dropdown = document.createElement('div');
        dropdown.className = 'inline-group-subtab-dropdown';
        dropdown.innerHTML = `
            <div class="inline-group-subtab-dropdown-header">
                <span>Protocolar</span>
                <button type="button" class="inline-group-subtab-dropdown-close" aria-label="Fechar lista">×</button>
            </div>
            <div class="inline-group-subtab-dropdown-body">
                <div class="inline-group-subtab-card">
                    <button type="button" class="inline-group-subtab-select-button">
                        <span class="inline-group-subtab-select-label">Selecione um tipo</span>
                        <span class="inline-group-subtab-select-caret">▾</span>
                    </button>
                    <div class="inline-group-subtab-execute-area">
                        <button type="button" class="inline-group-subtab-execute documento-peticoes-execute"
                                data-arquivos-peticoes-execute disabled>
                        <span class="documento-peticoes-execute-icon" aria-hidden="true">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                                 xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 7l6 5-6 5V7z" fill="currentColor"/>
                            </svg>
                        </span>
                        </button>
                        <span class="inline-group-subtab-execute-text">executar</span>
                    </div>
                    <span class="inline-group-subtab-execute-label" aria-live="polite" hidden></span>
                </div>
                <div class="inline-group-subtab-options-shell" hidden>
                    <div class="inline-group-subtab-options" hidden>
                    </div>
                </div>
            </div>
            <div class="inline-group-subtab-status" role="status" aria-live="polite"></div>
        `;
        return dropdown;
    };

    let tiposCache = [];
    let statusElement = null;
    let executeButtonRef = null;
    let executeLabelRef = null;

    const normalizeText = (value) => {
        if (!value) {
            return '';
        }
        return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    };

    const getArquivoRows = () => {
        const selectors = [
            '#processoarquivo_set-group tbody tr',
            '#arquivos-group tbody tr'
        ];
        const rows = selectors
            .map(selector => Array.from(document.querySelectorAll(selector)))
            .flat();
        return rows.filter(row => row.querySelector('td.field-nome'));
    };

    const getRowFileName = (row) => {
        if (!row) {
            return '';
        }
        const input = row.querySelector('input[name$="-nome"]');
        if (input && input.value) {
            return input.value.trim();
        }
        const text = row.querySelector('td.field-nome')?.textContent || row.textContent || '';
        return text.trim();
    };

    const emitBaseChange = (baseName = selectedBaseName) => {
        document.dispatchEvent(new CustomEvent('arquivosPeticao:baseChanged', {
            detail: { baseId: selectedBaseId, baseName }
        }));
    };

    const setStatus = (text = '', severity = '') => {
        if (!statusElement) {
            return;
        }
        if (!text) {
            statusElement.textContent = '';
            statusElement.dataset.status = '';
            statusElement.hidden = true;
            return;
        }
        statusElement.textContent = text;
        statusElement.dataset.status = severity;
        statusElement.hidden = false;
    };

    const isReadyToExecute = () => Boolean(selectedTipoId && selectedBaseId);

    const updateExecuteButtonState = () => {
        if (!executeButtonRef) {
            return;
        }
        const canExecute = isReadyToExecute();
        executeButtonRef.disabled = !canExecute;
        executeButtonRef.classList.toggle('inline-group-subtab-execute-ready', canExecute);
        const baseLabel = selectedBaseName ? ` ${selectedBaseName}` : '';
        const title = `Executar${baseLabel}`;
        executeButtonRef.setAttribute('title', title);
        executeButtonRef.setAttribute('aria-label', title);
        if (executeLabelRef) {
            if (selectedBaseName) {
                executeLabelRef.textContent = selectedBaseName;
                executeLabelRef.hidden = false;
            } else {
                executeLabelRef.textContent = '';
                executeLabelRef.hidden = true;
            }
        }
    };

    const setupBaseCheckbox = (checkbox, row) => {
        if (!checkbox || checkbox.dataset.peticoesEnhanced === '1') {
            return;
        }
        checkbox.removeAttribute('disabled');
        const handleChange = () => {
            const id = checkbox.dataset.fileId || '';
            if (checkbox.checked) {
                const fileName = getRowFileName(row);
                selectedBaseId = id;
                selectedBaseName = fileName;
                window.__arquivos_peticao_selected_base_id = id;
                window.__arquivos_peticao_selected_base_name = selectedBaseName;
                getArquivoRows().forEach((otherRow) => {
                    const otherCheckbox = otherRow.querySelector('.arquivos-peticoes-base-checkbox');
                    if (otherCheckbox && otherCheckbox !== checkbox) {
                        otherCheckbox.checked = false;
                    }
                });
            } else if (selectedBaseId === id) {
                selectedBaseId = '';
                selectedBaseName = '';
                window.__arquivos_peticao_selected_base_id = '';
                window.__arquivos_peticao_selected_base_name = '';
            }
            highlightSelectedRow();
            emitBaseChange();
        };
        checkbox.addEventListener('change', handleChange);
        checkbox.dataset.peticoesEnhanced = '1';
    };

    const ensureBaseWrapper = (row) => {
        let wrapper = row.querySelector('.arquivos-peticoes-base-wrapper');
        const nameCell = row.querySelector('td.field-nome');
        if (!nameCell) {
            return null;
        }
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'arquivos-peticoes-base-wrapper';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'arquivos-peticoes-base-checkbox';
            setupBaseCheckbox(checkbox, row);
            wrapper.appendChild(checkbox);
            nameCell.insertBefore(wrapper, nameCell.firstChild);
        }
        const checkbox = wrapper.querySelector('.arquivos-peticoes-base-checkbox');
        setupBaseCheckbox(checkbox, row);
        return wrapper;
    };

    const highlightSelectedRow = () => {
        getArquivoRows().forEach(row => {
            const checkbox = row.querySelector('.arquivos-peticoes-base-checkbox');
            if (!checkbox) {
                return;
            }
            const rowSelected = checkbox.checked && String(selectedBaseId) && checkbox.dataset.fileId === selectedBaseId;
            row.classList.toggle('arquivos-peticoes-base-row', rowSelected);
        });
    };

    const refreshBaseCheckboxes = () => {
        const normalizedType = normalizeText(selectedTipoName);
        const candidates = getArquivoRows();
        let baseStillValid = false;
            candidates.forEach(row => {
                const wrapper = ensureBaseWrapper(row);
                if (!wrapper) {
                    return;
                }
                const checkbox = wrapper.querySelector('.arquivos-peticoes-base-checkbox');
                const idInput = row.querySelector('input[id$="-id"]');
                const fileId = idInput ? idInput.value : null;
                if (checkbox && fileId) {
                    checkbox.dataset.fileId = fileId;
                }
                const nameText = normalizeText(row.querySelector('td.field-nome')?.textContent || '');
                const is01Row = /01\s*-/i.test(nameText);
                const hasTipo = Boolean(normalizedType);
                const isCandidate = is01Row && hasTipo;
                wrapper.style.display = is01Row ? 'inline-flex' : 'none';
                if (checkbox) {
                    const rowSelected = Boolean(selectedBaseId) && fileId && selectedBaseId === fileId;
                    checkbox.checked = rowSelected;
                    if (rowSelected) {
                        baseStillValid = true;
                    }
                }
            if (!isCandidate && checkbox) {
                checkbox.checked = false;
                row.classList.remove('arquivos-peticoes-base-row');
            }
        });
        if (!baseStillValid && selectedBaseId) {
            selectedBaseId = '';
            selectedBaseName = '';
            window.__arquivos_peticao_selected_base_id = '';
            window.__arquivos_peticao_selected_base_name = '';
            emitBaseChange();
        }
        highlightSelectedRow();
        bindBaseButtons();
    };

    const bindBaseButtons = () => {
        const roots = [
            document.querySelector('#arquivos-group'),
            document.querySelector('#processoarquivo_set-group')
        ].filter(Boolean);
        const buttons = roots
            .flatMap(root => Array.from(root.querySelectorAll('button, a, .monitoria-checkbox-wrapper span')))
            .filter(btn => btn.textContent.trim().toLowerCase() === 'base');
        buttons.forEach(btn => {
            if (btn.dataset.baseBound === '1') {
                return;
            }
            btn.dataset.baseBound = '1';
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                const row = btn.closest('tr');
                if (!row) {
                    return;
                }
                const checkbox = row.querySelector('.arquivos-peticoes-base-checkbox');
                if (!checkbox) {
                    return;
                }
                checkbox.removeAttribute('disabled');
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                btn.classList.toggle('base-active', checkbox.checked);
            });
        });
    };

    const ensureAddRowUploadButton = () => {
        const rows = Array.from(document.querySelectorAll(
            '#arquivos-group tr.add-row, #arquivos-group tr.dynamic-arquivos,' +
            '#processoarquivo_set-group tr.add-row, #processoarquivo_set-group tr.dynamic-processoarquivo'
        ));
        rows.forEach(row => {
            const hasFileLink = row.querySelector('td.field-arquivo a[href*="/media/"], td.field-arquivo a[href*="processos/"]');
            if (hasFileLink) {
                return;
            }
            const uploadParagraph = row.querySelector('td.field-arquivo p.file-upload');
            const nameInput = row.querySelector('td.field-nome input');
            const fileInput = row.querySelector('input[type="file"]');
            if (!fileInput) {
                return;
            }
            if (uploadParagraph && uploadParagraph.dataset.addButton !== '1') {
                const label = document.createElement('label');
                label.className = 'documento-peticoes-addfile-button button';
                label.textContent = 'Procurar...';
                label.setAttribute('for', fileInput.id);
                uploadParagraph.appendChild(label);
                uploadParagraph.dataset.addButton = '1';
            }
            if (nameInput && !nameInput.dataset.addButtonRow) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'documento-peticoes-addfile-button';
                button.textContent = 'Procurar...';
                button.addEventListener('click', () => {
                    fileInput.click();
                });
                nameInput.insertAdjacentElement('afterend', button);
                nameInput.dataset.addButtonRow = '1';
            }
        });
    };

    const initBaseSelectionObserver = () => {
        const targets = [
            document.querySelector('#processoarquivo_set-group tbody'),
            document.querySelector('#arquivos-group tbody')
        ].filter(Boolean);
        if (!targets.length) {
            return;
        }
        const observer = new MutationObserver(() => {
            refreshBaseCheckboxes();
            bindBaseButtons();
            ensureAddRowUploadButton();
        });
        targets.forEach(target => observer.observe(target, { childList: true, subtree: true }));
        refreshBaseCheckboxes();
        bindBaseButtons();
        ensureAddRowUploadButton();
    };

    let selectedTipoId = window.__arquivos_peticao_selected_tipo_id || '';
    let selectedTipoName = window.__arquivos_peticao_selected_tipo_name || '';
    let selectButtonRef = null;
    let selectedBaseId = window.__arquivos_peticao_selected_base_id || '';
    let selectedBaseName = window.__arquivos_peticao_selected_base_name || '';
    let selectedTipoItem = null;
    let summaryCardInstance = null;
    let currentSummaryData = null;
    let previewModalInstance = null;
    let currentPreview = null;

    const setActiveTipo = (tipoId, tipoName, tipoObj = null) => {
        selectedTipoId = tipoId;
        selectedTipoName = tipoName;
        window.__arquivos_peticao_selected_tipo_id = tipoId;
        window.__arquivos_peticao_selected_tipo_name = tipoName;
        window.__arquivos_peticao_selected_base_name = selectedBaseName;
        refreshBaseCheckboxes();
        document.dispatchEvent(new CustomEvent('arquivosPeticao:tipoChanged', {
            detail: { tipoId: selectedTipoId, tipoName: selectedTipoName }
        }));
        if (selectButtonRef) {
            const label = selectButtonRef.querySelector('.inline-group-subtab-select-label');
            if (label) {
                label.textContent = tipoName || 'Selecione um tipo';
            }
            selectButtonRef.classList.toggle('inline-group-subtab-select-active', Boolean(tipoName));
        }
        selectedTipoItem = tipoObj || tiposCache.find(item => String(item.id) === String(tipoId)) || null;
        setStatus('');
        updateExecuteButtonState();
    };

    const populateDropdown = (dropdown, apiUrl) => {
        const optionsShell = dropdown.querySelector('.inline-group-subtab-options-shell');
        const optionsContainer = dropdown.querySelector('.inline-group-subtab-options');
        const selectButton = dropdown.querySelector('.inline-group-subtab-select-button');
        if (!optionsContainer || !selectButton) {
            return;
        }
        if (!optionsShell) {
            return;
        }
        if (!apiUrl) {
            return;
        }
        const handleTiposResponse = (data) => {
            const types = Array.isArray(data.tipos) ? data.tipos : [];
            tiposCache = types;
            if (types.length === 0) {
                optionsContainer.innerHTML = '';
                return;
            }
            optionsContainer.innerHTML = '';
            const placeholder = document.createElement('div');
            placeholder.className = 'inline-group-subtab-option placeholder';
            placeholder.textContent = 'Selecione um tipo';
            placeholder.setAttribute('aria-hidden', 'true');
            optionsContainer.appendChild(placeholder);
            const markActive = (button) => {
                optionsContainer.querySelectorAll('.inline-group-subtab-option').forEach(opt => {
                    if (opt.classList.contains('placeholder')) {
                        return;
                    }
                    opt.classList.toggle('active', opt === button);
                });
            };

            types.forEach(item => {
                const name = String(item.nome || '').trim();
                const id = item.id || '';
                if (!name) return;
                const optionBtn = document.createElement('button');
                optionBtn.type = 'button';
                optionBtn.className = 'inline-group-subtab-option';
                optionBtn.textContent = name;
                optionBtn.dataset.tipoId = id;
                optionBtn.addEventListener('click', () => {
                    markActive(optionBtn);
                    setActiveTipo(id, name, item);
                    selectButton.querySelector('.inline-group-subtab-select-label').textContent = name;
                    setHidden(true);
                });
                optionsContainer.appendChild(optionBtn);
            });
            if (selectedTipoId) {
                const match = types.find(item => String(item.id) === String(selectedTipoId));
                if (match) {
                    selectedTipoItem = match;
                    selectedTipoName = match.nome || selectedTipoName;
                    selectButton.querySelector('.inline-group-subtab-select-label').textContent = match.nome || '';
                    const matchedBtn = optionsContainer.querySelector(`[data-tipo-id="${match.id || ''}"]`);
                    if (matchedBtn) {
                        markActive(matchedBtn);
                    }
                }
            }
            const caret = selectButton.querySelector('.inline-group-subtab-select-caret');
            const updateCaret = (isOpen) => {
                if (!caret) {
                    return;
                }
                caret.textContent = isOpen ? '▴' : '▾';
            };

            const setHidden = (hidden) => {
                if (hidden) {
                    optionsContainer.setAttribute('hidden', '');
                    optionsShell.setAttribute('hidden', '');
                } else {
                    optionsContainer.removeAttribute('hidden');
                    optionsShell.removeAttribute('hidden');
                }
                updateCaret(!hidden);
            };
            setHidden(true);

            const closeOptions = () => setHidden(true);
            const toggleOptions = () => {
                const isHidden = optionsShell.hasAttribute('hidden');
                setHidden(!isHidden);
            };

            updateCaret(!optionsShell.hasAttribute('hidden'));
            selectButton.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleOptions();
            });
            document.addEventListener('click', () => {
                if (!optionsShell.hasAttribute('hidden')) {
                    closeOptions();
                }
            });
        };
        const cacheKey = buildTiposCacheKey(apiUrl);
        const cached = readSessionCache(cacheKey, TIPOS_CACHE_TTL_MS);
        if (cached) {
            handleTiposResponse(cached);
            return;
        }
        fetch(apiUrl, {
            method: 'GET',
            credentials: 'same-origin'
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Erro ao carregar');
                }
                return response.json();
            })
            .then(data => {
                writeSessionCache(cacheKey, data);
                handleTiposResponse(data);
            })
            .catch(() => {
                console.error('Não foi possível carregar os tipos.');
            });
    };

    const createPreviewModal = () => {
        if (previewModalInstance) {
            return previewModalInstance;
        }
        const overlay = document.createElement('div');
        overlay.className = 'documento-peticoes-modal-overlay';
        overlay.innerHTML = `
            <div class="documento-peticoes-modal">
                <button type="button" class="documento-peticoes-modal-close" aria-label="Fechar">×</button>
                <h3>Pré-visualização do combo</h3>
                <p>Nome sugerido: <strong id="documento-peticoes-modal-zipname">...</strong></p>
                <div>
                    <strong>Itens encontrados:</strong>
                    <ul id="documento-peticoes-modal-found"></ul>
                </div>
                <div class="documento-peticoes-custom-alert" id="documento-peticoes-modal-missing" style="display:none">
                    <strong>Faltantes:</strong>
                    <ul id="documento-peticoes-modal-missing-list"></ul>
                </div>
                <div class="documento-peticoes-upload" id="documento-peticoes-modal-optional" style="display:none">
                    <strong>Anexos opcionais</strong>
                    <div id="documento-peticoes-modal-optional-list"></div>
                </div>
                <div class="preview-actions">
                    <button type="button" class="button" id="documento-peticoes-modal-voltar">Voltar</button>
                    <button type="button" class="button" id="documento-peticoes-modal-prosseguir">Prosseguir mesmo assim</button>
                    <button type="button" class="button button-primary" id="documento-peticoes-modal-gerar">Gerar ZIP</button>
                </div>
                <p class="documento-peticoes-custom-alert" id="documento-peticoes-modal-result" style="display:none"></p>
            </div>
        `;
        document.body.appendChild(overlay);
        const closeBtn = overlay.querySelector('.documento-peticoes-modal-close');
        const voltarBtn = overlay.querySelector('#documento-peticoes-modal-voltar');
        const prosseguirBtn = overlay.querySelector('#documento-peticoes-modal-prosseguir');
        const gerarBtn = overlay.querySelector('#documento-peticoes-modal-gerar');
        const modal = {
            overlayEl: overlay,
            zipNameEl: overlay.querySelector('#documento-peticoes-modal-zipname'),
            foundList: overlay.querySelector('#documento-peticoes-modal-found'),
            missingPanel: overlay.querySelector('#documento-peticoes-modal-missing'),
            missingList: overlay.querySelector('#documento-peticoes-modal-missing-list'),
            optionalPanel: overlay.querySelector('#documento-peticoes-modal-optional'),
            optionalList: overlay.querySelector('#documento-peticoes-modal-optional-list'),
            resultEl: overlay.querySelector('#documento-peticoes-modal-result'),
            gerarBtn
        };
        const closeOverlay = () => overlay.classList.remove('open');
        closeBtn.addEventListener('click', closeOverlay);
        voltarBtn.addEventListener('click', closeOverlay);
        prosseguirBtn.addEventListener('click', () => {
            gerarBtn.dataset.allowed = '1';
            modal.resultEl.style.display = 'none';
        });
        gerarBtn.addEventListener('click', () => {
            if (!currentPreview) {
                return;
            }
            runGenerate();
        });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closeOverlay();
            }
        });
        previewModalInstance = modal;
        return modal;
    };

    const openPreviewModal = (preview, tipoName) => {
        const modal = createPreviewModal();
        modal.zipNameEl.textContent = preview.zip_name || '(sem nome)';
        modal.foundList.innerHTML = '';
        (preview.found || []).forEach(item => {
            const li = document.createElement('li');
            li.textContent = item.label;
            modal.foundList.appendChild(li);
        });
        if (preview.missing && preview.missing.length) {
            modal.missingPanel.style.display = 'block';
            modal.missingList.innerHTML = '';
            preview.missing.forEach(entry => {
                const li = document.createElement('li');
                li.textContent = entry;
                modal.missingList.appendChild(li);
            });
        } else {
            modal.missingPanel.style.display = 'none';
            modal.missingList.innerHTML = '';
        }
        if (preview.optional && preview.optional.length) {
            modal.optionalPanel.style.display = 'block';
            modal.optionalList.innerHTML = '';
            preview.optional.forEach(opt => {
                const label = document.createElement('label');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = true;
                checkbox.dataset.id = opt.id;
                label.appendChild(checkbox);
                label.append(` ${opt.name}`);
                modal.optionalList.appendChild(label);
            });
        } else {
            modal.optionalPanel.style.display = 'none';
            modal.optionalList.innerHTML = '';
        }
        modal.resultEl.style.display = 'none';
        modal.resultEl.textContent = '';
        modal.gerarBtn.dataset.allowed = '1';
        modal.overlayEl.classList.add('open');
        currentPreview = {
            ...preview,
            tipoId: preview.tipo_id || selectedTipoId,
            tipoName: tipoName || selectedTipoName || (selectedTipoItem?.nome || '')
        };
    };

    const closePreviewModal = () => {
        if (!previewModalInstance) {
            return;
        }
        previewModalInstance.overlayEl.classList.remove('open');
    };

    const triggerDownload = (url, filename) => {
        if (!url) {
            return;
        }
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        if (filename) {
            link.download = filename;
        }
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const createSummaryCard = () => {
        if (summaryCardInstance) {
            return summaryCardInstance;
        }
        const container = document.createElement('div');
        container.className = 'documento-peticoes-summary-card';
        container.innerHTML = `
            <div class="documento-peticoes-summary-header">
                <strong class="documento-peticoes-summary-title">Resumo do ZIP</strong>
                <button type="button" class="documento-peticoes-summary-close" aria-label="Fechar resumo">×</button>
            </div>
            <p class="documento-peticoes-summary-name"></p>
            <ul class="documento-peticoes-summary-list"></ul>
            <div class="documento-peticoes-summary-missing" style="display:none">
                <strong>Faltantes:</strong>
                <ul class="documento-peticoes-summary-missing-list"></ul>
            </div>
            <div class="documento-peticoes-summary-actions">
                <button type="button" class="documento-peticoes-summary-download button button-primary" disabled>Baixar ZIP</button>
            </div>
        `;
        document.body.appendChild(container);
        const closeBtn = container.querySelector('.documento-peticoes-summary-close');
        closeBtn.addEventListener('click', () => container.classList.remove('open'));
        summaryCardInstance = {
            container,
            titleEl: container.querySelector('.documento-peticoes-summary-title'),
            nameEl: container.querySelector('.documento-peticoes-summary-name'),
            listEl: container.querySelector('.documento-peticoes-summary-list'),
            missingPanel: container.querySelector('.documento-peticoes-summary-missing'),
            missingList: container.querySelector('.documento-peticoes-summary-missing-list'),
            downloadBtn: container.querySelector('.documento-peticoes-summary-download')
        };
        return summaryCardInstance;
    };

    const showSummaryCard = (payload) => {
        const summary = createSummaryCard();
        if (!summary) {
            return;
        }
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        summary.listEl.innerHTML = '';
        entries.forEach(entry => {
            const li = document.createElement('li');
            li.className = 'documento-peticoes-summary-item';
            const labelText = entry.label ? `${entry.label}: ` : '';
            li.textContent = `${labelText}${entry.name || 'Arquivo'}`;
            summary.listEl.appendChild(li);
        });
        if (Array.isArray(payload.missing) && payload.missing.length) {
            summary.missingPanel.style.display = 'block';
            summary.missingList.innerHTML = '';
            payload.missing.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item;
                summary.missingList.appendChild(li);
            });
        } else {
            summary.missingPanel.style.display = 'none';
            summary.missingList.innerHTML = '';
        }
        summary.titleEl.textContent = payload.zip_name || 'Resumo do ZIP';
        summary.nameEl.textContent = payload.description || '';
        if (payload.url) {
            summary.downloadBtn.removeAttribute('disabled');
            summary.downloadBtn.onclick = () => window.open(payload.url, '_blank');
        } else {
            summary.downloadBtn.setAttribute('disabled', 'disabled');
            summary.downloadBtn.onclick = null;
        }
        summary.container.classList.add('open');
        currentSummaryData = payload;
    };

    const collectOptionalIds = () => {
        const modal = createPreviewModal();
        return Array.from(modal.optionalList.querySelectorAll('input[type="checkbox"]'))
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.id)
            .filter(Boolean);
    };

    async function runPreview() {
        ensureDocumentoPeticoesStyles();
        if (!selectedTipoId) {
            setStatus('Selecione um tipo de petição antes de executar.', 'error');
            return;
        }
        if (!selectedBaseId) {
            setStatus('Marque a base do arquivo antes de executar.', 'error');
            return;
        }
        const previewApiUrl = getPreviewApiUrl();
        if (!previewApiUrl) {
            setStatus('URL de preview não está configurada.', 'error');
            return;
        }
        setStatus('Gerando preview...', 'info');
        try {
            const response = await fetch(previewApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    tipo_id: selectedTipoId,
                    arquivo_base_id: selectedBaseId
                })
            });
            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.error || 'Falha ao gerar o preview.');
            }
            const preview = data.preview || {};
            openPreviewModal(preview, selectedTipoName || (selectedTipoItem?.nome || ''));
            setStatus('Preview pronto! Revise os itens e gere o ZIP.', 'success');
        } catch (err) {
            setStatus(err.message || 'Erro ao gerar o preview.', 'error');
        }
    }

    async function runGenerate() {
        const generateApiUrl = getGenerateApiUrl();
        if (!generateApiUrl) {
            setStatus('URL de geração não está configurada.', 'error');
            return;
        }
        if (!currentPreview || !currentPreview.tipoId) {
            setStatus('Gere um preview antes de tentar gerar o ZIP.', 'error');
            return;
        }
        if (!selectedBaseId) {
            setStatus('A base não está selecionada.', 'error');
            return;
        }
        const modal = createPreviewModal();
        modal.resultEl.style.display = 'none';
        modal.resultEl.textContent = '';
        modal.gerarBtn.disabled = true;
        try {
            const response = await fetch(generateApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    tipo_id: currentPreview.tipoId,
                    arquivo_base_id: selectedBaseId,
                    optional_ids: collectOptionalIds()
                })
            });
            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.error || 'Falha ao gerar o ZIP.');
            }
            setStatus('ZIP criado e download iniciado.', 'success');
            if (data.result?.url) {
                triggerDownload(data.result.url, data.result?.zip_name);
            }
            closePreviewModal();
            setTimeout(() => {
                window.location.reload();
            }, 800);
        } catch (err) {
            modal.resultEl.textContent = err.message || 'Erro ao gerar o ZIP.';
            modal.resultEl.style.display = 'block';
            setStatus(err.message || 'Erro ao gerar o ZIP.', 'error');
        } finally {
            modal.gerarBtn.disabled = false;
        }
    }

    document.addEventListener('arquivosPeticao:tipoChanged', updateExecuteButtonState);
    document.addEventListener('arquivosPeticao:baseChanged', updateExecuteButtonState);

    const tryAttachSubtab = () => {
        const tabs = document.querySelector('.inline-group-tabs');
        if (!tabs) {
            return;
        }

        if (document.querySelector('.inline-group-subtabs')) {
            return;
        }

        const subtab = document.createElement('div');
        subtab.className = 'inline-group-subtabs';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'inline-group-subtab-button';
        button.textContent = 'Protocolar ▾';
        subtab.appendChild(button);

        const dropdown = createDropdown();
        subtab.appendChild(dropdown);

        const obsTab = tabs.querySelector('.fake-observacoes-tab');
        if (obsTab && obsTab.parentNode) {
            obsTab.parentNode.insertBefore(subtab, obsTab.nextSibling);
        } else {
            tabs.appendChild(subtab);
        }

        selectButtonRef = dropdown.querySelector('.inline-group-subtab-select-button');
        executeButtonRef = dropdown.querySelector('[data-arquivos-peticoes-execute]');
        executeLabelRef = dropdown.querySelector('.inline-group-subtab-execute-label');
        statusElement = dropdown.querySelector('.inline-group-subtab-status');
        if (statusElement) {
            statusElement.hidden = true;
        }
        const apiUrl = window.__tipos_peticao_api_url || null;
        populateDropdown(dropdown, apiUrl);

        if (executeButtonRef) {
            executeButtonRef.addEventListener('click', (event) => {
                event.stopPropagation();
                if (executeButtonRef.disabled) {
                    return;
                }
                runPreview();
            });
        }
        updateExecuteButtonState();

        const openDropdown = () => {
            ensureDocumentoPeticoesStyles();
            dropdown.classList.add('open');
            button.setAttribute('aria-expanded', 'true');
        };
        const closeDropdown = () => {
            dropdown.classList.remove('open');
            button.setAttribute('aria-expanded', 'false');
        };
        const closeButton = dropdown.querySelector('.inline-group-subtab-dropdown-close');
        if (closeButton) {
            closeButton.addEventListener('click', closeDropdown);
        }
        button.addEventListener('click', function (event) {
            event.stopPropagation();
            if (!dropdown.classList.contains('open')) {
                openDropdown();
            }
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && dropdown.classList.contains('open')) {
                closeDropdown();
            }
        }, true);
        document.dispatchEvent(new CustomEvent('arquivosPeticao:executeReady'));
    };

    const initArquivosPeticoesTab = () => {
        tryAttachSubtab();
        initBaseSelectionObserver();
        // In case tabs load after, wait a bit
        setTimeout(tryAttachSubtab, 200);
    };
    if (document.readyState === 'complete') {
        initArquivosPeticoesTab();
    } else {
        window.addEventListener('load', initArquivosPeticoesTab);
    }
})();
