(function($) {
    $(document).ready(function() {
        const $analiseInline = $('.analise-procedural-group');
        if (!$analiseInline.length) {
            return; // Sai se o inline de análise não estiver na página
        }

        const $responseField = $analiseInline.find('textarea[name$="-respostas"]');
        if (!$responseField.length) {
            return;
        }

        let userResponses = {};

        // --- Funções ---

        function loadResponses() {
            try {
                const data = $responseField.val();
                userResponses = data ? JSON.parse(data) : {};
                // Garante que a estrutura de dados para o status dos contratos exista
                if (!userResponses.contratos_status) {
                    userResponses.contratos_status = {};
                }
            } catch (e) {
                console.error('Erro ao carregar respostas da análise:', e);
                userResponses = { contratos_status: {} };
            }
        }

        function saveResponses() {
            $responseField.val(JSON.stringify(userResponses, null, 2));
        }

        function updateContratoStatus(contratoId, statusKey, value) {
            if (!userResponses.contratos_status[contratoId]) {
                userResponses.contratos_status[contratoId] = {};
            }
            userResponses.contratos_status[contratoId][statusKey] = value;
            saveResponses();
        }

        function updateUIFromState() {
            $('.contrato-item-wrapper').each(function() {
                const $wrapper = $(this);
                const contratoId = $wrapper.data('contrato-id');
                const status = userResponses.contratos_status[contratoId];

                if (status) {
                    // Atualiza o checkbox de seleção
                    $wrapper.find('.contrato-selector').prop('checked', status.selecionado || false);
                    
                    // Atualiza o botão 'Quitado'
                    const $toggle = $wrapper.find('.contrato-quitado-toggle');
                    if (status.quitado) {
                        $toggle.addClass('active');
                    } else {
                        $toggle.removeClass('active');
                    }
                }
            });
        }

        // --- Event Handlers ---

        $('.contrato-selector').on('change', function() {
            const $checkbox = $(this);
            const contratoId = $checkbox.val();
            const isSelected = $checkbox.is(':checked');
            updateContratoStatus(contratoId, 'selecionado', isSelected);
            $(document).trigger('contratoStatusChange'); // Notifica outros scripts
        });

        $('.contrato-quitado-toggle').on('click', function() {
            const $toggle = $(this);
            const contratoId = $toggle.closest('.contrato-item-wrapper').data('contrato-id');
            const isActive = $toggle.hasClass('active');
            
            // Inverte o estado
            const newState = !isActive;
            $toggle.toggleClass('active', newState);
            updateContratoStatus(contratoId, 'quitado', newState);
            $(document).trigger('contratoStatusChange'); // Notifica outros scripts
        });

        // --- Inicialização ---

        loadResponses();
        updateUIFromState();

    });
})(django.jQuery);
