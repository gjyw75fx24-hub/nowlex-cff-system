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
    const ufAtivas = new Set(urlParams.getAll("uf").filter(Boolean));

    const ufsComProcessos = new Set();
    ufList.querySelectorAll('a').forEach(link => {
        const match = link.href.match(/[\?&]uf=([A-Z]{2})/);
        if (match) {
            ufsComProcessos.add(match[1]);
        }
    });

    const linkTodos = Array.from(ufList.querySelectorAll('a')).find(a => a.textContent.trim().toLowerCase() === 'todos');

    const toggleUF = (uf) => {
        const current = new URLSearchParams(window.location.search);
        const values = new Set(current.getAll('uf').filter(Boolean));
        if (values.has(uf)) {
            values.delete(uf);
        } else {
            values.add(uf);
        }
        current.delete('uf');
        values.forEach(v => current.append('uf', v));
        const newSearch = current.toString();
        window.location.search = newSearch ? `?${newSearch}` : window.location.pathname;
    };

    // Marcar as UFs já selecionadas visualmente
    ufAtivas.forEach(uf => {
        const path = mapa.querySelector(`#UF-${uf.toUpperCase()}`);
        if (path) path.classList.add('highlighted');
        const linkUF = Array.from(ufList.querySelectorAll('a')).find(a => a.href.includes(`uf=${uf}`));
        if (linkUF) linkUF.classList.add('selected');
    });

    mapa.querySelectorAll("path[id^='UF-']").forEach(path => {
        const uf = path.id.replace("UF-", "");
        
        if (ufsComProcessos.has(uf)) {
            // Usa o href para encontrar o link, o que ignora a contagem no texto
            const linkUF = Array.from(ufList.querySelectorAll('a')).find(a => a.href.includes(`uf=${uf}`));

            // Hover no MAPA -> Destaque na LISTA
            path.addEventListener("mouseenter", () => {
                if (!ufAtivas.has(uf.toUpperCase())) {
                    path.classList.add("highlighted");
                    if (linkUF) linkUF.style.fontWeight = 'bold';
                }
            });
            path.addEventListener("mouseleave", () => {
                if (!ufAtivas.has(uf.toUpperCase())) {
                    path.classList.remove("highlighted");
                    if (linkUF) linkUF.style.fontWeight = 'normal';
                }
            });

            if (linkUF) {
                // Hover na LISTA -> Destaque no MAPA (Restaurado)
                linkUF.addEventListener('mouseenter', () => {
                    if (!ufAtivas.has(uf.toUpperCase())) path.classList.add('highlighted');
                });
                linkUF.addEventListener('mouseleave', () => {
                    if (!ufAtivas.has(uf.toUpperCase())) path.classList.remove('highlighted');
                });

                // Lógica de clique unificada
                const clickHandler = (event) => {
                    event.preventDefault();
                    toggleUF(uf.toUpperCase());
                };
                
                path.addEventListener("click", clickHandler);
                linkUF.addEventListener("click", clickHandler);
            }
        } else {
            path.classList.add('estado-vazio');
            path.addEventListener("mouseenter", () => { path.classList.add("highlighted-vazio"); });
            path.addEventListener("mouseleave", () => { path.classList.remove("highlighted-vazio"); });
        }
    });
});
