(function($) {
    $(document).ready(function() {
        const formatCpfFields = () => {
            $('.info-card-header .parte-documento').each(function() {
                const $cpfElement = $(this);
                const digitsOnly = $cpfElement.text().replace(/\D/g, '').trim();

                if (digitsOnly.length === 11) {
                    const formattedCpf = digitsOnly.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                    $cpfElement.text(formattedCpf);

                    $cpfElement.addClass('cpf-copy-field');
                    $cpfElement.attr('title', 'Clique para copiar o CPF sem formatação');
                    $cpfElement.off('click').on('click', function(e) {
                        e.preventDefault();

                        navigator.clipboard.writeText(digitsOnly).then(function() {
                            const originalText = $cpfElement.text();
                            $cpfElement.text('Copiado!');
                            $cpfElement.addClass('copied');

                            setTimeout(function() {
                                $cpfElement.text(originalText);
                                $cpfElement.removeClass('copied');
                            }, 1500);
                        }, function(err) {
                            console.error('Erro ao copiar CPF: ', err);
                        });
                    });
                }
            });
        };

        const updateHiddenObitoField = ($card, isDead) => {
            const parteId = $card.data('parte-id');
            if (!parteId) {
                return;
            }
            const $idInput = $(`input[name$="-id"][value="${parteId}"]`);
            if (!$idInput.length) {
                return;
            }
            const inputName = $idInput.attr('name');
            const prefix = inputName.replace(/-id$/, '');
            const $obitoInput = $(`input[name="${prefix}-obito"]`);
            if ($obitoInput.length) {
                $obitoInput.val(isDead ? '1' : '0');
            }
        };

        const setDeathState = ($card, isDead) => {
            if (!$card.length) {
                return;
            }

            const $toggle = $card.find('.parte-status-toggle');
            if (!$toggle.length) {
                return;
            }

            if (isDead) {
                $card.addClass('info-card-dead');
                $toggle.text('Óbito');
                $toggle.attr('aria-pressed', 'true');
                $toggle.data('status', 'obito');
            } else {
                $card.removeClass('info-card-dead');
                $toggle.text('Regular');
                $toggle.attr('aria-pressed', 'false');
                $toggle.data('status', 'regular');
            }
            updateHiddenObitoField($card, isDead);
        };

        $('.parte-status-toggle').each(function() {
            const $card = $(this).closest('.info-card');
            const obitoValue = $card.data('obito');
            const isDead = obitoValue === '1' || obitoValue === 1 || obitoValue === true;
            setDeathState($card, Boolean(isDead));
        });

        $('.parte-status-toggle').on('click', function(e) {
            e.preventDefault();
            const $toggle = $(this);
            const $card = $toggle.closest('.info-card');
            const currentlyDead = $card.hasClass('info-card-dead');
            setDeathState($card, !currentlyDead);
        });

        formatCpfFields();
    });
})(django.jQuery);
