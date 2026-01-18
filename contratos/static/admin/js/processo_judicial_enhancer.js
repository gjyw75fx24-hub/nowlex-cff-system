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
        renderCalendarDays(calendarGridEl, detailList, detailCardBody, null, null, () => {});
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

    const insertMinhasAcoesLink = () => {
        const navSidebar = document.getElementById('nav-sidebar');
        if (!navSidebar) return;
        const usersLink = Array.from(navSidebar.querySelectorAll('a'))
            .find((link) => link.textContent.trim() === 'Usuários');
        const userRow = usersLink?.closest('tr');
        if (!userRow || userRow.nextElementSibling?.classList.contains('minhas-acoes-row')) {
            return;
        }
        const row = document.createElement('tr');
        row.className = 'minhas-acoes-row';
        const th = document.createElement('th');
        th.scope = 'row';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'minhas-acoes-trigger';
        button.textContent = 'Minhas ações';
        th.appendChild(button);
        const td = document.createElement('td');
        row.append(th, td);
        userRow.parentNode.insertBefore(row, userRow.nextSibling);
        button.addEventListener('click', () => toggleMinhasAcoesPanel());
    };

    const removeViewSiteLink = () => {
        const userTools = document.getElementById('user-tools');
        if (!userTools) return;
        const link = Array.from(userTools.querySelectorAll('a'))
            .find((anchor) => anchor.textContent.trim().toLowerCase() === 'ver o site'
                || anchor.textContent.trim().toLowerCase() === 'view site');
        if (!link) return;
        const previous = link.previousSibling;
        const next = link.nextSibling;
        link.remove();
        if (previous && previous.nodeType === Node.TEXT_NODE && previous.textContent.includes('/')) {
            previous.remove();
        } else if (next && next.nodeType === Node.TEXT_NODE && next.textContent.includes('/')) {
            next.remove();
        }
    };

    const createMinhasAcoesPanel = () => {
        if (document.querySelector('.minhas-acoes-panel')) {
            return document.querySelector('.minhas-acoes-panel');
        }
        const panel = document.createElement('aside');
        panel.className = 'minhas-acoes-panel';
        panel.innerHTML = `
            <div class="minhas-acoes-panel__header">
                <strong>Minhas ações</strong>
                <button type="button" class="minhas-acoes-panel__close" aria-label="Fechar">×</button>
            </div>
            <div class="minhas-acoes-panel__body">
                <p class="minhas-acoes-panel__loading">Carregando ações...</p>
            </div>
        `;
        document.body.appendChild(panel);
        panel.querySelector('.minhas-acoes-panel__close').addEventListener('click', () => {
            panel.classList.remove('minhas-acoes-panel--open');
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                panel.classList.remove('minhas-acoes-panel--open');
            }
        });
        return panel;
    };

    const renderMinhasAcoes = (panel, items) => {
        const body = panel.querySelector('.minhas-acoes-panel__body');
        if (!body) return;
        if (!items.length) {
            body.innerHTML = '<p class="minhas-acoes-panel__empty">Nenhuma ação recente.</p>';
            return;
        }
        const list = document.createElement('div');
        list.className = 'minhas-acoes-panel__list';
        items.forEach((item) => {
            const entry = document.createElement(item.change_url ? 'a' : 'div');
            entry.className = 'minhas-acoes-panel__item';
            if (item.change_url) {
                entry.href = item.change_url;
                entry.target = '_blank';
                entry.rel = 'noopener noreferrer';
            }
            const title = document.createElement('span');
            title.className = 'minhas-acoes-panel__item-title';
            title.textContent = item.object_repr || 'Registro';
            const meta = document.createElement('span');
            meta.className = 'minhas-acoes-panel__item-meta';
            const typeLabel = item.content_type ? `${item.content_type} · ` : '';
            meta.textContent = `${typeLabel}${item.action_time_display || ''}`;
            entry.append(title, meta);
            if (item.change_message) {
                const desc = document.createElement('span');
                desc.className = 'minhas-acoes-panel__item-desc';
                desc.textContent = item.change_message;
                entry.appendChild(desc);
            }
            list.appendChild(entry);
        });
        body.innerHTML = '';
        body.appendChild(list);
    };

    const loadMinhasAcoes = (panel) => {
        const body = panel.querySelector('.minhas-acoes-panel__body');
        if (body) {
            body.innerHTML = '<p class="minhas-acoes-panel__loading">Carregando ações...</p>';
        }
        fetch('/admin/minhas-acoes/')
            .then((response) => response.json())
            .then((data) => {
                renderMinhasAcoes(panel, Array.isArray(data.items) ? data.items : []);
            })
            .catch(() => {
                if (body) {
                    body.innerHTML = '<p class="minhas-acoes-panel__empty">Não foi possível carregar as ações.</p>';
                }
            });
    };

    const positionMinhasAcoesPanel = (panel, trigger) => {
        if (!panel || !trigger) return;
        const rect = trigger.getBoundingClientRect();
        const sidebar = document.getElementById('nav-sidebar');
        const sidebarRect = sidebar?.getBoundingClientRect();
        const left = (sidebarRect ? sidebarRect.left : rect.left) - 6;
        panel.style.left = `${Math.max(0, left)}px`;
        panel.style.top = `${rect.bottom + 6}px`;
        panel.style.right = 'auto';
        const maxLeft = window.innerWidth - panel.offsetWidth - 12;
        if (panel.offsetWidth && left > maxLeft) {
            panel.style.left = `${Math.max(0, maxLeft)}px`;
        }
    };

    const toggleMinhasAcoesPanel = () => {
        const panel = createMinhasAcoesPanel();
        panel.classList.toggle('minhas-acoes-panel--open');
        if (panel.classList.contains('minhas-acoes-panel--open')) {
            positionMinhasAcoesPanel(panel, document.querySelector('.minhas-acoes-trigger'));
            loadMinhasAcoes(panel);
        }
    };

    insertMinhasAcoesLink();
    removeViewSiteLink();

    const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const getMonthLabel = (state) => {
        const monthName = MONTHS[state.monthIndex % MONTHS.length];
        const year = state.year || new Date().getFullYear();
        if (state.mode === 'weekly') {
            const weekNumber = Math.floor(state.weekOffset / 7) + 1;
            return `Semana ${weekNumber} · ${monthName} ${year}`;
        }
        return `${monthName} ${year}`;
    };
    const clampWeekOffset = (offset, state) => {
        const grid = buildMonthGrid(state.monthIndex, state.year || new Date().getFullYear());
        const maxOffset = Math.max(0, grid.length - 7);
        const normalized = Math.max(0, Math.min(offset, maxOffset));
        return normalized - (normalized % 7);
    };

    const parseDateInputValue = (value) => {
        if (!value) return null;
        const normalized = value.trim();
        const isoMatch = normalized.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
            return {
                year: Number(isoMatch[1]),
                monthIndex: Number(isoMatch[2]) - 1,
                day: Number(isoMatch[3]),
            };
        }
        const brMatch = normalized.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (brMatch) {
            return {
                year: Number(brMatch[3]),
                monthIndex: Number(brMatch[2]) - 1,
                day: Number(brMatch[1]),
            };
        }
        const parsed = new Date(normalized);
        if (!Number.isNaN(parsed.getTime())) {
            return {
                year: parsed.getFullYear(),
                monthIndex: parsed.getMonth(),
                day: parsed.getDate(),
            };
        }
        return null;
    };
    const formatDateIso = (year, monthIndex, day) => {
        const y = String(year).padStart(4, '0');
        const m = String(monthIndex + 1).padStart(2, '0');
        const d = String(day).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    const formatDateLabel = (isoDate) => {
        if (!isoDate) return '';
        const parsed = new Date(isoDate);
        if (Number.isNaN(parsed.getTime())) {
            return isoDate;
        }
        return parsed.toLocaleDateString('pt-BR');
    };
    const entryOrigins = new Map();
    const getOriginKey = (entry) => {
        if (!entry) return null;
        if (entry.backendId) return `${entry.type || ''}-${entry.backendId}`;
        return entry.id ? `local-${entry.id}` : null;
    };
    const rememberOrigin = (entry) => {
        const key = getOriginKey(entry);
        if (!key) return;
        if (!entryOrigins.has(key)) {
            const originDate = entry.originalDate || formatDateIso(entry.year, entry.monthIndex, entry.day);
            entryOrigins.set(key, originDate || entry.originalDay || entry.day);
        }
    };
    const applyOriginFromMap = (entry) => {
        const key = getOriginKey(entry);
        if (!key) return;
        if (entryOrigins.has(key)) {
            const storedOrigin = entryOrigins.get(key);
            if (typeof storedOrigin === 'string' && storedOrigin.includes('-')) {
                entry.originalDate = storedOrigin;
                const parsed = parseDateInputValue(storedOrigin);
                if (parsed) {
                    entry.originalDay = parsed.day;
                }
            } else {
                entry.originalDay = storedOrigin;
            }
        }
    };
    let updateAgendaEntryDate = () => {};
    let moveAgendaEntries = () => {};

    const normalizeEntryMetadata = (dayInfo, type) => {
        const list = type === 'T' ? dayInfo.tasksT : dayInfo.tasksP;
        if (!list) return;
        list.forEach((entry, index) => {
            const prefix = type === 'T' ? 'Tarefa' : 'Prazo';
            entry.id = entry.id || `${type.toLowerCase()}-${dayInfo.day}-${index + 1}`;
            // Reordena sempre de forma sequencial por tipo e dia (já filtrado por usuário, se ativo)
            entry.label = `${index + 1}`;
            const baseDescription = entry.description || entry.descricao || entry.titulo || entry.title;
            entry.description = baseDescription || `${prefix} ${dayInfo.day}.${index + 1}`;
            entry.originalDay = entry.originalDay || dayInfo.day;
            entry.originalDate = entry.originalDate || formatDateIso(dayInfo.year, dayInfo.monthIndex, dayInfo.day);
        });
    };

    const createCalendarDays = (monthIndex, year = new Date().getFullYear()) => {
        const days = new Date(year, monthIndex + 1, 0).getDate();
        return Array.from({ length: days }, (_, index) => {
            return {
                day: index + 1,
                tasksT: [],
                tasksP: [],
                monthIndex,
                year,
            };
        });
    };
    const calendarMonths = {};
    const resetCalendarMonths = () => {
        Object.keys(calendarMonths).forEach((key) => delete calendarMonths[key]);
    };
    const getMonthData = (monthIndex, year = new Date().getFullYear()) => {
        const key = `${year}-${monthIndex}`;
        if (!calendarMonths[key]) {
            calendarMonths[key] = createCalendarDays(monthIndex, year);
        }
        return calendarMonths[key];
    };
    const buildMonthGrid = (monthIndex, year = new Date().getFullYear()) => {
        const days = getMonthData(monthIndex, year);
        const firstWeekday = new Date(year, monthIndex, 1).getDay();
        const leading = Array(firstWeekday).fill(null);
        const total = leading.length + days.length;
        const trailing = (7 - (total % 7)) % 7;
        return [...leading, ...days, ...Array(trailing).fill(null)];
    };

    const processMatch = window.location.pathname.match(/processojudicial\/(\d+)\/change/);
    const currentProcessId = processMatch ? processMatch[1] : null;

    const collectAgendaEntriesFromInline = () => {
        const entries = [];
        const appendEntry = (entry) => {
            if (!entry) return;
            entries.push(entry);
        };
        document.querySelectorAll('#tarefas-group .dynamic-tarefas').forEach((row, index) => {
            if (row.classList.contains('empty-form')) return;
            const deleteCheckbox = row.querySelector('input[id$="-DELETE"]');
            if (deleteCheckbox?.checked) return;
            const doneCheckbox = row.querySelector('input[id$="-concluida"]');
            if (doneCheckbox && doneCheckbox.checked) return;
            const dateInput = row.querySelector('input[id$="-data"]');
            const descInput = row.querySelector('input[id$="-descricao"]');
            const obsInput = row.querySelector('textarea[id$="-observacoes"]') || row.querySelector('input[id$="-observacoes"]');
            const priorityInput = row.querySelector('select[id$="-prioridade"]') || row.querySelector('input[id$="-prioridade"]');
            const responsavelInput = row.querySelector('select[id$="-responsavel"]') || row.querySelector('input[id$="-responsavel"]');
            const parsedDate = parseDateInputValue(dateInput?.value);
            if (!parsedDate) return;
            const idInput = row.querySelector('input[id$="-id"]');
            const entry = {
                type: 'T',
                id: idInput?.value ? `t-${idInput.value}` : `t-${index + 1}-${parsedDate.day}`,
                backendId: idInput?.value ? Number(idInput.value) : null,
                label: `${index + 1}`,
                description: (descInput?.value || '').trim(),
                detail: (obsInput?.value || '').trim(),
                priority: (priorityInput?.value || '').trim(),
                originalDay: parsedDate.day,
                day: parsedDate.day,
                monthIndex: parsedDate.monthIndex,
                year: parsedDate.year,
                admin_url: currentProcessId ? `/admin/contratos/processojudicial/${currentProcessId}/change/` : '',
                processo_id: currentProcessId ? Number(currentProcessId) : null,
                responsavel: responsavelInput?.value ? { id: Number(responsavelInput.value) } : null,
            };
            rememberOrigin(entry);
            appendEntry(entry);
        });
        document.querySelectorAll('#prazos-group .dynamic-prazos').forEach((row, index) => {
            if (row.classList.contains('empty-form')) return;
            const deleteCheckbox = row.querySelector('input[id$="-DELETE"]');
            if (deleteCheckbox?.checked) return;
            const doneCheckbox = row.querySelector('input[id$="-concluido"]');
            if (doneCheckbox && doneCheckbox.checked) return;
            const dateInput = row.querySelector('input[id$="-data_limite_0"]') || row.querySelector('input[id$="-data_limite"]');
            const parsedDate = parseDateInputValue(dateInput?.value);
            if (!parsedDate) return;
            const titleInput = row.querySelector('input[id$="-titulo"]');
            const obsInput = row.querySelector('textarea[id$="-observacoes"]') || row.querySelector('input[id$="-observacoes"]');
            const idInput = row.querySelector('input[id$="-id"]');
            const responsavelInput = row.querySelector('select[id$="-responsavel"]') || row.querySelector('input[id$="-responsavel"]');
            const entry = {
                type: 'P',
                id: idInput?.value ? `p-${idInput.value}` : `p-${index + 1}-${parsedDate.day}`,
                backendId: idInput?.value ? Number(idInput.value) : null,
                label: `${index + 1}`,
                description: (titleInput?.value || '').trim(),
                detail: (obsInput?.value || '').trim(),
                originalDay: parsedDate.day,
                day: parsedDate.day,
                monthIndex: parsedDate.monthIndex,
                year: parsedDate.year,
                admin_url: currentProcessId ? `/admin/contratos/processojudicial/${currentProcessId}/change/` : '',
                processo_id: currentProcessId ? Number(currentProcessId) : null,
                responsavel: responsavelInput?.value ? { id: Number(responsavelInput.value) } : null,
            };
            rememberOrigin(entry);
            appendEntry(entry);
        });
        return entries;
    };

    const dedupeEntries = (entries = []) => {
        const seen = new Set();
        return entries.filter((entry) => {
            const key = entry.id || `${entry.type}-${entry.processo_id || 'x'}-${entry.day}-${entry.monthIndex}-${entry.year}-${entry.label}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };
    const mergeEntriesByBackend = (primary = [], secondary = []) => {
        const map = new Map();
        const add = (entry, prefer = false) => {
            const typeKey = entry.type === 'P' ? 'p' : 't';
            const key = entry.backendId ? `b-${typeKey}-${entry.backendId}` : `i-${entry.id}`;
            if (!prefer && map.has(key)) return;
            map.set(key, entry);
        };
        primary.forEach(entry => add(entry, true));
        secondary.forEach(entry => add(entry, false));
        return Array.from(map.values());
    };
    const rebuildAgendaEntriesFromCalendar = () => {
        const rebuilt = [];
        Object.keys(calendarMonths).forEach(key => {
            const days = calendarMonths[key] || [];
            days.forEach(day => {
                const common = { monthIndex: day.monthIndex, year: day.year, day: day.day };
                day.tasksT.forEach(entry => rebuilt.push({ ...entry, ...common, type: 'T' }));
                day.tasksP.forEach(entry => rebuilt.push({ ...entry, ...common, type: 'P' }));
            });
        });
        return rebuilt;
    };
    const persistEntryDate = (entryData, targetDayInfo) => {
        if (!entryData?.backendId || !targetDayInfo) return;
        const payloadDate = formatDateIso(targetDayInfo.year, targetDayInfo.monthIndex, targetDayInfo.day);
        const isTask = entryData.type === 'T';
        const url = isTask
            ? `/api/agenda/tarefa/${entryData.backendId}/update-date/`
            : `/api/agenda/prazo/${entryData.backendId}/update-date/`;
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrftoken || '',
            },
            body: JSON.stringify({ date: payloadDate }),
        }).catch(() => {});
    };
    const debounce = (fn, delay = 300) => {
        let timer = null;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    };

    const applyEntriesToCalendar = (entries = []) => {
        entries.forEach((entry) => {
            const days = getMonthData(entry.monthIndex, entry.year);
            const dayInfo = days[entry.day - 1];
            if (!dayInfo) return;
            const entryType = entry.type === 'P' ? 'P' : 'T';
            entry.type = entryType;
            const targetList = entryType === 'T' ? dayInfo.tasksT : dayInfo.tasksP;
            targetList.push(entry);
            normalizeEntryMetadata(dayInfo, entry.type);
        });
    };

    const hydrateAgendaFromInlineData = () => {
        const entries = collectAgendaEntriesFromInline();
        applyEntriesToCalendar(entries);
        return entries;
    };

    const normalizeApiEntry = (item) => {
        if (!item) return null;
        const type = item.type === 'P' ? 'P' : 'T';
        const parsed = parseDateInputValue(item.date || item.data_limite || item.data);
        if (!parsed) return null;
        const originalRaw = item.original_date || item.data_origem || item.data_limite_origem;
        const originalParsed = parseDateInputValue(originalRaw);
        const originalDate = originalParsed
            ? formatDateIso(originalParsed.year, originalParsed.monthIndex, originalParsed.day)
            : formatDateIso(parsed.year, parsed.monthIndex, parsed.day);
        const entry = {
            type,
            id: `${type.toLowerCase()}-${item.id || `${parsed.day}`}`,
            backendId: item.id || null,
            label: item.id ? `${item.id}` : `${parsed.day}`,
            description: type === 'T' ? (item.descricao || '') : (item.title || item.titulo || ''),
            detail: item.observacoes || '',
            priority: type === 'T' ? (item.prioridade || '') : '',
            originalDay: originalParsed ? originalParsed.day : parsed.day,
            originalDate,
            day: parsed.day,
            monthIndex: parsed.monthIndex,
            year: parsed.year,
            admin_url: item.admin_url || '',
            processo_id: item.processo_id,
            responsavel: item.responsavel || null,
        };
        const hasApiOrigin = Boolean(originalRaw);
        if (hasApiOrigin) {
            const key = getOriginKey(entry);
            if (key) {
                entryOrigins.set(key, originalDate);
            }
        } else {
            applyOriginFromMap(entry);
        }
        rememberOrigin(entry);
        return entry;
    };

    const hydrateAgendaFromApi = (inlineEntries = [], calendarStateRef = null, renderFn = null, setEntriesRef = null, preferApiOnly = false) => {
        const statusParam = calendarStateRef?.showCompleted ? 'completed' : 'pending';
        const url = `/api/agenda/geral/?status=${statusParam}`;
        fetch(url)
            .then((response) => {
                if (!response.ok) throw new Error();
                return response.json();
            })
            .then((data) => {
                const apiEntries = Array.isArray(data) ? data.map(normalizeApiEntry).filter(Boolean) : [];
                if (preferApiOnly) {
                    entryOrigins.clear();
                }
                const combined = preferApiOnly ? apiEntries : mergeEntriesByBackend(apiEntries, inlineEntries);
                resetCalendarMonths();
                if (setEntriesRef) {
                    setEntriesRef(combined);
                }
                let filtered = combined;
                const activeUserId = calendarStateRef?.activeUser?.id;
                if (activeUserId) {
                    filtered = filtered.filter(entry => entry?.responsavel?.id === activeUserId);
                }
                if (calendarStateRef?.focused && currentProcessId) {
                    filtered = combined.filter(entry => `${entry.processo_id || ''}` === `${currentProcessId}`);
                }
                applyEntriesToCalendar(filtered);
                if (calendarStateRef && filtered.length) {
                    const first = filtered
                        .slice()
                        .sort((a, b) => new Date(a.year, a.monthIndex, a.day) - new Date(b.year, b.monthIndex, b.day))[0];
                    if (first) {
                        calendarStateRef.monthIndex = first.monthIndex;
                        calendarStateRef.year = first.year;
                    }
                }
                renderFn && renderFn();
            })
            .catch(() => {
                resetCalendarMonths();
                let filtered = inlineEntries;
                if (calendarStateRef?.focused && currentProcessId) {
                    filtered = inlineEntries.filter(entry => `${entry.processo_id || ''}` === `${currentProcessId}`);
                }
                applyEntriesToCalendar(filtered);
                renderFn && renderFn();
            });
    };

    const populateDetailEntries = (dayData, type, detailList, detailCardBody, setDetailTitle) => {
        setDetailTitle?.(dayData?.day, type);
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
            const priorityCode = (entryData.priority || '').toUpperCase();
            const priorityClass = priorityCode === 'A'
                ? 'agenda-panel__details-item--priority-high'
                : priorityCode === 'M'
                    ? 'agenda-panel__details-item--priority-medium'
                    : priorityCode === 'B'
                        ? 'agenda-panel__details-item--priority-low'
                        : '';
            if (priorityClass) {
                entry.classList.add(priorityClass);
            }
            const label = document.createElement('span');
            label.className = 'agenda-panel__details-item-label';
            label.textContent = entryData.label;
            entry.appendChild(label);
            const text = document.createElement('span');
            text.className = 'agenda-panel__details-item-text';
            text.textContent = entryData.description || '';
            entry.appendChild(text);
            const currentDate = formatDateIso(dayData.year, dayData.monthIndex, dayData.day);
            if (entryData.originalDate) {
                const original = document.createElement('span');
                original.className = 'agenda-panel__details-original';
                original.textContent = `Origem: ${formatDateLabel(entryData.originalDate)}`;
                entry.appendChild(original);
            }
            entry.addEventListener('click', () => {
                const detail = entryData.detail || entryData.observacoes || entryData.description;
                detailCardBody.textContent = detail || 'Sem observações adicionais.';
            });
            entry.addEventListener('dblclick', () => {
                const url = entryData.admin_url || entryData.url;
                if (url) {
                    window.open(url, '_blank');
                }
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
                    entry: {
                        id: entryData.id,
                        backendId: entryData.backendId,
                        type,
                    },
                }));
                event.dataTransfer.effectAllowed = 'move';
            });
            detailList.appendChild(entry);
        });
    };

    const renderCalendarDays = (gridElement, detailList, detailCardBody, state, rerender, setDetailTitle) => {
        if (!gridElement || !detailList || !detailCardBody) {
            return;
        }
        const todayFallback = new Date();
        const effectiveState = state || { mode: 'monthly', weekOffset: 0, monthIndex: todayFallback.getMonth(), year: todayFallback.getFullYear() };
        gridElement.innerHTML = '';
        detailList.innerHTML = '<p class="agenda-panel__details-empty">Clique em T ou P para ver as tarefas/prazos e detalhes.</p>';
        detailCardBody.textContent = 'Selecione um item para visualizar mais informações.';
        setDetailTitle?.(null, null);
        gridElement.classList.toggle('agenda-panel__calendar-grid--weekly', effectiveState.mode === 'weekly');
        let activeDayCell = null;
        const recordActiveDay = (dayInfo, type) => {
            if (!state) return;
            state.activeDay = { day: dayInfo.day, monthIndex: dayInfo.monthIndex, year: dayInfo.year };
            state.activeType = type || state.activeType || null;
        };
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
        const calendarGrid = buildMonthGrid(effectiveState.monthIndex, effectiveState.year || new Date().getFullYear());
        const baseDays = effectiveState.mode === 'weekly'
            ? calendarGrid.slice(effectiveState.weekOffset, effectiveState.weekOffset + 7)
            : calendarGrid;
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
            const currentDate = formatDateIso(dayInfo.year, dayInfo.monthIndex, dayInfo.day);
            const hasHistory = [...dayInfo.tasksT, ...dayInfo.tasksP]
                .some(entry => entry.originalDate && entry.originalDate !== currentDate);
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
                    populateDetailEntries(dayInfo, type, detailList, detailCardBody, setDetailTitle);
                    recordActiveDay(dayInfo, type);
                    setActiveDay(dayCell);
                });
                tag.addEventListener('dragstart', (event) => {
                    const payload = {
                        source: 'calendar',
                        day: dayInfo.day,
                        monthIndex: dayInfo.monthIndex,
                        year: dayInfo.year,
                        type,
                        entries: dayInfo[type === 'T' ? 'tasksT' : 'tasksP'].map(entry => ({
                            id: entry.id,
                            backendId: entry.backendId,
                            type: entry.type || type,
                        })),
                    };
                    dayInfo[type === 'T' ? 'tasksT' : 'tasksP'].forEach(entry => {
                        entry.type = entry.type || type;
                    });
                    // Usa drag image só da sigla selecionada para não carregar as duas
                    const clone = tag.cloneNode(true);
                    clone.style.position = 'absolute';
                    clone.style.top = '-999px';
                    document.body.appendChild(clone);
                    const rect = clone.getBoundingClientRect();
                    event.dataTransfer.setDragImage(clone, rect.width / 2, rect.height / 2);
                    event.dataTransfer.setData('text/plain', JSON.stringify(payload));
                    event.dataTransfer.effectAllowed = 'move';
                    setTimeout(() => document.body.removeChild(clone), 0);
                });
                tagsWrapper.appendChild(tag);
            };
            renderTag('T', dayInfo.tasksT);
            renderTag('P', dayInfo.tasksP);
            dayCell.addEventListener('click', () => {
                if (dayInfo.tasksT.length) {
                    populateDetailEntries(dayInfo, 'T', detailList, detailCardBody, setDetailTitle);
                    recordActiveDay(dayInfo, 'T');
                } else if (dayInfo.tasksP.length) {
                    populateDetailEntries(dayInfo, 'P', detailList, detailCardBody, setDetailTitle);
                    recordActiveDay(dayInfo, 'P');
                } else {
                    detailList.innerHTML = '<p class="agenda-panel__details-empty">Nenhuma atividade registrada.</p>';
                    detailCardBody.textContent = 'Selecione um item para visualizar mais informações.';
                    setDetailTitle?.(dayInfo.day, null);
                    recordActiveDay(dayInfo, null);
                }
                setActiveDay(dayCell);
            });
            const isActiveDay =
                state?.activeDay &&
                state.activeDay.day === dayInfo.day &&
                state.activeDay.monthIndex === dayInfo.monthIndex &&
                state.activeDay.year === dayInfo.year;
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
                    const sourceMonth = getMonthData(parsed.monthIndex ?? effectiveState.monthIndex, parsed.year || effectiveState.year || new Date().getFullYear());
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
                        persistEntryDate(movedEntry, dayInfo);
                        moveAgendaEntries([movedEntry], dayInfo);
                    } else if (parsed.source === 'calendar') {
                        const transferred = sourceDay[typeKey];
                        if (!transferred.length) return;
                        dayInfo[typeKey].push(...transferred);
                        sourceDay[typeKey] = [];
                        normalizeEntryMetadata(sourceDay, parsed.type);
                        normalizeEntryMetadata(dayInfo, parsed.type);
                        const entriesPayload = parsed.entries && parsed.entries.length ? parsed.entries : transferred;
                        entriesPayload.forEach(entry => persistEntryDate(entry, dayInfo));
                        moveAgendaEntries(entriesPayload, dayInfo);
                    }
                    agendaEntries = dedupeEntries(rebuildAgendaEntriesFromCalendar());
                    if (state) {
                        state.activeDay = { day: dayInfo.day, monthIndex: dayInfo.monthIndex, year: dayInfo.year };
                        state.activeType = parsed.type;
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
            if (isActiveDay) {
                setActiveDay(dayCell);
                const preferredType = state.activeType;
                if (preferredType === 'T' && dayInfo.tasksT.length) {
                    populateDetailEntries(dayInfo, 'T', detailList, detailCardBody, setDetailTitle);
                } else if (preferredType === 'P' && dayInfo.tasksP.length) {
                    populateDetailEntries(dayInfo, 'P', detailList, detailCardBody, setDetailTitle);
                } else if (dayInfo.tasksT.length) {
                    populateDetailEntries(dayInfo, 'T', detailList, detailCardBody, setDetailTitle);
                    recordActiveDay(dayInfo, 'T');
                } else if (dayInfo.tasksP.length) {
                    populateDetailEntries(dayInfo, 'P', detailList, detailCardBody, setDetailTitle);
                    recordActiveDay(dayInfo, 'P');
                }
            }
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
                    <div class="agenda-panel__header-actions">
                        <button type="button" class="agenda-panel__refresh-btn" aria-label="Atualizar agenda">↻</button>
                        <button type="button" class="agenda-panel__close" aria-label="Fechar agenda">×</button>
                    </div>
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
        const refreshButton = overlay.querySelector('.agenda-panel__refresh-btn');
        const cycleBtn = overlay.querySelector('.agenda-panel__cycle-btn');
        const modeButton = overlay.querySelector('.agenda-panel__cycle-mode');
        const prevNavBtn = overlay.querySelector('[data-direction="prev"]');
        const nextNavBtn = overlay.querySelector('[data-direction="next"]');
        const monthTitleEl = overlay.querySelector('.agenda-panel__month-title');
        const detailList = overlay.querySelector('.agenda-panel__details-list-inner');
        const detailCardBody = overlay.querySelector('.agenda-panel__details-card-body');
        const detailTitleWrapper = overlay.querySelector('.agenda-panel__details-title');
        const detailTitleText = document.createElement('span');
        detailTitleText.className = 'agenda-panel__details-title-text';
        const detailTitleType = document.createElement('span');
        detailTitleType.className = 'agenda-panel__details-type';
        detailTitleWrapper.textContent = '';
        detailTitleWrapper.append(detailTitleText, detailTitleType);
        const setDetailTitle = (dayNumber, type) => {
            const base = dayNumber ? `Eventos do dia ${dayNumber}` : 'Eventos do dia';
            detailTitleText.textContent = base;
            const typeLabel = type === 'T' ? 'Tarefa' : type === 'P' ? 'Prazo' : '';
            detailTitleType.textContent = typeLabel;
            detailTitleType.dataset.type = type || '';
            detailTitleType.style.visibility = typeLabel ? 'visible' : 'hidden';
        };
        setDetailTitle(null, null);
        const calendarGridEl = overlay.querySelector('[data-calendar-placeholder]');
        const usersToggle = overlay.querySelector('.agenda-panel__users-toggle');
        const subtitleEl = overlay.querySelector('.agenda-panel__subtitle');
        let focusToggle = null;
        if (currentProcessId) {
            focusToggle = document.createElement('button');
            focusToggle.type = 'button';
            focusToggle.className = 'agenda-panel__focus-toggle';
            focusToggle.textContent = 'Agenda Focada';
            focusToggle.title = 'Mostrar apenas itens deste processo';
            subtitleEl.parentNode.insertBefore(focusToggle, subtitleEl.nextSibling);
        }
        const summaryBar = document.createElement('div');
        summaryBar.className = 'agenda-panel__summary';
        summaryBar.style.fontSize = '12px';
        summaryBar.style.color = '#4b5563';
        summaryBar.style.marginTop = '2px';
        subtitleEl.parentNode.insertBefore(summaryBar, subtitleEl.nextSibling);
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
        const completedButton = document.createElement('button');
        completedButton.type = 'button';
        completedButton.className = 'agenda-panel__history-toggle agenda-panel__completed-toggle';
        completedButton.textContent = 'Concluídos';
        completedButton.title = 'Alternar visualização de concluídos';
        completedButton.addEventListener('click', () => {
            calendarState.showCompleted = !calendarState.showCompleted;
            completedButton.classList.toggle('agenda-panel__history-toggle--active', calendarState.showCompleted);
            refreshAgendaData(true);
        });
        const firstFormBtn = footer.querySelector('.agenda-panel__form-btn');
        footer.insertBefore(completedButton, firstFormBtn);
        footer.insertBefore(historyButton, completedButton);
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
        const today = new Date();
        const calendarState = {
            mode: 'monthly',
            months: 1,
            monthIndex: today.getMonth(),
            year: today.getFullYear(),
            weekOffset: 0,
            showHistory: false,
            showCompleted: false,
            view: 'calendar',
            activeUser: null,
            focused: false,
            activeDay: null,
            activeType: null,
            preserveView: false,
            lastAppliedEntries: [],
            users: [],
            usersLoading: false,
            usersLoaded: false,
            usersError: false,
            defaultUserLabel: getDefaultUserLabel(),
        };
        const getInlineEntries = () => dedupeEntries(hydrateAgendaFromInlineData());
        let agendaEntries = getInlineEntries();
        updateAgendaEntryDate = (entryId, backendId, type, targetDayInfo) => {
            if (!targetDayInfo) return;
            agendaEntries = agendaEntries.map(item => {
                const matchesBackend = backendId && item.backendId && `${item.backendId}` === `${backendId}`;
                const matchesId = entryId && item.id === entryId;
                if (!(matchesBackend || matchesId)) return item;
                const newType = item.type || type;
                return {
                    ...item,
                    type: newType,
                    day: targetDayInfo.day,
                    monthIndex: targetDayInfo.monthIndex,
                    year: targetDayInfo.year,
                };
            });
        };
        moveAgendaEntries = (entriesToMove = [], targetDayInfo) => {
            if (!targetDayInfo || !entriesToMove.length) return;
            const backendPairs = entriesToMove
                .filter(e => e.backendId !== null && e.backendId !== undefined && e.backendId !== '')
                .map(e => `${e.type || ''}-${e.backendId}`);
            const backendSet = new Set(backendPairs);
            const idSet = new Set(entriesToMove.map(e => e.id));
            agendaEntries = agendaEntries.map(item => {
                const key = item.backendId ? `${item.type || ''}-${item.backendId}` : null;
                const matchesBackend = key && backendSet.has(key);
                const matchesId = idSet.has(item.id);
                if (matchesBackend || matchesId) {
                    const newOrigin = item.originalDate || formatDateIso(item.year, item.monthIndex, item.day);
                    rememberOrigin({
                        backendId: item.backendId,
                        originalDate: newOrigin,
                        year: item.year,
                        monthIndex: item.monthIndex,
                        day: item.day,
                    });
                    return {
                        ...item,
                        day: targetDayInfo.day,
                        monthIndex: targetDayInfo.monthIndex,
                        year: targetDayInfo.year,
                        type: item.type || entriesToMove[0]?.type,
                    };
                }
                return item;
            });
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
        const renderSummaryBar = (entries = []) => {
            if (!summaryBar) return;
            const counters = {
                T: { month: 0, total: 0 },
                P: { month: 0, total: 0 },
            };
            const monthIdx = calendarState.monthIndex;
            const year = calendarState.year;
            entries.forEach((entry) => {
                const type = entry.type === 'P' ? 'P' : 'T';
                counters[type].total += 1;
                if (entry.monthIndex === monthIdx && entry.year === year) {
                    counters[type].month += 1;
                }
            });
            const modeLabel = calendarState.showCompleted ? 'Concluídos' : 'Pendentes';
            summaryBar.textContent = `${modeLabel} — Mês: T ${counters.T.month} · P ${counters.P.month} | Total: T ${counters.T.total} · P ${counters.P.total}`;
        };
    const applyAgendaEntriesToState = () => {
        resetCalendarMonths();
        let entriesToApply = agendaEntries;
        const activeUserId = calendarState.activeUser?.id;
        if (activeUserId) {
            entriesToApply = entriesToApply.filter(
                entry => `${entry?.responsavel?.id || ''}` === `${activeUserId}`
            );
        }
        if (calendarState.focused && currentProcessId) {
            entriesToApply = entriesToApply.filter(
                entry => `${entry.processo_id || ''}` === `${currentProcessId}`
            );
        }
        applyEntriesToCalendar(entriesToApply);
        calendarState.lastAppliedEntries = entriesToApply;
        if (!calendarState.preserveView && entriesToApply.length) {
            const first = entriesToApply
                .slice()
                .sort((a, b) => new Date(a.year, a.monthIndex, a.day) - new Date(b.year, b.monthIndex, b.day))[0];
            if (first) {
                    calendarState.monthIndex = first.monthIndex;
                    calendarState.year = first.year;
                }
            }
            calendarState.preserveView = false;
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
            setDetailTitle(null, null);
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
                const username = document.createElement('span');
                username.className = 'agenda-panel__user-card-username';
                username.textContent = user.username || formatUserLabel(user);
                const counters = document.createElement('div');
                counters.className = 'agenda-panel__user-card-counts';
                counters.style.fontSize = '11px';
                counters.style.color = '#4b5563';
                const isCompletedMode = calendarState.showCompleted;
                const taskCount = isCompletedMode ? (user.completed_tasks || 0) : (user.pending_tasks || 0);
                const prazoCount = isCompletedMode ? (user.completed_prazos || 0) : (user.pending_prazos || 0);
                const label = isCompletedMode ? 'Concluídos' : 'Pendentes';
                counters.textContent = `${label} — T ${taskCount} · P ${prazoCount}`;
                card.append(initials, username, counters);
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
            resetCalendarMonths();
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
            applyAgendaEntriesToState();
            renderCalendarDays(calendarGridEl, detailList, detailCardBody, calendarState, renderCalendar, setDetailTitle);
            renderSummaryBar(calendarState.lastAppliedEntries || []);
        };
        if (focusToggle) {
            focusToggle.addEventListener('click', () => {
                calendarState.focused = !calendarState.focused;
                focusToggle.classList.toggle('agenda-panel__focus-toggle--active', calendarState.focused);
                applyAgendaEntriesToState();
                renderCalendar();
            });
        }
        const refreshAgendaData = () => {
            if (refreshButton) {
                refreshButton.disabled = true;
            }
            const inline = calendarState.showCompleted ? [] : getInlineEntries();
            const preferApiOnly = calendarState.showCompleted || false;
            hydrateAgendaFromApi(inline, calendarState, () => {
                applyAgendaEntriesToState();
                renderCalendar();
                if (refreshButton) {
                    refreshButton.disabled = false;
                }
            }, (combined) => {
                agendaEntries = combined;
            }, preferApiOnly);
        };
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                refreshAgendaData();
            });
        }
        hydrateAgendaFromApi(agendaEntries, calendarState, () => {
            applyAgendaEntriesToState();
            renderCalendar();
        }, (combined) => {
            agendaEntries = combined;
        });
        const handleNavigation = (direction) => {
            if (calendarState.mode === 'weekly') {
                const step = 7;
                const delta = direction === 'next' ? step : -step;
                calendarState.weekOffset = clampWeekOffset(calendarState.weekOffset + delta, calendarState);
            } else {
                const delta = direction === 'next' ? 1 : -1;
                let monthIndex = calendarState.monthIndex + delta;
                let year = calendarState.year;
                if (monthIndex > 11) {
                    monthIndex = 0;
                    year += 1;
                } else if (monthIndex < 0) {
                    monthIndex = 11;
                    year -= 1;
                }
                calendarState.monthIndex = monthIndex;
                calendarState.year = year;
            }
            calendarState.preserveView = true;
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
                calendarState.weekOffset = clampWeekOffset(calendarState.weekOffset, calendarState);
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
                    calendarState.weekOffset = clampWeekOffset(calendarState.weekOffset, calendarState);
                }
                calendarState.preserveView = true;
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
        const andamentosGroup = document.getElementById('andamentos-group');
        const submitRow = excluirBtn.closest('.submit-row');
        if (andamentosGroup && submitRow) {
            const updateVisibility = () => {
                submitRow.style.display = andamentosGroup.classList.contains('active') ? '' : 'none';
            };
            updateVisibility();
            const tabsContainer = document.querySelector('.inline-group-tabs');
            if (tabsContainer) {
                tabsContainer.addEventListener('click', (event) => {
                    const target = event.target;
                    if (target && target.tagName === 'BUTTON') {
                        window.requestAnimationFrame(updateVisibility);
                    }
                });
            }
            const observer = new MutationObserver(updateVisibility);
            observer.observe(andamentosGroup, { attributes: true, attributeFilter: ['class'] });
        }
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
        let lastSubmitButton = null;
        form.addEventListener('submit', () => {
            deduplicateInlineAndamentos();
        });
        form.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const button = target.closest('input[type="submit"], button[type="submit"]');
            if (!button || !form.contains(button)) return;
            lastSubmitButton = button;
        }, { capture: true });
        form.addEventListener('submit', (event) => {
            const submitter = event.submitter && form.contains(event.submitter)
                ? event.submitter
                : lastSubmitButton;
            if (!submitter) return;
            const activeButton = submitter.closest('input[type="submit"], button[type="submit"]');
            if (!activeButton) return;
            const originalLabel = activeButton.tagName === 'INPUT'
                ? activeButton.value
                : activeButton.textContent;
            activeButton.dataset.originalLabel = originalLabel;
            if (activeButton.tagName === 'INPUT') {
                activeButton.value = 'Salvando...';
            } else {
                activeButton.textContent = 'Salvando...';
            }
        }, { capture: true });
        const continueButtons = form.querySelectorAll('input[name="_continue"], button[name="_continue"]');
        continueButtons.forEach((button) => {
            button.style.display = 'none';
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

    const wrapInlineTableForScroll = () => {
        ['tarefas-group', 'prazos-group'].forEach(groupId => {
            const group = document.getElementById(groupId);
            if (!group) return;
            const tabular = group.querySelector('.tabular');
            if (!tabular || tabular.parentElement.classList.contains('inline-scroll-container')) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'inline-scroll-container';
            tabular.classList.add('inline-scroll-inner');
            tabular.parentNode.insertBefore(wrapper, tabular);
            wrapper.appendChild(tabular);
        });
    };
    wrapInlineTableForScroll();

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
