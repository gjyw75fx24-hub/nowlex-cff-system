(function($) {
    'use strict';

    // ========================================================================
    // LÓGICA DO WIDGET DE ENDEREÇO
    // ========================================================================
    function initEnderecoWidget(widgetWrapper) {
        const $wrapper = $(widgetWrapper);
        if ($wrapper.data('widgetInitialized')) {
            return;
        }
        console.log('[DEBUG] 1. Inicializando EnderecoWidget para:', widgetWrapper);

        const $hiddenTextarea = $wrapper.find('textarea[name$="-endereco"]');
        const $inputs = $wrapper.find('.endereco-fields-grid input');

        function populateInputs() {
            console.log('[DEBUG] 3. populateInputs - Lendo do textarea:', $hiddenTextarea.val());
            const fullString = $hiddenTextarea.val();
            const out = {A:'',B:'',C:'',D:'',E:'',F:'',G:'',H:''};
            if (fullString) {
                const get = (letra) => (fullString.match(new RegExp(`${letra}:\\s*([\\s\\S]*?)(?=\\s*-\\s*[A-H]:|$)`, 'i')) || [])[1] || '';
                Object.keys(out).forEach(key => out[key] = get(key).trim());
                if (out.G) {
                    out.G = out.G.replace(/CEP:?\\s*/i, '').replace(/\\D/g, '');
                }
            }
            console.log('[DEBUG] 4. populateInputs - Valores a serem aplicados:', out);
            $inputs.each(function() {
                const part = $(this).data('part');
                $(this).val(out[part]);
            });
        }

        function updateTextarea() {
            const parts = ['A','B','C','D','E','F','G','H'].map(field => `${field}: ${$wrapper.find(`input[data-part="${field}"]`).val() || ''}`);
            const newString = parts.join(' - ');
            console.log('[DEBUG] X. updateTextarea - Atualizando textarea com:', newString);
            $hiddenTextarea.val(newString);
        }

        $inputs.on('input', updateTextarea);
        $wrapper.find('input[data-part="G"]').on('input', function(e) {
            let cep = e.target.value.replace(/\D/g, "").substring(0, 8);
            e.target.value = (cep.length > 5) ? cep.replace(/^(\d{5})(\d)/, "$1-$2") : cep;
        });
        
        $wrapper.data('populateFunc', populateInputs);
        populateInputs();
        $wrapper.data('widgetInitialized', true);
    }

    // ========================================================================
    // LÓGICA DO BOTÃO CIA
    // ========================================================================
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    }
    const csrftoken = getCookie('csrftoken');

    function initializeCiaButtons() {
        $('.dynamic-partes_processuais').each(function() {
            const inlineForm = $(this);
            const tipoPoloSelect = inlineForm.find('select[name$="-tipo_polo"]');
            
            const processCiaButton = () => {
                const tipoPolo = tipoPoloSelect.val();
                const addressFieldDiv = inlineForm.find('.field-endereco');
                if (tipoPolo === 'PASSIVO' && addressFieldDiv.length > 0 && addressFieldDiv.find('.cia-button').length === 0) {
                    const formPrefix = tipoPoloSelect.attr('name').replace('-tipo_polo', '');
                    addressFieldDiv.find('label').first().append($(`<button type="button" class="cia-button" data-form-prefix="${formPrefix}" title="Clique e preencha automaticamente o endereço">CIA</button>`));
                } else {
                    addressFieldDiv.find('.cia-button').remove();
                }
            };
            processCiaButton();
            tipoPoloSelect.on('change', processCiaButton);
        });
    }

    function autoFillAddress(prefix, button) {
        const cpf = $(`#id_${prefix}-documento`).val().replace(/\D/g, '');
        if (!cpf) return alert('O campo "Documento" desta parte está vazio.');
        button.text('Buscando...').prop('disabled', true);
        fetch(`/api/fetch-address/${cpf}/`)
            .then(response => response.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                const textarea = $(`#id_${prefix}-endereco`);
                textarea.val(data.endereco_formatado);
                const widgetWrapper = textarea.closest('.endereco-widget-wrapper');
                const populateFunc = widgetWrapper.data('populateFunc');
                if (populateFunc) {
                    populateFunc();
                }
                if (typeof showCffSystemDialog === 'function') {
                    showCffSystemDialog('Endereço preenchido com sucesso!', 'success');
                } else {
                    alert('Endereço preenchido com sucesso!');
                }
            })
            .catch(error => alert(`Erro: ${error.message}`))
            .finally(() => {
                button.text('CIA').prop('disabled', false);
            });
    }

    // --- PONTO DE ENTRADA ---
    $(document).ready(function() {
        function initializeAll() {
            $('.endereco-widget-wrapper').each(function() { initEnderecoWidget(this); });
            initializeCiaButtons();
        }
        initializeAll();
        $(document).on('formset:added', (event, $row, formsetName) => {
            if (formsetName === 'partes_processuais') initializeAll();
        });
        $(document).on('click', '.cia-button', function(e) {
            e.preventDefault();
            const btn = $(this);
            const prefix = btn.data('form-prefix');
            autoFillAddress(prefix, btn);
        });
    });

})(django.jQuery);
