document.addEventListener('DOMContentLoaded', function() {

    // --- Seletores Globais ---
    const form = document.getElementById('processojudicial_form');
    const cnjInput = document.getElementById('id_cnj');
    const ufInput = document.getElementById('id_uf');
    const tribunalInput = document.getElementById('id_tribunal');
    const varaInput = document.getElementById('id_vara');
    const valorCausaInput = document.getElementById('id_valor_causa');
    const statusSelect = document.getElementById('id_status');

    // --- 1. Criação do Botão "Dados Online" ---
    if (cnjInput && !document.getElementById('btn_buscar_cnj')) {
        const searchButton = document.createElement('button');
        searchButton.id = 'btn_buscar_cnj';
        searchButton.type = 'button';
        searchButton.className = 'button';
        searchButton.innerText = '📄 Dados Online';
        searchButton.style.marginLeft = '10px';
        cnjInput.parentNode.appendChild(searchButton);

        const feedbackDiv = document.createElement('div');
        feedbackDiv.id = 'cnj_feedback';
        feedbackDiv.style.marginTop = '5px';
        feedbackDiv.style.fontWeight = 'bold';
        cnjInput.parentNode.parentNode.appendChild(feedbackDiv);
    }

    const searchButton = document.getElementById('btn_buscar_cnj');
    const cnjFeedback = document.getElementById('cnj_feedback');


    // --- 2. Prevenção de Envio com Enter ---
    if (form) {
        form.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
                event.preventDefault();
            }
        });
    }

    // --- 3. Lógica do Botão "Preencher UF" ---
    if (ufInput && !document.getElementById("btn_preencher_uf")) {
        const botao = document.createElement("button");
        botao.id = "btn_preencher_uf";
        botao.type = "button";
        botao.innerText = "Preencher UF";
        botao.className = "button";
        botao.style.marginLeft = "10px";

        botao.onclick = function () {
            if (!cnjInput.value) {
                alert("Por favor, insira um número de CNJ.");
                return;
            }

            const valorLimpo = cnjInput.value.replace(/[^\d]/g, "");
            let codUF = null;

            if (valorLimpo.length >= 20) {
                const j = valorLimpo.substring(13, 14);
                const tr = valorLimpo.substring(14, 16);
                codUF = `${j}.${tr}`;
            }

            const mapaUF = {
                "8.01": "AC", "8.02": "AL", "8.03": "AP", "8.04": "AM", "8.05": "BA",
                "8.06": "CE", "8.07": "DF", "8.08": "ES", "8.09": "GO", "8.10": "MA",
                "8.11": "MT", "8.12": "MS", "8.13": "MG", "8.14": "PA", "8.15": "PB",
                "8.16": "PR", "8.17": "PE", "8.18": "PI", "8.19": "RJ", "8.20": "RN",
                "8.21": "RS", "8.22": "RO", "8.23": "RR", "8.24": "SC", "8.25": "SE",
                "8.26": "SP", "8.27": "TO"
            };

            const uf = mapaUF[codUF];
            if (uf) {
                ufInput.value = uf;
                if (tribunalInput) tribunalInput.value = "TJ" + uf;
            } else {
                alert("Não foi possível extrair a UF a partir do CNJ informado. Verifique se o número possui 20 dígitos.");
            }
        };
        ufInput.parentNode.insertBefore(botao, ufInput.nextSibling);
    }

    // --- 4. Lógica do Botão de Busca Online ---
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

    // Botão "Atualizar andamentos agora" ao lado do checkbox de Busca Ativa
    const buscaAtivaInput = document.getElementById('id_busca_ativa');
    if (buscaAtivaInput && !document.getElementById('btn_atualizar_andamentos')) {
        const btn = document.createElement('button');
        btn.id = 'btn_atualizar_andamentos';
        btn.type = 'button';
        btn.className = 'button';
        btn.innerText = '🔄 Atualizar andamentos agora';
        btn.style.marginRight = '10px';

        const container = buscaAtivaInput.parentNode;
        container.insertBefore(btn, buscaAtivaInput);

        btn.addEventListener('click', () => {
            const match = window.location.pathname.match(/processojudicial\/(\d+)\/change/);
            if (!match) {
                alert('Salve o processo antes de atualizar andamentos.');
                return;
            }
            const objectId = match[1];
            const originalText = btn.innerText;
            btn.disabled = true;
            btn.innerText = 'Buscando andamentos...';

            fetch(`/admin/contratos/processojudicial/${objectId}/atualizar-andamentos/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': csrftoken }
            }).then(resp => {
                if (!resp.ok) throw new Error('Erro ao acionar atualização.');
                window.location.reload();
            }).catch(err => {
                alert(err.message || 'Falha ao atualizar andamentos.');
            }).finally(() => {
                btn.disabled = false;
                btn.innerText = originalText;
            });
        });
    }

    // Máscara e formatação CNJ no input principal
    if (cnjInput) {
        const formatCnj = (raw) => {
            const d = (raw || '').replace(/\D/g, '').slice(0, 20);
            const parts = [
                d.slice(0, 7),
                d.slice(7, 9),
                d.slice(9, 13),
                d.slice(13, 14),
                d.slice(14, 16),
                d.slice(16, 20),
            ];
            if (d.length <= 7) return d;
            return `${parts[0]}-${parts[1]}${parts[2] ? '.' + parts[2] : ''}${parts[3] ? '.' + parts[3] : ''}${parts[4] ? '.' + parts[4] : ''}${parts[5] ? '.' + parts[5] : ''}`;
        };

        cnjInput.addEventListener('input', (e) => {
            const pos = e.target.selectionStart;
            const formatted = formatCnj(e.target.value);
            e.target.value = formatted;
            // Best effort to keep cursor near the end
            e.target.setSelectionRange(formatted.length, formatted.length);
        });
    }

    if (cnjInput && searchButton) {
        const toggleButtonState = () => {
            const cnjLimpo = cnjInput.value.replace(/\D/g, '');
            searchButton.disabled = cnjLimpo.length < 10;
        };
        toggleButtonState();
        cnjInput.addEventListener('input', toggleButtonState);

        searchButton.addEventListener('click', function() {
            const cnj = cnjInput.value.trim().replace(/\D/g, ''); // Limpa o CNJ para garantir que só números sejam enviados
            if (!cnj) {
                setFeedback('Por favor, insira um número de CNJ.', 'error');
                return;
            }

            const url = `/api/buscar-dados-escavador/${cnj}/`;
            setFeedback('Buscando dados online...', 'loading');

            fetch(url, {
                method: 'GET',
                headers: {
                    'X-CSRFToken': csrftoken,
                }
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => {
                        throw new Error(err.message || `Erro ${response.status}: ${response.statusText}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'success') {
                    setFeedback(data.message, 'success');
                    fillFormFields(data.processo, data.partes, data.andamentos);
                } else {
                    throw new Error(data.message);
                }
            })
            .catch(error => {
                console.error('Erro na requisição:', error);
                setFeedback(error.message || 'Ocorreu um erro inesperado.', 'error');
            });
        });
    }

    function setFeedback(message, type) {
        if (cnjFeedback) {
            cnjFeedback.textContent = message;
            cnjFeedback.style.color = type === 'success' ? 'green' : (type === 'error' ? 'red' : 'orange');
        }
    }

    // --- Funções Auxiliares para Inlines de Parte ---

    // Função para aplicar máscara de CPF/CNPJ
    function maskCpfCnpj(value) {
        let cleaned = value.replace(/\D/g, '');
        if (cleaned.length <= 11) { // CPF
            cleaned = cleaned.replace(/(\d{3})(\d)/, '$1.$2');
            cleaned = cleaned.replace(/(\d{3})(\d)/, '$1.$2');
            cleaned = cleaned.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        } else { // CNPJ
            cleaned = cleaned.replace(/^(\d{2})(\d)/, '$1.$2');
            cleaned = cleaned.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
            cleaned = cleaned.replace(/\.(\d{3})(\d)/, '.$1/$2');
            cleaned = cleaned.replace(/(\d{4})(\d)/, '$1-$2');
        }
        return cleaned;
    }

    // Atualiza o estado visual da inline de parte (ex: cor de fundo, visibilidade do botão CIA)
    function updateParteDisplay(parteInline) {
        const tipoPoloSelect = parteInline.querySelector('[id$="-tipo_polo"]');
        const enderecoField = parteInline.querySelector('.field-endereco');
        const enderecoGrid = enderecoField ? enderecoField.querySelector('.endereco-fields-grid') : null;
        const toggleBtn = enderecoField ? enderecoField.querySelector('.endereco-toggle-button') : null;
        const clearBtn = enderecoField ? enderecoField.querySelector('.endereco-clear-button') : null;
        const isPassive = tipoPoloSelect && tipoPoloSelect.value === 'PASSIVO';

        if (isPassive) {
            parteInline.style.backgroundColor = 'rgba(220, 230, 255, 0.5)'; // Azul claro sutil
        } else {
            parteInline.style.backgroundColor = ''; // Remove cor se não for passivo
        }

        // Minimiza endereço para polo ativo, expande para passivo
        if (enderecoGrid) {
            const showGrid = isPassive;
            enderecoGrid.style.display = showGrid ? 'grid' : 'none';
            if (toggleBtn) {
                toggleBtn.style.display = 'inline-block';
                toggleBtn.innerText = showGrid ? '▾' : '▸';
                toggleBtn.title = showGrid ? 'Recolher endereço' : 'Expandir endereço';
            }
            if (clearBtn) {
                clearBtn.style.display = showGrid ? 'inline-block' : 'none';
            }
        }

        setupCiaButton(parteInline); // Garante que o botão CIA seja atualizado
    }

    // Configura o botão CIA (Completar Informações de Endereço) para uma inline de parte
    function setupCiaButton(parteInline) {
        const enderecoInput = parteInline.querySelector('[id$="-endereco"]');
        const tipoPoloSelect = parteInline.querySelector('[id$="-tipo_polo"]');
        const documentoInput = parteInline.querySelector('[id$="-documento"]'); // Necessário para a API do CIA
        let ciaButton = parteInline.querySelector('.cia-button');
        let clearButton = parteInline.querySelector('.endereco-clear-button');

        const isPassive = tipoPoloSelect && tipoPoloSelect.value === 'PASSIVO';

        if (enderecoInput) {
            if (isPassive && !ciaButton) {
                // Cria o botão se for polo passivo e ainda não existir
                ciaButton = document.createElement('button');
                ciaButton.type = 'button';
                ciaButton.className = 'button cia-button';
                ciaButton.innerText = 'CEP';
                ciaButton.style.marginLeft = '5px';
                enderecoInput.parentNode.appendChild(ciaButton);
            } else if (!isPassive && ciaButton) {
                // Remove o botão se não for polo passivo e ele existir
                ciaButton.remove();
                ciaButton = null;
            }

            const fetchEnderecoCIA = () => {
                const cpfCnpj = documentoInput ? documentoInput.value.replace(/\D/g, '') : '';
                if (!cpfCnpj || cpfCnpj.length < 11) {
                    return;
                }
                const url = `/api/fetch-address/${cpfCnpj}/`;
                fetch(url)
                    .then(response => response.json())
                    .then(data => {
                        if (data.endereco_formatado) {
                            enderecoInput.value = data.endereco_formatado;
                            enderecoInput.dispatchEvent(new Event('change', { bubbles: true }));
                        } else if (data.error) {
                            console.warn('Erro ao buscar endereço:', data.error);
                        }
                    })
                    .catch(error => {
                        console.error('Erro na requisição da API de endereço:', error);
                    });
            };

            if (ciaButton) {
                // Configura o handler do botão (se ele existir)
                ciaButton.onclick = function() {
                    const cpfCnpj = documentoInput ? documentoInput.value.replace(/\D/g, '') : '';
                    if (!cpfCnpj) {
                        alert('Por favor, informe o CPF/CNPJ da parte para buscar o endereço.');
                        return;
                    }
                    fetchEnderecoCIA();
                };
            }

            // Dispara automaticamente ao preencher o CPF/CNPJ do polo passivo (menos cliques)
            if (documentoInput) {
                documentoInput.addEventListener('blur', () => {
                    if (tipoPoloSelect && tipoPoloSelect.value === 'PASSIVO') {
                        fetchEnderecoCIA();
                    }
                });
            }

            // Botão de limpar endereço (sempre disponível)
            if (!clearButton) {
                clearButton = document.createElement('button');
                clearButton.type = 'button';
                clearButton.className = 'button endereco-clear-button';
                clearButton.innerText = '🧹';
                clearButton.title = 'Limpar endereço';
                clearButton.style.marginLeft = '5px';
                clearButton.style.background = 'transparent';
                clearButton.style.border = 'none';
                clearButton.style.color = '#555';
                clearButton.style.cursor = 'pointer';
                clearButton.style.float = 'right';
                enderecoInput.parentNode.appendChild(clearButton);
            }
            clearButton.onclick = function() {
                enderecoInput.value = '';
                const fieldWrapper = enderecoInput.closest('.field-endereco');
                if (fieldWrapper) {
                    fieldWrapper.querySelectorAll('input[data-part]').forEach(inp => {
                        inp.value = '';
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                }
                enderecoInput.dispatchEvent(new Event('change', { bubbles: true }));
            };
        }
    }


    // Configura campo de documento (máscara e tipo de pessoa) para uma inline de parte
    function setupDocumentoField(parteInline) {
        const documentoInput = parteInline.querySelector('[id$="-documento"]');
        const tipoPessoaSelect = parteInline.querySelector('[id$="-tipo_pessoa"]');

        if (documentoInput) {
            // Aplica máscara inicial e atualiza no input
            documentoInput.value = maskCpfCnpj(documentoInput.value);

            documentoInput.addEventListener('input', function() {
                const cleanedValue = this.value.replace(/\D/g, '');
                this.value = maskCpfCnpj(cleanedValue);

                // Auto-set tipo_pessoa
                if (tipoPessoaSelect) {
                    if (cleanedValue.length > 0 && cleanedValue.length <= 11) {
                        tipoPessoaSelect.value = 'PF'; // Pessoa Física
                    } else if (cleanedValue.length > 11) {
                        tipoPessoaSelect.value = 'PJ'; // Pessoa Jurídica
                    } else {
                        tipoPessoaSelect.value = ''; // Limpa se vazio
                    }
                }
            });
        }
    }

    // Função principal para configurar uma inline de parte
    function setupParteInline(parteInline) {
        setupDocumentoField(parteInline);

        // Cria toggle para endereço (minimiza por padrão no polo ativo)
        const enderecoField = parteInline.querySelector('.field-endereco');
        if (enderecoField && !enderecoField.querySelector('.endereco-toggle-button')) {
            const label = enderecoField.querySelector('label');
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'button endereco-toggle-button';
            toggleBtn.innerText = '▸';
            toggleBtn.title = 'Expandir endereço';
            toggleBtn.style.marginLeft = '5px';
            toggleBtn.style.background = 'transparent';
            toggleBtn.style.border = 'none';
            toggleBtn.style.color = '#555';
            toggleBtn.style.cursor = 'pointer';
            toggleBtn.addEventListener('click', () => {
                const grid = enderecoField.querySelector('.endereco-fields-grid');
                const clearBtn = enderecoField.querySelector('.endereco-clear-button');
                if (!grid) return;
                const showing = grid.style.display !== 'none';
                grid.style.display = showing ? 'none' : 'grid';
                toggleBtn.innerText = showing ? '▸' : '▾';
                toggleBtn.title = showing ? 'Expandir endereço' : 'Recolher endereço';
                if (clearBtn) clearBtn.style.display = showing ? 'none' : 'inline-block';
            });
            if (label) {
                label.appendChild(toggleBtn);
            } else {
                enderecoField.appendChild(toggleBtn);
            }
        }

        const tipoPoloSelect = parteInline.querySelector('[id$="-tipo_polo"]');
        if (tipoPoloSelect) {
            tipoPoloSelect.addEventListener('change', () => updateParteDisplay(parteInline));
        }
        updateParteDisplay(parteInline); // Atualiza no carregamento inicial
    }


    // --- 5. Preenchimento de Campos do Formulário ---
    function fillFormFields(processo, partes, andamentos) {
        console.log("--- Iniciando fillFormFields ---");
        console.log("Dados do processo recebidos:", processo);
        console.log("Dados das partes recebidos:", partes);

        // Mapeamento dos valores de tipo_pessoa da API para os valores do campo no Django
        const tipoPessoaMap = {
            'JURIDICA': 'PJ',
            'FISICA': 'PF'
        };


        if (processo) { // Adiciona uma verificação de segurança
            console.log("Preenchendo campos do processo principal...");
            if (varaInput) varaInput.value = processo.vara || '';
            if (tribunalInput) tribunalInput.value = processo.tribunal || '';
            
            // CORRIGIDO: Agora espera o valor numérico do backend.
            if (valorCausaInput && processo.valor_causa) {
                // O Django DecimalField espera um ponto como separador decimal, não vírgula.
                valorCausaInput.value = processo.valor_causa;
            } else if (valorCausaInput) {
                valorCausaInput.value = '0.00';
            }

            if (ufInput && !ufInput.value) ufInput.value = processo.uf || '';

            const statusId = processo.status_id;
            const statusNome = processo.status_nome;

            if (statusSelect && statusId && statusNome) {
                console.log(`Tentando definir Classe para: ID=${statusId}, Nome=${statusNome}`);
                let optionExists = Array.from(statusSelect.options).some(opt => opt.value == statusId);
                if (!optionExists) {
                    console.log("Opção de Classe não existe, criando uma nova.");
                    const newOption = new Option(statusNome, statusId, true, true);
                    statusSelect.appendChild(newOption);
                }
                statusSelect.value = statusId;
            }
        } else {
            console.warn("Objeto 'processo' é nulo ou indefinido. Pulando preenchimento dos campos principais.");
        }

        if (partes && partes.length > 0) {
            const addParteButton = document.querySelector('#partes_processuais-group .add-row a');
            let totalFormsInput = document.querySelector('#id_partes_processuais-TOTAL_FORMS');
            let totalForms = parseInt(totalFormsInput.value);
            
            console.log(`Encontradas ${totalForms} inlines de partes. Recebidas ${partes.length} partes.`);

            // Adiciona novas inlines se necessário
            for (let i = totalForms; i < partes.length; i++) {
                if (addParteButton) {
                    console.log("Adicionando nova inline de parte...");
                    addParteButton.click();
                }
            }
            
            // Lógica para esconder inlines extras
            totalForms = parseInt(totalFormsInput.value); // Re-ler o total
            for (let i = partes.length; i < totalForms; i++) {
                 const inlineToDelete = document.getElementById(`partes_processuais-${i}`);
                 if (inlineToDelete) {
                    const deleteCheckbox = inlineToDelete.querySelector('input[id$="-DELETE"]');
                    if(deleteCheckbox) deleteCheckbox.checked = true;
                    inlineToDelete.style.display = 'none';
                 }
            }


            // Aumentado o timeout para garantir a renderização de novas inlines
            setTimeout(() => {
                console.log("Iniciando preenchimento das inlines de partes após timeout.");
                
                // Itera sobre os dados das partes recebidas para preencher as inlines correspondentes
                for (let i = 0; i < partes.length; i++) {
                    const inline = document.getElementById(`partes_processuais-${i}`);
                    if (!inline) {
                        console.error(`Não foi possível encontrar a inline de parte #${i} para preencher. O formulário pode não ter sido adicionado a tempo.`);
                        continue;
                    }
                    
                    const parte = partes[i];
                    console.log(`Processando inline #${i} com dados:`, parte);

                    const prefix = `id_partes_processuais-${i}-`;
                    const tipoPoloSelect = inline.querySelector(`#${prefix}tipo_polo`);
                    const nomeInput = inline.querySelector(`#${prefix}nome`);
                    const tipoPessoaSelect = inline.querySelector(`#${prefix}tipo_pessoa`);
                    const documentoInput = inline.querySelector(`#${prefix}documento`);
                    const enderecoInput = inline.querySelector(`#${prefix}endereco`);

                    if (nomeInput) nomeInput.value = parte.nome || '';
                                            if (tipoPoloSelect) tipoPoloSelect.value = parte.tipo_polo || '';
                                            if (tipoPessoaSelect) {
                                                const apiTipoPessoa = parte.tipo_pessoa ? parte.tipo_pessoa.toUpperCase() : '';
                                                tipoPessoaSelect.value = tipoPessoaMap[apiTipoPessoa] || '';
                                            }
                                            if (documentoInput) {                        documentoInput.value = parte.documento || '';
                        documentoInput.dispatchEvent(new Event('input', { bubbles: true })); 
                    }
                    if (enderecoInput) enderecoInput.value = parte.endereco || '';

                    // Garante que o checkbox de deleção esteja desmarcado para as partes que estamos preenchendo
                    const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                    if (deleteCheckbox) deleteCheckbox.checked = false;
                    inline.style.display = 'block'; // Garante que a inline esteja visível
                }
            }, 500); 
        }

        if (andamentos && andamentos.length > 0) {
            const addAndamentoButton = document.querySelector('#andamentos-group .add-row a');
            const totalAndamentosForms = document.querySelectorAll('.dynamic-andamentos').length;

            for (let i = totalAndamentosForms; i < andamentos.length; i++) {
                if (addAndamentoButton) {
                    addAndamentoButton.click();
                }
            }

            setTimeout(() => {
                document.querySelectorAll('.dynamic-andamentos').forEach((inline, i) => {
                    if (i < andamentos.length) {
                        const andamento = andamentos[i];
                        const prefix = `id_andamentos-${i}-`;
                        const dataInput = inline.querySelector(`#${prefix}data_0`);
                        const horaInput = inline.querySelector(`#${prefix}data_1`);
                        const descricaoInput = inline.querySelector(`#${prefix}descricao`);

                        if (dataInput && horaInput && andamento.data) {
                            const dateTime = new Date(andamento.data);
                            dataInput.value = dateTime.toLocaleDateString('pt-BR');
                            horaInput.value = dateTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        }
                        if (descricaoInput) descricaoInput.value = andamento.descricao || '';

                        const deleteCheckbox = inline.querySelector('input[id$="-DELETE"]');
                        if (deleteCheckbox) deleteCheckbox.checked = false;
                    }
                });
            }, 500);
        }
    }

    // --- Inicialização de Inlines existentes ---
    document.querySelectorAll('.dynamic-partes').forEach(setupParteInline);

    // --- Configuração para novas inlines adicionadas dinamicamente ---
    if (typeof jQuery !== 'undefined') {
        jQuery(document).on('formset:added', function(event, $row, formsetName) {
            // Verifica se a nova linha pertence ao formset 'partes_processuais'
            if (formsetName === 'partes_processuais') {
                // $row é um objeto jQuery, pegamos o elemento DOM com [0]
                if ($row && $row.length) {
                    setupParteInline($row[0]);
                }
            }
        });
    }

});
