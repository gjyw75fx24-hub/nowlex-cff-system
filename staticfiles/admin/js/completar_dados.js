document.addEventListener("DOMContentLoaded", function () {
    const cnjInput = document.getElementById("id_cnj");
    if (!cnjInput) return;

    // Evita duplicar botão se já existir
    if (document.getElementById("btn_completar_dados")) return;

    // Cria botão
    const botao = document.createElement("button");
    botao.id = "btn_completar_dados";
    botao.type = "button";
    botao.className = "button";
    botao.innerText = "📄 Completar Dados";
    botao.style.marginLeft = "10px";

    // Insere botão ao lado do input CNJ
    cnjInput.parentNode.appendChild(botao);

    botao.addEventListener("click", async () => {
        const cnj = cnjInput.value.trim();
        if (cnj.length < 20) {
            alert("Informe um CNJ completo (20 dígitos).");
            return;
        }

        botao.disabled = true;
        const original = botao.textContent;
        botao.textContent = "⏳ Buscando…";

        try {
            const resp = await fetch(`/processos/completar-dados/?cnj=${encodeURIComponent(cnj)}`);
            const data = await resp.json();

            if (data.success) {
                const map = {
                    tribunal: "id_tribunal",
                    vara: "id_vara",
                    valor_causa: "id_valor_causa",
                    uf: "id_uf",
                    data_distribuicao: "id_data_distribuicao",
                    classe_processual: "id_classe_processual",
                    assunto_principal: "id_assunto_principal"
                };

                Object.entries(data.dados).forEach(([campo, valor]) => {
                    const el = document.getElementById(map[campo]);
                    if (el && valor) el.value = valor;
                });

                alert("Dados preenchidos com sucesso!");
            } else {
                alert("Erro: " + (data.message || "Não foi possível completar."));
            }
        } catch (e) {
            console.error(e);
            alert("Erro inesperado.");
        } finally {
            botao.disabled = false;
            botao.textContent = original;
        }
    });
});
