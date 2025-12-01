// static/admin/js/soma_contratos.js

document.addEventListener('DOMContentLoaded', function () {
    const valorCausaProcessoField = document.querySelector('.field-valor_causa .readonly');
    const inlinesContainer = document.getElementById('contratos-group');

    function parseCurrency(value) {
        if (!value) return 0;
        // Garante que seja uma string, substitui a vírgula por ponto para o parseFloat, e remove tudo que não for dígito ou ponto.
        const cleanedValue = String(value).replace(',', '.').replace(/[^\d.]/g, '');
        return parseFloat(cleanedValue) || 0;
    }

    function formatCurrency(value) {
        return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function updateTotal() {
        let total = 0;
        const valorCausaContratoFields = inlinesContainer.querySelectorAll('input[name$="-valor_causa"]');
        
        valorCausaContratoFields.forEach(input => {
            total += parseCurrency(input.value);
        });

        if (valorCausaProcessoField) {
            valorCausaProcessoField.textContent = formatCurrency(total);
        }
    }

    if (inlinesContainer) {
        inlinesContainer.addEventListener('change', function (event) {
            if (event.target && event.target.matches('input[name$="-valor_causa"]')) {
                updateTotal();
            }
        });

        // Garante que a soma seja executada ao carregar a página
        updateTotal();

        // Observa adições ou remoções de inlines
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes.length || mutation.removedNodes.length) {
                    updateTotal();
                    // Re-adiciona listeners para os novos campos
                    const newInputs = inlinesContainer.querySelectorAll('input[name$="-valor_causa"]');
                    newInputs.forEach(input => {
                        input.removeEventListener('change', updateTotal); // Evita duplicatas
                        input.addEventListener('change', updateTotal);
                    });
                }
            });
        });

        observer.observe(inlinesContainer, { childList: true, subtree: true });
    }
});