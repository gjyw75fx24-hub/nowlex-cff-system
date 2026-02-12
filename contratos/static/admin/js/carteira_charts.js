// Arquivo: contratos/static/admin/js/carteira_charts.js

window.addEventListener('DOMContentLoaded', () => {
    const chartDataElement = document.getElementById('chart_data_script');
    if (!chartDataElement) return;

    const chartData = JSON.parse(chartDataElement.textContent);
    const labels = chartData.map(c => c.nome);
    const processCounts = chartData.map(c => c.total_processos);
    const valuations = chartData.map(c => c.valor_total);

    // Insere os containers para os gráficos abaixo da tabela (evita layout lado-a-lado)
    const changelist = document.getElementById('changelist');
    if (changelist) {
        const chartContainer = document.createElement('div');
        chartContainer.className = 'charts-container';
        chartContainer.style.display = 'flex';
        chartContainer.style.justifyContent = 'space-around';
        chartContainer.style.flexWrap = 'wrap';
        chartContainer.style.gap = '16px';
        chartContainer.style.padding = '20px';
        chartContainer.style.backgroundColor = '#f8f8f8';
        chartContainer.style.width = '100%';
        chartContainer.style.boxSizing = 'border-box';
        chartContainer.style.clear = 'both';
        chartContainer.style.marginTop = '16px';
        chartContainer.innerHTML = `
            <div class="chart-wrapper" style="width: 45%;">
                <h3>Distribuição de Processos por Carteira</h3>
                <canvas id="processCountChart"></canvas>
            </div>
            <div class="chart-wrapper" style="width: 45%;">
                <h3>Valuation por Carteira (R$)</h3>
                <canvas id="valuationChart"></canvas>
            </div>
        `;
        const changelistForm = document.getElementById('changelist-form');
        if (changelistForm && changelistForm.parentNode) {
            changelistForm.parentNode.insertBefore(chartContainer, changelistForm.nextSibling);
        } else {
            changelist.appendChild(chartContainer);
        }
    }

    // Gráfico de Pizza: Distribuição de Processos
    const ctx1 = document.getElementById('processCountChart').getContext('2d');
    new Chart(ctx1, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: 'Nº de Processos',
                data: processCounts,
                backgroundColor: [
                    'rgba(255, 99, 132, 0.7)', 'rgba(54, 162, 235, 0.7)',
                    'rgba(255, 206, 86, 0.7)', 'rgba(75, 192, 192, 0.7)',
                    'rgba(153, 102, 255, 0.7)', 'rgba(255, 159, 64, 0.7)'
                ],
                borderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += context.parsed;
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });

    // Gráfico de Barras: Valuation
    const ctx2 = document.getElementById('valuationChart').getContext('2d');
    new Chart(ctx2, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Valor Total da Carteira (R$)',
                data: valuations,
                backgroundColor: 'rgba(75, 192, 192, 0.7)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value, index, values) {
                            return 'R$ ' + value.toLocaleString('pt-BR');
                        }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += 'R$ ' + context.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
});
