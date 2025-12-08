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
