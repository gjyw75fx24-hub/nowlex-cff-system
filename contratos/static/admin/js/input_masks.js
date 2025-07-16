// static/admin/js/input_masks.js

document.addEventListener('DOMContentLoaded', function() {

    // --- FUNÇÕES DE MÁSCARA ---

    function formatarCNJ(value) {
        const v = value.replace(/\D/g, '').slice(0, 14);
        if (v.length >= 13) {
            return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
        } else if (v.length >= 9) {
            return v.replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})/, '$1.$2.$3/$4');
        } else if (v.length >= 6) {
            return v.replace(/(\d{2})(\d{3})(\d{1,3})/, '$1.$2.$3');
        } else if (v.length >= 3) {
            return v.replace(/(\d{2})(\d{1,3})/, '$1.$2');
        }
        return v;
    }

    function formatarCPF_CNPJ(value) {
        const v = value.replace(/\D/g, '');
        // CNPJ
        if (v.length > 11) {
            return formatarCNJ(v); // Reutiliza a formatação de CNPJ
        } 
        // CPF
        else {
            if (v.length >= 10) {
                return v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
            } else if (v.length >= 7) {
                return v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
            } else if (v.length >= 4) {
                return v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
            }
            return v;
        }
    }

    // --- APLICAÇÃO DAS MÁSCARAS ---

    function aplicarMascara(event) {
        const input = event.target;
        const tipoMascara = input.dataset.mask;

        if (tipoMascara === 'cpf-cnpj') {
            input.value = formatarCPF_CNPJ(input.value);
        }
        // Adicione outras máscaras aqui se necessário
    }

    // --- INICIALIZAÇÃO ---

    // Aplica a máscara em todos os campos de documento das partes
    function inicializarMascarasPartes() {
        const camposDocumento = document.querySelectorAll('input[name$="-documento"]');
        camposDocumento.forEach(input => {
            input.setAttribute('data-mask', 'cpf-cnpj');
            input.setAttribute('maxlength', '18'); // 18 é o tamanho de um CNPJ formatado
            input.addEventListener('input', aplicarMascara);
            // Formata o valor inicial, caso já exista
            input.value = formatarCPF_CNPJ(input.value);
        });
    }

    // Aplica a máscara no campo CNJ principal
    function inicializarMascaraCNJPrincipal() {
        const cnjInput = document.getElementById('id_cnj');
        if (cnjInput) {
            cnjInput.setAttribute('maxlength', '25'); // Formato do CNJ de processo é diferente
            cnjInput.addEventListener('input', (e) => {
                const v = e.target.value.replace(/\D/g, '');
                // Máscara para CNJ de processo: NNNNNNN-DD.YYYY.J.TR.OOOO
                if (v.length > 16) {
                    e.target.value = v.replace(/(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})(\d{4})/, '$1-$2.$3.$4.$5.$6');
                }
            });
            // Formata o valor inicial
            const v = cnjInput.value.replace(/\D/g, '');
            if (v.length === 20) {
                 cnjInput.value = v.replace(/(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})(\d{4})/, '$1-$2.$3.$4.$5.$6');
            }
        }
    }

    // Inicializa tudo
    inicializarMascarasPartes();
    inicializarMascaraCNJPrincipal();

    // O Django admin adiciona inlines dinamicamente. Precisamos observar essas mudanças.
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Se um novo inline de "Parte" for adicionado, reinicializa as máscaras
                if (mutation.target.querySelector('.dynamic-partes')) {
                    inicializarMascarasPartes();
                }
            }
        });
    });

    const inlinesContainer = document.getElementById('partes-group');
    if (inlinesContainer) {
        observer.observe(inlinesContainer, { childList: true, subtree: true });
    }
});
