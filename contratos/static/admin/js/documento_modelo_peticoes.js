 (function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        const widget = document.querySelector('[data-documento-peticoes-widget]');
        if (!widget) {
            return;
        }

        const apiUrl = widget.dataset.apiUrl;
        const csrfToken = widget.dataset.csrfToken;
        const fieldsContainer = widget.querySelector('[data-documento-peticoes-fields]');
        const addButton = widget.querySelector('[data-documento-peticoes-add]');
        const saveButton = widget.querySelector('[data-documento-peticoes-save]');
        const messageEl = widget.querySelector('[data-documento-peticoes-message]');
        const dropdownContainer = widget.querySelector('[data-documento-peticoes-dropdown]');
        const dropdownSelect = widget.querySelector('[data-documento-peticoes-select]');
        const toggleButton = widget.querySelector('[data-documento-peticoes-toggle]');

        if (!apiUrl) {
            console.error('API URL ausente para os tipos de petição.');
            return;
        }

        let tipos = [];
        let isSaving = false;
        let previewModal = null;
        let currentPreview = null;

        const showMessage = (text, type = '') => {
            if (!messageEl) return;
            messageEl.textContent = text;
            messageEl.dataset.status = type;
        };

        const clearMessage = () => {
            if (!messageEl) return;
            messageEl.textContent = '';
            messageEl.dataset.status = '';
        };

        const getTipoDisplayName = (tipo) => {
            if (!tipo) {
                return '';
            }
            if (typeof tipo === 'object') {
                return String(tipo.nome || '').trim();
            }
            return String(tipo).trim();
        };

        const renderDropdownOptions = () => {
            if (!dropdownSelect) return;
            dropdownSelect.innerHTML = '<option value="">Selecione um tipo</option>';
            tipos.forEach(function (tipo) {
                const trimmed = getTipoDisplayName(tipo);
                if (!trimmed) {
                    return;
                }
                const option = document.createElement('option');
                option.value = trimmed;
                option.textContent = trimmed;
                dropdownSelect.appendChild(option);
            });
            dropdownSelect.disabled = dropdownSelect.options.length <= 1;
        };

        const createUploadArea = () => {
            const uploadArea = document.createElement('div');
            uploadArea.className = 'documento-peticoes-upload';
            uploadArea.innerHTML = `
                Arraste arquivos aqui ou <button type="button">Selecionar</button>
            `;
            const button = uploadArea.querySelector('button');
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.pdf,.doc,.docx';
            input.style.display = 'none';
            uploadArea.appendChild(input);
            button.addEventListener('click', () => input.click());
            input.addEventListener('change', () => {
                if (input.files.length) {
                    showMessage('Upload adicionado à fila (pendente de implementação).', 'success');
                }
            });
            return uploadArea;
        };

        const renderRows = () => {
            fieldsContainer.innerHTML = '';
            if (tipos.length === 0) {
                const placeholder = document.createElement('p');
                placeholder.className = 'documento-peticoes-placeholder';
                placeholder.textContent = 'Clique no + para começar a adicionar tipos.';
                fieldsContainer.appendChild(placeholder);
                return;
            }

            tipos.forEach(function (tipo, index) {
                const row = document.createElement('div');
                row.className = 'documento-peticoes-row';
                row.dataset.tipoId = tipo.id || '';

                const rowMain = document.createElement('div');
                rowMain.className = 'documento-peticoes-row-main';

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'documento-peticoes-input';
                input.value = tipo.nome || '';
                input.placeholder = 'Nome da petição';
                input.addEventListener('input', function () {
                    tipos[index] = { ...(tipos[index] || {}), nome: input.value };
                    clearMessage();
                    renderDropdownOptions();
                });

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'button button-secondary documento-peticoes-remove';
                removeBtn.textContent = 'Remover';
                removeBtn.addEventListener('click', function () {
                    tipos.splice(index, 1);
                    renderRows();
                    renderDropdownOptions();
                    clearMessage();
                });

                rowMain.appendChild(input);
                rowMain.appendChild(removeBtn);

                const actions = document.createElement('div');
                actions.style.display = 'flex';
                actions.style.flexDirection = 'column';
                actions.style.gap = '6px';

                actions.appendChild(createUploadArea());

                row.appendChild(rowMain);
                row.appendChild(actions);
                fieldsContainer.appendChild(row);
            });
        };

        const loadTipos = async () => {
            try {
                const response = await fetch(apiUrl, {
                    method: 'GET',
                    credentials: 'same-origin'
                });
                if (!response.ok) {
                    throw new Error('Não foi possível carregar os tipos.');
                }
                const data = await response.json();
                tipos = (data.tipos || []).map(item => ({
                    id: item.id || '',
                    nome: item.nome || ''
                }));
                renderRows();
                renderDropdownOptions();
            } catch (error) {
                showMessage(error.message, 'error');
            }
        };

        const saveTipos = async () => {
            if (isSaving) {
                return;
            }
            isSaving = true;
            saveButton.disabled = true;
            const payload = {
                tipos: tipos
                    .map(tipo => getTipoDisplayName(tipo))
                    .filter(name => name)
            };
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken || ''
                    },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const message = errorData.error || 'Falha ao salvar os tipos.';
                    throw new Error(message);
                }
                showMessage('Tipos salvos com sucesso.', 'success');
            } catch (error) {
                showMessage(error.message, 'error');
            } finally {
                isSaving = false;
                saveButton.disabled = false;
            }
        };

        addButton.addEventListener('click', function () {
            tipos.push({ id: '', nome: '' });
            renderRows();
            renderDropdownOptions();
            clearMessage();
            const inputs = fieldsContainer.querySelectorAll('.documento-peticoes-input');
            if (inputs.length) {
                inputs[inputs.length - 1].focus();
            }
        });

        if (saveButton) {
            saveButton.addEventListener('click', saveTipos);
        }

        const previewUrl = widget.dataset.previewUrl;
        const generateUrl = widget.dataset.generateUrl;

        const createPreviewModal = () => {
            if (previewModal) {
                return previewModal;
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

            closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
            voltarBtn.addEventListener('click', () => overlay.classList.remove('open'));
            prosseguirBtn.addEventListener('click', () => {
                gerarBtn.dataset.allowed = '1';
                overlay.querySelector('#documento-peticoes-modal-result').style.display = 'none';
            });
            gerarBtn.addEventListener('click', () => {
                if (!currentPreview) {
                    return;
                }
                gerarZip(currentPreview);
            });

            previewModal = {
                overlay,
                zipNameEl: overlay.querySelector('#documento-peticoes-modal-zipname'),
                foundList: overlay.querySelector('#documento-peticoes-modal-found'),
                missingPanel: overlay.querySelector('#documento-peticoes-modal-missing'),
                missingList: overlay.querySelector('#documento-peticoes-modal-missing-list'),
                optionalPanel: overlay.querySelector('#documento-peticoes-modal-optional'),
                optionalList: overlay.querySelector('#documento-peticoes-modal-optional-list'),
                resultEl: overlay.querySelector('#documento-peticoes-modal-result'),
                gerarBtn,
                overlayEl: overlay
            };
            return previewModal;
        };

        const openPreviewModal = (preview, tipoName) => {
            const modal = createPreviewModal();
            modal.zipNameEl.textContent = preview.zip_name || '(sem nome)';
            modal.foundList.innerHTML = '';
            preview.found.forEach(item => {
                const li = document.createElement('li');
                li.textContent = `${item.label} (${item.name})`;
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
            modal.gerarBtn.dataset.allowed = '1';
            modal.overlayEl.classList.add('open');
            currentPreview = { ...preview, tipoName, tipoId: preview.tipo_id };
        };

        const collectOptionalIds = () => {
            const modal = createPreviewModal();
            return Array.from(modal.optionalList.querySelectorAll('input[type="checkbox"]'))
                .filter(cb => cb.checked)
                .map(cb => cb.dataset.id)
                .filter(Boolean);
        };

        const runPreview = async (tipo) => {
            const baseId = window.__arquivos_peticao_selected_base_id || '';
            if (!baseId) {
                showMessage('Selecione o arquivo-base na aba Arquivos antes de executar.', 'error');
                return;
            }
            if (!previewUrl) {
                showMessage('URL de preview não configurada.', 'error');
                return;
            }
            showMessage('Gerando preview...', 'info');
            try {
                const response = await fetch(previewUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken || ''
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        tipo_id: tipo.id,
                        arquivo_base_id: baseId
                    })
                });
                const data = await response.json();
                if (!response.ok || !data.ok) {
                    throw new Error(data.error || 'Falha ao gerar preview');
                }
                openPreviewModal(data.preview, tipo.nome || '');
                showMessage('Preview pronto. Revise os faltantes.', 'success');
            } catch (err) {
                showMessage(err.message || 'erro ao gerar preview', 'error');
            }
        };

        const gerarZip = async (preview) => {
            if (!generateUrl) {
                showMessage('URL de geração não configurada.', 'error');
                return;
            }
            const modal = createPreviewModal();
            modal.resultEl.style.display = 'none';
            modal.resultEl.textContent = '';
            modal.gerarBtn.disabled = true;
            const payload = {
                tipo_id: preview.tipo_id,
                arquivo_base_id: window.__arquivos_peticao_selected_base_id,
                optional_ids: collectOptionalIds()
            };
            try {
                const response = await fetch(generateUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken || ''
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (!response.ok || !data.ok) {
                    throw new Error(data.error || 'Falha ao gerar ZIP');
                }
                modal.resultEl.textContent = `ZIP criado: ${data.result?.zip_name || 'arquivo'} — <a target="_blank" href="${data.result?.url}">Baixar</a>`;
                modal.resultEl.style.display = 'block';
            } catch (err) {
                modal.resultEl.textContent = err.message || 'Erro ao gerar o ZIP.';
                modal.resultEl.style.display = 'block';
            } finally {
                modal.gerarBtn.disabled = false;
            }
        };

        const toggleDropdown = (event) => {
            event.stopPropagation();
            if (!dropdownContainer) return;
            const isOpen = !dropdownContainer.hasAttribute('hidden');
            dropdownContainer.hidden = isOpen;
            toggleButton.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        };

        if (toggleButton) {
            toggleButton.addEventListener('click', toggleDropdown);
        }

        document.addEventListener('click', function (event) {
            if (!widget.contains(event.target) && dropdownContainer && !dropdownContainer.hasAttribute('hidden')) {
                dropdownContainer.hidden = true;
                toggleButton.setAttribute('aria-expanded', 'false');
            }
        });

        loadTipos();
    });
})();
