// contratos/static/contratos/cnj_autofill.js

// Garante que o código só rode depois que a página estiver totalmente carregada
window.addEventListener("load", function() {
    (function($) {
        // Mapeamentos (os mesmos do models.py)
        const mapaUf = {
            "8.01": "AC", "8.02": "AL", "8.03": "AP", "8.04": "AM", "8.05": "BA",
            "8.06": "CE", "8.07": "DF", "8.08": "ES", "8.09": "GO", "8.10": "MA",
            "8.11": "MT", "8.12": "MS", "8.13": "MG", "8.14": "PA", "8.15": "PB",
            "8.16": "PR", "8.17": "PE", "8.18": "PI", "8.19": "RJ", "8.20": "RN",
            "8.21": "RS", "8.22": "RO", "8.23": "RR", "8.24": "SC", "8.25": "SE",
            "8.26": "SP", "8.27": "TO"
        };
        const mapaTribunal = {
            "8.01": "TJAC", "8.02": "TJAL", "8.03": "TJAP", "8.04": "TJAM", "8.05": "TJBA",
            "8.06": "TJCE", "8.07": "TJDFT", "8.08": "TJES", "8.09": "TJGO", "8.10": "TJMA",
            "8.11": "TJMT", "8.12": "TJMS", "8.13": "TJMG", "8.14": "TJPA", "8.15": "TJPB",
            "8.16": "TJPR", "8.17": "TJPE", "8.18": "TJPI", "8.19": "TJRJ", "8.20": "TJRN",
            "8.21": "TJRS", "8.22": "TJRO", "8.23": "TJRR", "8.24": "TJSC", "8.25": "TJSE",
            "8.26": "TJSP", "8.27": "TJTO"
        };

        // Função para extrair dados e preencher os campos
        function preencherCampos() {
            const cnjInput = $("#id_cnj").val();
            const cnjLimpo = (cnjInput || "").replace(/\D/g, ''); // Remove tudo que não for dígito

            let codUf = null;
            if (cnjLimpo.length === 20) {
                const j = cnjLimpo.substring(13, 14);
                const tr = cnjLimpo.substring(14, 16);
                codUf = `${j}.${tr}`;
            }

            const uf = codUf ? mapaUf[codUf] || "" : "";
            const tribunal = codUf ? mapaTribunal[codUf] || "" : "";

            // Preenche os campos na tela
            // O campo UF é um div, então usamos .text()
            $(".field-uf_calculada .readonly").text(uf);
            // O campo Tribunal é um input, então usamos .val()
            $("#id_tribunal").val(tribunal);
        }

        // Adiciona um "ouvinte" ao campo CNJ.
        // A função preencherCampos será chamada toda vez que você digitar algo.
        $("#id_cnj").on("input", preencherCampos);

        // Adiciona um "ouvinte" para a tecla Enter no campo CNJ
        $("#id_cnj").on("keydown", function(event) {
            if (event.key === "Enter") {
                // Impede a submissão do formulário
                event.preventDefault();
            }
        });

        // Roda a função uma vez no carregamento da página, caso o campo já esteja preenchido
        preencherCampos();

    })(django.jQuery);
});
