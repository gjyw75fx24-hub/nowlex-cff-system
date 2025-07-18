// Garante que o script só rode após o carregamento completo da página
document.addEventListener('DOMContentLoaded', function() {

    // --- Seletores dos elementos do formulário ---
    const cnjInput = document.getElementById('id_cnj');
    const cnjFeedback = document.getElementById('cnj_feedback');
    const searchButton = document.getElementById('btn_buscar_cnj');
    
    const ufInput = document.getElementById('id_uf'); // Adicionado
    const varaInput = document.getElementById('id_vara');
    const tribunalInput = document.getElementById('id_tribunal');
    const valorCausaInput = document.getElementById('id_valor_causa');
    const statusSelect = document.getElementById('id_status');

    // --- Funções auxiliares ---
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

    // --- Lógica de habilitação do botão ---
    if (cnjInput && searchButton) {
        const toggleButtonState = () => {
            // Habilita o botão se o campo tiver um número razoável de caracteres
            const cnjLimpo = cnjInput.value.replace(/\D/g, '');
            searchButton.disabled = cnjLimpo.length < 10;
        };
        toggleButtonState(); 
        cnjInput.addEventListener('input', toggleButtonState);
    }

    // --- Lógica do clique no botão de busca ---
    if (searchButton) {
        searchButton.addEventListener('click', function() {
            const cnj = cnjInput.value.trim();
            if (!cnj) {
                setFeedback('Por favor, insira um número de CNJ.', 'error');
                return;
            }

            const url = searchButton.getAttribute('data-url');
            setFeedback('Buscando dados online...', 'loading');

            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': csrftoken,
                },
                // Envia o CNJ como o usuário digitou. O backend vai limpar.
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
                    // Passa os dados do processo, partes e andamentos
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

    /**
     * Preenche os campos do formulário principal e os inlines das partes.
     * @param {object} processo - O objeto com os dados do processo principal.
     * @param {Array} partes - A lista de objetos das partes.
     */
    function fillFormFields(processo, partes, andamentos) {
        // 1. Preenche os campos do formulário principal
        if (varaInput) varaInput.value = processo.vara || '';
        if (tribunalInput) tribunalInput.value = processo.tribunal || '';
        if (valorCausaInput) valorCausaInput.value = processo.valor_causa || '0.00';
        if (statusSelect && processo.status_id) {
            statusSelect.value = processo.status_id;
        }
        // Preenche UF apenas se estiver vazio
        if (ufInput && !ufInput.value) {
            ufInput.value = processo.uf || '';
        }

        // 2. Preenche os formulários de inline das partes
        if (partes && partes.length > 0) {
            const addParteButton = document.querySelector('#partes_processuais-group .add-row a');
            const totalPartesForms = document.querySelectorAll('.dynamic-partes_processuais').length;

            // Garante que há inlines suficientes
            for (let i = totalPartesForms; i < partes.length; i++) {
                if (addParteButton) addParteButton.click();
            }

            // Remove inlines extras se houver mais formulários do que partes
            for (let i = partes.length; i < totalPartesForms; i++) {
                const inline = document.querySelector(`#partes_processuais-group .dynamic-partes_processuais:nth-child(${i + 1})`);
                if (inline) {
                    const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                    if (deleteCheckbox) deleteCheckbox.checked = true;
                }
            }

            // Preenche os inlines
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

                    // Garante que o inline não está marcado para exclusão se estiver sendo preenchido
                    const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                    if (deleteCheckbox) deleteCheckbox.checked = false;
                }
            });
        }

        // 3. Preenche os formulários de inline dos andamentos
        if (andamentos && andamentos.length > 0) {
            const addAndamentoButton = document.querySelector('#andamentos-group .add-row a');
            const totalAndamentosForms = document.querySelectorAll('.dynamic-andamentos').length;

            // Garante que há inlines suficientes
            for (let i = totalAndamentosForms; i < andamentos.length; i++) {
                if (addAndamentoButton) addAndamentoButton.click();
            }

            // Remove inlines extras se houver mais formulários do que andamentos
            for (let i = andamentos.length; i < totalAndamentosForms; i++) {
                const inline = document.querySelector(`#andamentos-group .dynamic-andamentos:nth-child(${i + 1})`);
                if (inline) {
                    const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                    if (deleteCheckbox) deleteCheckbox.checked = true;
                }
            }

            // Preenche os inlines
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

                    // Garante que o inline não está marcado para exclusão se estiver sendo preenchido
                    const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                    if (deleteCheckbox) deleteCheckbox.checked = false;
                }
            });
        }

        // 4. Informa o usuário
        setFeedback('Dados preenchidos. Revise as informações e salve o formulário.', 'success');
    }

    function setFeedback(message, type) {
        if (cnjFeedback) {
            cnjFeedback.textContent = message;
            cnjFeedback.style.color = type === 'success' ? 'green' : (type === 'error' ? 'red' : 'orange');
        }
    }
});