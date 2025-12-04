(function($) {
    $(document).ready(function() {
        // Encontra todos os elementos de CPF no card de dados básicos
        $('.info-card-header span:nth-child(2)').each(function() {
            const $cpfElement = $(this);
            const rawCpf = $cpfElement.text().trim();

            // Aplica a formatação apenas se for um CPF (11 dígitos)
            if (rawCpf.length === 11 && /^\d+$/.test(rawCpf)) {
                const formattedCpf = rawCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                $cpfElement.text(formattedCpf);

                // Adiciona a classe e o título para feedback visual
                $cpfElement.addClass('cpf-copy-field');
                $cpfElement.attr('title', 'Clique para copiar o CPF sem formatação');

                // Adiciona o evento de clique
                $cpfElement.on('click', function(e) {
                    e.preventDefault();
                    
                    navigator.clipboard.writeText(rawCpf).then(function() {
                        // Feedback visual de sucesso
                        const originalText = $cpfElement.text();
                        $cpfElement.text('Copiado!');
                        $cpfElement.addClass('copied');
                        
                        setTimeout(function() {
                            $cpfElement.text(originalText);
                            $cpfElement.removeClass('copied');
                        }, 1500); // Volta ao texto original após 1.5 segundos
                    }, function(err) {
                        console.error('Erro ao copiar CPF: ', err);
                    });
                });
            }
        });
    });
})(django.jQuery);
