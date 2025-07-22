document.addEventListener('DOMContentLoaded', function() {

    // --- Seletores Globais ---
    const form = document.getElementById('processojudicial_form');
    const cnjInput = document.getElementById('id_cnj');
    const ufInput = document.getElementById('id_uf');
    const tribunalInput = document.getElementById('id_tribunal');
    const varaInput = document.getElementById('id_vara');
    const valorCausaInput = document.getElementById('id_valor_causa');
    const statusSelect = document.getElementById('id_status');

    // --- 1. Criação do Botão "Dados Online" ---
    // O botão é criado aqui para garantir a posição desejada, ao lado do campo CNJ.
    if (cnjInput && !document.getElementById('btn_buscar_cnj')) {
        const searchButton = document.createElement('button');
        searchButton.id = 'btn_buscar_cnj';
        searchButton.type = 'button';
        searchButton.className = 'button';
        searchButton.innerText = '📄 Dados Online';
        searchButton.style.marginLeft = '10px';
        cnjInput.parentNode.appendChild(searchButton);

        const feedbackDiv = document.createElement('div');
        feedbackDiv.id = 'cnj_feedback';
        feedbackDiv.style.marginTop = '5px';
        feedbackDiv.style.fontWeight = 'bold';
        cnjInput.parentNode.parentNode.appendChild(feedbackDiv);
    }
    
    // Agora que o botão foi criado, podemos selecioná-lo
    const searchButton = document.getElementById('btn_buscar_cnj');
    const cnjFeedback = document.getElementById('cnj_feedback');


    // --- 2. Prevenção de Envio com Enter ---
    if (form) {
        form.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
                event.preventDefault();
            }
        });
    }

    // --- 3. Lógica do Botão "Preencher UF" ---
    if (ufInput && !document.getElementById("btn_preencher_uf")) {
        const botao = document.createElement("button");
        botao.id = "btn_preencher_uf";
        botao.type = "button";
        botao.innerText = "Preencher UF";
        botao.className = "button";
        botao.style.marginLeft = "10px";

        botao.onclick = function () {
            if (!cnjInput.value) {
                alert("Por favor, insira um número de CNJ.");
                return;
            }
            
            const valorLimpo = cnjInput.value.replace(/[^\d]/g, "");
            let codUF = null;

            if (valorLimpo.length >= 20) {
                const j = valorLimpo.substring(13, 14);
                const tr = valorLimpo.substring(14, 16);
                codUF = `${j}.${tr}`;
            }

            const mapaUF = {
                "8.01": "AC", "8.02": "AL", "8.03": "AP", "8.04": "AM", "8.05": "BA",
                "8.06": "CE", "8.07": "DF", "8.08": "ES", "8.09": "GO", "8.10": "MA",
                "8.11": "MT", "8.12": "MS", "8.13": "MG", "8.14": "PA", "8.15": "PB",
                "8.16": "PR", "8.17": "PE", "8.18": "PI", "8.19": "RJ", "8.20": "RN",
                "8.21": "RS", "8.22": "RO", "8.23": "RR", "8.24": "SC", "8.25": "SE",
                "8.26": "SP", "8.27": "TO"
            };

            const uf = mapaUF[codUF];
            if (uf) {
                ufInput.value = uf;
                if (tribunalInput) tribunalInput.value = "TJ" + uf;
            } else {
                alert("Não foi possível extrair a UF a partir do CNJ informado. Verifique se o número possui 20 dígitos.");
            }
        };
        ufInput.parentNode.insertBefore(botao, ufInput.nextSibling);
    }

    // --- 4. Lógica do Botão de Busca Online ---
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
    const csrftoken = getCookie('csrftoken');

    if (cnjInput && searchButton) {
        const toggleButtonState = () => {
            const cnjLimpo = cnjInput.value.replace(/\D/g, '');
            searchButton.disabled = cnjLimpo.length < 10;
        };
        toggleButtonState(); 
        cnjInput.addEventListener('input', toggleButtonState);

        searchButton.addEventListener('click', function() {
            const cnj = cnjInput.value.trim();
            if (!cnj) {
                setFeedback('Por favor, insira um número de CNJ.', 'error');
                return;
            }

            const url = '/api/contratos/buscar-dados-escavador/'; // URL está fixa aqui
            setFeedback('Buscando dados online...', 'loading');

            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': csrftoken,
                },
                body: `cnj=${encodeURIComponent(cnj)}`
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => {
                        throw new Error(err.message || `Erro ${response.status}: ${response.statusText}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'success') {
                    setFeedback(data.message, 'success');
                    fillFormFields(data.processo, data.partes, data.andamentos); 
                } else {
                    throw new Error(data.message);
                }
            })
            .catch(error => {
                console.error('Erro na requisição:', error);
                setFeedback(error.message || 'Ocorreu um erro inesperado.', 'error');
            });
        });
    }

    function setFeedback(message, type) {
        if (cnjFeedback) {
            cnjFeedback.textContent = message;
            cnjFeedback.style.color = type === 'success' ? 'green' : (type === 'error' ? 'red' : 'orange');
        }
    }

    function fillFormFields(processo, partes, andamentos) {
        if (varaInput) varaInput.value = processo.vara || '';
        if (tribunalInput) tribunalInput.value = processo.tribunal || '';
        
        // Formata o valor da causa para o padrão brasileiro (vírgula como decimal)
        if (valorCausaInput && processo.valor_causa) {
            valorCausaInput.value = processo.valor_causa.replace('.', ',');
        } else if (valorCausaInput) {
            valorCausaInput.value = '0,00';
        }

        if (ufInput && !ufInput.value) ufInput.value = processo.uf || '';

        // --- Lógica Aprimorada para o Status Processual ---
        const statusId = processo.status_id;
        const statusNome = processo.status_nome;

        if (statusSelect && statusId && statusNome) {
            let optionExists = Array.from(statusSelect.options).some(opt => opt.value == statusId);
            if (!optionExists) {
                const newOption = new Option(statusNome, statusId, true, true);
                statusSelect.appendChild(newOption);
            }
            statusSelect.value = statusId;
        }
        // --- Fim da Lógica do Status ---

        if (partes && partes.length > 0) {
            const addParteButton = document.querySelector('#partes_processuais-group .add-row a');
            const totalPartesForms = document.querySelectorAll('.dynamic-partes_processuais').length;

            for (let i = totalPartesForms; i < partes.length; i++) {
                if (addParteButton) addParteButton.click();
            }

            document.querySelectorAll('.dynamic-partes_processuais').forEach((inline, i) => {
                if (i < partes.length) {
                    const parte = partes[i];
                    const prefix = `id_partes_processuais-${i}-`;
                    const tipoPoloSelect = inline.querySelector(`#${prefix}tipo_polo`);
                    const nomeInput = inline.querySelector(`#${prefix}nome`);
                    const tipoPessoaSelect = inline.querySelector(`#${prefix}tipo_pessoa`);
                    const documentoInput = inline.querySelector(`#${prefix}documento`);
                    const enderecoInput = inline.querySelector(`#${prefix}endereco`);

                    if (tipoPoloSelect) tipoPoloSelect.value = parte.tipo_polo;
                    if (nomeInput) nomeInput.value = parte.nome;
                    if (tipoPessoaSelect) tipoPessoaSelect.value = parte.tipo_pessoa;
                    if (documentoInput) {
                        documentoInput.value = parte.documento;
                        documentoInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    if (enderecoInput) enderecoInput.value = parte.endereco || '';

                    const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                    if (deleteCheckbox) deleteCheckbox.checked = false;
                }
            });
        }

        if (andamentos && andamentos.length > 0) {
            const addAndamentoButton = document.querySelector('#andamentos-group .add-row a');
            const totalAndamentosForms = document.querySelectorAll('.dynamic-andamentos').length;

            for (let i = totalAndamentosForms; i < andamentos.length; i++) {
                if (addAndamentoButton) addAndamentoButton.click();
            }

            document.querySelectorAll('.dynamic-andamentos').forEach((inline, i) => {
                if (i < andamentos.length) {
                    const andamento = andamentos[i];
                    const prefix = `id_andamentos-${i}-`;
                    const dataInput = inline.querySelector(`#${prefix}data_0`);
                    const horaInput = inline.querySelector(`#${prefix}data_1`);
                    const descricaoInput = inline.querySelector(`#${prefix}descricao`);

                    if (dataInput && horaInput && andamento.data) {
                        const dateTime = new Date(andamento.data);
                        dataInput.value = dateTime.toLocaleDateString('pt-BR');
                        horaInput.value = dateTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    }
                    if (descricaoInput) descricaoInput.value = andamento.descricao || '';

                    const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                    if (deleteCheckbox) deleteCheckbox.checked = false;
                }
            });
        }
    }
});