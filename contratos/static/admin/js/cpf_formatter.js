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
        };

        $('.parte-status-toggle').each(function() {
            const $card = $(this).closest('.info-card');
            setDeathState($card, false);
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
