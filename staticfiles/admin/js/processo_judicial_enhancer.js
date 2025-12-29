document.addEventListener('DOMContentLoaded', function() {

    // --- Seletores Globais ---
    const form = document.getElementById('processojudicial_form');
    const cnjInput = document.getElementById('id_cnj');
    const ufInput = document.getElementById('id_uf');
    const tribunalInput = document.getElementById('id_tribunal');
    const varaInput = document.getElementById('id_vara');
    const valorCausaInput = document.getElementById('id_valor_causa');
    const statusSelect = document.getElementById('id_status');

    // --- 1. Criação do Botão "Dados Online" ---
    if (cnjInput && !document.getElementById('btn_buscar_cnj')) {
        const searchButton = document.createElement('button');
        searchButton.id = 'btn_buscar_cnj';
        searchButton.type = 'button';
        searchButton.className = 'button';
        searchButton.innerText = '📄 Dados Online';
        searchButton.style.marginLeft = '10px';
        cnjInput.parentNode.appendChild(searchButton);

        const feedbackDiv = document.createElement('div');
        feedbackDiv.id = 'cnj_feedback';
        feedbackDiv.style.marginTop = '5px';
        feedbackDiv.style.fontWeight = 'bold';
        cnjInput.parentNode.parentNode.appendChild(feedbackDiv);
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
        overlay.style.zIndex = 2000;
        overlay.style.minWidth = '280px';

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
        button.addEventListener('click', () => overlay.remove());
        overlay.appendChild(button);

        document.body.appendChild(overlay);
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
                </div>
            </div>
        `;
        placeholderRow.appendChild(placeholderCell);
        processoRow.parentNode.insertBefore(placeholderRow, processoRow.nextSibling);
    };
    insertAgendaSidebarPlaceholder();

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
    if (buscaAtivaInput && !document.getElementById('btn_atualizar_andamentos')) {
        const actionHost = andamentosActionsContainer || buscaAtivaInput.parentNode;
        const btn = document.createElement('button');
        btn.id = 'btn_atualizar_andamentos';
        btn.type = 'button';
        btn.className = 'button analise-inner-tab-button';
        btn.innerText = '🔄 Atualizar andamentos agora';

        actionHost.appendChild(btn);

        const removeDuplicatesBtn = document.createElement('button');
        removeDuplicatesBtn.id = 'btn_remover_andamentos_duplicados';
        removeDuplicatesBtn.type = 'button';
        removeDuplicatesBtn.className = 'button analise-inner-tab-button';
        removeDuplicatesBtn.innerText = '🧹 Limpar duplicados';

        actionHost.appendChild(removeDuplicatesBtn);

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
                const messageParts = [];
                const serverMessage = data.message || (removed ? `${removed} andamento(s) duplicado(s) removido(s).` : 'Não foram encontrados andamentos duplicados.');
                if (serverMessage) {
                    messageParts.push(serverMessage);
                }
                if (inlineRemoved > 0) {
                    messageParts.push(`${inlineRemoved} andamento(s) duplicado(s) foram marcados para remoção no formulário. Salve para confirmar a exclusão.`);
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
        form.addEventListener('submit', () => {
            deduplicateInlineAndamentos();
        });
    }

    const removeInlineRelatedLinks = (root = document) => {
        ['tarefas-group', 'listas-group', 'prazos-group'].forEach(groupId => {
            const group = document.getElementById(groupId);
            if (!group) return;
            const cleanup = (target = group) => {
                target.querySelectorAll('.related-widget-wrapper').forEach(el => {
                    el.remove();
                });
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
            if (valorCausaInput && processo.valor_causa) {
                // O Django DecimalField espera um ponto como separador decimal, não vírgula.
                valorCausaInput.value = processo.valor_causa;
            } else if (valorCausaInput) {
                valorCausaInput.value = '0.00';
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
