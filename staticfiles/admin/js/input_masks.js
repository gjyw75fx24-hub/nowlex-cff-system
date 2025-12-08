// static/admin/js/input_masks.js

document.addEventListener('DOMContentLoaded', function () {
    function formatarMoedaAoFinalizar(event) {
        const input = event.target;
        let value = input.value;

        if (!value) return;

        // Remove espaços e R$
        value = value.replace(/\s/g, '');
        value = value.replace(/[\R$\u00A0]/g, '');
        value = value.replace(/\./g, '');
        value = value.replace(',', '.');

        const numero = Number(value);

        if (isNaN(numero)) {
            input.value = '';
            return;
        }

        input.value = numero.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
    }

    function prepararValorParaEnvio(input) {
        let valor = input.value;

        valor = valor.replace(/\s/g, '');
        valor = valor.replace(/[\R$\u00A0]/g, '');
        valor = valor.replace(/\./g, '');
        valor = valor.replace(',', '.');

        input.value = valor;
    }

    function inicializarMascaras() {
        const moneyInputs = document.querySelectorAll('input.money-mask');
        const form = document.querySelector('form');

        moneyInputs.forEach(input => {
            // Aplica formatação ao carregar valor existente
            if (input.value) {
                const numero = Number(input.value.replace(/\s/g, '').replace(/[\R$\u00A0]/g, '').replace(/\./g, '').replace(',', '.'));
                if (!isNaN(numero)) {
                    input.value = numero.toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL'
                    });
                }
            }
            // Aplica formatação ao sair do campo
            input.addEventListener('blur', formatarMoedaAoFinalizar);
        });

        if (form) {
            form.addEventListener('submit', (e) => {
                moneyInputs.forEach(input => prepararValorParaEnvio(input));

                // Força botão "Salvar e continuar editando"
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = '_continue';
                hiddenInput.value = '1';
                form.appendChild(hiddenInput);
            });

            // Impede Enter de submeter e força "_continue"
            form.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.target.matches('textarea')) {
                    e.preventDefault();

                    // Submete com _continue manualmente
                    const hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.name = '_continue';
                    hiddenInput.value = '1';
                    form.appendChild(hiddenInput);
                    form.submit();
                }
            });
        }

        // Máscara de CNJ
        const cnjInput = document.getElementById('id_cnj');
        if (cnjInput) {
            cnjInput.addEventListener('input', (e) => {
                const v = e.target.value.replace(/\D/g, '');
                e.target.value = v
                    .replace(/(\d{7})(\d)/, '$1-$2')
                    .replace(/(\d{2})(\d)/, '$1.$2')
                    .replace(/(\d{4})(\d)/, '$1.$2')
                    .replace(/(\d{1})(\d)/, '$1.$2')
                    .replace(/(\d{2})(\d)/, '$1.$2')
                    .slice(0, 25);
            });
        }

        // CPF/CNPJ
        function formatarCPF_CNPJ(value) {
            const v = value.replace(/\D/g, '');
            if (v.length > 11) {
                return v
                    .replace(/(\d{2})(\d)/, '$1.$2')
                    .replace(/(\d{3})(\d)/, '$1.$2')
                    .replace(/(\d{3})(\d)/, '$1/$2')
                    .replace(/(\d{4})(\d)/, '$1-$2')
                    .slice(0, 18);
            } else {
                return v
                    .replace(/(\d{3})(\d)/, '$1.$2')
                    .replace(/(\d{3})(\d)/, '$1.$2')
                    .replace(/(\d{3})(\d{1,2})/, '$1-$2')
                    .slice(0, 14);
            }
        }

        function aplicarMascaraPartes() {
            const camposDocumento = document.querySelectorAll('input[name$="-documento"]');
            camposDocumento.forEach(input => {
                if (input.dataset.maskApplied) return;

                input.addEventListener('input', (e) => {
                    e.target.value = formatarCPF_CNPJ(e.target.value);
                });
                input.dataset.maskApplied = 'true';
            });
        }

        aplicarMascaraPartes();

        const inlinesContainer = document.getElementById('partes-group');
        if (inlinesContainer) {
            const observer = new MutationObserver(() => aplicarMascaraPartes());
            observer.observe(inlinesContainer, { childList: true, subtree: true });
        }
    }

    inicializarMascaras();
});
