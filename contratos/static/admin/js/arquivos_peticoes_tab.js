(function () {
    'use strict';

    const createDropdown = () => {
        const dropdown = document.createElement('div');
        dropdown.className = 'inline-group-subtab-dropdown';
        dropdown.innerHTML = `
            <div class="inline-group-subtab-dropdown-header">
                <span>Petições</span>
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
                </div>
                <div class="inline-group-subtab-options-shell" hidden>
                    <div class="inline-group-subtab-options" hidden>
                    </div>
                </div>
            </div>
        `;
        return dropdown;
    };

    const normalizeText = (value) => {
        if (!value) {
            return '';
        }
        return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    };

    const getArquivoRows = () => {
        const tableBody = document.querySelector('#processoarquivo_set-group tbody');
        if (!tableBody) {
            return [];
        }
        return Array.from(tableBody.querySelectorAll('tr')).filter(row => row.querySelector('td.field-nome'));
    };

    const emitBaseChange = () => {
        document.dispatchEvent(new CustomEvent('arquivosPeticao:baseChanged', {
            detail: { baseId: selectedBaseId }
        }));
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
            checkbox.addEventListener('change', () => {
                const id = checkbox.dataset.fileId || '';
                if (checkbox.checked) {
                    selectedBaseId = id;
                    window.__arquivos_peticao_selected_base_id = id;
                    getArquivoRows().forEach((otherRow) => {
                        const otherCheckbox = otherRow.querySelector('.arquivos-peticoes-base-checkbox');
                        if (otherCheckbox && otherCheckbox !== checkbox) {
                            otherCheckbox.checked = false;
                        }
                    });
                } else if (selectedBaseId === id) {
                    selectedBaseId = '';
                    window.__arquivos_peticao_selected_base_id = '';
                }
                highlightSelectedRow();
                emitBaseChange();
            });
            wrapper.appendChild(checkbox);
            nameCell.insertBefore(wrapper, nameCell.firstChild);
        }
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
            const isCandidate = is01Row && normalizedType && nameText.includes(normalizedType);
            wrapper.style.display = is01Row ? 'inline-flex' : 'none';
            if (checkbox) {
                checkbox.disabled = !isCandidate;
                checkbox.checked = isCandidate && selectedBaseId && fileId && selectedBaseId === fileId;
            }
            if (!isCandidate && checkbox) {
                checkbox.checked = false;
                row.classList.remove('arquivos-peticoes-base-row');
            }
        });
        if (selectedBaseId) {
            highlightSelectedRow();
        }
    };

    const initBaseSelectionObserver = () => {
        const tableBody = document.querySelector('#processoarquivo_set-group tbody');
        if (!tableBody) {
            return;
        }
        const observer = new MutationObserver(refreshBaseCheckboxes);
        observer.observe(tableBody, { childList: true, subtree: true });
        refreshBaseCheckboxes();
    };

    let selectedTipoId = '';
    let selectedTipoName = '';
    let selectButtonRef = null;
    let selectedBaseId = '';

    const setActiveTipo = (tipoId, tipoName) => {
        selectedTipoId = tipoId;
        selectedTipoName = tipoName;
        selectedBaseId = '';
        window.__arquivos_peticao_selected_tipo_id = tipoId;
        window.__arquivos_peticao_selected_tipo_name = tipoName;
        window.__arquivos_peticao_selected_base_id = '';
        refreshBaseCheckboxes();
        document.dispatchEvent(new CustomEvent('arquivosPeticao:tipoChanged', {
            detail: { tipoId: selectedTipoId, tipoName: selectedTipoName }
        }));
        emitBaseChange();
        if (selectButtonRef) {
            const label = selectButtonRef.querySelector('.inline-group-subtab-select-label');
            if (label) {
                label.textContent = tipoName || 'Selecione um tipo';
            }
            selectButtonRef.classList.toggle('inline-group-subtab-select-active', Boolean(tipoName));
        }
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
                const types = Array.isArray(data.tipos) ? data.tipos : [];
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
                        setActiveTipo(id, name);
                        selectButton.querySelector('.inline-group-subtab-select-label').textContent = name;
                        setHidden(true);
                    });
                    optionsContainer.appendChild(optionBtn);
                });
                if (selectedTipoId) {
                    const match = types.find(item => String(item.id) === String(selectedTipoId));
                    if (match) {
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
            })
            .catch(() => {
                console.error('Não foi possível carregar os tipos.');
            });
    };

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
        button.textContent = 'Petições ▾';
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
        const apiUrl = window.__tipos_peticao_api_url || null;
        populateDropdown(dropdown, apiUrl);

        const openDropdown = () => {
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

    window.addEventListener('load', function () {
        tryAttachSubtab();
        initBaseSelectionObserver();
        // In case tabs load after, wait a bit
        setTimeout(tryAttachSubtab, 200);
    });
})();
