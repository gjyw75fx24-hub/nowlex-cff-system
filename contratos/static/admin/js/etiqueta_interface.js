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
        const previewContainer = $('#etiqueta-preview-container');

        // --- Instâncias do Pickr ---
        let pickrFundo = null;
        let pickrFonte = null;

                // --- Posicionamento ---
        function positionElements() {
            // ================== INÍCIO DA SOLUÇÃO FINAL ==================

            // 1. Seleciona os elementos principais
            const mainHeader = $('#content h1').first();
            const contentDiv = $('#content');
            const openModalBtn = $('#open-etiqueta-modal');
            const aplicadasContainer = $('#etiquetas-aplicadas-container');

            // 2. Lógica original para posicionar o botão "Inserir Etiquetas"
            if (mainHeader.length && contentDiv.length) {
                const topPosition = mainHeader.position().top + parseFloat(mainHeader.css('margin-top'));
                openModalBtn.detach().appendTo(contentDiv).css({
                    'position': 'absolute',
                    'top': topPosition + 'px',
                    'right': '40px',
                    'transform': 'scale(0.7)',
                    'transform-origin': 'top right'
                });
            }

            // 3. AQUI ESTÁ A MÁGICA:
            // O subtítulo (CNJ) é adicionado um pouco depois.
            // Esta função espera até que o subtítulo exista para então mover as etiquetas.
            const waitForSubTitle = setInterval(function() {
                // O seletor '.object-tools' é o container do subtítulo CNJ.
                const subTitleContainer = $('.object-tools');

                if (subTitleContainer.length > 0) {
                    // O subtítulo foi encontrado!
                    clearInterval(waitForSubTitle); // Para de verificar

                    // Move o container de etiquetas para DEPOIS do container do subtítulo
                    subTitleContainer.after(aplicadasContainer.detach());
                    
                    // Mostra o container de etiquetas com o espaçamento correto
                    aplicadasContainer.css({ 'padding': '10px 0', 'display': 'block' }).show();
                }
            }, 50); // Verifica a cada 50 milissegundos

            // 4. Lógica original para ajustar o botão de histórico
            const historyButton = $('a.historylink');
            if (historyButton.length) {
                historyButton.css({
                    'transform': 'scale(0.8)',
                    'transform-origin': 'top right',
                    'display': 'inline-block'
                });
            }
            // =================== FIM DA SOLUÇÃO FINAL ====================
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

        // --- Lógica do Modal de Criação com Pickr e Preview ---
        const swatches = [
            '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4',
            '#009688', '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800', '#FF5722',
            '#795548', '#9E9E9E', '#607D8B', '#000000', '#FFFFFF'
        ];

        function updatePreview() {
            const cor_fundo = pickrFundo.getColor().toHEXA().toString();
            const cor_fonte = pickrFonte.getColor().toHEXA().toString();
            
            newEtiquetaNameInput.css({
                'background-color': cor_fundo,
                'color': cor_fonte,
                'text-align': 'center',
                'font-weight': 'bold'
            });
        }

        function initializePickers(callback) {
            if (window.Pickr) {
                const pickerOptions = {
                    theme: 'classic',
                    swatches: swatches,
                    components: {
                        preview: true, opacity: false, hue: true,
                        interaction: {
                            hex: false, rgba: false, hsla: false, hsva: false, cmyk: false,
                            input: true, clear: false, save: true
                        }
                    }
                };
                pickrFundo = Pickr.create({ el: '#color-picker-fundo', default: '#417690', ...pickerOptions });
                pickrFonte = Pickr.create({ el: '#color-picker-fonte', default: '#FFFFFF', ...pickerOptions });

                const repositionPicker = (pickerInstance) => {
                    const pickerApp = pickerInstance.getRoot().app;
                    const createModalBox = createModal.find('> div')[0].getBoundingClientRect();
                    pickerApp.style.top = `${createModalBox.bottom + 10}px`;
                };

                pickrFundo.on('show', instance => repositionPicker(instance));
                pickrFonte.on('show', instance => repositionPicker(instance));

                pickrFundo.on('change', updatePreview).on('save', updatePreview);
                pickrFonte.on('change', updatePreview).on('save', updatePreview);

                if (callback) callback();
            } else {
                setTimeout(() => initializePickers(callback), 100);
            }
        }

        const openCreateEtiquetaBtn = $('#open-create-etiqueta-btn');
        function showCreateEtiquetaModal() {
            createEtiquetaError.hide();
            newEtiquetaNameInput.val('');
            newEtiquetaNameInput.css({
                'background-color': '', 'color': '', 'text-align': '', 'font-weight': ''
            });

            const setupAndShow = () => {
                pickrFundo.setColor('#417690', true);
                pickrFonte.setColor('#FFFFFF', true);
                updatePreview();
                createModal.show();
            };

            if (!pickrFundo) {
                initializePickers(setupAndShow);
            } else {
                setupAndShow();
            }
        }

        addNewEtiquetaBtn.on('click', showCreateEtiquetaModal);
        openCreateEtiquetaBtn.on('click', function(e) {
            e.preventDefault();
            showCreateEtiquetaModal();
        });

        newEtiquetaNameInput.on('keyup', updatePreview);

        cancelCreateEtiquetaBtn.on('click', function() {
            createModal.hide();
        });

        saveNewEtiquetaBtn.on('click', function() {
            const nome = newEtiquetaNameInput.val().trim();
            if (nome) {
                const cor_fundo = pickrFundo.getColor().toHEXA().toString();
                const cor_fonte = pickrFonte.getColor().toHEXA().toString();
                $.ajax({
                    url: criarEtiquetaUrl,
                    type: 'POST',
                    data: JSON.stringify({ 'nome': nome, 'cor_fundo': cor_fundo, 'cor_fonte': cor_fonte }),
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
