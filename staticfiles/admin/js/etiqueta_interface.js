'use strict';
(function($) {
    $(document).ready(function() {
        // --- Configuração Inicial ---
        const processoId = window.location.pathname.split('/').filter(Boolean)[3];
        if (!processoId || isNaN(parseInt(processoId))) return;

        const etiquetasUrl = `/admin/contratos/processojudicial/${processoId}/etiquetas/`;
        const criarEtiquetaUrl = `/admin/contratos/processojudicial/etiquetas/criar/`;

        // --- Seletores de Elementos ---
        const modal = $('#etiqueta-modal');
        const closeModalBtn = $('#close-etiqueta-modal');
        const searchInput = $('#search-etiqueta-input');
        const etiquetaListContainer = $('#etiqueta-list');
        const aplicadasContainer = $('#etiquetas-aplicadas-container');
        
        const createModal = $('#create-etiqueta-modal');
        const addNewEtiquetaBtn = $('#add-new-etiqueta-btn');
        const saveNewEtiquetaBtn = $('#save-new-etiqueta-btn');
        const cancelCreateEtiquetaBtn = $('#cancel-create-etiqueta-btn');
        const newEtiquetaNameInput = $('#new-etiqueta-name-input');
        const createEtiquetaError = $('#create-etiqueta-error');

        // --- Posicionamento ---
        function positionElements() {
            const mainHeader = $('#content h1').first();
            const contentDiv = $('#content');
            const openModalBtn = $('#open-etiqueta-modal');

            if (mainHeader.length && contentDiv.length) {
                // 1. Posicionar o botão com 'position: absolute' e scale(0.7)
                const topPosition = mainHeader.position().top + parseFloat(mainHeader.css('margin-top'));
                openModalBtn.detach().appendTo(contentDiv).css({
                    'position': 'absolute',
                    'top': topPosition + 'px',
                    'right': '40px',
                    'transform': 'scale(0.7)',
                    'transform-origin': 'top right'
                });

                // 2. Posicionar as etiquetas abaixo do H1
                mainHeader.after(aplicadasContainer.detach());
                aplicadasContainer.css({ 'padding': '10px 0', 'display': 'block' }).show();
                
                // 3. Diminuir o botão Histórico
                const historyButton = $('a.historylink');
                if (historyButton.length) {
                    historyButton.css({
                        'transform': 'scale(0.8)',
                        'transform-origin': 'top right',
                        'display': 'inline-block'
                    });
                }
            }
        }
        
        positionElements();

        // --- Funções ---
        let todasEtiquetas = [];
        let etiquetasProcesso = [];

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

        function renderAplicadas() {
            aplicadasContainer.empty();
            etiquetasProcesso.forEach(etiqueta => {
                const tag = $(`<span class="etiqueta-badge" style="background-color: ${etiqueta.cor_fundo}; color: ${etiqueta.cor_fonte};">${etiqueta.nome}<button class="remove-etiqueta-btn" data-id="${etiqueta.id}" title="Remover">&times;</button></span>`);
                aplicadasContainer.append(tag);
            });
        }

        function renderModalList(filter = '') {
            etiquetaListContainer.empty();
            const etiquetasProcessoIds = new Set(etiquetasProcesso.map(e => e.id));
            const filteredEtiquetas = todasEtiquetas.filter(e => e.nome.toLowerCase().includes(filter.toLowerCase()));
            
            filteredEtiquetas.forEach(etiqueta => {
                const isChecked = etiquetasProcessoIds.has(etiqueta.id);
                const listItem = $(`
                    <div style="padding: 5px 0;">
                        <label>
                            <input type="checkbox" class="etiqueta-checkbox" data-id="${etiqueta.id}" ${isChecked ? 'checked' : ''}>
                            <span class="etiqueta-badge" style="background-color: ${etiqueta.cor_fundo}; color: ${etiqueta.cor_fonte}; font-size: 0.9em; padding: 3px 8px;">${etiqueta.nome}</span>
                        </label>
                    </div>`);
                etiquetaListContainer.append(listItem);
            });
        }

        function fetchData() {
            $.get(etiquetasUrl, function(data) {
                todasEtiquetas = data.todas_etiquetas;
                etiquetasProcesso = data.etiquetas_processo;
                renderAplicadas();
                renderModalList();
            });
        }

        function handleEtiquetaChange(etiquetaId, action) {
            $.ajax({
                url: etiquetasUrl,
                type: 'POST',
                data: JSON.stringify({ 'etiqueta_id': etiquetaId, 'action': action }),
                contentType: 'application/json',
                beforeSend: xhr => xhr.setRequestHeader("X-CSRFToken", csrftoken),
                success: () => fetchData(),
                error: () => alert('Ocorreu um erro ao atualizar a etiqueta.')
            });
        }

        // --- Event Handlers ---
        $('#content').on('click', '#open-etiqueta-modal', function(e) {
            e.preventDefault();
            const buttonRect = this.getBoundingClientRect();
            const modalContent = modal.find('> div');
            const modalWidth = modalContent.outerWidth();
            let leftPosition = buttonRect.right - modalWidth;
            if (leftPosition < 0) leftPosition = 10;
            modalContent.css({ 'top': buttonRect.bottom + window.scrollY + 5 + 'px', 'left': leftPosition + window.scrollX + 'px' });
            modal.show();
        });

        closeModalBtn.on('click', () => modal.hide());
        $('#save-etiquetas-btn').on('click', () => modal.hide());
        modal.on('click', function(e) { if ($(e.target).is(modal)) { modal.hide(); } });
        searchInput.on('keyup', function() { renderModalList($(this).val()); });
        etiquetaListContainer.on('change', '.etiqueta-checkbox', function() {
            handleEtiquetaChange($(this).data('id'), $(this).is(':checked') ? 'add' : 'remove');
        });
        aplicadasContainer.on('click', '.remove-etiqueta-btn', function() {
            handleEtiquetaChange($(this).data('id'), 'remove');
        });

        // --- Lógica do Modal de Criação (sem seletor de cor) ---
        addNewEtiquetaBtn.on('click', function() {
            createEtiquetaError.hide();
            newEtiquetaNameInput.val('');
            createModal.show();
        });

        cancelCreateEtiquetaBtn.on('click', function() {
            createModal.hide();
        });

        saveNewEtiquetaBtn.on('click', function() {
            const nome = newEtiquetaNameInput.val().trim();
            if (nome) {
                $.ajax({
                    url: criarEtiquetaUrl,
                    type: 'POST',
                    data: JSON.stringify({ 'nome': nome }),
                    contentType: 'application/json',
                    beforeSend: xhr => xhr.setRequestHeader("X-CSRFToken", csrftoken),
                    success: response => {
                        if(response.status === 'created') {
                            createModal.hide();
                            fetchData();
                        }
                    },
                    error: response => {
                        createEtiquetaError.text(response.responseJSON.message || 'Ocorreu um erro.').show();
                    }
                });
            }
        });

        fetchData();
    });
})(django.jQuery);