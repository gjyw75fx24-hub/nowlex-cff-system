document.addEventListener('DOMContentLoaded', function () {
    const mapaWrapper = document.getElementById('mapa-brasil-wrapper');
    if (!mapaWrapper) return;

    const allSummaries = document.querySelectorAll('#changelist-filter summary');
    let filtroUFSummary = null;
    for (const summary of allSummaries) {
        if (summary.textContent.trim().toLowerCase() === 'por uf') {
            filtroUFSummary = summary;
            break;
        }
    }

    if (!filtroUFSummary) return;

    const ufList = filtroUFSummary.nextElementSibling;
    if (!ufList || ufList.tagName !== 'UL') return;
    
    const flexWrapper = document.createElement('div');
    flexWrapper.style.display = 'flex';
    flexWrapper.style.gap = '0px';
    flexWrapper.style.alignItems = 'flex-start';
    flexWrapper.style.padding = '5px 0';

    flexWrapper.appendChild(ufList);
    flexWrapper.appendChild(mapaWrapper);
    filtroUFSummary.insertAdjacentElement('afterend', flexWrapper);
    
    ufList.style.flex = '0 0 80px';
    ufList.style.marginTop = '0';
    mapaWrapper.style.flex = '1';
    mapaWrapper.style.minWidth = '150px';
    mapaWrapper.style.marginLeft = '-55px';
    mapaWrapper.style.marginTop = '25px';
    mapaWrapper.style.display = 'block';

    const mapa = document.getElementById("mapa-brasil");
    if (!mapa) return;

    const urlParams = new URLSearchParams(window.location.search);
    const ufAtiva = urlParams.get("uf"); 

    // --- NOVA LÓGICA: Identificar UFs com processos ---
    const ufsComProcessos = new Set();
    ufList.querySelectorAll('a').forEach(link => {
        const match = link.href.match(/[\?&]uf=([A-Z]{2})/);
        if (match) {
            ufsComProcessos.add(match[1]);
        }
    });

    if (ufAtiva) {
        const estadoSelecionado = mapa.querySelector(`#UF-${ufAtiva.toUpperCase()}`);
        if (estadoSelecionado) {
            estadoSelecionado.classList.add("highlighted");
        }
    }

    mapa.querySelectorAll("path[id^='UF-']").forEach(path => {
        const uf = path.id.replace("UF-", "");
        
        // Verifica se o estado está na lista de UFs com processos
        if (ufsComProcessos.has(uf)) {
            // Comportamento para estados COM processos
            const linkUF = Array.from(ufList.querySelectorAll('a')).find(a => a.href.includes(`?uf=${uf}`));

            path.addEventListener("mouseenter", () => {
                if (uf.toUpperCase() !== ufAtiva) path.classList.add("highlighted");
            });
            path.addEventListener("mouseleave", () => {
                if (uf.toUpperCase() !== ufAtiva) path.classList.remove("highlighted");
            });

            if (linkUF) {
                path.addEventListener("click", () => { window.location.href = linkUF.href; });
            }
        } else {
            // Comportamento para estados VAZIOS
            path.classList.add('estado-vazio');
            path.addEventListener("mouseenter", () => { path.classList.add("highlighted-vazio"); });
            path.addEventListener("mouseleave", () => { path.classList.remove("highlighted-vazio"); });
        }
    });
});