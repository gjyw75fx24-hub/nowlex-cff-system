document.addEventListener('DOMContentLoaded', function () {
    const mapaWrapper = document.getElementById('mapa-brasil-wrapper');
    if (!mapaWrapper) return;

    const filtroUFLink = document.querySelector('#changelist-filter a[href*="?uf="]');
    if (!filtroUFLink) return;

    const ufList = filtroUFLink.closest('ul');
    if (!ufList) return;
    
    // O contêiner original que envolve a lista de UFs
    const originalContainer = ufList.parentElement;

    // --- CORREÇÃO: Criar um novo wrapper flexível ---
    const flexWrapper = document.createElement('div');
    flexWrapper.style.display = 'flex';
    flexWrapper.style.gap = '0px';
    flexWrapper.style.alignItems = 'flex-start';
    mapaWrapper.style.marginLeft = '-55px'; // Puxa o mapa para a esquerda
    mapaWrapper.style.marginTop = '25px'; // Empurra o mapa para baixo

    // Move a lista de UFs original para dentro do novo wrapper
    flexWrapper.appendChild(ufList);
    
    // Define os tamanhos
    ufList.style.flex = '0 0 80px';
    ufList.style.marginTop = '0';
    mapaWrapper.style.flex = '1';
    mapaWrapper.style.minWidth = '150px';

    // Adiciona o mapa ao novo wrapper
    flexWrapper.appendChild(mapaWrapper);
    
    // Substitui o contêiner original pelo nosso novo wrapper flexível
    originalContainer.appendChild(flexWrapper);
    mapaWrapper.style.display = 'block';

    // --- Lógica de interatividade (sem alterações) ---
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