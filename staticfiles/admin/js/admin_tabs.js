// static/admin/js/admin_tabs.js

window.addEventListener('load', function() {
    // Encontra todos os grupos de inlines na página do admin
    const inlineGroups = document.querySelectorAll('.inline-group');
    if (inlineGroups.length === 0) {
        return; // Se não houver inlines, não faz nada
    }

    // Cria o container para os botões das abas
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'inline-group-tabs';

    // Insere o container de abas antes do primeiro grupo de inline
    inlineGroups[0].parentNode.insertBefore(tabsContainer, inlineGroups[0]);

    // Itera sobre cada grupo de inline para criar um botão de aba
    inlineGroups.forEach((group, index) => {
        // Pega o título do inline (ex: "Partes", "Andamentos")
        const title = group.querySelector('h2').textContent;
        
        const tabButton = document.createElement('button');
        tabButton.textContent = title;
        tabButton.type = 'button'; // Para não submeter o formulário

        tabButton.addEventListener('click', () => {
            // Remove a classe 'active' de todos os botões e grupos
            tabsContainer.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            inlineGroups.forEach(grp => grp.classList.remove('active'));

            // Adiciona a classe 'active' ao botão clicado e ao grupo correspondente
            tabButton.classList.add('active');
            group.classList.add('active');
        });

        tabsContainer.appendChild(tabButton);

        // Ativa a primeira aba por padrão
        if (index === 0) {
            tabButton.classList.add('active');
            group.classList.add('active');
        }
    });
});
