// contratos/static/admin/js/filter_search.js

window.addEventListener('load', function() {
    // --- Lógica para o botão de colapsar filtro (com memória) ---
    const filterDiv = document.getElementById('changelist-filter');
    const toggleButton = document.getElementById('filter-toggle');

    if (filterDiv && toggleButton) {
        // 1. Ao carregar, verifica o estado salvo no localStorage
        const isCollapsedSaved = localStorage.getItem('filterCollapsed') === 'true';
        if (isCollapsedSaved) {
            filterDiv.classList.add('collapsed');
            toggleButton.textContent = ' [+]';
        }

        // 2. Adiciona o evento de clique para alterar e salvar o estado
        toggleButton.addEventListener('click', function() {
            filterDiv.classList.toggle('collapsed');
            const isCurrentlyCollapsed = filterDiv.classList.contains('collapsed');
            
            if (isCurrentlyCollapsed) {
                toggleButton.textContent = ' [+]';
            } else {
                toggleButton.textContent = ' [–]';
            }
            
            // Salva o estado atual no localStorage para lembrar na próxima visita
            localStorage.setItem('filterCollapsed', isCurrentlyCollapsed);
        });
    }

    // --- Lógica para a busca no filtro de etiquetas ---
    const searchInput = document.getElementById('etiqueta-filter-search');
    const etiquetaList = document.getElementById('etiqueta-filter-list');

    if (!searchInput || !etiquetaList) {
        return; // Sai se o filtro de busca não estiver na página
    }

    // Pega todos os itens da lista de etiquetas
    const listItems = etiquetaList.getElementsByTagName('li');

    // Adiciona um "ouvinte" que reage cada vez que o usuário digita
    searchInput.addEventListener('keyup', function() {
        const searchTerm = searchInput.value.toLowerCase();

        // Itera sobre cada item da lista (cada <li>)
        for (let i = 0; i < listItems.length; i++) {
            const item = listItems[i];
            const link = item.getElementsByTagName('a')[0];
            
            // O item "Todos" deve sempre aparecer
            if (link.innerText.toLowerCase() === 'todos') {
                item.style.display = '';
                continue;
            }

            // Verifica se o texto do link inclui o termo buscado
            if (link.textContent.toLowerCase().includes(searchTerm)) {
                item.style.display = ''; // Mostra o item se corresponder
            } else {
                item.style.display = 'none'; // Esconde o item se não corresponder
            }
        }
    });
});
