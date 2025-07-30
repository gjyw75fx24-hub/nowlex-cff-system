document.addEventListener('DOMContentLoaded', function() {
    console.log("Módulo Tarefas/Prazos carregado.");

    // Lógica para mover os botões para a posição correta na interface do admin
    const customActionsContainer = document.createElement('div');
    customActionsContainer.id = 'custom-actions-container';
    
    const submitRow = document.querySelector('.submit-row');
    if (submitRow) {
        submitRow.parentNode.insertBefore(customActionsContainer, submitRow);
    }

    // Move os botões de etiquetas e tarefas/prazos para o novo container
    const etiquetaElements = document.getElementById('etiqueta-elements-source');
    const tarefasPrazosElements = document.getElementById('tarefas-prazos-elements-source');

    if (etiquetaElements) customActionsContainer.appendChild(etiquetaElements.children[0]); // Botão Etiquetas
    if (tarefasPrazosElements) customActionsContainer.appendChild(tarefasPrazosElements.children[0]); // Botão Tarefas/Prazos

    // --- Gerenciamento do Submenu ---
    const submenuButton = document.getElementById('open-tarefas-prazos-submenu');
    const submenu = document.getElementById('tarefas-prazos-submenu');
    if (submenuButton && submenu) {
        submenuButton.addEventListener('click', function(event) {
            event.stopPropagation();
            submenu.style.display = submenu.style.display === 'block' ? 'none' : 'block';
        });
    }
    document.addEventListener('click', () => {
        if (submenu) submenu.style.display = 'none';
    });

    // --- Gerenciamento de Modais ---
    const modals = {
        agenda: document.getElementById('agenda-modal'),
        novaTarefa: document.getElementById('nova-tarefa-modal'),
        novoPrazo: document.getElementById('novo-prazo-modal'),
    };

    const openModalButtons = {
        agenda: document.getElementById('open-agenda-modal'),
        novaTarefa: document.getElementById('open-nova-tarefa-modal'),
        novoPrazo: document.getElementById('open-novo-prazo-modal'),
    };

    // Função genérica para abrir um modal
    function openModal(modal) {
        if (modal) modal.style.display = 'block';
    }

    // Função genérica para fechar todos os modais
    function closeModal() {
        for (const key in modals) {
            if (modals[key]) modals[key].style.display = 'none';
        }
    }

    // Adiciona eventos para abrir os modais
    if (openModalButtons.agenda) openModalButtons.agenda.addEventListener('click', () => openModal(modals.agenda));
    if (openModalButtons.novaTarefa) openModalButtons.novaTarefa.addEventListener('click', (e) => { e.preventDefault(); openModal(modals.novaTarefa); });
    if (openModalButtons.novoPrazo) openModalButtons.novoPrazo.addEventListener('click', (e) => { e.preventDefault(); openModal(modals.novoPrazo); });

    // Adiciona eventos para fechar os modais (botões 'x' e 'cancelar')
    document.querySelectorAll('.agenda-modal-close').forEach(button => {
        button.addEventListener('click', closeModal);
    });

    // Fecha o modal se clicar fora do conteúdo
    window.addEventListener('click', function(event) {
        for (const key in modals) {
            if (event.target == modals[key]) {
                closeModal();
            }
        }
    });

    // TODO:
    // - Lógica de busca de usuários (autocomplete)
    // - Lógica para carregar listas de tarefas
    // - Lógica para submeter os formulários via API (fetch)
    // - Lógica para carregar e filtrar a agenda
});
