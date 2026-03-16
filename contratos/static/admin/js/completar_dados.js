// static/admin/js/completar_dados.js
document.addEventListener("DOMContentLoaded", function () {
    // Adia a execução para garantir que todos os elementos, incluindo os do Django, estejam prontos.
    setTimeout(setupCompletarDados, 0);
});

function setupCompletarDados() {
    const cnjInput = document.getElementById("id_cnj");
    const ufInput = document.getElementById("id_uf");
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
    botao.innerHTML = "🌐";
    botao.title = "Buscar dados online (API Escavador)";
    botao.setAttribute("aria-label", "Buscar dados online (API Escavador)");
    botao.style.marginLeft = "6px";
    botao.style.padding = "0";
    botao.style.minWidth = "32px";
    botao.style.width = "32px";
    botao.style.height = "32px";
    botao.style.lineHeight = "32px";
    botao.style.display = "inline-flex";
    botao.style.alignItems = "center";
    botao.style.justifyContent = "center";
    botao.style.borderRadius = "4px";
    botao.style.verticalAlign = "middle";

    const cnjInputParent = cnjInput.parentNode;
    const inlineGroup = document.createElement("div");
    inlineGroup.className = "cnj-inline-group";
    inlineGroup.style.display = "inline-flex";
    inlineGroup.style.alignItems = "center";
    inlineGroup.style.gap = "6px";
    inlineGroup.style.flexWrap = "nowrap";
    cnjInputParent.insertBefore(inlineGroup, cnjInput);
    inlineGroup.appendChild(cnjInput);
    inlineGroup.appendChild(botao);

    if (ufInput) {
        ufInput.setAttribute("maxlength", "2");
        ufInput.style.maxWidth = "70px";
        ufInput.style.width = "70px";
        ufInput.style.textTransform = "uppercase";
        ufInput.style.letterSpacing = "0.08em";
        ufInput.style.fontSize = "0.95rem";
    }

    // Adiciona o listener de clique
    botao.addEventListener("click", async () => {
        const cnj = cnjInput.value.trim();
        const cnjNumerico = cnj.replace(/\\D/g, '');

        if (cnjNumerico.length < 20) {
            alert("Informe um CNJ completo (mínimo 20 dígitos).");
            return;
        }

        botao.disabled = true;
        const originalText = botao.textContent;
        botao.textContent = "⏳ Buscando…";

        try {
            // Faz a requisição para a API (GET unificado com o endpoint usado no enhancer)
            const response = await fetch(`/api/buscar-dados-escavador/${cnjNumerico}/`, {
                method: 'GET'
            });
            
            const data = await response.json();

            if (data.status === 'success' && data.processo) {
                if (typeof window.nowlexFillEscavadorFormFields === 'function') {
                    window.nowlexFillEscavadorFormFields(data.processo, data.partes || [], data.andamentos || []);
                } else {
                    const processo = data.processo;
                    const map = {
                        tribunal: "id_tribunal",
                        vara: "id_vara",
                        valor_causa: "id_valor_causa",
                        uf: "id_uf",
                    };

                    Object.entries(map).forEach(([key, id]) => {
                        if (processo[key]) {
                            const el = document.getElementById(id);
                            if (el) el.value = processo[key];
                        }
                    });

                    const statusSelect = document.getElementById('id_status');
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

                    if (data.andamentos && data.andamentos.length > 0) {
                        populateAndamentos(data.andamentos);
                    }
                }
                alert(data.message || "Dados preenchidos com sucesso!");

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
