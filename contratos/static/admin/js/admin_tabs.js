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

    const getInlineTabLabel = (group) => {
        const header = group.querySelector('h2');
        const baseTitle = header ? header.textContent.trim() : 'Untitled';
        const normalizedId = (group.id || '').toLowerCase();
        const normalizedTitle = baseTitle.toLowerCase();
        const isTarefa = normalizedId.includes('tarefa') || normalizedTitle.includes('tarefa');
        const isPrazo = normalizedId.includes('prazo') || normalizedTitle.includes('prazo');
        if (isTarefa || isPrazo) {
            return 'Tarefas & Prazos';
        }
        return baseTitle;
    };

    const tabIndexByTitle = new Map();
    inlineGroups.forEach((group) => {
        const title = getInlineTabLabel(group);
        let entryIndex = tabIndexByTitle.get(title);
        let tabEntry;
        if (entryIndex === undefined) {
            const tabButton = document.createElement('button');
            tabButton.textContent = title;
            tabButton.type = 'button';

            tabEntry = {
                button: tabButton,
                title: title,
                groups: [group],
            };
            tabButtons.push(tabEntry);
            entryIndex = tabButtons.length - 1;
            tabIndexByTitle.set(title, entryIndex);
            tabsContainer.appendChild(tabButton);

            tabButton.addEventListener('click', () => {
                const scrollPos = window.pageYOffset || document.documentElement.scrollTop || 0;
                // Salva o título da aba ativa no localStorage
                localStorage.setItem(lastActiveTabKey, title);
                activateTab(tabButtons[entryIndex], scrollPos);
            });
        } else {
            tabEntry = tabButtons[entryIndex];
            tabEntry.groups.push(group);
        }
        // Mantém a referência ao primeiro grupo como padrão para rolagem
        tabEntry.primaryGroup = tabEntry.primaryGroup || tabEntry.groups[0];
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
	        const normalizeNotebookText = (value) => String(value || '')
	            .replace(/\r\n?/g, '\n')
	            .trim();

	        const safeJsonParse = (raw) => {
	            if (!raw || typeof raw !== 'string') return null;
	            try {
	                return JSON.parse(raw);
	            } catch (error) {
	                return null;
	            }
	        };

	        const getCnjActiveIndex = () => {
	            const field = document.querySelector('input[name="cnj_active_index"], #id_cnj_active_index');
	            if (!field) return -1;
	            const value = parseInt(field.value, 10);
	            return Number.isFinite(value) ? value : -1;
	        };

	        const findAnaliseResponsesField = () => {
	            const selectors = [
	                '#analise_processo-group textarea[name$="-respostas"]',
	                '.inline-group[id*="analise_processo"] textarea[name$="-respostas"]',
	                'textarea[name^="analise_processo-"][name$="-respostas"]',
	                'textarea[name$="-respostas"]',
	            ];
	            for (const selector of selectors) {
	                const fields = Array.from(document.querySelectorAll(selector));
	                for (const field of fields) {
	                    const raw = (field && typeof field.value === 'string') ? field.value.trim() : '';
	                    const parsed = safeJsonParse(raw);
	                    if (parsed && typeof parsed === 'object') {
	                        return field;
	                    }
	                }
	            }
	            return null;
	        };

	        const parseAnaliseResponses = () => {
	            const field = findAnaliseResponsesField();
	            if (!field) return null;
	            const raw = (typeof field.value === 'string') ? field.value.trim() : '';
	            const parsed = safeJsonParse(raw);
	            return (parsed && typeof parsed === 'object') ? parsed : null;
	        };

	        const persistNotebookToAnaliseResponses = (text) => {
	            const field = findAnaliseResponsesField();
	            if (!field) return false;
	            const raw = (typeof field.value === 'string') ? field.value.trim() : '';
	            const parsed = safeJsonParse(raw);
	            const responses = (parsed && typeof parsed === 'object') ? parsed : {};
	            const normalized = normalizeNotebookText(text);

	            responses.observacoes_livres = normalized;

	            const activeIndex = getCnjActiveIndex();
	            const cards = Array.isArray(responses.saved_processos_vinculados)
	                ? responses.saved_processos_vinculados
	                : [];
	            const targetIndex = (activeIndex >= 0 && activeIndex < cards.length)
	                ? activeIndex
	                : (cards.length === 1 ? 0 : -1);

	            if (targetIndex !== -1) {
	                const card = cards[targetIndex];
	                if (card && typeof card === 'object') {
	                    card.observacoes = normalized;
	                }
	            }

	            field.value = JSON.stringify(responses);
	            return true;
	        };

	        const collectCardObservationBlocks = () => {
	            const responses = parseAnaliseResponses();
	            if (!responses || typeof responses !== 'object') {
	                return [];
	            }
            const seen = new Set();
            const blocks = [];
            const appendBlock = (value) => {
                const normalized = normalizeNotebookText(value);
                if (!normalized) {
                    return;
                }
                const signature = normalized.toLowerCase();
                if (seen.has(signature)) {
                    return;
                }
                seen.add(signature);
                blocks.push(normalized);
            };

	            ['saved_processos_vinculados', 'processos_vinculados'].forEach((sourceKey) => {
	                const cards = Array.isArray(responses[sourceKey]) ? responses[sourceKey] : [];
	                cards.forEach((card) => {
	                    if (!card || typeof card !== 'object') {
	                        return;
	                    }
	                    appendBlock(card.observacoes);
	                    appendBlock(card.supervisor_observacoes);
	                });
	            });

	            appendBlock(responses.observacoes_livres);

	            return blocks;
	        };

        const mergeNotebookWithCardObservations = (baseText) => {
            const observationBlocks = collectCardObservationBlocks();
            if (!observationBlocks.length) {
                return normalizeNotebookText(baseText);
            }
            let merged = normalizeNotebookText(baseText);
            let mergedSignature = `\n${merged.toLowerCase()}\n`;
            observationBlocks.forEach((block) => {
                const blockSignature = `\n${block.toLowerCase()}\n`;
                if (mergedSignature.includes(blockSignature)) {
                    return;
                }
                merged = merged ? `${merged}\n\n${block}` : block;
                mergedSignature = `\n${merged.toLowerCase()}\n`;
            });
            return merged;
        };

        const hydrateNotebookText = (baseText = null) => {
            const current = (typeof baseText === 'string')
                ? baseText
                : (notebookTextarea ? notebookTextarea.value : (localStorage.getItem(noteKey) || ''));
            const merged = mergeNotebookWithCardObservations(current);
            if (notebookTextarea && notebookTextarea.value !== merged) {
                notebookTextarea.value = merged;
            }
            localStorage.setItem(noteKey, merged);
            return merged;
        };

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
            hydrateNotebookText(saved);
            const save = () => localStorage.setItem(noteKey, notebookTextarea.value);
            notebookTextarea.addEventListener('input', save);
            const ensureBlankLineBeforeMention = (text, cursorPos) => {
                const prefixSegment = typeof cursorPos === 'number'
                    ? text.slice(0, cursorPos)
                    : text;
                const normalized = prefixSegment.replace(/[ \t\r]+$/g, '');
                if (!normalized.trim()) {
                    return '';
                }
                if (normalized.endsWith('\n\n')) {
                    return '';
                }
                if (normalized.endsWith('\n')) {
                    return '\n';
                }
                return '\n\n';
            };

            const formatMentionForInsertion = (value, textarea, cursorPos) => {
                if (!value) {
                    return '';
                }
                const trimmed = value.trim();
                if (!trimmed) {
                    return '';
                }
                const separator = ensureBlankLineBeforeMention(
                    textarea ? textarea.value : '',
                    cursorPos
                );
                return `${separator}${trimmed}\n\n`;
            };

            const insertAtCursor = (textarea, value) => {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const before = textarea.value.slice(0, start);
                const after = textarea.value.slice(end);
                textarea.value = `${before}${value}${after}`;
                const cursor = before.length + value.length;
                textarea.selectionStart = textarea.selectionEnd = cursor;
            };

            notebookMentionSaver = (text) => {
                if (!text || !notebookTextarea) {
                    return;
                }
                const mention = formatMentionForInsertion(
                    text,
                    notebookTextarea,
                    notebookTextarea.selectionStart
                );
                if (!mention.trim()) {
                    return;
                }
                const atCursor = notebookTextarea.selectionStart !== null;
                if (atCursor) {
                    insertAtCursor(notebookTextarea, mention);
                } else {
                    notebookTextarea.value = `${notebookTextarea.value}${mention}`;
                }
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
	                const savedTextForDb = notebookTextarea ? notebookTextarea.value : '';
	                localStorage.setItem(noteKey, savedTextForDb);
	                persistNotebookToAnaliseResponses(savedTextForDb);
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
            hydrateNotebookText();
            if (text && notebookMentionSaver) {
                notebookMentionSaver(text);
            }
            if (!notebookOverlay) return;
            notebookOverlay.classList.add('open');
            notebookTextarea?.focus();
        };

        notebookBtn.addEventListener('click', () => {
            ensureNotebook();
            hydrateNotebookText();
            if (!notebookOverlay) return;
            notebookOverlay.classList.add('open');
            notebookTextarea?.focus();
        });

        window.addEventListener('analiseObservacoesSalvas', (event) => {
            const incoming = (event && typeof event.detail === 'string')
                ? event.detail
                : (localStorage.getItem(noteKey) || '');
            hydrateNotebookText(incoming);
        });
    })();

    const dispatchTabActivated = (tabEntry) => {
        if (!tabEntry) return;
        const detail = {
            title: tabEntry.title,
            groupIds: tabEntry.groups
                .map(group => group.id)
                .filter(Boolean),
            primaryGroupId: tabEntry.primaryGroup?.id || ''
        };
        document.dispatchEvent(new CustomEvent('cff:adminTabActivated', { detail }));
    };

    function activateTab(entry, scrollPos) {
        if (!entry) return;
        tabButtons.forEach(item => item.button.classList.remove('active'));
        inlineGroups.forEach(grp => grp.classList.remove('active'));

        entry.button.classList.add('active');
        entry.groups.forEach(grp => grp.classList.add('active'));
        syncAdvogadoPassivo();
        dispatchTabActivated(entry);
        // Restaura a rolagem após o reflow das abas
        window.requestAnimationFrame(() => {
            window.scrollTo({ top: scrollPos || 0, behavior: 'auto' });
        });
    }

    // Marca abas com erros e prioriza a primeira aba com erro
    const errorSelector = '.errorlist, .errors, .form-row.errors, .inline-related.errors';
    const firstErrorTabIndex = tabButtons.findIndex(item => item.groups.some(group => group.querySelector(errorSelector)));
    tabButtons.forEach(item => {
        if (item.groups.some(group => group.querySelector(errorSelector))) {
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
        activateTab(tabButtons[activeTabIndex], 0);
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

    window.__openInlineTab = function(tabTitle) {
        if (!tabTitle) return false;
        const match = tabButtons.find(item => item.title.trim().toLowerCase() === tabTitle.trim().toLowerCase());
        if (!match) {
            return false;
        }
        activateTab(match, 0);
        const targetGroup = match.primaryGroup || match.groups[0];
        if (targetGroup) {
            window.scrollTo({ top: targetGroup.offsetTop - 20, behavior: 'smooth' });
        }
        return true;
    };
});
