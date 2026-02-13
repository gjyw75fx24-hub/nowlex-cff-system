window.addEventListener('DOMContentLoaded', () => {
    const chartDataElement = document.getElementById('chart_data_script');
    if (!chartDataElement) return;

    const chartData = JSON.parse(chartDataElement.textContent || '[]');
    const labels = chartData.map((c) => c.nome);
    const processCounts = chartData.map((c) => c.total_processos);
    const valuations = chartData.map((c) => c.valor_total);

    const changelist = document.getElementById('changelist');
    if (!changelist) return;

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
        <div class="chart-wrapper" style="width: 45%; min-width: 340px;">
            <h3>Distribuição de Processos por Carteira</h3>
            <canvas id="processCountChart"></canvas>
        </div>
        <div class="chart-wrapper" style="width: 45%; min-width: 340px;">
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

    const ctx1 = document.getElementById('processCountChart')?.getContext('2d');
    if (ctx1) {
        new Chart(ctx1, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    label: 'Nº de Processos',
                    data: processCounts,
                    backgroundColor: [
                        'rgba(255, 99, 132, 0.7)', 'rgba(54, 162, 235, 0.7)',
                        'rgba(255, 206, 86, 0.7)', 'rgba(75, 192, 192, 0.7)',
                        'rgba(153, 102, 255, 0.7)', 'rgba(255, 159, 64, 0.7)',
                    ],
                    borderColor: '#fff',
                    borderWidth: 2,
                }],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'top' },
                },
            },
        });
    }

    const ctx2 = document.getElementById('valuationChart')?.getContext('2d');
    if (ctx2) {
        new Chart(ctx2, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Valor Total da Carteira (R$)',
                    data: valuations,
                    backgroundColor: 'rgba(75, 192, 192, 0.7)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1,
                }],
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback(value) {
                                return `R$ ${Number(value || 0).toLocaleString('pt-BR')}`;
                            },
                        },
                    },
                },
                plugins: {
                    legend: { display: false },
                },
            },
        });
    }

    const intersectionsElement = document.getElementById('intersection_data_script');
    if (!intersectionsElement) return;
    const intersectionData = JSON.parse(intersectionsElement.textContent || '{}');
    const carteiras = Array.isArray(intersectionData.carteiras) ? intersectionData.carteiras : [];
    const pairs = Array.isArray(intersectionData.pairs) ? intersectionData.pairs : [];
    const totalUniqueCpfs = Number(intersectionData.total_unique_cpfs || 0);
    const processChangelistUrl = String(intersectionData.process_changelist_url || '').trim();
    if (!carteiras.length) return;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    const pairKey = (aId, bId) => {
        const a = Number(aId || 0);
        const b = Number(bId || 0);
        if (!a || !b) return '';
        return a < b ? `${a}-${b}` : `${b}-${a}`;
    };
    const pairMap = new Map();
    pairs.forEach((pair) => {
        const key = pairKey(pair.a_id, pair.b_id);
        if (!key) return;
        pairMap.set(key, pair);
    });
    const getPair = (aId, bId) => pairMap.get(pairKey(aId, bId));

    const buildPairUrl = (pair) => {
        if (!processChangelistUrl) {
            return '';
        }
        const params = new URLSearchParams();
        params.set('intersection_carteira_a', String(pair.a_id));
        params.set('intersection_carteira_b', String(pair.b_id));
        return `${processChangelistUrl}?${params.toString()}`;
    };

    const colorPalette = [
        { fill: 'rgba(255, 193, 7, 0.35)', stroke: 'rgba(191, 137, 0, 0.75)' },
        { fill: 'rgba(0, 123, 255, 0.30)', stroke: 'rgba(0, 86, 179, 0.75)' },
        { fill: 'rgba(111, 66, 193, 0.24)', stroke: 'rgba(91, 44, 140, 0.70)' },
        { fill: 'rgba(40, 167, 69, 0.25)', stroke: 'rgba(30, 126, 52, 0.75)' },
        { fill: 'rgba(220, 53, 69, 0.20)', stroke: 'rgba(178, 34, 34, 0.70)' },
        { fill: 'rgba(23, 162, 184, 0.22)', stroke: 'rgba(17, 120, 137, 0.70)' },
    ];

    const section = document.createElement('section');
    section.style.marginTop = '22px';
    section.style.padding = '16px';
    section.style.border = '1px solid #d9e1ea';
    section.style.borderRadius = '10px';
    section.style.background = '#fff';
    section.innerHTML = `
        <h3 style="margin:0 0 8px 0;">Interseção de Cadastros/CPFs entre Carteiras</h3>
        <div style="font-size:12px; color:#46576b; margin-bottom:10px;">
            CPFs únicos analisados: <strong>${totalUniqueCpfs.toLocaleString('pt-BR')}</strong>
        </div>
        <div class="carteira-intersection-diagram" style="width:100%; overflow:auto; border:1px solid #e7edf4; border-radius:8px; padding:8px; box-sizing:border-box;"></div>
        <div class="carteira-intersection-table-wrap" style="margin-top:12px;"></div>
    `;
    chartContainer.appendChild(section);

    const diagramWrap = section.querySelector('.carteira-intersection-diagram');
    const tableWrap = section.querySelector('.carteira-intersection-table-wrap');
    if (!diagramWrap || !tableWrap) return;

    const maxCpf = Math.max(...carteiras.map((c) => Number(c.cpf_total || 0)), 1);
    const radii = carteiras.map((carteira) => {
        const ratio = Number(carteira.cpf_total || 0) / maxCpf;
        return 44 + (Math.sqrt(ratio) * 56);
    });
    const radiiSum = radii.reduce((sum, radius) => sum + radius, 0);
    const width = Math.max(900, Math.round(580 + (radiiSum * 1.05)));
    const height = Math.max(420, Math.round(350 + (carteiras.length * 10)));
    const padding = 26;
    const cx = width / 2;
    const cy = height / 2;
    const layoutRadiusX = Math.max(120, Math.min(width * 0.30, (width / 2) - 180));
    const layoutRadiusY = Math.max(95, Math.min(height * 0.25, (height / 2) - 140));
    const nodes = carteiras.map((carteira, index) => {
        const color = colorPalette[index % colorPalette.length];
        const angle = (Math.PI * 2 * index) / Math.max(carteiras.length, 1);
        return {
            id: Number(carteira.id),
            nome: carteira.nome,
            cpf_total: Number(carteira.cpf_total || 0),
            percent_global: Number(carteira.percent_global || 0),
            r: radii[index],
            color,
            x: cx + (layoutRadiusX * Math.cos(angle)),
            y: cy + (layoutRadiusY * Math.sin(angle)),
        };
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const circleArea = (radius) => Math.PI * radius * radius;
    const overlapArea = (r1, r2, d) => {
        const radius1 = Math.max(0, Number(r1 || 0));
        const radius2 = Math.max(0, Number(r2 || 0));
        const dist = Math.max(0, Number(d || 0));
        if (dist >= radius1 + radius2) return 0;
        if (dist <= Math.abs(radius1 - radius2)) {
            return Math.PI * Math.min(radius1, radius2) ** 2;
        }
        const alpha = Math.acos(clamp((dist * dist + radius1 * radius1 - radius2 * radius2) / (2 * dist * radius1), -1, 1));
        const beta = Math.acos(clamp((dist * dist + radius2 * radius2 - radius1 * radius1) / (2 * dist * radius2), -1, 1));
        const part1 = radius1 * radius1 * alpha;
        const part2 = radius2 * radius2 * beta;
        const part3 = 0.5 * Math.sqrt(
            Math.max(
                0,
                (-dist + radius1 + radius2) *
                (dist + radius1 - radius2) *
                (dist - radius1 + radius2) *
                (dist + radius1 + radius2)
            )
        );
        return part1 + part2 - part3;
    };
    const solveDistanceForTargetOverlap = (r1, r2, targetArea) => {
        const minContainDistance = Math.abs(r1 - r2) + 0.001;
        const maxTouchDistance = r1 + r2 - 0.001;
        const maxArea = Math.PI * Math.min(r1, r2) ** 2;
        const desiredArea = clamp(Number(targetArea || 0), 0, maxArea);

        if (desiredArea <= 0.0001) {
            return r1 + r2 + 10;
        }
        if (desiredArea >= (maxArea - 0.001)) {
            return minContainDistance;
        }

        let low = minContainDistance;
        let high = maxTouchDistance;
        for (let i = 0; i < 56; i += 1) {
            const mid = (low + high) / 2;
            const area = overlapArea(r1, r2, mid);
            if (area > desiredArea) {
                low = mid;
            } else {
                high = mid;
            }
        }
        return (low + high) / 2;
    };
    const keepInside = (node) => {
        node.x = clamp(node.x, node.r + padding, width - node.r - padding);
        node.y = clamp(node.y, node.r + padding, height - node.r - padding);
    };
    const pairTargetDistance = new Map();
    pairs.forEach((pair) => {
        const nodeA = nodeById.get(Number(pair.a_id));
        const nodeB = nodeById.get(Number(pair.b_id));
        if (!nodeA || !nodeB) {
            return;
        }
        const aCount = Math.max(1, Number(nodeA.cpf_total || 0));
        const bCount = Math.max(1, Number(nodeB.cpf_total || 0));
        const interCount = Math.max(0, Number(pair.count || 0));
        const areaA = circleArea(nodeA.r);
        const areaB = circleArea(nodeB.r);
        const targetFromA = areaA * (interCount / aCount);
        const targetFromB = areaB * (interCount / bCount);
        const targetArea = clamp(
            (targetFromA + targetFromB) / 2,
            0,
            Math.PI * Math.min(nodeA.r, nodeB.r) ** 2
        );
        const dist = solveDistanceForTargetOverlap(nodeA.r, nodeB.r, targetArea);
        pairTargetDistance.set(pairKey(nodeA.id, nodeB.id), dist);
    });
    const targetDistance = (a, b) => {
        const pair = getPair(a.id, b.id);
        if (pair) {
            return pairTargetDistance.get(pairKey(a.id, b.id)) || (a.r + b.r - 4);
        }
        return a.r + b.r + 12;
    };

    for (let iter = 0; iter < 540; iter += 1) {
        for (let i = 0; i < nodes.length; i += 1) {
            for (let j = i + 1; j < nodes.length; j += 1) {
                const a = nodes[i];
                const b = nodes[j];
                const pair = getPair(a.id, b.id);
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let dist = Math.hypot(dx, dy);
                if (dist < 0.001) {
                    dx = 0.001 * (Math.random() - 0.5);
                    dy = 0.001 * (Math.random() - 0.5);
                    dist = Math.hypot(dx, dy);
                }
                const ux = dx / dist;
                const uy = dy / dist;
                const desired = targetDistance(a, b);
                const force = (dist - desired) * (pair ? 0.040 : 0.034);

                a.x += ux * force * 0.5;
                a.y += uy * force * 0.5;
                b.x -= ux * force * 0.5;
                b.y -= uy * force * 0.5;

                if (!pair) {
                    const minGapDistance = a.r + b.r + 8;
                    if (dist < minGapDistance) {
                        const repel = (minGapDistance - dist) * 0.38;
                        a.x -= ux * repel * 0.5;
                        a.y -= uy * repel * 0.5;
                        b.x += ux * repel * 0.5;
                        b.y += uy * repel * 0.5;
                    }
                }
            }
        }
        nodes.forEach(keepInside);
    }

    for (let pass = 0; pass < 80; pass += 1) {
        let moved = false;
        for (let i = 0; i < nodes.length; i += 1) {
            for (let j = i + 1; j < nodes.length; j += 1) {
                const a = nodes[i];
                const b = nodes[j];
                const pair = getPair(a.id, b.id);
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.max(0.001, Math.hypot(dx, dy));
                const ux = dx / dist;
                const uy = dy / dist;

                if (pair) {
                    const desired = targetDistance(a, b);
                    const diff = dist - desired;
                    if (Math.abs(diff) > 0.8) {
                        const pull = diff * 0.24;
                        a.x += ux * pull * 0.5;
                        a.y += uy * pull * 0.5;
                        b.x -= ux * pull * 0.5;
                        b.y -= uy * pull * 0.5;
                        moved = true;
                    }
                } else {
                    const minDist = a.r + b.r + 9;
                    if (dist < minDist) {
                        const push = (minDist - dist) * 0.30;
                        a.x -= ux * push * 0.5;
                        a.y -= uy * push * 0.5;
                        b.x += ux * push * 0.5;
                        b.y += uy * push * 0.5;
                        moved = true;
                    }
                }
            }
        }
        nodes.forEach(keepInside);
        if (!moved) break;
    }

    const defs = [];
    const intersectionOverlays = [];
    const mainCircles = [];
    const textLayers = [];
    const visibleOverlaps = [];

    nodes.forEach((node) => {
        mainCircles.push(
            `<circle id="carteira-circle-${node.id}" cx="${node.x.toFixed(2)}" cy="${node.y.toFixed(2)}" r="${node.r.toFixed(2)}" fill="${node.color.fill}" stroke="${node.color.stroke}" stroke-width="2"></circle>`
        );
        const nameOffset = clamp(node.r * 0.34, 16, 26);
        const labelY = node.y - nameOffset;
        const countLabel = `${Number(node.cpf_total || 0).toLocaleString('pt-BR')} CPF`;
        const percentLabel = `${Number(node.percent_global || 0).toLocaleString('pt-BR')}% do total`;
        textLayers.push(
            `<text x="${node.x.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle" font-size="12" fill="#2f3d4a" font-weight="600">${escapeHtml(node.nome)}</text>`
        );
        textLayers.push(
            `<text x="${node.x.toFixed(2)}" y="${(node.y - 2).toFixed(2)}" text-anchor="middle" font-size="13" fill="#1a2530" font-weight="700">${escapeHtml(countLabel)}</text>`
        );
        textLayers.push(
            `<text x="${node.x.toFixed(2)}" y="${(node.y + 18).toFixed(2)}" text-anchor="middle" font-size="11" fill="#455a6f">${escapeHtml(percentLabel)}</text>`
        );
    });

    pairs.forEach((pair) => {
        const nodeA = nodeById.get(Number(pair.a_id));
        const nodeB = nodeById.get(Number(pair.b_id));
        if (!nodeA || !nodeB) return;
        const dist = distance(nodeA, nodeB);
        const overlapExists = dist < (nodeA.r + nodeB.r - 0.8);
        if (!overlapExists) return;

        const key = pair.key || pairKey(pair.a_id, pair.b_id);
        const clipId = `pair-clip-${key}`;
        const pairUrl = buildPairUrl(pair);
        const countLabel = Number(pair.count || 0).toLocaleString('pt-BR');
        const titleText = `${pair.a_nome} ∩ ${pair.b_nome}: ${countLabel} CPF em comum`;
        visibleOverlaps.push(key);

        defs.push(
            `<clipPath id="${clipId}">
                <circle cx="${nodeA.x.toFixed(2)}" cy="${nodeA.y.toFixed(2)}" r="${nodeA.r.toFixed(2)}"></circle>
            </clipPath>`
        );

        const overlayCircle = `
            <circle
                cx="${nodeB.x.toFixed(2)}"
                cy="${nodeB.y.toFixed(2)}"
                r="${nodeB.r.toFixed(2)}"
                clip-path="url(#${clipId})"
                fill="rgba(27, 79, 155, 0.20)"
                stroke="rgba(27, 79, 155, 0.30)"
                stroke-width="1"
                class="carteira-intersection-hit"
                data-pair-key="${escapeHtml(key)}"
                ${pairUrl ? `data-url="${escapeHtml(pairUrl)}" tabindex="0" role="link"` : ''}
                style="${pairUrl ? 'cursor:pointer' : 'cursor:default'}"
            >
                <title>${escapeHtml(titleText)}${pairUrl ? ' (clique para abrir)' : ''}</title>
            </circle>
        `;
        intersectionOverlays.push(overlayCircle);
    });

    const svgParts = [
        `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Diagrama de interseção entre carteiras">`,
    ];
    if (defs.length) {
        svgParts.push('<defs>');
        svgParts.push(defs.join(''));
        svgParts.push('</defs>');
    }
    svgParts.push(mainCircles.join(''));
    svgParts.push(intersectionOverlays.join(''));
    svgParts.push(textLayers.join(''));
    svgParts.push('</svg>');
    diagramWrap.innerHTML = svgParts.join('');
    diagramWrap.querySelectorAll('.carteira-intersection-hit[data-url]').forEach((element) => {
        const open = () => {
            const url = element.getAttribute('data-url');
            if (url) {
                window.location.href = url;
            }
        };
        element.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            open();
        });
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open();
            }
        });
    });

    if (!pairs.length) {
        tableWrap.innerHTML = '<div style="font-size:13px; color:#57697d;">Sem interseções de CPF entre carteiras até o momento.</div>';
        return;
    }

    if (!visibleOverlaps.length) {
        tableWrap.innerHTML = `
            <div style="font-size:13px; color:#57697d; margin-bottom:8px;">
                Existem interseções reais nos dados. O layout foi ajustado para evitar sobreposição indevida.
            </div>
        `;
    }

    const rows = pairs
        .slice(0, 120)
        .map((pair) => {
            const pairUrl = buildPairUrl(pair);
            const openLink = pairUrl
                ? `<a href="${escapeHtml(pairUrl)}" style="font-weight:600;">Abrir lista</a>`
                : '—';
            return `
            <tr>
                <td>${escapeHtml(pair.a_nome)}</td>
                <td>${escapeHtml(pair.b_nome)}</td>
                <td style="text-align:right;">${Number(pair.count || 0).toLocaleString('pt-BR')}</td>
                <td style="text-align:right;">${Number(pair.pct_a || 0).toLocaleString('pt-BR')}%</td>
                <td style="text-align:right;">${Number(pair.pct_b || 0).toLocaleString('pt-BR')}%</td>
                <td style="text-align:right;">${Number(pair.pct_union || 0).toLocaleString('pt-BR')}%</td>
                <td style="text-align:center;">${openLink}</td>
            </tr>
        `;
        })
        .join('');

    tableWrap.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead>
                <tr style="background:#eef3f8;">
                    <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Carteira A</th>
                    <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Carteira B</th>
                    <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">CPFs em comum</th>
                    <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">% de A</th>
                    <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">% de B</th>
                    <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">% da união</th>
                    <th style="text-align:center; padding:6px; border:1px solid #d8e1ea;">Ações</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
});
