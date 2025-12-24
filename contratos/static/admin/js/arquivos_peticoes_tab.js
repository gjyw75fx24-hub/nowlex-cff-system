(function () {
    'use strict';

    const createDropdown = () => {
        const dropdown = document.createElement('div');
        dropdown.className = 'inline-group-subtab-dropdown';
        dropdown.innerHTML = `
            <div class="inline-group-subtab-dropdown-header">
                <span>Tipos de Petição</span>
                <button type="button" class="inline-group-subtab-dropdown-close" aria-label="Fechar lista">×</button>
            </div>
            <p class="inline-group-subtab-dropdown-status">Carregando...</p>
            <div class="inline-group-subtab-dropdown-body">
                <button type="button" class="inline-group-subtab-execute documento-peticoes-execute"
                        data-arquivos-peticoes-execute disabled>
                    <span class="documento-peticoes-execute-icon" aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                             xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
                            <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
                        </svg>
                    </span>
                    <span>Executar</span>
                </button>
                <button type="button" class="inline-group-subtab-select-button">
                    <span class="inline-group-subtab-select-label">Selecione um tipo</span>
                    <span class="inline-group-subtab-select-caret">▾</span>
                </button>
                <div class="inline-group-subtab-options" hidden>
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
        }
    };

    const populateDropdown = (dropdown, apiUrl) => {
        const status = dropdown.querySelector('.inline-group-subtab-dropdown-status');
        const optionsContainer = dropdown.querySelector('.inline-group-subtab-options');
        const selectButton = dropdown.querySelector('.inline-group-subtab-select-button');
        if (!optionsContainer || !selectButton) {
            return;
        }
        if (!apiUrl) {
            status.textContent = 'API indisponível.';
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
                    status.textContent = 'Nenhum tipo disponível.';
                    return;
                }
                status.style.display = 'none';
                optionsContainer.innerHTML = '';
                const markActive = (button) => {
                    optionsContainer.querySelectorAll('.inline-group-subtab-option').forEach(opt => {
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
                        optionsContainer.hidden = true;
                    });
                    optionsContainer.appendChild(optionBtn);
                });
                if (!selectedTipoId && types.length) {
                    const first = types[0];
                    selectButton.querySelector('.inline-group-subtab-select-label').textContent = String(first.nome || '').trim();
                    setActiveTipo(first.id || '', first.nome || '');
                    const firstBtn = optionsContainer.querySelector(`[data-tipo-id="${first.id || ''}"]`);
                    if (firstBtn) {
                        markActive(firstBtn);
                    }
                } else if (selectedTipoId) {
                    const match = types.find(item => String(item.id) === String(selectedTipoId));
                    if (match) {
                        selectButton.querySelector('.inline-group-subtab-select-label').textContent = match.nome || '';
                        const matchedBtn = optionsContainer.querySelector(`[data-tipo-id="${match.id || ''}"]`);
                        if (matchedBtn) {
                            markActive(matchedBtn);
                        }
                    }
                }
                selectButton.addEventListener('click', () => {
                    const isHidden = optionsContainer.hasAttribute('hidden');
                    setHidden(!isHidden);
                    updateCaret(!isHidden);
                });
                document.addEventListener('click', () => {
                    if (!optionsContainer.hasAttribute('hidden')) {
                        closeOptions();
                    }
                });
            })
            .catch(() => {
                status.textContent = 'Não foi possível carregar os tipos.';
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
