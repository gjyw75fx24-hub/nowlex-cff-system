// static/admin/js/admin_tabs.js

window.addEventListener('load', function() {
    const allInlineGroups = Array.from(document.querySelectorAll('.inline-group'));
    if (allInlineGroups.length === 0) {
        return;
    }

    const isAdvPassivo = group => {
        const title = (group.querySelector('h2')?.textContent || '').toLowerCase();
        return group.classList.contains('advogado-passivo-inline') || title.includes('advogado') && title.includes('passiva');
    };

    const advPassivoGroup = allInlineGroups.find(isAdvPassivo);
    const inlineGroups = allInlineGroups.filter(group => !isAdvPassivo(group));
    if (inlineGroups.length === 0) {
        return;
    }

    const partesGroup = inlineGroups.find(group => (group.id && group.id.includes('partes_processuais')) || group.classList.contains('dynamic-partes'));

    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'inline-group-tabs';
    inlineGroups[0].parentNode.insertBefore(tabsContainer, inlineGroups[0]);

    const tabButtons = []; // Para armazenar os botões e seus títulos
    const lastActiveTabKey = 'django_admin_last_active_tab';
    let activeTabIndex = 0; // Índice da aba a ser ativada

    inlineGroups.forEach((group, index) => {
        const title = group.querySelector('h2').textContent;
        const tabButton = document.createElement('button');
        tabButton.textContent = title;
        tabButton.type = 'button';

        tabButton.addEventListener('click', () => {
            const scrollPos = window.pageYOffset || document.documentElement.scrollTop || 0;
            // Salva o título da aba ativa no localStorage
            localStorage.setItem(lastActiveTabKey, title);
            
            activateTab(group, tabButton, scrollPos);
        });

        tabsContainer.appendChild(tabButton);
        tabButtons.push({ button: tabButton, title: title, group: group });
    });

    // Aba falsa "Observações" abre caderno flutuante
    (function addNotebookTab() {
        const notebookBtn = document.createElement('button');
        notebookBtn.type = 'button';
        notebookBtn.textContent = 'Observações';
        notebookBtn.className = 'fake-observacoes-tab';

        // insere após a aba Arquivos, se encontrada, senão no fim
        const arquivosIndex = tabButtons.findIndex(item => (item.title || '').toLowerCase().includes('arquivo'));
        const refButton = arquivosIndex !== -1 ? tabButtons[arquivosIndex].button : null;
        if (refButton && refButton.nextSibling) {
            tabsContainer.insertBefore(notebookBtn, refButton.nextSibling);
        } else {
            tabsContainer.appendChild(notebookBtn);
        }

        const noteKey = `observacoes_livres_${window.location.pathname}`;
        let notebookOverlay = null;
        let notebookTextarea = null;
        let notebookMentionSaver = null;

        const ensureNotebook = () => {
            if (notebookOverlay) return;
            notebookOverlay = document.createElement('div');
            notebookOverlay.className = 'notebook-overlay';
            notebookOverlay.innerHTML = `
                <div class="notebook" draggable="false">
                    <div class="notebook-header" data-drag-handle="1">
                        <span>Observações</span>
                        <button type="button" class="notebook-close" aria-label="Fechar">×</button>
                    </div>
                    <div class="notebook-body">
                        <textarea class="notebook-textarea" placeholder="Anote livremente aqui..."></textarea>
                    </div>
                    <div class="notebook-message" role="status" aria-live="polite"></div>
                    <div class="notebook-footer">
                        <button type="button" class="notebook-save-btn">Salvar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(notebookOverlay);
            notebookTextarea = notebookOverlay.querySelector('.notebook-textarea');

            const saved = localStorage.getItem(noteKey) || '';
            notebookTextarea.value = saved;
            const save = () => localStorage.setItem(noteKey, notebookTextarea.value);
            notebookTextarea.addEventListener('input', save);
            notebookMentionSaver = (text) => {
                if (!text || !notebookTextarea) {
                    return;
                }
                const mention = text.trim();
                if (!mention) {
                    return;
                }
                const current = notebookTextarea.value.trim();
                notebookTextarea.value = mention + (current ? `\n${current}` : '');
                save();
            };

            const messageSlot = notebookOverlay.querySelector('.notebook-message');
            let messageTimeout = null;
            const showNotebookMessage = (text, type = 'success') => {
                if (!messageSlot) return;
                messageSlot.textContent = text;
                messageSlot.className = `notebook-message visible ${type}`;
                if (messageTimeout) {
                    clearTimeout(messageTimeout);
                }
                messageTimeout = setTimeout(() => {
                    messageSlot.classList.remove('visible');
                }, 3500);
            };

            const close = () => notebookOverlay.classList.remove('open');
            notebookOverlay.querySelector('.notebook-close').addEventListener('click', close);
            document.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape' && notebookOverlay.classList.contains('open')) {
                    close();
                }
            });

            // Drag manual do caderno
            const notebook = notebookOverlay.querySelector('.notebook');
            const dragHandle = notebookOverlay.querySelector('[data-drag-handle]');
            const saveButton = notebookOverlay.querySelector('.notebook-save-btn');
            let isSaving = false;
            saveButton.addEventListener('click', async () => {
                if (isSaving) return;
                const targetForm = document.querySelector('#processojudicial_form') || document.querySelector('form');
                if (!targetForm) return;
                const formData = new FormData(targetForm);
                formData.set('_continue', '1');
                const actionUrl = targetForm.action || window.location.href;
                isSaving = true;
                const originalLabel = saveButton.textContent;
                saveButton.textContent = 'Salvando...';
                saveButton.disabled = true;
                try {
                    const response = await fetch(actionUrl, {
                        method: 'POST',
                        body: formData,
                        credentials: 'same-origin',
                        headers: {
                            'X-Requested-With': 'XMLHttpRequest'
                        }
                    });
                    if (!response.ok) {
                        throw new Error(`status ${response.status}`);
                    }
                    showNotebookMessage('Salvo com sucesso', 'success');
                    const savedText = notebookTextarea ? notebookTextarea.value : '';
                    window.dispatchEvent(new CustomEvent('analiseObservacoesSalvas', {
                        detail: savedText
                    }));
                } catch (error) {
                    showNotebookMessage(`Falha ao salvar: ${error.message}`, 'error');
                } finally {
                    isSaving = false;
                    saveButton.textContent = originalLabel;
                    saveButton.disabled = false;
                }
            });

            let isDragging = false;
            let startX = 0;
            let startY = 0;
            let origX = 0;
            let origY = 0;

            const onMouseDown = (ev) => {
                isDragging = true;
                startX = ev.clientX;
                startY = ev.clientY;
                const rect = notebook.getBoundingClientRect();
                origX = rect.left;
                origY = rect.top;
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            };

            const onMouseMove = (ev) => {
                if (!isDragging) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                notebook.style.position = 'fixed';
                notebook.style.left = `${origX + dx}px`;
                notebook.style.top = `${origY + dy}px`;
                notebook.style.transform = 'translate(0, 0)';
            };

            const onMouseUp = () => {
                isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            dragHandle.addEventListener('mousedown', onMouseDown);
        };

        window.openNotebookWithMention = function(text = '') {
            ensureNotebook();
            if (text && notebookMentionSaver) {
                notebookMentionSaver(text);
            }
            if (!notebookOverlay) return;
            notebookOverlay.classList.add('open');
            notebookTextarea?.focus();
        };

        notebookBtn.addEventListener('click', () => {
            ensureNotebook();
            if (!notebookOverlay) return;
            notebookOverlay.classList.add('open');
            notebookTextarea?.focus();
        });
    })();

    function activateTab(group, tabButton, scrollPos) {
        tabButtons.forEach(item => item.button.classList.remove('active'));
        inlineGroups.forEach(grp => grp.classList.remove('active'));

        tabButton.classList.add('active');
        group.classList.add('active');
        syncAdvogadoPassivo();
        // Restaura a rolagem após o reflow das abas
        window.requestAnimationFrame(() => {
            window.scrollTo({ top: scrollPos || 0, behavior: 'auto' });
        });
    }

    // Marca abas com erros e prioriza a primeira aba com erro
    const errorSelector = '.errorlist, .errors, .form-row.errors, .inline-related.errors';
    const firstErrorTabIndex = tabButtons.findIndex(item => item.group.querySelector(errorSelector));
    tabButtons.forEach(item => {
        if (item.group.querySelector(errorSelector)) {
            item.button.classList.add('has-errors');
        }
    });

    // Tenta carregar a última aba ativa do localStorage
    const savedTabTitle = localStorage.getItem(lastActiveTabKey);
    if (savedTabTitle) {
        const savedTabIndex = tabButtons.findIndex(item => item.title === savedTabTitle);
        if (savedTabIndex !== -1) {
            activeTabIndex = savedTabIndex;
        }
    }

    // Se houver erro, essa aba tem prioridade sobre a aba salva
    if (firstErrorTabIndex !== -1) {
        activeTabIndex = firstErrorTabIndex;
    }

    // Ativa a aba correspondente ao activeTabIndex
    if (tabButtons.length > 0) {
        activateTab(
            tabButtons[activeTabIndex].group,
            tabButtons[activeTabIndex].button
        );
    }

    function syncAdvogadoPassivo() {
        if (!advPassivoGroup || !partesGroup) {
            return;
        }
        if (partesGroup.classList.contains('active')) {
            advPassivoGroup.classList.add('active');
        } else {
            advPassivoGroup.classList.remove('active');
        }
    }

    syncAdvogadoPassivo();
});
