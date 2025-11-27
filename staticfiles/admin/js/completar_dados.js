// static/admin/js/completar_dados.js
document.addEventListener("DOMContentLoaded", function () {
    // Adia a execução para garantir que todos os elementos, incluindo os do Django, estejam prontos.
    setTimeout(setupCompletarDados, 0);
});

function setupCompletarDados() {
    const cnjInput = document.getElementById("id_cnj");
    if (!cnjInput) {
        console.warn("Campo CNJ (id_cnj) não encontrado.");
        return;
    }

    // Garante que o botão não seja duplicado
    if (document.getElementById("btn_completar_dados")) {
        return;
    }

    // Cria o botão para buscar dados
    const botao = document.createElement("button");
    botao.id = "btn_completar_dados";
    botao.type = "button";
    botao.className = "button";
    botao.innerText = "📄 Dados Online (API Escavador)";
    botao.style.marginLeft = "10px";

    // Insere o botão ao lado do campo CNJ
    cnjInput.parentNode.appendChild(botao);

    // Adiciona o listener de clique
    botao.addEventListener("click", async () => {
        const cnj = cnjInput.value.trim();
        if (cnj.length < 20) {
            alert("Informe um CNJ completo (mínimo 20 dígitos).");
            return;
        }

        botao.disabled = true;
        const originalText = botao.textContent;
        botao.textContent = "⏳ Buscando…";

        // Prepara os dados para a requisição POST
        const formData = new FormData();
        formData.append('cnj', cnj);
        
        // Pega o token CSRF do formulário
        const csrfTokenInput = document.querySelector('[name=csrfmiddlewaretoken]');
        if (!csrfTokenInput) {
            alert("Erro de segurança: Token CSRF não encontrado.");
            botao.disabled = false;
            botao.textContent = originalText;
            return;
        }
        const csrfToken = csrfTokenInput.value;

        try {
            // Faz a requisição para a API
            const response = await fetch('/api/contratos/buscar-dados-escavador/', {
                method: 'POST',
                body: formData,
                headers: {
                    'X-CSRFToken': csrfToken
                }
            });
            
            const data = await response.json();

            if (data.status === 'success' && data.processo) {
                const processo = data.processo;
                
                // Mapeamento dos campos simples
                const map = {
                    tribunal: "id_tribunal",
                    vara: "id_vara",
                    valor_causa: "id_valor_causa",
                    uf: "id_uf",
                };

                // Preenche os campos de texto
                Object.entries(map).forEach(([key, id]) => {
                    if (processo[key]) {
                        const el = document.getElementById(id);
                        if (el) el.value = processo[key];
                    }
                });

                // Lógica específica para o campo de Status Processual (<select>)
                const statusSelect = document.getElementById('id_status');
                const statusId = processo.status_id;
                const statusNome = processo.status_nome;

                if (statusSelect && statusId && statusNome) {
                    // Verifica se a opção já existe
                    let optionExists = Array.from(statusSelect.options).some(opt => opt.value == statusId);

                    // Se não existir, cria e adiciona a nova opção
                    if (!optionExists) {
                        const newOption = new Option(statusNome, statusId, true, true); // text, value, defaultSelected, selected
                        statusSelect.appendChild(newOption);
                    }
                    
                    // Define o valor do select
                    statusSelect.value = statusId;
                }

                alert(data.message || "Dados preenchidos com sucesso!");

                // Chamar a função para preencher os andamentos
                if (data.andamentos && data.andamentos.length > 0) {
                    populateAndamentos(data.andamentos);
                }

            } else {
                alert("Erro: " + (data.message || "Não foi possível completar os dados."));
            }
        } catch (e) {
            console.error("Erro na requisição:", e);
            alert("Ocorreu um erro inesperado ao se comunicar com a API.");
        } finally {
            botao.disabled = false;
            botao.textContent = originalText;
        }
    });
}

function populateAndamentos(andamentos) {
    const totalFormsInput = document.getElementById('id_andamentoprocessual_set-TOTAL_FORMS');
    const addRowButton = document.querySelector('.andamentoprocessual_set .add-row a'); 

    if (!totalFormsInput || !addRowButton) {
        console.warn("Elementos do formset de andamentos não encontrados. Não foi possível preencher os andamentos.");
        return;
    }

    let currentTotalForms = parseInt(totalFormsInput.value);

    andamentos.forEach(andamento => {
        // Simular clique no botão "Adicionar outro Andamento Processual"
        addRowButton.click();

        // The new form will have the index currentTotalForms (before it was incremented by the click)
        const newFormIndex = currentTotalForms;

        // Preencher os campos do novo formulário
        const dataInput = document.getElementById(`id_andamentoprocessual_set-${newFormIndex}-data_0`);
        const dataTimeInput = document.getElementById(`id_andamentoprocessual_set-${newFormIndex}-data_1`);
        const descricaoInput = document.getElementById(`id_andamentoprocessual_set-${newFormIndex}-descricao`);
        const detalhesInput = document.getElementById(`id_andamentoprocessual_set-${newFormIndex}-detalhes`);

        if (dataInput) {
            dataInput.value = andamento.data;
        }
        if (dataTimeInput) {
            dataTimeInput.value = '21:00:00';
        }
        if (descricaoInput) {
            descricaoInput.value = andamento.descricao;
        }
        if (detalhesInput && andamento.detalhes) {
            detalhesInput.value = andamento.detalhes;
        }

        // Update currentTotalForms for the next loop
        currentTotalForms++;
    });
}