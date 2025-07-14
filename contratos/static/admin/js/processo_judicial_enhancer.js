// contratos/static/admin/js/processo_judicial_enhancer.js

document.addEventListener('DOMContentLoaded', () => {
    // ====================================================================
    // 1. LÓGICA DO BOTÃO
    // ====================================================================
    const btn = document.getElementById('btn_preencher_uf');
    if (btn) {
        btn.addEventListener('click', () => {
            const cnjInput = document.getElementById('id_cnj');
            const ufInput = document.getElementById('id_uf');
            const tribunalInput = document.getElementById('id_tribunal');
            const mapaUF = {"8.01":"AC","8.02":"AL","8.03":"AP","8.04":"AM","8.05":"BA","8.06":"CE","8.07":"DF","8.08":"ES","8.09":"GO","8.10":"MA","8.11":"MT","8.12":"MS","8.13":"MG","8.14":"PA","8.15":"PB","8.16":"PR","8.17":"PE","8.18":"PI","8.19":"RJ","8.20":"RN","8.21":"RS","8.22":"RO","8.23":"RR","8.24":"SC","8.25":"SE","8.26":"SP","8.27":"TO"};
            const mapaTribunal = {"8.01":"TJAC","8.02":"TJAL","8.03":"TJAP","8.04":"TJAM","8.05":"TJBA","8.06":"TJCE","8.07":"TJDFT","8.08":"TJES","8.09":"TJGO","8.10":"TJMA","8.11":"TJMT","8.12":"TJMS","8.13":"TJMG","8.14":"TJPA","8.15":"TJPB","8.16":"TJPR","8.17":"TJPE","8.18":"TJPI","8.19":"TJRJ","8.20":"TJRN","8.21":"TJRS","8.22":"TJRO","8.23":"TJRR","8.24":"TJSC","8.25":"TJSE","8.26":"TJSP","8.27":"TJTO"};
            let valor = cnjInput.value || "";
            let codUF = null;
            if (valor.includes(".")) {
                const partes = valor.split(".");
                if (partes.length >= 4) codUF = `${partes[2]}.${partes[3]}`;
            } else {
                const cnjLimpo = valor.replace(/\D/g, '');
                if (/^\d{20}$/.test(cnjLimpo)) {
                    const J = cnjLimpo.substr(13, 1);
                    const TR = cnjLimpo.substr(14, 2);
                    codUF = `${J}.${TR}`;
                }
            }
            if (codUF && mapaUF[codUF]) {
                ufInput.value = mapaUF[codUF];
                tribunalInput.value = mapaTribunal[codUF];
            } else {
                alert("Não foi possível extrair a UF a partir do CNJ informado. Verifique o número.");
            }
        });
    }

    // ====================================================================
    // 2. LÓGICA DAS MÁSCARAS
    // ====================================================================
    const cnjPrincipalInput = document.getElementById('id_cnj');
    if (cnjPrincipalInput) {
        cnjPrincipalInput.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '').substring(0, 20);
            if (v.length >= 17) v = v.replace(/(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})(\d{4})/, '$1-$2.$3.$4.$5.$6');
            else if (v.length >= 15) v = v.replace(/(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})/, '$1-$2.$3.$4.$5');
            else if (v.length >= 14) v = v.replace(/(\d{7})(\d{2})(\d{4})(\d{1})/, '$1-$2.$3.$4');
            else if (v.length >= 10) v = v.replace(/(\d{7})(\d{2})(\d{4})/, '$1-$2.$3');
            else if (v.length >= 8) v = v.replace(/(\d{7})(\d{2})/, '$1-$2');
            e.target.value = v;
        });
    }

    function aplicarMascaraParte(docInput, tipoSelect) {
        const mascaraHandler = () => {
            const isPJ = tipoSelect.value === 'PJ';
            let v = docInput.value.replace(/\D/g, '');
            if (isPJ) {
                v = v.substring(0, 14);
                if (v.length >= 13) v = v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
                else if (v.length >= 9) v = v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})/, '$1.$2.$3/$4');
                else if (v.length >= 6) v = v.replace(/(\d{2})(\d{3})(\d{3})/, '$1.$2.$3');
                else if (v.length >= 3) v = v.replace(/(\d{2})(\d{3})/, '$1.$2');
            } else {
                v = v.substring(0, 11);
                if (v.length >= 10) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                else if (v.length >= 7) v = v.replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3');
                else if (v.length >= 4) v = v.replace(/(\d{3})(\d{3})/, '$1.$2');
            }
            docInput.value = v;
        };
        docInput.addEventListener('input', mascaraHandler);
        tipoSelect.addEventListener('change', mascaraHandler);
        mascaraHandler();
    }

    function configurarInlines() {
        document.querySelectorAll('.dynamic-contratos-parte:not([data-mascara-configurada])').forEach(inline => {
            const tipoSelect = inline.querySelector('select[name$="-tipo_pessoa"]');
            const docInput = inline.querySelector('input[name$="-documento"]');
            if (tipoSelect && docInput) {
                aplicarMascaraParte(docInput, tipoSelect);
                inline.setAttribute('data-mascara-configurada', 'true');
            }
        });
    }

    configurarInlines();
    document.body.addEventListener('formset:added', (event) => {
        if (event.target.classList.contains('dynamic-contratos-parte')) {
            configurarInlines();
        }
    });
});
