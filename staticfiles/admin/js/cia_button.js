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
                    addressFieldDiv.find('label').first().append($(`<button type="button" class="cia-button" data-form-prefix="${formPrefix}">CIA</button>`));
                } else {
                    addressFieldDiv.find('.cia-button').remove();
                }
            };
            processCiaButton();
            tipoPoloSelect.on('change', processCiaButton);
        });
    }

    function setupModals() {
        if ($('#cia-choice-modal').length > 0) return;
        $('body').append(`
            <div class="cia-modal-backdrop" id="cia-choice-modal">
                <div class="cia-modal-content">
                    <h3>Controle Inteligente Automatizado (CIA)</h3><p>Como deseja preencher o endereço desta parte?</p>
                    <div class="cia-modal-footer"><button type="button" class="cia-btn cia-btn-primary" id="cia-auto-fill">Automático (API)</button><button type="button" class="cia-btn cia-btn-secondary" id="cia-manual-form">Manual</button></div>
                </div>
            </div>
            <div class="cia-modal-backdrop" id="cia-form-modal">
                <div class="cia-modal-content">
                    <h3>Preenchimento Manual</h3>
                    <form id="cia-address-form">${['A (Rua ou Av)','B (Número)','C (Complemento)','D (Bairro)','E (Cidade)','F (Estado)','G (CEP)','H (UF)'].map(label => `<div class="cia-form-group"><label for="cia-${label[0]}">${label}:</label><input type="text" id="cia-${label[0]}" name="${label[0]}"></div>`).join('')}</form>
                    <div class="cia-modal-footer"><button type="button" class="cia-btn cia-btn-primary" id="cia-save-manual">Salvar e Replicar</button></div>
                </div>
            </div>`);

        $(document).on('click', '.cia-button', function(e) {
            e.preventDefault();
            $('#cia-choice-modal').data('active-prefix', $(this).data('form-prefix')).css('display', 'flex');
        });
        
        $('.cia-modal-backdrop').on('click', function(e) { if ($(e.target).is(this)) $(this).hide(); });

        $('#cia-auto-fill').on('click', function() {
            const btn = $(this);
            const prefix = $('#cia-choice-modal').data('active-prefix');
            const cpf = $(`#id_${prefix}-documento`).val().replace(/\D/g, '');
            if (!cpf) return alert('O campo "Documento" desta parte está vazio.');
            
            btn.text('Buscando...').prop('disabled', true);
            fetch(`/api/fetch-address/${cpf}/`)
                .then(response => response.json())
                .then(data => {
                    console.log('[DEBUG] 2. API retornou com sucesso. Dados:', data);
                    if (data.error) throw new Error(data.error);
                    
                    const textarea = $(`#id_${prefix}-endereco`);
                    textarea.val(data.endereco_formatado);
                    
                    console.log('[DEBUG] 2a. Tentando chamar a função de popular.');
                    const widgetWrapper = textarea.closest('.endereco-widget-wrapper');
                    const populateFunc = widgetWrapper.data('populateFunc');

                    if (populateFunc) {
                        populateFunc();
                    } else {
                        console.error('[DEBUG] ERRO: populateFunc não encontrada no .data() do widget!');
                    }
                    
                    alert('Endereço preenchido com sucesso!');
                })
                .catch(error => alert(`Erro: ${error.message}`))
                .finally(() => {
                    btn.text('Automático (API)').prop('disabled', false);
                    $('#cia-choice-modal').hide();
                });
        });

        $('#cia-manual-form').on('click', function() {
            const prefix = $('#cia-choice-modal').data('active-prefix');
            $('#cia-form-modal').data('active-prefix', prefix);
            const currentEndereco = $(`#id_${prefix}-endereco`).val();
            const get = (letra) => (currentEndereco.match(new RegExp(`${letra}:\\s*([\\s\\S]*?)(?=\\s*-\\s*[A-H]:|$)`, 'i')) || [])[1] || '';
            ['A','B','C','D','E','F','G','H'].forEach(k => $(`#cia-${k}`).val(get(k).trim()));
            $('#cia-choice-modal').hide();
            $('#cia-form-modal').css('display', 'flex');
        });

        $('#cia-save-manual').on('click', function() {
            const btn = $(this);
            const prefix = $('#cia-form-modal').data('active-prefix');
            const cpf = $(`#id_${prefix}-documento`).val().replace(/\D/g, '');
            if (!cpf) return alert('O "Documento" é necessário para salvar e replicar.');
            
            const formData = new FormData($('#cia-address-form')[0]);
            const data = Object.fromEntries(formData.entries());
            data.cpf = cpf;
            
            btn.text('Salvando...').prop('disabled', true);
            fetch(`/api/save-manual-address/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(result => {
                if (result.error) throw new Error(result.error);
                $('.dynamic-partes_processuais').each(function() {
                    const form = $(this);
                    if (form.find('input[name$="-documento"]').val().replace(/\D/g, '') === cpf) {
                        const textarea = form.find('textarea[name$="-endereco"]');
                        textarea.val(result.endereco_formatado);

                        console.log('[DEBUG] Save - Tentando chamar a função de popular para:', textarea);
                        const widgetWrapper = textarea.closest('.endereco-widget-wrapper');
                        const populateFunc = widgetWrapper.data('populateFunc');
                        if (populateFunc) {
                            populateFunc();
                        } else {
                            console.error('[DEBUG] ERRO: populateFunc não encontrada no .data() do widget ao salvar!');
                        }
                    }
                });
                alert(result.message);
            })
            .catch(error => alert(`Erro: ${error.message}`))
            .finally(() => {
                btn.text('Salvar e Replicar').prop('disabled', false);
                $('#cia-form-modal').hide();
            });
        });
    }

    // --- PONTO DE ENTRADA ---
    $(document).ready(function() {
        setupModals();
        function initializeAll() {
            $('.endereco-widget-wrapper').each(function() { initEnderecoWidget(this); });
            initializeCiaButtons();
        }
        initializeAll();
        $(document).on('formset:added', (event, $row, formsetName) => {
            if (formsetName === 'partes_processuais') initializeAll();
        });
    });

})(django.jQuery);
