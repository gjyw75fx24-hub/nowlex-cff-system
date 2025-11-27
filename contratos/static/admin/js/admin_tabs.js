// static/admin/js/admin_tabs.js

window.addEventListener('load', function() {
    const inlineGroups = document.querySelectorAll('.inline-group');
    if (inlineGroups.length === 0) {
        return;
    }

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
            // Salva o título da aba ativa no localStorage
            localStorage.setItem(lastActiveTabKey, title);
            
            tabButtons.forEach(item => item.button.classList.remove('active'));
            inlineGroups.forEach(grp => grp.classList.remove('active'));

            tabButton.classList.add('active');
            group.classList.add('active');
        });

        tabsContainer.appendChild(tabButton);
        tabButtons.push({ button: tabButton, title: title, group: group });
    });

    // Tenta carregar a última aba ativa do localStorage
    const savedTabTitle = localStorage.getItem(lastActiveTabKey);
    if (savedTabTitle) {
        const savedTabIndex = tabButtons.findIndex(item => item.title === savedTabTitle);
        if (savedTabIndex !== -1) {
            activeTabIndex = savedTabIndex;
        }
    }

    // Ativa a aba correspondente ao activeTabIndex
    if (tabButtons.length > 0) {
        tabButtons[activeTabIndex].button.classList.add('active');
        tabButtons[activeTabIndex].group.classList.add('active');
    }
});
