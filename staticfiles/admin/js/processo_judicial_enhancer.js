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
        const calendarGridEl = overlay.querySelector('[data-calendar-placeholder]');
        const detailList = overlay.querySelector('.agenda-panel__details-list-inner');
        const detailCardBody = overlay.querySelector('.agenda-panel__details-card-body');
        const detailTitleEl = overlay.querySelector('.agenda-panel__details-title');
        renderCalendarDays(calendarGridEl, detailList, detailCardBody, null, null, detailTitleEl);
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

    const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const getMonthLabel = (state) => {
        const monthName = MONTHS[state.monthIndex % MONTHS.length];
        if (state.mode === 'weekly') {
            const weekNumber = Math.floor(state.weekOffset / 7) + 1;
            return `Semana ${weekNumber} · ${monthName} 2025`;
        }
        return `${monthName} 2025`;
    };
    const clampWeekOffset = (offset, state) => {
        const data = getMonthData(state.monthIndex, state.year || 2025);
        const maxOffset = Math.max(0, data.length - 7);
        return Math.max(0, Math.min(offset, maxOffset));
    };

    const normalizeEntryMetadata = (dayInfo, type) => {
        const list = type === 'T' ? dayInfo.tasksT : dayInfo.tasksP;
        if (!list) return;
        list.forEach((entry, index) => {
            const prefix = type === 'T' ? 'Tarefa' : 'Prazo';
            entry.id = `${type.toLowerCase()}-${dayInfo.day}-${index + 1}`;
            entry.label = `${index + 1}`;
            entry.description = `Descrição da ${prefix} ${dayInfo.day}.${index + 1}`;
            entry.originalDay = entry.originalDay || dayInfo.day;
        });
    };

    const createSampleCalendarDays = (monthIndex, year = 2025) => {
        const days = new Date(year, monthIndex + 1, 0).getDate();
        return Array.from({ length: days }, (_, index) => {
            const day = index + 1;
            const hasT = day % 3 === 0;
            const hasP = day % 4 === 0;
            const tasksT = hasT
                ? Array.from({ length: 2 }, (_, i) => ({
                    id: `t-${day}-${i}`,
                    label: `Tarefa ${day}.${i + 1}`,
                    description: `Descrição da Tarefa ${day}.${i + 1}`,
                    originalDay: day,
                }))
                : [];
            const tasksP = hasP
                ? Array.from({ length: 2 }, (_, i) => ({
                    id: `p-${day}-${i}`,
                    label: `Prazo ${day}.${i + 1}`,
                    description: `Descrição do Prazo ${day}.${i + 1}`,
                    originalDay: day,
                }))
                : [];
            const dayInfo = {
                day,
                tasksT,
                tasksP,
                monthIndex,
                year,
            };
            normalizeEntryMetadata(dayInfo, 'T');
            normalizeEntryMetadata(dayInfo, 'P');
            return dayInfo;
        });
    };
    const calendarMonths = {};
    const getMonthData = (monthIndex, year = 2025) => {
        const key = `${year}-${monthIndex}`;
        if (!calendarMonths[key]) {
            calendarMonths[key] = createSampleCalendarDays(monthIndex, year);
        }
        return calendarMonths[key];
    };

    const populateDetailEntries = (dayData, type, detailList, detailCardBody, setDetailTitle) => {
        setDetailTitle?.(dayData?.day);
        const entries = type === 'T' ? dayData.tasksT : dayData.tasksP;
        if (!entries.length) {
            detailList.innerHTML = '<p class="agenda-panel__details-empty">Nenhuma atividade registrada.</p>';
            detailCardBody.textContent = 'Selecione um item para visualizar mais informações.';
            return;
        }
        detailList.innerHTML = '';
        entries.forEach(entryData => {
            const entry = document.createElement('div');
            entry.className = 'agenda-panel__details-item';
            entry.tabIndex = 0;
            const label = document.createElement('span');
            label.className = 'agenda-panel__details-item-label';
            label.textContent = entryData.label;
            entry.appendChild(label);
            if (entryData.originalDay && entryData.originalDay !== dayData.day) {
                const original = document.createElement('span');
                original.className = 'agenda-panel__details-original';
                original.textContent = `Origem: ${entryData.originalDay}`;
                entry.appendChild(original);
            }
            entry.addEventListener('click', () => {
                detailCardBody.textContent = entryData.description;
            });
            entry.dataset.type = type;
            entry.dataset.entryId = entryData.id;
            entry.dataset.day = dayData.day;
            entry.draggable = true;
            entry.addEventListener('dragstart', (event) => {
                event.dataTransfer.setData('text/plain', JSON.stringify({
                    source: 'detail',
                    type,
                    day: dayData.day,
                    monthIndex: dayData.monthIndex,
                    year: dayData.year,
                    entry: entryData,
                }));
                event.dataTransfer.effectAllowed = 'move';
            });
            detailList.appendChild(entry);
        });
    };

    const renderCalendarDays = (gridElement, detailList, detailCardBody, state, rerender, detailTitleEl) => {
        const effectiveState = state || { mode: 'monthly', weekOffset: 0 };
        const updateDetailTitle = (dayNumber) => {
            if (!detailTitleEl) {
                return;
            }
            detailTitleEl.textContent = dayNumber ? `Eventos do dia ${dayNumber}` : 'Eventos do dia';
        };
        gridElement.innerHTML = '';
        detailList.innerHTML = '<p class="agenda-panel__details-empty">Clique em T ou P para ver as tarefas/prazos e detalhes.</p>';
        detailCardBody.textContent = 'Selecione um item para visualizar mais informações.';
        gridElement.classList.toggle('agenda-panel__calendar-grid--weekly', effectiveState.mode === 'weekly');
        let activeDayCell = null;
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
        const sampleCalendarDays = getMonthData(effectiveState.monthIndex, effectiveState.year || 2025);
        const baseDays = effectiveState.mode === 'weekly'
            ? sampleCalendarDays.slice(effectiveState.weekOffset, effectiveState.weekOffset + 7)
            : sampleCalendarDays;
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
            const hasHistory = [...dayInfo.tasksT, ...dayInfo.tasksP].some(entry => entry.originalDay && entry.originalDay !== dayInfo.day);
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
                tag.draggable = true;
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
                    populateDetailEntries(dayInfo, type, detailList, detailCardBody, updateDetailTitle);
                    setActiveDay(dayCell);
                });
                tag.addEventListener('dragstart', (event) => {
                    event.dataTransfer.setData('text/plain', JSON.stringify({
                        source: 'calendar',
                        day: dayInfo.day,
                        monthIndex: dayInfo.monthIndex,
                        year: dayInfo.year,
                        type,
                    }));
                    event.dataTransfer.effectAllowed = 'move';
                });
                tagsWrapper.appendChild(tag);
            };
            renderTag('T', dayInfo.tasksT);
            renderTag('P', dayInfo.tasksP);
            dayCell.addEventListener('click', () => {
                updateDetailTitle(dayInfo.day);
                if (dayInfo.tasksT.length) {
                    populateDetailEntries(dayInfo, 'T', detailList, detailCardBody, updateDetailTitle);
                } else if (dayInfo.tasksP.length) {
                    populateDetailEntries(dayInfo, 'P', detailList, detailCardBody, updateDetailTitle);
                } else {
                    detailList.innerHTML = '<p class="agenda-panel__details-empty">Nenhuma atividade registrada.</p>';
                    detailCardBody.textContent = 'Selecione um item para visualizar mais informações.';
                }
                setActiveDay(dayCell);
            });
            const setupDropZone = () => {
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
                    const typeKey = parsed.type === 'T' ? 'tasksT' : 'tasksP';
                    const sourceMonth = getMonthData(parsed.monthIndex ?? calendarState.monthIndex, parsed.year || 2025);
                    const sourceDay = sourceMonth.find(d => d.day === parsed.day);
                    if (!sourceDay) {
                        return;
                    }
                    if (parsed.source === 'detail') {
                        const sourceList = sourceDay[typeKey];
                        const entryIndex = sourceList.findIndex(entry => entry.id === parsed.entry?.id);
                        if (entryIndex === -1) return;
                        const [movedEntry] = sourceList.splice(entryIndex, 1);
                        dayInfo[typeKey].push(movedEntry);
                        normalizeEntryMetadata(sourceDay, parsed.type);
                        normalizeEntryMetadata(dayInfo, parsed.type);
                    } else if (parsed.source === 'calendar') {
                        const transferred = sourceDay[typeKey];
                        if (!transferred.length) return;
                        dayInfo[typeKey].push(...transferred);
                        sourceDay[typeKey] = [];
                        normalizeEntryMetadata(sourceDay, parsed.type);
                        normalizeEntryMetadata(dayInfo, parsed.type);
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
                    <button type="button" class="agenda-panel__close" aria-label="Fechar agenda">×</button>
                </div>
                <div class="agenda-panel__controls">
                    <button type="button" class="agenda-panel__cycle-btn" data-months="1">1 Calendário</button>
                    <button type="button" class="agenda-panel__cycle-mode" data-mode="monthly">Mensal</button>
                    <button type="button" class="agenda-panel__users-toggle" data-view="users" aria-pressed="false">Usuários</button>
                </div>
                <div class="agenda-panel__body">
                    <div class="agenda-panel__calendar-wrapper">
                        <div class="agenda-panel__calendar-header">
                            <strong class="agenda-panel__month-title">Janeiro 2025</strong>
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
                                        <p class="agenda-panel__details-empty">Clique em T ou P para ver as tarefas/prazos e detalhes.</p>
                                    </div>
                                </div>
                                <div class="agenda-panel__details-card">
                                    <p class="agenda-panel__details-card-title">Descrição detalhada</p>
                                    <p class="agenda-panel__details-card-body">Selecione um item para visualizar mais informações.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="agenda-panel__footer">
                    <button type="button" class="agenda-panel__form-btn" data-form="tarefas">Tarefas</button>
                    <button type="button" class="agenda-panel__form-btn" data-form="prazos">Prazos</button>
                    <button type="button" class="agenda-panel__split">Abrir em tela dividida</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const closeButton = overlay.querySelector('.agenda-panel__close');
        const cycleBtn = overlay.querySelector('.agenda-panel__cycle-btn');
        const modeButton = overlay.querySelector('.agenda-panel__cycle-mode');
        const prevNavBtn = overlay.querySelector('[data-direction="prev"]');
        const nextNavBtn = overlay.querySelector('[data-direction="next"]');
        const monthTitleEl = overlay.querySelector('.agenda-panel__month-title');
        const detailList = overlay.querySelector('.agenda-panel__details-list-inner');
        const detailCardBody = overlay.querySelector('.agenda-panel__details-card-body');
        const getDetailTitleEl = () => overlay.querySelector('.agenda-panel__details-title');
        const calendarGridEl = overlay.querySelector('[data-calendar-placeholder]');
        const usersToggle = overlay.querySelector('.agenda-panel__users-toggle');
        const subtitleEl = overlay.querySelector('.agenda-panel__subtitle');
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
        footer.insertBefore(historyButton, footer.querySelector('.agenda-panel__form-btn'));
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
        const calendarState = {
            mode: 'monthly',
            months: 1,
            monthIndex: 0,
            weekOffset: 0,
            showHistory: false,
            view: 'calendar',
            activeUser: null,
            users: [],
            usersLoading: false,
            usersLoaded: false,
            usersError: false,
            defaultUserLabel: getDefaultUserLabel(),
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
        const updateMonthTitle = () => {
            if (calendarState.view === 'users') {
                monthTitleEl.textContent = 'Usuários';
                return;
            }
            monthTitleEl.textContent = getMonthLabel(calendarState);
        };
        const renderUserSelectionGrid = () => {
            calendarGridEl.innerHTML = '';
            calendarGridEl.classList.remove('agenda-panel__calendar-grid--weekly');
            detailList.innerHTML = '<p class="agenda-panel__details-empty">Clique em um usuário para abrir a agenda dele.</p>';
            detailCardBody.textContent = 'Selecione um usuário para exibir a agenda geral dele.';
            const detailTitleElInstance = getDetailTitleEl();
            if (detailTitleElInstance) {
                detailTitleElInstance.textContent = 'Eventos do dia';
            }
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
                const name = document.createElement('span');
                name.className = 'agenda-panel__user-card-name';
                name.textContent = formatUserLabel(user);
                const username = document.createElement('span');
                username.className = 'agenda-panel__user-card-username';
                username.textContent = user.username;
                card.append(initials, name, username);
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
            renderCalendarDays(calendarGridEl, detailList, detailCardBody, calendarState, renderCalendar, getDetailTitleEl());
        };
        const handleNavigation = (direction) => {
            if (calendarState.mode === 'weekly') {
                const step = 7;
                const delta = direction === 'next' ? step : -step;
                calendarState.weekOffset = clampWeekOffset(calendarState.weekOffset + delta);
            } else {
                const delta = direction === 'next' ? 1 : -1;
                const totalMonths = MONTHS.length;
                calendarState.monthIndex = (calendarState.monthIndex + delta + totalMonths) % totalMonths;
            }
            renderCalendar();
        };
        closeButton.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                overlay.remove();
            }
        });
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
                calendarState.weekOffset = clampWeekOffset(calendarState.weekOffset);
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
                    calendarState.weekOffset = clampWeekOffset(calendarState.weekOffset);
                }
                renderCalendar();
            });
        });
        renderCalendar();
    };

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
        placeholder.addEventListener('click', () => openAgendaPanel());
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

    const makeInfoCardSticky = () => {
        const card = document.querySelector('.info-card');
        if (!card) return;
        card.classList.add('info-card-floating');
    };
    makeInfoCardSticky();

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
