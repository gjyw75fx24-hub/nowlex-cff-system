(function($) {
    'use strict';

    function initEnderecoWidget(widgetWrapper) {
        const $wrapper = $(widgetWrapper);
        const $hiddenTextarea = $wrapper.find('textarea[name$="-endereco"]');
        const $inputs = $wrapper.find('.endereco-fields-grid input');

        // Função para parsear a string e preencher os inputs
        function populateInputs() {
            const fullString = $hiddenTextarea.val();
            const out = {A:'',B:'',C:'',D:'',E:'',F:'',G:'',H:''};
            if (fullString) {
                function get(letra) {
                    const re = new RegExp(`${letra}:\s*([\s\S]*?)(?=\s*-\s*[A-H]:|$)`, 'i');
                    const m = fullString.match(re);
                    return m ? m[1].trim() : '';
                }
                Object.keys(out).forEach(key => out[key] = get(key));
            }
            
            $inputs.each(function() {
                const part = $(this).data('part');
                $(this).val(out[part]);
            });
        }

        // Função para ler os inputs e atualizar o textarea escondido
        function updateTextarea() {
            const parts = [];
            const fields = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
            
            fields.forEach(field => {
                const value = $wrapper.find(`input[data-part="${field}"]`).val() || '';
                parts.push(`${field}: ${value}`);
            });

            $hiddenTextarea.val(parts.join(' - '));
        }

        // --- Eventos ---
        $inputs.on('input', updateTextarea);
        
        $wrapper.find('input[data-part="G"]').on('input', function(e) {
            let cep = e.target.value.replace(/\D/g, "").substring(0, 8);
            if (cep.length > 5) {
                cep = cep.replace(/^(\d{5})(\d)/, "$1-$2");
            }
            e.target.value = cep;
        });

        // Preenche os inputs na inicialização
        populateInputs();

        // Expõe a API do widget para ser chamada externamente
        $wrapper.data('widgetApi', {
            populate: populateInputs
        });
    }

    $(document).ready(function() {
        // Inicializa para widgets já existentes na página
        $('.endereco-widget-wrapper').each(function() {
            if (!this.initialized) {
                initEnderecoWidget(this);
                this.initialized = true;
            }
        });

        // Inicializa para novos inlines adicionados dinamicamente
        $(document).on('formset:added', function(event, $row, formsetName) {
            if (formsetName === 'partes_processuais') {
                const widgetWrapper = $row.find('.endereco-widget-wrapper');
                if (widgetWrapper.length > 0) {
                    initEnderecoWidget(widgetWrapper[0]);
                }
            }
        });
    });

})(django.jQuery);
