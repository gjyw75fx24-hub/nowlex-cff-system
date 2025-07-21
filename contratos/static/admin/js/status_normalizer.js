// Arquivo: contratos/static/admin/js/status_normalizer.js

(function() {
    window.addEventListener('DOMContentLoaded', () => {
        const isStatusChangeList = document.body.classList.contains('app-contratos', 'model-statusprocessual', 'change-list');
        if (!isStatusChangeList) return;

        const changelistForm = document.getElementById('changelist-form');
        if (!changelistForm) return;

        const csrfToken = changelistForm.querySelector('input[name="csrfmiddlewaretoken"]').value;
        const statusData = new Map();
        const orderMap = new Map();

        changelistForm.querySelectorAll('tbody tr').forEach(row => {
            try {
                const idInput = row.querySelector('td.action-checkbox input.action-select');
                const nameLink = row.querySelector('th.field-nome a');
                const orderInput = row.querySelector('td.field-ordem input');

                if (idInput && nameLink && orderInput) {
                    const id = idInput.value;
                    const name = nameLink.textContent.trim();
                    const order = parseInt(orderInput.value, 10);

                    statusData.set(id, { order, name });
                    if (!orderMap.has(order)) orderMap.set(order, []);
                    orderMap.get(order).push(id);
                    
                    orderInput.setAttribute('data-original-value', order);
                    orderInput.addEventListener('blur', handleOrderChange);
                }
            } catch (e) {
                // Silenciosamente ignora erros em linhas malformadas
            }
        });

        async function handleOrderChange(event) {
            const changedInput = event.target;
            const originalValue = changedInput.getAttribute('data-original-value');
            const currentValue = changedInput.value;

            if (originalValue === currentValue) return;

            const sourceRow = changedInput.closest('tr');
            const sourceId = sourceRow.querySelector('td.action-checkbox input.action-select').value;
            const newOrder = parseInt(currentValue, 10);

            if (isNaN(newOrder)) return;

            if (newOrder === 0) {
                return;
            }

            const sourceName = statusData.get(sourceId).name;
            const conflictingIds = (orderMap.get(newOrder) || []).filter(id => id !== sourceId);

            if (conflictingIds.length > 0) {
                const targetId = conflictingIds[0];
                const targetName = statusData.get(targetId).name;

                const confirmation = confirm(
                    `A ordem ${newOrder} já pertence a "${targetName}".\n\n` +
                    `Deseja MESCLAR "${sourceName}" em "${targetName}"?`
                );

                if (confirmation) {
                    await mergeStatuses(sourceId, targetId, changedInput);
                } else {
                    changedInput.value = originalValue;
                }
            }
        }

        async function mergeStatuses(sourceId, targetId, inputElement) {
            inputElement.disabled = true;
            const url = `/api/contratos/status/merge/`;
            const formData = new FormData();
            formData.append('source_id', sourceId);
            formData.append('target_id', targetId);

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    body: formData,
                    headers: { 'X-CSRFToken': csrfToken }
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message);

                alert(`Sucesso: ${result.message}`);
                window.location.reload();
            } catch (error) {
                alert(`Falha na operação: ${error.message}`);
                inputElement.disabled = false;
                inputElement.value = inputElement.getAttribute('data-original-value');
            }
        }
    });
})();
