document.addEventListener('DOMContentLoaded', function() {
    const andamentoInlineGroup = document.querySelector('.dynamic-andamento');
    if (!andamentoInlineGroup) {
        return;
    }

    const heading = andamentoInlineGroup.querySelector('h2');
    const table = andamentoInlineGroup.querySelector('table');

    if (!heading || !table) {
        return;
    }

    // 1. Adicionar botão de remover selecionados
    const bulkDeleteButton = document.createElement('button');
    bulkDeleteButton.type = 'button';
    bulkDeleteButton.textContent = 'Remover Selecionados';
    bulkDeleteButton.className = 'button';
    bulkDeleteButton.style.marginLeft = '10px';
    heading.insertAdjacentElement('afterend', bulkDeleteButton);

    // 2. Adicionar checkbox "Selecionar Todos" no cabeçalho da tabela
    const headerRow = table.querySelector('thead tr');
    const selectAllTh = document.createElement('th');
    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.title = 'Selecionar Todos';
    selectAllTh.appendChild(selectAllCheckbox);
    headerRow.insertBefore(selectAllTh, headerRow.children[0]);

    // 3. Adicionar checkbox em cada linha de andamento
    const bodyRows = table.querySelectorAll('tbody tr.form-row');
    bodyRows.forEach(row => {
        const selectTd = document.createElement('td');
        const selectCheckbox = document.createElement('input');
        selectCheckbox.type = 'checkbox';
        selectCheckbox.className = 'andamento-select-checkbox';
        selectTd.appendChild(selectCheckbox);
        row.insertBefore(selectTd, row.children[0]);
    });

    // --- Lógica dos checkboxes ---

    // Lógica para "Selecionar Todos"
    selectAllCheckbox.addEventListener('change', function() {
        const checkboxes = table.querySelectorAll('.andamento-select-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
        });
    });

    // Lógica para o botão de remover
    bulkDeleteButton.addEventListener('click', function() {
        if (!confirm('Tem certeza que deseja remover os andamentos selecionados?')) {
            return;
        }

        const selectedCheckboxes = table.querySelectorAll('.andamento-select-checkbox:checked');
        let count = 0;
        selectedCheckboxes.forEach(checkbox => {
            const row = checkbox.closest('tr.form-row');
            const deleteCheckbox = row.querySelector('input[id$="-DELETE"]');
            if (deleteCheckbox && !deleteCheckbox.checked) {
                deleteCheckbox.checked = true;
                row.classList.add('deleted');
                count++;
            }
        });

        if (count > 0) {
            selectAllCheckbox.checked = false;
            alert(`${count} andamento(s) marcados para remoção. Salve o formulário para confirmar a exclusão.`);
        } else {
            alert('Nenhum andamento novo foi marcado para remoção. Os itens já marcados não são contados novamente.');
        }
    });
});