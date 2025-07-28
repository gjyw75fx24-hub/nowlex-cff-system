document.addEventListener('DOMContentLoaded', function () {
    console.log("Mapa Interativo Script Carregado (v2).");

    const mapaWrapper = document.getElementById('mapa-brasil-wrapper');
    if (!mapaWrapper) {
        console.error("Erro: Div 'mapa-brasil-wrapper' não encontrada.");
        return;
    }

    const filtroUFLink = document.querySelector('#changelist-filter a[href*="?uf="]');
    if (!filtroUFLink) {
        console.error("Erro: Nenhum link de filtro de UF (ex: ?uf=SP) foi encontrado. Verifique se o filtro 'uf' está ativo no admin.py e se há processos com UFs cadastradas.");
        return;
    }

    const ufList = filtroUFLink.closest('ul');
    if (!ufList) {
        console.error("Erro: Lista <ul> para o filtro UF não foi encontrada.");
        return;
    }
    
    const filtroContainer = ufList.parentElement;
    console.log("Elementos do filtro encontrados. Montando o mapa...");

    filtroContainer.style.display = 'flex';
    filtroContainer.style.gap = '15px';
    filtroContainer.style.alignItems = 'flex-start';

    ufList.style.flex = '0 0 80px';
    ufList.style.marginTop = '0';
    mapaWrapper.style.flex = '1';
    mapaWrapper.style.minWidth = '150px';

    filtroContainer.appendChild(mapaWrapper);
    mapaWrapper.style.display = 'block';
    console.log("Mapa inserido no DOM.");

    const mapa = document.getElementById("mapa-brasil");
    if (!mapa) return;

    const urlParams = new URLSearchParams(window.location.search);
    const ufAtiva = urlParams.get("uf"); 

    if (ufAtiva) {
        const estadoSelecionado = mapa.querySelector(`#UF-${ufAtiva.toUpperCase()}`);
        if (estadoSelecionado) {
            estadoSelecionado.classList.add("highlighted");
        }
    }

    mapa.querySelectorAll("path[id^='UF-']").forEach(path => {
        const uf = path.id.replace("UF-", "");
        const linkUF = Array.from(ufList.querySelectorAll('a')).find(a => a.textContent.trim() === uf);

        path.addEventListener("mouseenter", () => {
            path.classList.add("highlighted");
            if (linkUF) linkUF.style.fontWeight = 'bold';
        });
        path.addEventListener("mouseleave", () => {
            if (!ufAtiva || ufAtiva.toUpperCase() !== uf) {
                path.classList.remove("highlighted");
                if (linkUF) linkUF.style.fontWeight = 'normal';
            }
        });

        if (linkUF) {
            linkUF.addEventListener('mouseenter', () => path.classList.add('highlighted'));
            linkUF.addEventListener('mouseleave', () => {
                if (!ufAtiva || ufAtiva.toUpperCase() !== uf) {
                    path.classList.remove('highlighted');
                }
            });
        }

        path.addEventListener("click", () => {
            if (linkUF) {
                window.location.href = linkUF.href;
            }
        });
    });
});