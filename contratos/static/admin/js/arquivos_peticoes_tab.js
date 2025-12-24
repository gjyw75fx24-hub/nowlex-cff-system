(function () {
    'use strict';

    const createDropdown = () => {
        const dropdown = document.createElement('div');
        dropdown.className = 'inline-group-subtab-dropdown';
        dropdown.innerHTML = `
            <p class="inline-group-subtab-dropdown-status">Carregando...</p>
            <select class="inline-group-subtab-select">
                <option value="">Selecione um tipo</option>
            </select>
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

    const ensureBaseWrapper = (row) => {
        let wrapper = row.querySelector('.arquivos-peticoes-base-wrapper');
        const nameCell = row.querySelector('td.field-nome');
        if (!nameCell) {
            return null;
        }
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'arquivos-peticoes-base-wrapper';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'arquivos_peticao_base';
            radio.className = 'arquivos-peticoes-base-radio';
            radio.addEventListener('change', () => {
                const id = radio.dataset.fileId || '';
                selectedBaseId = id;
                window.__arquivos_peticao_selected_base_id = id;
                highlightSelectedRow();
            });
            wrapper.appendChild(radio);
            nameCell.insertBefore(wrapper, nameCell.firstChild);
        }
        return wrapper;
    };

    const highlightSelectedRow = () => {
        getArquivoRows().forEach(row => {
            const radio = row.querySelector('.arquivos-peticoes-base-radio');
            if (!radio) {
                return;
            }
            const rowSelected = String(selectedBaseId) && radio.dataset.fileId === selectedBaseId && radio.checked;
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
            const radio = wrapper.querySelector('input[type="radio"]');
            const idInput = row.querySelector('input[id$="-id"]');
            const fileId = idInput ? idInput.value : null;
            if (fileId) {
                radio.dataset.fileId = fileId;
            }
            const nameText = normalizeText(row.querySelector('td.field-nome')?.textContent || '');
            const isCandidate = normalizedType && nameText.includes('01 -') && nameText.includes(normalizedType);
            wrapper.style.display = isCandidate ? 'inline-flex' : 'none';
            radio.disabled = !isCandidate;
            if (!isCandidate) {
                radio.checked = false;
                row.classList.remove('arquivos-peticoes-base-row');
            }
            if (!selectedBaseId || selectedBaseId !== fileId) {
                radio.checked = false;
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
    let selectedBaseId = '';

    const setActiveTipo = (tipoId, tipoName) => {
        selectedTipoId = tipoId;
        selectedTipoName = tipoName;
        selectedBaseId = '';
        window.__arquivos_peticao_selected_tipo_id = tipoId;
        window.__arquivos_peticao_selected_tipo_name = tipoName;
        window.__arquivos_peticao_selected_base_id = '';
        refreshBaseCheckboxes();
    };

    const updateTipoSelectionFromDropdown = (select) => {
        const option = select.selectedOptions[0];
        setActiveTipo(option?.value || '', option?.textContent?.trim() || '');
    };

    const populateDropdown = (dropdown, apiUrl) => {
        const status = dropdown.querySelector('.inline-group-subtab-dropdown-status');
        const select = dropdown.querySelector('.inline-group-subtab-select');
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
                    select.style.display = 'none';
                    return;
                }
                status.style.display = 'none';
                select.innerHTML = '<option value="">Selecione um tipo</option>';
                select.disabled = false;
                types.forEach(item => {
                    const name = item.nome || item.value || '';
                    if (!name) return;
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    select.appendChild(option);
                });
                select.addEventListener('change', () => {
                    updateTipoSelectionFromDropdown(select);
                });
            })
            .catch(() => {
                status.textContent = 'Não foi possível carregar os tipos.';
                select.style.display = 'none';
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

        const apiUrl = window.__tipos_peticao_api_url || null;
        populateDropdown(dropdown, apiUrl);

        const toggleDropdown = (event) => {
            event.stopPropagation();
            const isOpen = dropdown.classList.toggle('open');
            button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        };

        button.addEventListener('click', toggleDropdown);
        document.addEventListener('click', function (event) {
            if (!subtab.contains(event.target)) {
                dropdown.classList.remove('open');
                button.setAttribute('aria-expanded', 'false');
            }
        });
    };

    window.addEventListener('load', function () {
        tryAttachSubtab();
        initBaseSelectionObserver();
        // In case tabs load after, wait a bit
        setTimeout(tryAttachSubtab, 200);
    });
})();
