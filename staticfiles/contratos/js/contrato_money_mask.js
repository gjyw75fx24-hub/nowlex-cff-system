// JS responsável por manter o formato monetário somente na interface,
// sem alterar a lógica de persistência definida no backend.
(function () {
    'use strict';

    const currencyFormatter = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });

    function normalizeCurrency(value) {
        if (!value) {
            return '';
        }
        let normalized = String(value).trim();
        if (!normalized) {
            return '';
        }
        normalized = normalized.replace(/\s/g, '');
        normalized = normalized.replace(/[\u00A0R$]/g, '');
        const hasComma = normalized.indexOf(',') >= 0;
        const hasDot = normalized.indexOf('.') >= 0;
        if (hasComma && hasDot) {
            normalized = normalized.replace(/\./g, '');
            normalized = normalized.replace(',', '.');
        } else if (hasComma) {
            normalized = normalized.replace(',', '.');
        }
        return normalized;
    }

    function formatCurrency(value) {
        const numericValue = normalizeCurrency(value);
        if (!numericValue) {
            return '';
        }
        const parsed = Number(numericValue);
        if (!Number.isFinite(parsed)) {
            return '';
        }
        return currencyFormatter.format(parsed);
    }

    function reformatInput(input) {
        const formatted = formatCurrency(input.value);
        if (formatted) {
            input.value = formatted;
        } else {
            input.value = '';
        }
    }

    function sanitizeInput(input) {
        input.value = normalizeCurrency(input.value);
    }

    function initMoneyMask(form) {
        if (!form) {
            return;
        }

        const moneyInputs = () => Array.from(form.querySelectorAll('input.money-mask'));

        function attachHandlers(input) {
            if (input.dataset.moneyMaskBound) {
                return;
            }
            input.addEventListener('blur', () => reformatInput(input));
            input.dataset.moneyMaskBound = 'true';
        }

        function reapply() {
            moneyInputs().forEach(input => {
                reformatInput(input);
                attachHandlers(input);
            });
        }

        reapply();

        const observer = new MutationObserver(reapply);
        observer.observe(form, { childList: true, subtree: true });

        form.addEventListener('submit', () => {
            moneyInputs().forEach(sanitizeInput);
        });
    }

    function run() {
        const adminForm = document.querySelector('form');
        initMoneyMask(adminForm);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
