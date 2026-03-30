(function () {
    const $ = window.jQuery || (window.django && window.django.jQuery);

    function normalizeErrorMessage(xhr, fallbackMessage) {
        return xhr?.responseJSON?.detail
            || String(xhr?.responseText || '').trim()
            || fallbackMessage;
    }

    document.addEventListener('DOMContentLoaded', function () {
        const root = document.getElementById('slack-supervision-manager-root');
        if (!root || !$) {
            return;
        }

        const listUrl = String(root.dataset.listUrl || '').trim();
        const refreshUrl = String(root.dataset.refreshUrl || '').trim();
        const deleteUrl = String(root.dataset.deleteUrl || '').trim();
        const csrftoken = String(document.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '').trim();
        if (!listUrl || !refreshUrl || !deleteUrl) {
            return;
        }

        const summary = document.getElementById('slack-supervision-manager-summary');
        const feedback = document.getElementById('slack-supervision-manager-feedback');
        const list = document.getElementById('slack-supervision-manager-list');
        const typeFilterSelect = document.getElementById('slack-supervision-manager-type-filter');
        const refreshBtn = document.getElementById('slack-supervision-manager-refresh');
        const sendSelectedBtn = document.getElementById('slack-supervision-manager-send-selected');
        const deleteLastBtn = document.getElementById('slack-supervision-manager-delete-last');
        const deleteSelectedBtn = document.getElementById('slack-supervision-manager-delete-selected');
        const deleteAllBtn = document.getElementById('slack-supervision-manager-delete-all');
        const findOldThreadsBtn = document.getElementById('slack-supervision-manager-find-old-threads');
        const deleteOldThreadsBtn = document.getElementById('slack-supervision-manager-delete-old-threads');
        const typeFilterWrapper = typeFilterSelect ? typeFilterSelect.closest('.analise-slack-deliveries-toolbar__filter') : null;

        let deliveries = [];
        let summaryData = {
            sent_count: 0,
            responded_count: 0,
            pending_count: 0,
            queued_count: 0,
        };
        let isBusy = false;
        let emptyListMessage = 'Nenhuma entrega Slack de supervisão foi encontrada para os supervisores.';
        let hasRemoteLoadWarnings = false;
        let orphanReplyKeys = [];
        let highlightOrphanReplies = false;
        let reconcileRetryTimer = null;
        let reconcileRetryAttempts = 0;
        const maxReconcileRetryAttempts = 4;
        let activeSummaryFilter = 'all';
        let activeAnalysisTypeFilter = '';
        let availableAnalysisTypes = [];
        let selectedDeliveryKeys = new Set();
        let typePickerRoot = null;
        let typePickerTrigger = null;
        let typePickerMenu = null;

        function fetchSlackSupervisionDeliveries(options = {}) {
            const requestData = {};
            if (options && options.reconcile) {
                requestData.reconcile = '1';
            }
            return $.ajax({
                url: listUrl,
                method: 'GET',
                data: requestData,
                dataType: 'json',
            });
        }

        function refreshSlackSupervisionDeliveries(options = {}) {
            const payload = {};
            if (options && options.mode) {
                payload.mode = options.mode;
            }
            if (options && Array.isArray(options.deliveryIds) && options.deliveryIds.length) {
                payload.delivery_ids = options.deliveryIds;
            }
            return $.ajax({
                url: refreshUrl,
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken },
                contentType: 'application/json; charset=utf-8',
                dataType: 'json',
                data: JSON.stringify(payload),
            });
        }

        function deleteSlackSupervisionDeliveries(mode, deliveryIds = []) {
            return $.ajax({
                url: deleteUrl,
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken },
                contentType: 'application/json; charset=utf-8',
                dataType: 'json',
                data: JSON.stringify({
                    mode,
                    delivery_ids: deliveryIds,
                }),
            });
        }

        const getAllDeliveries = () => (Array.isArray(deliveries) ? deliveries : []);

        const syncSelectedDeliveryKeysFromDom = () => {
            const visibleKeys = new Set(
                Array.from(list.querySelectorAll('input[type="checkbox"][data-delivery-key]'))
                    .map((input) => String(input.getAttribute('data-delivery-key') || '').trim())
                    .filter(Boolean)
            );
            visibleKeys.forEach((key) => selectedDeliveryKeys.delete(key));
            Array.from(list.querySelectorAll('input[type="checkbox"][data-delivery-key]:checked'))
                .map((input) => String(input.getAttribute('data-delivery-key') || '').trim())
                .filter(Boolean)
                .forEach((key) => selectedDeliveryKeys.add(key));
        };

        const getSelectedIds = () => {
            syncSelectedDeliveryKeysFromDom();
            return Array.from(selectedDeliveryKeys).filter(Boolean);
        };

        const getSelectedLocalIds = () => {
            const selectedIds = new Set(getSelectedIds());
            return getAllDeliveries()
                .filter((delivery) => selectedIds.has(String(delivery?.delivery_key || '').trim()))
                .map((delivery) => {
                    const rawId = String(delivery?.id ?? '').trim();
                    return /^\d+$/.test(rawId) ? rawId : '';
                })
                .filter(Boolean);
        };

        const matchesSummaryFilter = (delivery) => {
            if (!delivery || activeSummaryFilter === 'all') {
                return true;
            }
            if (activeSummaryFilter === 'sent') {
                return Boolean(delivery.has_message);
            }
            if (activeSummaryFilter === 'responded') {
                return Boolean(delivery.is_responded);
            }
            if (activeSummaryFilter === 'pending') {
                return Boolean(delivery.is_pending);
            }
            if (activeSummaryFilter === 'queued') {
                return String(delivery.dispatch_state || '').trim() === 'queued';
            }
            return true;
        };

        const matchesTypeFilter = (delivery) => {
            if (!activeAnalysisTypeFilter) {
                return true;
            }
            return String(delivery?.analysis_type_filter_key || delivery?.analysis_type_slug || '').trim() === activeAnalysisTypeFilter;
        };

        const getVisibleDeliveries = () => (
            getAllDeliveries().filter((delivery) => matchesSummaryFilter(delivery) && matchesTypeFilter(delivery))
        );

        const refreshTypeFilterOptions = () => {
            const options = Array.isArray(availableAnalysisTypes) ? availableAnalysisTypes.slice() : [];
            options.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
            typeFilterSelect.innerHTML = '';
            const allOption = document.createElement('option');
            allOption.value = '';
            allOption.textContent = 'Todos os tipos';
            typeFilterSelect.appendChild(allOption);
            options.forEach((item) => {
                const optionEl = document.createElement('option');
                optionEl.value = item.slug;
                optionEl.textContent = item.name;
                typeFilterSelect.appendChild(optionEl);
            });
            if (activeAnalysisTypeFilter && !options.some((item) => item.slug === activeAnalysisTypeFilter)) {
                activeAnalysisTypeFilter = '';
            }
            typeFilterSelect.value = activeAnalysisTypeFilter;
            renderTypePickerOptions();
        };

        const closeTypePicker = () => {
            if (typePickerRoot) {
                typePickerRoot.classList.remove('is-open');
            }
            if (typePickerTrigger) {
                typePickerTrigger.setAttribute('aria-expanded', 'false');
            }
        };

        const openTypePicker = () => {
            if (!typePickerRoot || !typePickerTrigger || isBusy) {
                return;
            }
            typePickerRoot.classList.add('is-open');
            typePickerTrigger.setAttribute('aria-expanded', 'true');
        };

        const renderTypePickerOptions = () => {
            if (!typePickerTrigger || !typePickerMenu || !typeFilterSelect) {
                return;
            }
            const selectedOption = typeFilterSelect.options[typeFilterSelect.selectedIndex];
            typePickerTrigger.textContent = selectedOption ? selectedOption.textContent : 'Todos os tipos';
            typePickerMenu.innerHTML = '';
            Array.from(typeFilterSelect.options).forEach((option) => {
                const optionBtn = document.createElement('button');
                optionBtn.type = 'button';
                optionBtn.className = 'analise-slack-deliveries-type-picker__option';
                if (option.selected) {
                    optionBtn.classList.add('analise-slack-deliveries-type-picker__option--active');
                }
                optionBtn.textContent = option.textContent;
                optionBtn.addEventListener('click', () => {
                    typeFilterSelect.value = option.value;
                    typeFilterSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
                    closeTypePicker();
                });
                typePickerMenu.appendChild(optionBtn);
            });
        };

        const ensureTypePicker = () => {
            if (!typeFilterWrapper || !typeFilterSelect) {
                return;
            }
            if (!typePickerRoot) {
                typePickerRoot = document.createElement('div');
                typePickerRoot.className = 'analise-slack-deliveries-type-picker';
                typePickerTrigger = document.createElement('button');
                typePickerTrigger.type = 'button';
                typePickerTrigger.className = 'analise-slack-deliveries-type-picker__trigger';
                typePickerTrigger.setAttribute('aria-haspopup', 'listbox');
                typePickerTrigger.setAttribute('aria-expanded', 'false');
                typePickerMenu = document.createElement('div');
                typePickerMenu.className = 'analise-slack-deliveries-type-picker__menu';
                typePickerMenu.setAttribute('role', 'listbox');
                typePickerTrigger.addEventListener('click', () => {
                    if (typePickerRoot.classList.contains('is-open')) {
                        closeTypePicker();
                        return;
                    }
                    openTypePicker();
                });
                typePickerRoot.appendChild(typePickerTrigger);
                typePickerRoot.appendChild(typePickerMenu);
                typeFilterWrapper.appendChild(typePickerRoot);
                typeFilterWrapper.classList.add('is-enhanced');
                typeFilterSelect.classList.add('analise-slack-deliveries-toolbar__select--native');
                document.addEventListener('click', (event) => {
                    if (!typePickerRoot || typePickerRoot.contains(event.target) || typeFilterWrapper.contains(event.target) && event.target === typeFilterSelect) {
                        return;
                    }
                    closeTypePicker();
                });
                document.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape') {
                        closeTypePicker();
                    }
                });
            }
            renderTypePickerOptions();
        };

        const isOrphanThreadReply = (delivery) => (
            Boolean(delivery?.is_remote_orphan) && String(delivery?.message_kind || '').trim() === 'thread_reply_orphan'
        );

        const syncOrphanReplyKeys = () => {
            orphanReplyKeys = getAllDeliveries()
                .filter((delivery) => isOrphanThreadReply(delivery))
                .map((delivery) => String(delivery?.delivery_key || '').trim())
                .filter(Boolean);
        };

        const setBusy = (busy) => {
            isBusy = busy;
            [
                refreshBtn,
                sendSelectedBtn,
                deleteLastBtn,
                deleteSelectedBtn,
                deleteAllBtn,
                findOldThreadsBtn,
                deleteOldThreadsBtn,
                typeFilterSelect,
            ].forEach((button) => {
                button.disabled = busy;
            });
            if (typePickerTrigger) {
                typePickerTrigger.disabled = busy;
            }
            if (busy) {
                closeTypePicker();
            }
            list.classList.toggle('is-loading', busy);
        };

        const setActionLoadingState = (button, active, activeText) => {
            if (!button) {
                return;
            }
            if (!button.dataset.defaultLabel) {
                button.dataset.defaultLabel = button.textContent || '';
            }
            if (active) {
                button.textContent = activeText;
                button.classList.add('is-loading');
            } else {
                button.textContent = button.dataset.defaultLabel || button.textContent;
                button.classList.remove('is-loading');
            }
        };

        const resetToolbarLoadingState = () => {
            [
                refreshBtn,
                sendSelectedBtn,
                deleteLastBtn,
                deleteSelectedBtn,
                deleteAllBtn,
                findOldThreadsBtn,
                deleteOldThreadsBtn,
            ].forEach((button) => setActionLoadingState(button, false));
        };

        const setFeedback = (message, variant = 'info') => {
            const text = String(message || '').trim();
            if (!text) {
                feedback.style.display = 'none';
                feedback.textContent = '';
                feedback.className = 'analise-slack-deliveries-modal__feedback';
                return;
            }
            feedback.style.display = '';
            feedback.textContent = text;
            feedback.className = `analise-slack-deliveries-modal__feedback analise-slack-deliveries-modal__feedback--${variant}`;
        };

        const refreshActionState = () => {
            const selectedCount = getSelectedIds().length;
            const selectedLocalCount = getSelectedLocalIds().length;
            deleteSelectedBtn.disabled = isBusy || selectedCount === 0;
            deleteLastBtn.disabled = isBusy || deliveries.length === 0;
            deleteAllBtn.disabled = isBusy || (deliveries.length === 0 && !hasRemoteLoadWarnings);
            sendSelectedBtn.disabled = isBusy || selectedLocalCount === 0;
            deleteOldThreadsBtn.disabled = isBusy || orphanReplyKeys.length === 0;
            refreshBtn.textContent = selectedLocalCount > 0 ? 'Atualizar selecionadas' : 'Atualizar';
        };

        const collectDeliveryErrorMessages = (items) => (
            Array.from(new Set(
                (Array.isArray(items) ? items : [])
                    .map((item) => String(item?.error || '').trim())
                    .filter(Boolean)
            ))
        );

        const renderSummary = () => {
            const cards = [
                { label: 'Enviadas', value: summaryData.sent_count || 0, filterKey: 'sent' },
                { label: 'Respondidas', value: summaryData.responded_count || 0, filterKey: 'responded' },
                { label: 'Pendentes', value: summaryData.pending_count || 0, filterKey: 'pending' },
                { label: 'Em fila', value: summaryData.queued_count || 0, filterKey: 'queued' },
            ];
            summary.innerHTML = '';
            cards.forEach((card) => {
                const cardEl = document.createElement('button');
                cardEl.type = 'button';
                cardEl.className = 'analise-slack-deliveries-summary__card';
                if (activeSummaryFilter === card.filterKey) {
                    cardEl.classList.add('analise-slack-deliveries-summary__card--active');
                }
                const valueEl = document.createElement('strong');
                valueEl.textContent = String(card.value);
                const labelEl = document.createElement('span');
                labelEl.textContent = card.label;
                cardEl.appendChild(valueEl);
                cardEl.appendChild(labelEl);
                cardEl.addEventListener('click', () => {
                    activeSummaryFilter = activeSummaryFilter === card.filterKey ? 'all' : card.filterKey;
                    renderSummary();
                    renderList();
                });
                summary.appendChild(cardEl);
            });
        };

        const renderList = () => {
            list.innerHTML = '';
            const visibleDeliveries = getVisibleDeliveries();
            if (!deliveries.length) {
                const empty = document.createElement('div');
                empty.className = 'analise-slack-deliveries-empty';
                empty.textContent = emptyListMessage;
                list.appendChild(empty);
                refreshActionState();
                return;
            }
            if (!visibleDeliveries.length) {
                const empty = document.createElement('div');
                empty.className = 'analise-slack-deliveries-empty';
                empty.textContent = 'Nenhuma mensagem corresponde ao filtro atual.';
                list.appendChild(empty);
                refreshActionState();
                return;
            }

            visibleDeliveries.forEach((delivery) => {
                const item = document.createElement('label');
                item.className = 'analise-slack-deliveries-item';
                if (highlightOrphanReplies && isOrphanThreadReply(delivery)) {
                    item.classList.add('analise-slack-deliveries-item--orphan-thread');
                }

                const deliveryKey = String(delivery.delivery_key || delivery.id || '').trim();
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.setAttribute('data-delivery-key', deliveryKey);
                checkbox.checked = selectedDeliveryKeys.has(deliveryKey);
                if (highlightOrphanReplies && isOrphanThreadReply(delivery)) {
                    checkbox.checked = true;
                    selectedDeliveryKeys.add(deliveryKey);
                }

                const content = document.createElement('div');
                content.className = 'analise-slack-deliveries-item__content';

                const titleEl = document.createElement('div');
                titleEl.className = 'analise-slack-deliveries-item__title';
                const typeBadge = document.createElement('span');
                typeBadge.className = 'analise-slack-deliveries-item__type-badge';
                typeBadge.textContent = String(delivery.analysis_type_short || delivery.analysis_type_name || 'A').trim().slice(0, 12);
                typeBadge.title = String(delivery.analysis_type_name || '').trim();
                const titleText = document.createElement('span');
                titleText.className = 'analise-slack-deliveries-item__title-text';
                const queueLabel = Number.isFinite(Number(delivery.queue_position)) && Number(delivery.queue_position) > 0
                    ? ` · Em fila #${delivery.queue_position}`
                    : '';
                titleText.textContent = `${delivery.cnj_label || 'Card'}${queueLabel}`;
                titleEl.appendChild(typeBadge);
                titleEl.appendChild(titleText);

                const meta = document.createElement('div');
                meta.className = 'analise-slack-deliveries-item__meta';
                const statusText = delivery.dispatch_state === 'queued'
                    ? 'Status Slack: em fila'
                    : (delivery.last_status ? `Status Slack: ${delivery.last_status}` : 'Status Slack: enviado');
                meta.textContent = [
                    delivery.analysis_type_name ? `Tipo: ${delivery.analysis_type_name}` : '',
                    delivery.supervisor_name ? `Supervisor: ${delivery.supervisor_name}` : '',
                    delivery.parte_nome ? `Parte: ${delivery.parte_nome}` : '',
                    delivery.processo_label ? `Processo: ${delivery.processo_label}` : '',
                    delivery.notified_at_display ? `Enviada em ${delivery.notified_at_display}` : 'Ainda não enviada',
                    statusText,
                    delivery.card_source ? `Origem: ${delivery.card_source}:${delivery.card_index}` : '',
                ].filter(Boolean).join(' · ');

                content.appendChild(titleEl);
                content.appendChild(meta);
                item.appendChild(checkbox);
                item.appendChild(content);
                list.appendChild(item);
            });

            list.querySelectorAll('input[type="checkbox"][data-delivery-key]').forEach((input) => {
                input.addEventListener('change', () => {
                    const deliveryKey = String(input.getAttribute('data-delivery-key') || '').trim();
                    if (!deliveryKey) {
                        refreshActionState();
                        return;
                    }
                    if (input.checked) {
                        selectedDeliveryKeys.add(deliveryKey);
                    } else {
                        selectedDeliveryKeys.delete(deliveryKey);
                    }
                    refreshActionState();
                });
            });
            refreshActionState();
        };

        const clearReconcileRetryState = () => {
            if (reconcileRetryTimer) {
                window.clearTimeout(reconcileRetryTimer);
                reconcileRetryTimer = null;
            }
            reconcileRetryAttempts = 0;
        };

        const scheduleReconcileRetry = (contextLabel = 'fila') => {
            if (reconcileRetryTimer || reconcileRetryAttempts >= maxReconcileRetryAttempts) {
                return;
            }
            reconcileRetryAttempts += 1;
            reconcileRetryTimer = window.setTimeout(() => {
                reconcileRetryTimer = null;
                fetchSlackSupervisionDeliveries({ reconcile: true })
                    .done((response) => {
                        highlightOrphanReplies = false;
                        applyDeliveriesResponse(response);
                        if (hasRemoteLoadWarnings) {
                            scheduleReconcileRetry(contextLabel);
                            return;
                        }
                        setFeedback(`${contextLabel} reconciliada automaticamente.`, 'success');
                        clearReconcileRetryState();
                    })
                    .fail(() => {
                        scheduleReconcileRetry(contextLabel);
                    });
            }, 3000);
        };

        const applyDeliveriesResponse = (response) => {
            const responseErrors = collectDeliveryErrorMessages(response?.errors);
            deliveries = Array.isArray(response?.results) ? response.results : [];
            const availableKeys = new Set(
                deliveries
                    .map((delivery) => String(delivery?.delivery_key || '').trim())
                    .filter(Boolean)
            );
            selectedDeliveryKeys = new Set(
                Array.from(selectedDeliveryKeys).filter((key) => availableKeys.has(key))
            );
            syncOrphanReplyKeys();
            availableAnalysisTypes = Array.isArray(response?.available_analysis_types) ? response.available_analysis_types : [];
            summaryData = response?.summary && typeof response.summary === 'object'
                ? response.summary
                : { sent_count: 0, responded_count: 0, pending_count: 0, queued_count: 0 };
            hasRemoteLoadWarnings = responseErrors.length > 0;
            emptyListMessage = hasRemoteLoadWarnings && !deliveries.length
                ? `Nao foi possivel listar as mensagens ja enviadas no Slack. ${responseErrors.join(' | ')}`
                : 'Nenhuma entrega Slack de supervisão foi encontrada para os supervisores.';
            refreshTypeFilterOptions();
            renderSummary();
            renderList();
            if (hasRemoteLoadWarnings) {
                setFeedback(`Mensagens carregadas com avisos: ${responseErrors.join(' | ')}`, 'warning');
            }
        };

        const applyDeliveriesLoadError = (xhr) => {
            deliveries = [];
            orphanReplyKeys = [];
            selectedDeliveryKeys = new Set();
            summaryData = { sent_count: 0, responded_count: 0, pending_count: 0, queued_count: 0 };
            hasRemoteLoadWarnings = false;
            emptyListMessage = 'Nenhuma entrega Slack de supervisão foi encontrada para os supervisores.';
            availableAnalysisTypes = [];
            refreshTypeFilterOptions();
            renderSummary();
            renderList();
            setFeedback(normalizeErrorMessage(xhr, 'Falha ao carregar mensagens Slack.'), 'error');
        };

        const loadDeliveries = (options = {}) => {
            const shouldReconcile = !(options && options.reconcile === false);
            const retryContextLabel = String(options?.retryContextLabel || 'Fila').trim() || 'Fila';
            setBusy(true);
            setFeedback('');
            if (shouldReconcile) {
                clearReconcileRetryState();
            }
            const finalizeLoad = () => {
                resetToolbarLoadingState();
                setBusy(false);
                refreshActionState();
            };
            const fallbackToSimpleLoad = () => (
                fetchSlackSupervisionDeliveries({ reconcile: false })
                    .done((response) => {
                        applyDeliveriesResponse(response);
                        if (!hasRemoteLoadWarnings) {
                            setFeedback('Mensagens carregadas sem reconciliar toda a fila. Tentando concluir em segundo plano.', 'warning');
                        }
                        scheduleReconcileRetry(retryContextLabel);
                    })
                    .fail((xhr) => {
                        applyDeliveriesLoadError(xhr);
                    })
                    .always(finalizeLoad)
            );
            return fetchSlackSupervisionDeliveries({ reconcile: shouldReconcile })
                .done((response) => {
                    highlightOrphanReplies = false;
                    applyDeliveriesResponse(response);
                    if (shouldReconcile && hasRemoteLoadWarnings) {
                        scheduleReconcileRetry(retryContextLabel);
                    } else if (shouldReconcile) {
                        clearReconcileRetryState();
                    }
                })
                .fail((xhr) => {
                    if (shouldReconcile) {
                        fallbackToSimpleLoad();
                        return;
                    }
                    applyDeliveriesLoadError(xhr);
                    finalizeLoad();
                })
                .done(() => {
                    finalizeLoad();
                });
        };

        const runFindOldThreads = () => {
            setBusy(true);
            setActionLoadingState(findOldThreadsBtn, true, 'Buscando...');
            setFeedback('');
            fetchSlackSupervisionDeliveries({ reconcile: false })
                .done((response) => {
                    highlightOrphanReplies = true;
                    applyDeliveriesResponse(response);
                    if (orphanReplyKeys.length) {
                        setFeedback(`${orphanReplyKeys.length} thread(s) antiga(s) órfã(s) encontrada(s) e destacada(s) na lista.`, 'warning');
                    } else {
                        setFeedback('Nenhuma thread antiga órfã foi encontrada nesta carga.', 'success');
                    }
                })
                .fail((xhr) => {
                    highlightOrphanReplies = false;
                    applyDeliveriesLoadError(xhr);
                })
                .always(() => {
                    resetToolbarLoadingState();
                    setBusy(false);
                    refreshActionState();
                });
        };

        const runRefresh = (options = {}) => {
            const selectedLocalIds = getSelectedLocalIds();
            const selectedOnly = Boolean(options?.selectedOnly || selectedLocalIds.length > 0);
            if (options?.selectedOnly && !selectedLocalIds.length) {
                setFeedback('Selecione ao menos uma mensagem local para enviar.', 'warning');
                refreshActionState();
                return;
            }
            const previousSummary = {
                sent_count: Number(summaryData?.sent_count || 0),
                responded_count: Number(summaryData?.responded_count || 0),
                pending_count: Number(summaryData?.pending_count || 0),
                queued_count: Number(summaryData?.queued_count || 0),
            };
            const previousDeliveryCount = Array.isArray(deliveries) ? deliveries.length : 0;
            const summaryHasChanged = () => (
                Number(summaryData?.sent_count || 0) !== previousSummary.sent_count
                || Number(summaryData?.responded_count || 0) !== previousSummary.responded_count
                || Number(summaryData?.pending_count || 0) !== previousSummary.pending_count
                || Number(summaryData?.queued_count || 0) !== previousSummary.queued_count
                || (Array.isArray(deliveries) ? deliveries.length : 0) !== previousDeliveryCount
            );
            const scheduleReloadAfterFailure = (attempt = 1) => {
                window.setTimeout(() => {
                    loadDeliveries({ reconcile: false })
                        .always(() => {
                            if (summaryHasChanged()) {
                                setFeedback('Atualização concluída com atraso. Os contadores foram atualizados.', 'warning');
                                return;
                            }
                            if (attempt >= 6) {
                                setFeedback('A atualização pode ainda estar em processamento. Reabra a tela em alguns instantes.', 'warning');
                                return;
                            }
                            scheduleReloadAfterFailure(attempt + 1);
                        });
                }, 4000);
            };

            setBusy(true);
            setActionLoadingState(selectedOnly ? sendSelectedBtn : refreshBtn, true, selectedOnly ? 'Enviando...' : 'Atualizando...');
            setFeedback('');
            refreshSlackSupervisionDeliveries(selectedOnly ? {
                mode: 'selected',
                deliveryIds: selectedLocalIds,
            } : {})
                .done((response) => {
                    const recipients = Array.isArray(response?.recipients) ? response.recipients.filter(Boolean) : [];
                    const queuedCount = parseInt(response?.queued_count || 0, 10) || 0;
                    const errors = Array.isArray(response?.errors) ? response.errors : [];
                    const typeSummaries = Array.isArray(response?.type_summaries) ? response.type_summaries : [];
                    const typeSummaryText = typeSummaries
                        .map((item) => {
                            const slug = String(item?.analysis_type_slug || 'sem_tipo').trim() || 'sem_tipo';
                            const pendingTotal = parseInt(item?.pending_total || 0, 10) || 0;
                            const postedNowCount = parseInt(item?.posted_now_count || 0, 10) || 0;
                            const alreadySentCount = parseInt(item?.already_sent_count || 0, 10) || 0;
                            return `${slug}: ${postedNowCount} nova(s), ${alreadySentCount} ativa(s), ${pendingTotal} pendente(s)`;
                        })
                        .filter(Boolean)
                        .join(' | ');
                    if (errors.length) {
                        setFeedback(
                            `Atualização concluída com falhas. ${errors.map((item) => item.error || 'erro').join(' | ')}${typeSummaryText ? ` | ${typeSummaryText}` : ''}`,
                            'warning'
                        );
                    } else if (recipients.length || queuedCount) {
                        const parts = [];
                        if (selectedOnly) {
                            parts.push(`${selectedLocalIds.length} item(ns) selecionado(s) processado(s)`);
                        }
                        if (recipients.length) {
                            parts.push(`Mensagens sincronizadas para: ${recipients.join(', ')}`);
                        }
                        if (queuedCount) {
                            parts.push(`${queuedCount} item(ns) permanecem em fila`);
                        }
                        if (typeSummaryText) {
                            parts.push(`Tipos: ${typeSummaryText}`);
                        }
                        setFeedback(parts.join('. ') + '.', 'success');
                    } else {
                        setFeedback(
                            `Atualização concluída. Nenhuma mensagem pendente precisou ser reenviada.${typeSummaryText ? ` Tipos: ${typeSummaryText}.` : ''}`,
                            'success'
                        );
                    }
                    loadDeliveries();
                })
                .fail((xhr) => {
                    setFeedback(normalizeErrorMessage(xhr, 'A atualização pode ainda estar em processamento. Vamos recarregar a lista automaticamente.'), 'warning');
                    setActionLoadingState(refreshBtn, false);
                    setActionLoadingState(sendSelectedBtn, false);
                    setBusy(false);
                    refreshActionState();
                    scheduleReloadAfterFailure();
                });
        };

        const runDeleteOldThreads = () => {
            if (!orphanReplyKeys.length) {
                setFeedback('Nenhuma thread antiga órfã foi localizada para apagar.', 'warning');
                refreshActionState();
                return;
            }
            if (!window.confirm(`Apagar ${orphanReplyKeys.length} thread(s) antiga(s) órfã(s) do Slack?`)) {
                return;
            }
            setBusy(true);
            setActionLoadingState(deleteOldThreadsBtn, true, 'Apagando...');
            setFeedback('');
            deleteSlackSupervisionDeliveries('selected', orphanReplyKeys)
                .done((response) => {
                    const deletedCount = parseInt(response?.deleted_count || 0, 10) || 0;
                    const errors = Array.isArray(response?.errors) ? response.errors : [];
                    if (errors.length) {
                        setFeedback(
                            `Foram apagadas ${deletedCount} thread(s) antiga(s), mas houve falhas: ${errors.map((item) => item.error || 'erro').join(' | ')}`,
                            'warning'
                        );
                    } else {
                        setFeedback(`Foram apagadas ${deletedCount} thread(s) antiga(s) do Slack.`, 'success');
                    }
                    highlightOrphanReplies = true;
                    runFindOldThreads();
                })
                .fail((xhr) => {
                    setActionLoadingState(deleteOldThreadsBtn, false);
                    setBusy(false);
                    setFeedback(normalizeErrorMessage(xhr, 'Falha ao apagar threads antigas do Slack.'), 'error');
                    refreshActionState();
                });
        };

        const runDelete = (mode) => {
            let actionButton = null;
            let selectedIds = [];
            let confirmMessage = '';
            if (mode === 'last') {
                actionButton = deleteLastBtn;
                confirmMessage = 'Apagar a última mensagem Slack enviada da fila global dos supervisores?';
            } else if (mode === 'all') {
                actionButton = deleteAllBtn;
                confirmMessage = 'Apagar todas as mensagens Slack listadas de todos os supervisores?';
            } else {
                actionButton = deleteSelectedBtn;
                selectedIds = getSelectedIds();
                if (!selectedIds.length) {
                    setFeedback('Selecione ao menos uma mensagem Slack para apagar.', 'warning');
                    refreshActionState();
                    return;
                }
                confirmMessage = `Apagar ${selectedIds.length} mensagem(ns) Slack selecionada(s) dos supervisores listados?`;
            }

            if (!window.confirm(confirmMessage)) {
                return;
            }

            setBusy(true);
            setActionLoadingState(actionButton, true, 'Apagando...');
            setFeedback('');
            deleteSlackSupervisionDeliveries(mode, selectedIds)
                .done((response) => {
                    const deletedCount = parseInt(response?.deleted_count || 0, 10) || 0;
                    const errors = Array.isArray(response?.errors) ? response.errors : [];
                    if (errors.length) {
                        setFeedback(
                            `Foram apagadas ${deletedCount} mensagem(ns), mas houve falhas: ${errors.map((item) => item.error || 'erro').join(' | ')}`,
                            'warning'
                        );
                    } else {
                        setFeedback(`Foram apagadas ${deletedCount} mensagem(ns) Slack.`, 'success');
                    }
                    loadDeliveries({ retryContextLabel: 'Fila de mensagens' });
                })
                .fail((xhr) => {
                    setActionLoadingState(actionButton, false);
                    setBusy(false);
                    setFeedback(normalizeErrorMessage(xhr, 'Falha ao apagar mensagens Slack.'), 'error');
                    refreshActionState();
                });
        };

        typeFilterSelect.addEventListener('change', () => {
            activeAnalysisTypeFilter = String(typeFilterSelect.value || '').trim();
            renderTypePickerOptions();
            renderList();
        });
        refreshBtn.addEventListener('click', () => runRefresh({ selectedOnly: getSelectedLocalIds().length > 0 }));
        sendSelectedBtn.addEventListener('click', () => runRefresh({ selectedOnly: true }));
        deleteLastBtn.addEventListener('click', () => runDelete('last'));
        deleteSelectedBtn.addEventListener('click', () => runDelete('selected'));
        deleteAllBtn.addEventListener('click', () => runDelete('all'));
        findOldThreadsBtn.addEventListener('click', runFindOldThreads);
        deleteOldThreadsBtn.addEventListener('click', runDeleteOldThreads);

        ensureTypePicker();
        loadDeliveries();
    });
})();
