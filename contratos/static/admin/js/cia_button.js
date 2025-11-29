(function($) {
    'use strict';

    // Helpers
    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    function extrairCamposAH(s) {
        const out = {A:'',B:'',C:'',D:'',E:'',F:'',G:'',H:''};
        if (!s) return out;
        function get(letra) {
            const re = new RegExp(`${letra}:\\s*([\\s\\S]*?)(?=\\s*-\\s*[A-H]:|$)`, 'i');
            const m = s.match(re);
            return m ? m[1].trim() : '';
        }
        Object.keys(out).forEach(key => out[key] = get(key));
        return out;
    }

    const csrftoken = getCookie('csrftoken');

    // Função principal que inicia tudo
    function initializeCiaButtons() {
        // Encontra cada formulário inline de "Partes"
        $('.dynamic-partes_processuais').each(function() {
            const inlineForm = $(this);
            const tipoPoloSelect = inlineForm.find('select[name$="-tipo_polo"]');
            
            const processInline = () => {
                const tipoPolo = tipoPoloSelect.val();
                const addressRow = inlineForm.find('.field-endereco');
                const existingButton = addressRow.find('.cia-button');

                // Se for "Polo Passivo", adiciona o botão (se não existir)
                if (tipoPolo === 'PASSIVO') {
                    if (addressRow.length > 0 && existingButton.length === 0) {
                        const formPrefix = tipoPoloSelect.attr('name').replace('-tipo_polo', '');
                        const ciaButton = $(`<button type="button" class="cia-button" data-form-prefix="${formPrefix}">CIA</button>`);
                        addressRow.find('label').append(ciaButton);
                    }
                } 
                // Se não for "Polo Passivo", remove o botão (se existir)
                else {
                    if (existingButton.length > 0) {
                        existingButton.remove();
                    }
                }
            };

            // Executa a lógica na carga da página e quando o select muda
            processInline();
            tipoPoloSelect.on('change', processInline);
        });
    }

    // --- Criação dos Modais (uma vez por página) ---
    function createModals() {
        if ($('#cia-choice-modal').length > 0) return; // Só cria se não existirem

        const choiceModal = $(`
            <div class="cia-modal-backdrop" id="cia-choice-modal">
                <div class="cia-modal-content">
                    <h3>Controle Inteligente Automatizado (CIA)</h3>
                    <p>Como deseja preencher o endereço desta parte?</p>
                    <div class="cia-modal-footer">
                        <button type="button" class="cia-btn cia-btn-primary" id="cia-auto-fill">Preenchimento Automático (API)</button>
                        <button type="button" class="cia-btn cia-btn-secondary" id="cia-manual-form">Formulário Manual</button>
                    </div>
                </div>
            </div>
        `).appendTo('body');

        const formModal = $(`
            <div class="cia-modal-backdrop" id="cia-form-modal">
                <div class="cia-modal-content">
                    <h3>Preenchimento Manual do Endereço</h3>
                    <form id="cia-address-form">
                        <div class="cia-form-group"><label for="cia-A">A (Rua ou Av):</label><input type="text" id="cia-A" name="A"></div>
                        <div class="cia-form-group"><label for="cia-B">B (Número):</label><input type="text" id="cia-B" name="B"></div>
                        <div class="cia-form-group"><label for="cia-C">C (Complemento):</label><input type="text" id="cia-C" name="C"></div>
                        <div class="cia-form-group"><label for="cia-D">D (Bairro):</label><input type="text" id="cia-D" name="D"></div>
                        <div class="cia-form-group"><label for="cia-E">E (Cidade):</label><input type="text" id="cia-E" name="E"></div>
                        <div class="cia-form-group"><label for="cia-F">F (Estado):</label><input type="text" id="cia-F" name="F"></div>
                        <div class="cia-form-group"><label for="cia-G">G (CEP):</label><input type="text" id="cia-G" name="G" maxlength="9"></div>
                        <div class="cia-form-group"><label for="cia-H">H (UF):</label><input type="text" id="cia-H" name="H" maxlength="2"></div>
                    </form>
                    <div class="cia-modal-footer">
                        <button type="button" class="cia-btn cia-btn-primary" id="cia-save-manual">Salvar e Replicar</button>
                    </div>
                </div>
            </div>
        `).appendTo('body');
        
        // Evento para fechar modal clicando no fundo
        $('.cia-modal-backdrop').on('click', function(e) {
            if ($(e.target).is('.cia-modal-backdrop')) {
                $(this).hide();
            }
        });
        
        // Máscara de CEP
        formModal.find('#cia-G').on('input', function(e) {
            let cep = e.target.value.replace(/\D/g, "").substring(0, 8);
            if (cep.length > 5) {
                cep = cep.replace(/^(\d{5})(\d)/, "$1-$2");
            }
            e.target.value = cep;
        });
    }

    // --- Lógica de Eventos dos Modais ---
    function bindModalEvents() {
        // Abrir modal de escolha
        $(document).on('click', '.cia-button', function(e) {
            e.preventDefault();
            const prefix = $(this).data('form-prefix');
            $('#cia-choice-modal').data('active-prefix', prefix).css('display', 'flex');
        });

        // Ação: Preenchimento automático
        $('#cia-auto-fill').on('click', function() {
            const prefix = $('#cia-choice-modal').data('active-prefix');
            const docField = $(`#id_${prefix}-documento`);
            const cpf = docField.val().replace(/\D/g, '');

            if (!cpf) {
                alert('O campo "Documento" desta parte está vazio.');
                return;
            }

            $(this).text('Buscando...').prop('disabled', true);

            fetch(`/api/contratos/fetch-address/${cpf}/`)
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        alert('Erro: ' + data.error);
                    } else {
                        $(`#id_${prefix}-endereco`).val(data.endereco_formatado);
                        alert('Endereço preenchido com sucesso!');
                    }
                })
                .catch(error => alert('Ocorreu um erro de rede.'))
                .finally(() => {
                    $('#cia-auto-fill').text('Preenchimento Automático (API)').prop('disabled', false);
                    $('#cia-choice-modal').hide();
                });
        });

        // Ação: Abrir formulário manual
        $('#cia-manual-form').on('click', function() {
            const prefix = $('#cia-choice-modal').data('active-prefix');
            $('#cia-form-modal').data('active-prefix', prefix);

            const currentEndereco = $(`#id_${prefix}-endereco`).val();
            const campos = extrairCamposAH(currentEndereco);
            Object.keys(campos).forEach(key => $(`#cia-${key}`).val(campos[key]));
            
            $('#cia-choice-modal').hide();
            $('#cia-form-modal').css('display', 'flex');
        });

        // Ação: Salvar formulário manual
        $('#cia-save-manual').on('click', function() {
            const prefix = $('#cia-form-modal').data('active-prefix');
            const docField = $(`#id_${prefix}-documento`);
            const cpf = docField.val().replace(/\D/g, '');

            if (!cpf) {
                alert('O campo "Documento" desta parte é necessário para salvar e replicar.');
                return;
            }

            const formData = new FormData($('#cia-address-form')[0]);
            const data = Object.fromEntries(formData.entries());
            data.cpf = cpf;

            $(this).text('Salvando...').prop('disabled', true);

            fetch(`/api/contratos/save-manual-address/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(result => {
                if (result.error) {
                    alert('Erro: ' + result.error);
                } else {
                    // Atualiza o endereço em TODAS as partes visíveis na página com o mesmo CPF
                    $('.dynamic-partes_processuais').each(function() {
                        const form = $(this);
                        const currentDoc = form.find('input[name$="-documento"]').val().replace(/\D/g, '');
                        if (currentDoc === cpf) {
                            form.find('textarea[name$="-endereco"]').val(result.endereco_formatado);
                        }
                    });
                    alert(result.message);
                }
            })
            .catch(error => alert('Ocorreu um erro de rede ao salvar.'))
            .finally(() => {
                $('#cia-save-manual').text('Salvar e Replicar').prop('disabled', false);
                $('#cia-form-modal').hide();
            });
        });
    }

    // --- Ponto de Entrada ---
    $(document).ready(function() {
        createModals();
        bindModalEvents();
        initializeCiaButtons();

        // Lida com novos inlines adicionados dinamicamente pelo Django
        $(document).on('formset:added', function(event, $row, formsetName) {
            if (formsetName === 'partes_processuais') {
                initializeCiaButtons();
            }
        });
    });

})(django.jQuery);