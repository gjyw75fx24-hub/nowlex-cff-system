// contratos/static/admin/js/filter_search.js

window.addEventListener('load', function() {
    // --- Lógica para o botão de colapsar filtro ---
    const filterDiv = document.getElementById('changelist-filter');
    const toggleButton = document.getElementById('filter-toggle');

    if (filterDiv && toggleButton) {
        toggleButton.addEventListener('click', function() {
            filterDiv.classList.toggle('collapsed');
            if (filterDiv.classList.contains('collapsed')) {
                toggleButton.textContent = ' [+]';
            } else {
                toggleButton.textContent = ' [–]';
            }
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
