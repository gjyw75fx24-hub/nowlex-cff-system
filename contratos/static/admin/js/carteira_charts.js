window.addEventListener('DOMContentLoaded', () => {
    const chartDataElement = document.getElementById('chart_data_script');
    if (!chartDataElement) return;

    const chartData = JSON.parse(chartDataElement.textContent || '[]');
    const fallbackHexPalette = [
        '#FFC107', '#2196F3', '#673AB7', '#4CAF50', '#F44336', '#00BCD4',
        '#FF9800', '#8BC34A', '#795548', '#9C27B0',
    ];
    const normalizeHex = (value, fallback = '#417690') => {
        const raw = String(value || '').trim();
        if (!raw) return fallback;
        const candidate = raw.startsWith('#') ? raw : `#${raw}`;
        return /^#[0-9A-Fa-f]{6}$/.test(candidate) ? candidate.toUpperCase() : fallback;
    };
    const hexToRgb = (hex) => {
        const normalized = normalizeHex(hex, '#417690');
        return {
            r: parseInt(normalized.slice(1, 3), 16),
            g: parseInt(normalized.slice(3, 5), 16),
            b: parseInt(normalized.slice(5, 7), 16),
        };
    };
    const hexToRgba = (hex, alpha) => {
        const { r, g, b } = hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };
    const resolveCarteiraColor = (item, index) => {
        const fallback = fallbackHexPalette[index % fallbackHexPalette.length];
        return normalizeHex(item?.cor_grafico, fallback);
    };

    const labels = chartData.map((c) => c.nome);
    const processCounts = chartData.map((c) => Number(c.total_processos || 0));
    const valuations = chartData.map((c) => Number(c.valor_total || 0));
    const carteiraBaseColors = chartData.map((item, index) => resolveCarteiraColor(item, index));

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
                    backgroundColor: carteiraBaseColors.map((hex) => hexToRgba(hex, 0.72)),
                    borderColor: carteiraBaseColors.map((hex) => hexToRgba(hex, 0.98)),
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
                    backgroundColor: carteiraBaseColors.map((hex) => hexToRgba(hex, 0.58)),
                    borderColor: carteiraBaseColors.map((hex) => hexToRgba(hex, 0.92)),
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
    const sanitizeFileName = (value) => {
        const normalized = String(value || 'kpi')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase();
        return normalized || 'kpi';
    };
    const makeTimestampForFile = () => {
        const now = new Date();
        const yyyy = String(now.getFullYear());
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
    };
    const createKpiFileName = (panelTitle, extension = 'jpg') => {
        const base = sanitizeFileName(panelTitle || 'kpi');
        const ext = String(extension || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
        return `${base}-${makeTimestampForFile()}.${ext}`;
    };
    const triggerDownloadDataUrl = (dataUrl, fileName) => {
        const href = String(dataUrl || '').trim();
        if (!href) return;
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = String(fileName || 'kpi.jpg');
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    };
    let html2CanvasLoaderPromise = null;
    const ensureHtml2Canvas = () => {
        if (typeof window.html2canvas === 'function') {
            return Promise.resolve(window.html2canvas);
        }
        if (html2CanvasLoaderPromise) {
            return html2CanvasLoaderPromise;
        }
        html2CanvasLoaderPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
            script.async = true;
            script.onload = () => {
                if (typeof window.html2canvas === 'function') {
                    resolve(window.html2canvas);
                    return;
                }
                reject(new Error('html2canvas indisponivel'));
            };
            script.onerror = () => reject(new Error('Falha ao carregar html2canvas'));
            document.head.appendChild(script);
        });
        return html2CanvasLoaderPromise;
    };
    const clonePanelWithImageCharts = (panel) => {
        const clone = panel.cloneNode(true);
        clone.setAttribute('data-print-kpi-root', '1');
        clone.querySelectorAll('[data-kpi-print-btn]').forEach((btn) => btn.remove());
        const sourceCanvases = Array.from(panel.querySelectorAll('canvas'));
        const clonedCanvases = Array.from(clone.querySelectorAll('canvas'));
        clonedCanvases.forEach((canvas, index) => {
            const sourceCanvas = sourceCanvases[index];
            if (!sourceCanvas) return;
            try {
                const img = document.createElement('img');
                img.src = sourceCanvas.toDataURL('image/png');
                img.alt = 'Grafico do KPI';
                img.style.display = 'block';
                img.style.maxWidth = '100%';
                const width = Number(sourceCanvas.clientWidth || sourceCanvas.width || 0);
                if (width > 0) {
                    img.style.width = `${width}px`;
                }
                canvas.replaceWith(img);
            } catch (error) {
                // ignore canvas conversion failures and keep the canvas node
            }
        });
        return clone;
    };
    const renderPanelToJpegFallback = (panel) => {
        return new Promise((resolve, reject) => {
            try {
                const clone = clonePanelWithImageCharts(panel);
                const rect = panel.getBoundingClientRect();
                const width = Math.max(1, Math.ceil(panel.scrollWidth || rect.width || 1));
                const height = Math.max(1, Math.ceil(panel.scrollHeight || rect.height || 1));
                const xhtml = `
                    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px; height:${height}px; background:#fff; padding:0; margin:0;">
                        ${clone.outerHTML}
                    </div>
                `;
                const svg = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                        <foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject>
                    </svg>
                `;
                const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                const objectUrl = URL.createObjectURL(blob);
                const image = new Image();
                image.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) {
                            URL.revokeObjectURL(objectUrl);
                            reject(new Error('Canvas indisponivel'));
                            return;
                        }
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, width, height);
                        ctx.drawImage(image, 0, 0, width, height);
                        const jpegData = canvas.toDataURL('image/jpeg', 0.92);
                        URL.revokeObjectURL(objectUrl);
                        resolve(jpegData);
                    } catch (error) {
                        URL.revokeObjectURL(objectUrl);
                        reject(error);
                    }
                };
                image.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error('Falha ao renderizar imagem'));
                };
                image.src = objectUrl;
            } catch (error) {
                reject(error);
            }
        });
    };
    const exportPanelAsJpeg = async (panel, panelTitle, triggerButton) => {
        if (!panel) return false;
        const fileName = createKpiFileName(panelTitle, 'jpg');
        const button = triggerButton || null;
        const originalTitle = button ? button.title : '';
        const previousPointerEvents = button ? button.style.pointerEvents : '';
        if (button) {
            button.title = 'Gerando JPG...';
            button.style.pointerEvents = 'none';
        }
        try {
            const html2canvas = await ensureHtml2Canvas();
            const canvas = await html2canvas(panel, {
                backgroundColor: '#ffffff',
                scale: Math.max(2, Math.ceil(window.devicePixelRatio || 1)),
                useCORS: true,
                logging: false,
                ignoreElements: (element) => Boolean(element?.dataset?.kpiPrintBtn),
            });
            const jpegData = canvas.toDataURL('image/jpeg', 0.92);
            triggerDownloadDataUrl(jpegData, fileName);
            return true;
        } catch (error) {
            try {
                const fallbackData = await renderPanelToJpegFallback(panel);
                triggerDownloadDataUrl(fallbackData, fileName);
                return true;
            } catch (fallbackError) {
                window.alert('Nao foi possivel gerar o JPG desta janela de KPI.');
                return false;
            }
        } finally {
            if (button) {
                button.style.pointerEvents = previousPointerEvents;
                button.title = originalTitle;
            }
        }
    };
    const printPanelElement = (panel, panelTitle) => {
        if (!panel) return;
        const titleText = String(panelTitle || 'KPI').trim() || 'KPI';
        const printWindow = window.open('about:blank', '_blank', 'width=1200,height=900');
        if (!printWindow) return;

        const clone = clonePanelWithImageCharts(panel);

        const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .map((link) => {
                const href = String(link.getAttribute('href') || '').trim();
                if (!href) return '';
                return `<link rel="stylesheet" href="${escapeHtml(href)}">`;
            })
            .join('');

        let doc = null;
        try {
            doc = printWindow.document;
        } catch (error) {
            return;
        }

        const htmlContent = `
            <!doctype html>
            <html lang="pt-BR">
                <head>
                    <meta charset="utf-8">
                    <title>${escapeHtml(titleText)}</title>
                    ${stylesheets}
                    <style>
                        @page { size: auto; margin: 12mm; }
                        html, body { margin: 0; padding: 0; background: #fff; }
                        body { font-family: Arial, sans-serif; color: #1f2f3e; }
                        [data-print-kpi-root] { margin: 0; width: 100%; box-sizing: border-box; overflow: visible !important; }
                        [data-print-kpi-root] * { box-sizing: border-box; }
                        [data-print-kpi-root] canvas,
                        [data-print-kpi-root] img,
                        [data-print-kpi-root] svg { max-width: 100%; }
                    </style>
                </head>
                <body>${clone.outerHTML}</body>
            </html>
        `;

        try {
            doc.open();
            doc.write(htmlContent);
            doc.close();
        } catch (error) {
            try {
                printWindow.location.replace(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
            } catch (fallbackError) {
                return;
            }
        }

        const executePrint = () => {
            printWindow.focus();
            printWindow.print();
            setTimeout(() => {
                try { printWindow.close(); } catch (error) { /* noop */ }
            }, 120);
        };
        if (doc.readyState === 'complete') {
            setTimeout(executePrint, 120);
        } else {
            printWindow.addEventListener('load', () => setTimeout(executePrint, 120), { once: true });
        }
    };
    const attachPrintButtonToPanel = (panel, panelTitle) => {
        if (!panel || panel.dataset.kpiPrintReady === '1') return;
        panel.dataset.kpiPrintReady = '1';
        panel.style.position = panel.style.position || 'relative';
        const currentPaddingBottom = Number.parseFloat(panel.style.paddingBottom || '0');
        if (!Number.isFinite(currentPaddingBottom) || currentPaddingBottom < 38) {
            panel.style.paddingBottom = '40px';
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.kpiPrintBtn = '1';
        button.title = 'Clique: imprimir/PDF. Shift+clique: baixar JPG';
        button.setAttribute('aria-label', 'Imprimir ou baixar JPG desta janela do KPI');
        button.style.position = 'absolute';
        button.style.right = '10px';
        button.style.bottom = '8px';
        button.style.width = '28px';
        button.style.height = '28px';
        button.style.borderRadius = '999px';
        button.style.border = '1px solid #d4dee9';
        button.style.background = '#ffffff';
        button.style.color = '#466480';
        button.style.display = 'inline-flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.cursor = 'pointer';
        button.style.opacity = '0.82';
        button.style.boxShadow = '0 1px 3px rgba(24, 39, 53, 0.12)';
        button.style.padding = '0';
        button.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M9 4h6l1 2h3c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V8c0-1.1.9-2 2-2h3l1-2zm3 12a4 4 0 100-8 4 4 0 000 8zM7 9a1 1 0 100-2 1 1 0 000 2z"></path>
            </svg>
        `;
        button.addEventListener('mouseenter', () => { button.style.opacity = '1'; });
        button.addEventListener('mouseleave', () => { button.style.opacity = '0.82'; });
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
                await exportPanelAsJpeg(panel, panelTitle, button);
                return;
            }
            printPanelElement(panel, panelTitle);
        });
        panel.appendChild(button);
    };
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

    const buildCircleColor = (carteira, index) => {
        const base = resolveCarteiraColor(carteira, index);
        return {
            base,
            fill: hexToRgba(base, 0.30),
            stroke: hexToRgba(base, 0.76),
        };
    };

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
    attachPrintButtonToPanel(section, 'Intersecao de Cadastros e CPFs');

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
        const color = buildCircleColor(carteira, index);
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
    } else {
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

        tableWrap.innerHTML += `
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
    }

    const kpiDataElement = document.getElementById('kpi_data_script');
    if (!kpiDataElement) return;

    let kpiData = {};
    try {
        kpiData = JSON.parse(kpiDataElement.textContent || '{}');
    } catch (error) {
        console.error('[carteira-kpi] erro ao parsear dados:', error);
        return;
    }

    const kpiBuckets = (kpiData && typeof kpiData === 'object' && kpiData.buckets) ? kpiData.buckets : {};
    const kpiUfOptions = Array.isArray(kpiData.ufs) ? kpiData.ufs : [];
    const kpiProcessChangelistUrl = String(kpiData.process_changelist_url || '').trim();
    const peticaoTypes = Array.isArray(kpiData.peticao_types) ? kpiData.peticao_types : [];
    const peticaoByCarteira = Array.isArray(kpiData.peticao_by_carteira) ? kpiData.peticao_by_carteira : [];
    const peticaoTotals = Array.isArray(kpiData.peticao_totals) ? kpiData.peticao_totals : [];
    const priorityKpi = (kpiData && typeof kpiData === 'object' && kpiData.priority_kpi)
        ? kpiData.priority_kpi
        : {};
    const priorityRows = Array.isArray(priorityKpi.rows) ? priorityKpi.rows : [];
    const priorityByPriority = Array.isArray(priorityKpi.by_priority) ? priorityKpi.by_priority : [];
    const priorityByUf = Array.isArray(priorityKpi.by_uf) ? priorityKpi.by_uf : [];
    const priorityTotals = (priorityKpi && typeof priorityKpi === 'object' && priorityKpi.totals)
        ? priorityKpi.totals
        : {};
    const productivityKpi = (kpiData && typeof kpiData === 'object' && kpiData.productivity_kpi)
        ? kpiData.productivity_kpi
        : {};
    const productivityUsers = Array.isArray(productivityKpi.users) ? productivityKpi.users : [];
    const productivityDaily = Array.isArray(productivityKpi.daily) ? productivityKpi.daily : [];
    const productivityTotals = (productivityKpi && typeof productivityKpi === 'object' && productivityKpi.totals)
        ? productivityKpi.totals
        : {};
    const productivitySemData = (productivityKpi && typeof productivityKpi === 'object' && productivityKpi.sem_data)
        ? productivityKpi.sem_data
        : {};
    const productivityPending = (productivityKpi && typeof productivityKpi === 'object' && productivityKpi.pending)
        ? productivityKpi.pending
        : {};
    const productivityDateMin = String(productivityKpi?.date_min || '').trim();
    const productivityDateMax = String(productivityKpi?.date_max || '').trim();
    const onlinePresenceKpi = (kpiData && typeof kpiData === 'object' && kpiData.online_presence_kpi)
        ? kpiData.online_presence_kpi
        : {};
    if (!kpiUfOptions.length || !Object.keys(kpiBuckets).length) return;

    const kpiSection = document.createElement('section');
    kpiSection.style.marginTop = '22px';
    kpiSection.style.padding = '16px';
    kpiSection.style.border = '1px solid #d9e1ea';
    kpiSection.style.borderRadius = '10px';
    kpiSection.style.background = '#fff';
    kpiSection.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;">
            <h3 style="margin:0;">KPIs da Análise por Carteira x Tipo</h3>
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                UF:
                <select class="carteira-kpi-uf" style="padding:4px 8px; min-width:130px;"></select>
            </label>
        </div>
        <div class="carteira-kpi-summary" style="margin-bottom:10px; font-size:12px; color:#46576b;"></div>
        <div class="carteira-kpi-table-wrap" style="overflow:auto;"></div>
        <div class="carteira-kpi-questions-wrap" style="margin-top:10px;"></div>
    `;
    chartContainer.appendChild(kpiSection);
    attachPrintButtonToPanel(kpiSection, 'KPIs da Analise por Carteira e Tipo');

    const ufSelect = kpiSection.querySelector('.carteira-kpi-uf');
    const summaryWrap = kpiSection.querySelector('.carteira-kpi-summary');
    const tableWrapKpi = kpiSection.querySelector('.carteira-kpi-table-wrap');
    const questionsWrap = kpiSection.querySelector('.carteira-kpi-questions-wrap');
    if (!ufSelect || !summaryWrap || !tableWrapKpi || !questionsWrap) return;

    const kpiCharts = [];
    const destroyKpiCharts = () => {
        while (kpiCharts.length) {
            const chart = kpiCharts.pop();
            if (chart && typeof chart.destroy === 'function') {
                chart.destroy();
            }
        }
    };

    const numberPt = (value) => Number(value || 0).toLocaleString('pt-BR');
    const pctPt = (value) => `${Number(value || 0).toLocaleString('pt-BR')}%`;
    const getComboQuestionByKey = (combo, questionKey) => {
        const questions = Array.isArray(combo?.questions) ? combo.questions : [];
        const key = String(questionKey || '').trim();
        if (!key) return null;
        return questions.find((item) => String(item?.chave || '').trim() === key) || null;
    };
    const getComboQuestionBase = (combo, questionKey) => {
        const question = getComboQuestionByKey(combo, questionKey);
        return Number(question?.cards || 0);
    };
    const formatByQuestionBase = (countValue, baseValue) => {
        const count = Number(countValue || 0);
        const base = Number(baseValue || 0);
        if (!base) {
            return `${numberPt(count)} / 0`;
        }
        const pct = Number(((count * 100) / base).toFixed(2));
        return `${numberPt(count)} / ${numberPt(base)} (${pctPt(pct)})`;
    };
    const truncateLabel = (value, limit = 30) => {
        const text = String(value || '');
        if (text.length <= limit) return text;
        return `${text.slice(0, limit - 1)}…`;
    };

    const kpiPalette = [
        '#3D6D8A', '#2E8BC0', '#4DAA57', '#B48B1E', '#9C4E9A', '#D46A4A', '#5C6BC0', '#6B8E23',
    ];
    const paletteColor = (index, alpha = 1) => {
        const hex = kpiPalette[index % kpiPalette.length];
        return hexToRgba(hex, alpha);
    };

    const buildKpiResponseUrl = (combo, question, answer, ufCode) => {
        if (!kpiProcessChangelistUrl) return '';
        if (!combo || !question || !answer) return '';
        const carteiraId = Number(combo.carteira_id || 0);
        const tipoId = Number(combo.tipo_id || 0);
        const questionKey = String(question.chave || '').trim();
        const answerValue = String(answer.valor || '').trim();
        if (!carteiraId || !tipoId || !questionKey || !answerValue) {
            return '';
        }
        const params = new URLSearchParams();
        params.set('kpi_carteira_id', String(carteiraId));
        params.set('kpi_tipo_id', String(tipoId));
        params.set('kpi_question', questionKey);
        params.set('kpi_answer', answerValue);
        if (ufCode && ufCode !== 'ALL') {
            params.set('kpi_uf', String(ufCode));
        }
        return `${kpiProcessChangelistUrl}?${params.toString()}`;
    };

    const buildPeticaoUrl = (tipoSlug, carteiraId) => {
        if (!kpiProcessChangelistUrl) return '';
        const slug = String(tipoSlug || '').trim();
        if (!slug) return '';
        const params = new URLSearchParams();
        params.set('peticao_tipo', slug);
        const carteiraParsed = Number(carteiraId || 0);
        if (carteiraParsed > 0) {
            params.set('peticao_carteira_id', String(carteiraParsed));
        }
        return `${kpiProcessChangelistUrl}?${params.toString()}`;
    };

    const buildPriorityKpiUrl = (tagId, status, ufCode) => {
        if (!kpiProcessChangelistUrl) return '';
        const parsedTagId = Number(tagId || 0);
        if (!parsedTagId) return '';
        const statusValue = String(status || 'all').trim().toLowerCase();
        const params = new URLSearchParams();
        params.set('priority_kpi_tag_id', String(parsedTagId));
        if (statusValue && statusValue !== 'all') {
            params.set('priority_kpi_status', statusValue);
        }
        const ufValue = String(ufCode || '').trim().toUpperCase();
        if (ufValue && ufValue !== 'ALL') {
            params.set('priority_kpi_uf', ufValue);
        }
        return `${kpiProcessChangelistUrl}?${params.toString()}`;
    };

    const buildUfDatasets = (answers) => {
        const ufTotals = {};
        answers.forEach((answer) => {
            const byUf = Array.isArray(answer.by_uf) ? answer.by_uf : [];
            byUf.forEach((item) => {
                const uf = String(item.uf || '').trim();
                if (!uf) return;
                ufTotals[uf] = (ufTotals[uf] || 0) + Number(item.count || 0);
            });
        });

        const orderedUfs = Object.entries(ufTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([uf]) => uf);
        if (!orderedUfs.length) {
            return [];
        }

        const maxSeries = 6;
        const mainUfs = orderedUfs.slice(0, maxSeries);
        const mainUfSet = new Set(mainUfs);
        const includeOthers = orderedUfs.length > maxSeries;
        const datasets = [];

        mainUfs.forEach((uf, idx) => {
            datasets.push({
                label: uf,
                data: answers.map((answer) => {
                    const total = Number(answer.count || 0);
                    if (!total) return 0;
                    const byUf = Array.isArray(answer.by_uf) ? answer.by_uf : [];
                    const match = byUf.find((item) => String(item.uf || '') === uf);
                    const count = Number(match?.count || 0);
                    return Number(((count * 100) / total).toFixed(2));
                }),
                backgroundColor: paletteColor(idx, 0.75),
                borderColor: paletteColor(idx, 0.92),
                borderWidth: 1,
                stack: 'uf',
            });
        });

        if (includeOthers) {
            datasets.push({
                label: 'Outras UFs',
                data: answers.map((answer) => {
                    const total = Number(answer.count || 0);
                    if (!total) return 0;
                    const byUf = Array.isArray(answer.by_uf) ? answer.by_uf : [];
                    const othersCount = byUf.reduce((sum, item) => {
                        const uf = String(item.uf || '');
                        if (mainUfSet.has(uf)) return sum;
                        return sum + Number(item.count || 0);
                    }, 0);
                    return Number(((othersCount * 100) / total).toFixed(2));
                }),
                backgroundColor: 'rgba(142, 155, 170, 0.70)',
                borderColor: 'rgba(110, 126, 145, 0.95)',
                borderWidth: 1,
                stack: 'uf',
            });
        }

        return datasets;
    };

    const renderQuestionCharts = (question, verticalId, horizontalId) => {
        const answers = Array.isArray(question.answers) ? question.answers : [];
        if (!answers.length) {
            return;
        }
        const verticalCanvas = document.getElementById(verticalId);
        const horizontalCanvas = document.getElementById(horizontalId);
        if (!verticalCanvas || !horizontalCanvas) {
            return;
        }

        const labels = answers.map((answer) => truncateLabel(answer.valor, 28));
        const values = answers.map((answer) => Number(answer.count || 0));
        const verticalCtx = verticalCanvas.getContext('2d');
        if (verticalCtx) {
            const verticalChart = new Chart(verticalCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Análises',
                        data: values,
                        backgroundColor: labels.map((_, idx) => paletteColor(idx, 0.66)),
                        borderColor: labels.map((_, idx) => paletteColor(idx, 0.92)),
                        borderWidth: 1,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: (items) => {
                                    const item = items?.[0];
                                    return item ? String(answers[item.dataIndex]?.valor || '') : '';
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            ticks: {
                                maxRotation: 0,
                                autoSkip: true,
                                font: { size: 10 },
                            },
                            grid: { display: false },
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                precision: 0,
                                font: { size: 10 },
                            },
                        },
                    },
                },
            });
            kpiCharts.push(verticalChart);
        }

        const ufDatasets = buildUfDatasets(answers);
        if (!ufDatasets.length) {
            const fallback = document.createElement('div');
            fallback.style.fontSize = '10px';
            fallback.style.color = '#5b6f84';
            fallback.style.marginTop = '4px';
            fallback.textContent = 'Sem distribuição por UF nesta amostra.';
            horizontalCanvas.parentElement?.appendChild(fallback);
            return;
        }

        const horizontalCtx = horizontalCanvas.getContext('2d');
        if (!horizontalCtx) return;

        const horizontalChart = new Chart(horizontalCtx, {
            type: 'bar',
            data: {
                labels,
                datasets: ufDatasets,
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 10,
                            font: { size: 9 },
                        },
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const item = items?.[0];
                                return item ? String(answers[item.dataIndex]?.valor || '') : '';
                            },
                            label: (context) => `${context.dataset.label}: ${Number(context.parsed.x || 0).toLocaleString('pt-BR')}%`,
                        },
                    },
                },
                scales: {
                    x: {
                        stacked: true,
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: (value) => `${Number(value || 0).toLocaleString('pt-BR')}%`,
                            font: { size: 9 },
                        },
                    },
                    y: {
                        stacked: true,
                        ticks: {
                            font: { size: 9 },
                        },
                    },
                },
            },
        });
        kpiCharts.push(horizontalChart);
    };

    kpiUfOptions.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = String(option.code || 'ALL');
        opt.textContent = String(option.label || option.code || 'ALL');
        ufSelect.appendChild(opt);
    });
    ufSelect.value = 'ALL';

    const renderKpiByUf = (ufCode) => {
        destroyKpiCharts();
        const bucket = kpiBuckets[ufCode] || kpiBuckets.ALL || {
            cards_total: 0,
            processos_total: 0,
            cpfs_total: 0,
            combos: [],
        };
        const combos = Array.isArray(bucket.combos) ? bucket.combos : [];

        summaryWrap.innerHTML = `
            <strong>Análises registradas:</strong> ${numberPt(bucket.cards_total)}
            &nbsp;|&nbsp;
            <strong>Processos:</strong> ${numberPt(bucket.processos_total)}
            &nbsp;|&nbsp;
            <strong>CPFs:</strong> ${numberPt(bucket.cpfs_total)}
            &nbsp;|&nbsp;
            <strong>Recortes carteira/tipo:</strong> ${numberPt(combos.length)}
        `;

        if (!combos.length) {
            tableWrapKpi.innerHTML = '<div style="font-size:13px; color:#57697d;">Sem dados de KPI para o recorte selecionado.</div>';
            questionsWrap.innerHTML = '';
            return;
        }

        const rows = combos.map((combo) => {
            const kpis = combo.kpis || {};
            const proporBase = getComboQuestionBase(combo, 'propor_monitoria');
            const reproporBase = getComboQuestionBase(combo, 'repropor_monitoria');
            return `
                <tr>
                    <td style="text-align:left;">${escapeHtml(combo.carteira_nome || '[Sem carteira]')}</td>
                    <td style="text-align:left;">${escapeHtml(combo.tipo_nome || '[Sem tipo]')}</td>
                    <td style="text-align:right;">${numberPt(combo.cards)}</td>
                    <td style="text-align:right;">${numberPt(combo.processos)}</td>
                    <td style="text-align:right;">${numberPt(combo.cpfs)}</td>
                    <td style="text-align:right;">${formatByQuestionBase(kpis.propor_monitoria_sim, proporBase)}</td>
                    <td style="text-align:right;">${formatByQuestionBase(kpis.repropor_monitoria_sim, reproporBase)}</td>
                    <td style="text-align:right;">${numberPt(kpis.cumprimento_sentenca_iniciar_cs)}</td>
                    <td style="text-align:right;">${numberPt(kpis.habilitar_sim)}</td>
                    <td style="text-align:right;">${numberPt(kpis.habilitar_nao)}</td>
                    <td style="text-align:right;">${numberPt(kpis.recomendou_monitoria)} (${pctPt(combo.pct_recomendou_monitoria)})</td>
                </tr>
            `;
        }).join('');

        tableWrapKpi.innerHTML = `
            <div style="font-size:11px; color:#5b6f84; margin-bottom:6px;">
                <strong>Leitura:</strong>
                "Nova monitória" e "Repropor monitória" = <strong>SIM/base da própria pergunta</strong>.
                "Recomendou monitória" = <strong>análises com SIM em propor/repropor ÷ total de análises registradas no recorte</strong>.
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:12px;">
                <thead>
                    <tr style="background:#eef3f8;">
                        <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Carteira</th>
                        <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Tipo de análise</th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Análises</th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Processos</th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">CPFs</th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Nova monitória (SIM/base)</th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Repropor monitória (SIM/base)</th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Iniciar CS</th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Habilitar</th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Não habilitar</th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Recomendou monitória</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;

        const chartJobs = [];
        const questionCards = combos.slice(0, 14).map((combo, comboIndex) => {
            const questions = Array.isArray(combo.questions) ? combo.questions : [];
            if (!questions.length) {
                return '';
            }
            const questionBlocks = questions.slice(0, 7).map((question, questionIndex) => {
                const answers = Array.isArray(question.answers) ? question.answers : [];
                if (!answers.length) {
                    return '';
                }
                const questionCards = Number(question.cards || 0);
                const comboCards = Number(combo.cards || 0);
                const coveragePct = comboCards > 0 ? Number(((questionCards * 100) / comboCards).toFixed(2)) : 0;
                const verticalId = `kpi-answers-v-${comboIndex}-${questionIndex}-${ufCode}`;
                const horizontalId = `kpi-answers-h-${comboIndex}-${questionIndex}-${ufCode}`;
                chartJobs.push({ question, verticalId, horizontalId });
                const answerRows = answers.map((answer) => {
                    const isSemResposta = Boolean(answer?.is_sem_resposta);
                    const answerCount = Number(answer?.count || 0);
                    const baseDenominator = isSemResposta ? comboCards : questionCards;
                    const pctBasePergunta = typeof answer?.pct_base_pergunta === 'number'
                        ? answer.pct_base_pergunta
                        : Number(answer?.pct || 0);
                    const pctTotalAnalises = typeof answer?.pct_total_analises === 'number'
                        ? answer.pct_total_analises
                        : (comboCards > 0 ? Number(((answerCount * 100) / comboCards).toFixed(2)) : 0);
                    const url = (!isSemResposta && answerCount > 0)
                        ? buildKpiResponseUrl(combo, question, answer, ufCode)
                        : '';
                    const answerLabel = `${escapeHtml(answer.valor)} (${numberPt(answerCount)} de ${numberPt(baseDenominator)})`;
                    const answerLink = url && answerCount > 0
                        ? `<a href="${escapeHtml(url)}" style="font-weight:600; color:#1f5f9e;">${answerLabel}</a>`
                        : `<span>${answerLabel}</span>`;
                    const answerMetrics = isSemResposta
                        ? `<span style="color:#6a7a8b;">· ${pctPt(pctTotalAnalises)} do total analisado</span>`
                        : `<span style="color:#6a7a8b;">· ${pctPt(pctBasePergunta)} da base da pergunta · ${pctPt(pctTotalAnalises)} do total analisado</span>`;
                    return `
                        <li style="margin-bottom:2px;">
                            ${answerLink}
                            ${answerMetrics}
                        </li>
                    `;
                }).join('');
                return `
                    <div class="kpi-question-panel" style="display:grid; grid-template-columns:minmax(260px, 1fr) minmax(260px, 330px); gap:10px; align-items:start; border:1px dashed #dbe4ee; border-radius:8px; padding:8px; background:#fff;">
                        <div>
                            <div class="kpi-question-panel-title" style="font-size:12px; font-weight:700; color:#2f3d4a; margin-bottom:4px;">
                                ${escapeHtml(question.pergunta || question.chave || '')}
                            </div>
                            <div style="font-size:11px; color:#5b6f84; margin-bottom:4px;">
                                Denominador: ${numberPt(questionCards)} de ${numberPt(comboCards)} análises registradas no recorte (${pctPt(coveragePct)})
                            </div>
                            <ul style="margin:0; padding-left:16px; font-size:12px; color:#46576b;">
                                ${answerRows}
                            </ul>
                        </div>
                        <div style="display:grid; gap:6px;">
                            <div style="height:110px;">
                                <canvas id="${verticalId}"></canvas>
                            </div>
                            <div style="height:130px;">
                                <canvas id="${horizontalId}"></canvas>
                            </div>
                        </div>
                    </div>
                `;
            }).filter(Boolean).join('');
            if (!questionBlocks) {
                return '';
            }
            return `
                <details style="border:1px solid #e4ebf3; border-radius:8px; padding:8px; background:#fafcff;">
                    <summary style="cursor:pointer; font-weight:600; color:#2f3d4a;">
                        ${escapeHtml(combo.carteira_nome || '[Sem carteira]')} · ${escapeHtml(combo.tipo_nome || '[Sem tipo]')}
                    </summary>
                    <div style="display:grid; gap:8px; margin-top:8px;">
                        ${questionBlocks}
                    </div>
                </details>
            `;
        }).filter(Boolean).join('');

        questionsWrap.innerHTML = questionCards
            ? `
                <div style="font-size:12px; font-weight:600; margin-bottom:6px; color:#2f3d4a;">
                    Questionário da Análise (amostra por carteira/tipo)
                </div>
                <div style="display:grid; gap:8px;">
                    ${questionCards}
                </div>
            `
            : '';
        questionsWrap.querySelectorAll('.kpi-question-panel').forEach((panel) => {
            const panelTitle = String(panel.querySelector('.kpi-question-panel-title')?.textContent || '').trim();
            attachPrintButtonToPanel(panel, panelTitle || 'Pergunta do KPI');
        });

        chartJobs.forEach(({ question, verticalId, horizontalId }) => {
            renderQuestionCharts(question, verticalId, horizontalId);
        });
    };

    ufSelect.addEventListener('change', () => {
        renderKpiByUf(ufSelect.value || 'ALL');
    });
    renderKpiByUf('ALL');

    if (peticaoTypes.length && peticaoByCarteira.length) {
        const peticaoSection = document.createElement('section');
        peticaoSection.style.marginTop = '16px';
        peticaoSection.style.padding = '14px';
        peticaoSection.style.border = '1px solid #d9e1ea';
        peticaoSection.style.borderRadius = '10px';
        peticaoSection.style.background = '#fff';
        peticaoSection.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
                <h3 style="margin:0;">Peças Geradas por Tipo e Carteira</h3>
                <div style="font-size:12px; color:#5d6f83;">Clique em uma barra para abrir a lista filtrada.</div>
            </div>
            <div class="carteira-kpi-peticao-totals" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;"></div>
            <div style="height:290px;">
                <canvas id="kpiPeticaoCarteiraChart"></canvas>
            </div>
        `;
        chartContainer.appendChild(peticaoSection);
        attachPrintButtonToPanel(peticaoSection, 'Pecas Geradas por Tipo e Carteira');

        const totalsWrap = peticaoSection.querySelector('.carteira-kpi-peticao-totals');
        if (totalsWrap) {
            totalsWrap.innerHTML = peticaoTypes.map((tipo, idx) => {
                const slug = String(tipo.slug || '');
                const totalItem = peticaoTotals.find((item) => String(item.slug || '') === slug) || {};
                const label = String(tipo.label || slug || 'Tipo');
                const pieces = Number(totalItem.pieces || 0);
                const processos = Number(totalItem.processos || 0);
                const url = buildPeticaoUrl(slug, null);
                const inner = `
                    <span style="font-weight:700;">${escapeHtml(label)}</span>
                    <span>· Peças: <strong>${numberPt(pieces)}</strong></span>
                    <span>· Processos: <strong>${numberPt(processos)}</strong></span>
                `;
                if (url) {
                    return `
                        <a href="${escapeHtml(url)}" style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#2f435b; text-decoration:none; border:1px solid #e2e9f2; border-radius:999px; padding:5px 10px; background:${paletteColor(idx, 0.14)};">
                            ${inner}
                        </a>
                    `;
                }
                return `
                    <span style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#2f435b; border:1px solid #e2e9f2; border-radius:999px; padding:5px 10px; background:${paletteColor(idx, 0.14)};">
                        ${inner}
                    </span>
                `;
            }).join('');
        }

        const peticaoCanvas = document.getElementById('kpiPeticaoCarteiraChart');
        const peticaoCtx = peticaoCanvas ? peticaoCanvas.getContext('2d') : null;
        if (peticaoCtx) {
            const labels = peticaoByCarteira.map((item) => String(item.carteira_nome || item.carteira_id || 'Carteira'));
            const datasets = peticaoTypes.map((tipo, idx) => {
                const slug = String(tipo.slug || '');
                return {
                    label: String(tipo.label || slug || 'Tipo'),
                    data: peticaoByCarteira.map((item) => Number((item.pieces || {})[slug] || 0)),
                    backgroundColor: paletteColor(idx, 0.68),
                    borderColor: paletteColor(idx, 0.96),
                    borderWidth: 1,
                };
            });

            new Chart(peticaoCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets,
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                boxWidth: 12,
                                font: { size: 11 },
                            },
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.dataset.label}: ${numberPt(context.parsed.y || 0)} peça(s)`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            ticks: {
                                font: { size: 11 },
                            },
                            grid: { display: false },
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                precision: 0,
                                font: { size: 11 },
                            },
                        },
                    },
                    onClick(event, elements, chart) {
                        if (!elements || !elements.length) return;
                        const first = elements[0];
                        const datasetIndex = Number(first.datasetIndex);
                        const dataIndex = Number(first.index);
                        const tipo = peticaoTypes[datasetIndex];
                        const carteira = peticaoByCarteira[dataIndex];
                        if (!tipo || !carteira) return;
                        const url = buildPeticaoUrl(tipo.slug, carteira.carteira_id);
                        if (url) {
                            window.location.href = url;
                        }
                    },
                },
            });
        }
    }

    if (priorityRows.length) {
        const prioritySection = document.createElement('section');
        prioritySection.style.marginTop = '16px';
        prioritySection.style.padding = '14px';
        prioritySection.style.border = '1px solid #d9e1ea';
        prioritySection.style.borderRadius = '10px';
        prioritySection.style.background = '#fff';
        prioritySection.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
                <h3 style="margin:0;">Importados com Prioridade</h3>
                <div style="font-size:12px; color:#5d6f83;">Clique nos números ou barras para abrir a lista filtrada.</div>
            </div>
            <div class="carteira-kpi-priority-summary" style="font-size:12px; color:#46576b; margin-bottom:10px;"></div>
            <div class="carteira-kpi-priority-by-priority" style="margin-bottom:10px;"></div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:10px; margin-bottom:10px;">
                <div style="height:250px; border:1px solid #e4ebf3; border-radius:8px; padding:8px;">
                    <canvas id="kpiPriorityUfChart"></canvas>
                </div>
                <div style="height:250px; border:1px solid #e4ebf3; border-radius:8px; padding:8px;">
                    <canvas id="kpiPriorityStatusChart"></canvas>
                </div>
            </div>
            <div class="carteira-kpi-priority-table-wrap" style="overflow:auto;"></div>
        `;
        chartContainer.appendChild(prioritySection);
        attachPrintButtonToPanel(prioritySection, 'Importados com Prioridade');

        const summaryEl = prioritySection.querySelector('.carteira-kpi-priority-summary');
        const byPriorityWrap = prioritySection.querySelector('.carteira-kpi-priority-by-priority');
        const tableWrap = prioritySection.querySelector('.carteira-kpi-priority-table-wrap');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <strong>Cadastros com prioridade:</strong> ${numberPt(priorityTotals.processos || 0)}
                &nbsp;|&nbsp;
                <strong>Analisados:</strong> ${numberPt(priorityTotals.analisados || 0)}
                &nbsp;|&nbsp;
                <strong>Pendentes:</strong> ${numberPt(priorityTotals.pendentes || 0)}
            `;
        }

        const makeCountLink = (count, tagId, status, ufCode) => {
            const numericCount = Number(count || 0);
            if (numericCount <= 0) return `${numberPt(numericCount)}`;
            const url = buildPriorityKpiUrl(tagId, status, ufCode);
            if (!url) return `${numberPt(numericCount)}`;
            return `<a href="${escapeHtml(url)}" style="font-weight:600; color:#1f5f9e;">${numberPt(numericCount)}</a>`;
        };

        if (byPriorityWrap && priorityByPriority.length) {
            const cardsHtml = priorityByPriority.map((item) => {
                const tagId = Number(item.prioridade_id || 0);
                const tagName = escapeHtml(item.prioridade_nome || `Prioridade ${tagId || ''}`);
                return `
                    <div style="border:1px solid #d8e1ea; border-radius:8px; padding:8px 10px; background:#fbfdff; min-width:220px;">
                        <div style="font-size:12px; color:#2d3e50; font-weight:700; margin-bottom:6px;">${tagName}</div>
                        <div style="font-size:12px; color:#46576b; line-height:1.6;">
                            <div><strong>Importados:</strong> ${makeCountLink(item.total, tagId, 'all', '')}</div>
                            <div><strong>Analisados:</strong> ${makeCountLink(item.analisados, tagId, 'analisado', '')}</div>
                            <div><strong>Pendentes:</strong> ${makeCountLink(item.pendentes, tagId, 'pendente', '')}</div>
                        </div>
                    </div>
                `;
            }).join('');
            byPriorityWrap.innerHTML = `
                <div style="font-size:12px; color:#46576b; margin-bottom:6px;"><strong>Totais por tipo de prioridade</strong></div>
                <div style="display:flex; flex-wrap:wrap; gap:8px;">
                    ${cardsHtml}
                </div>
            `;
        }

        if (tableWrap) {
            const rowsHtml = priorityRows.map((row) => `
                <tr>
                    <td style="text-align:left; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(row.uf || 'SEM_UF')}</td>
                    <td style="text-align:left; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(row.prioridade_nome || `Prioridade ${row.prioridade_id || ''}`)}</td>
                    <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${makeCountLink(row.total, row.prioridade_id, 'all', row.uf)}</td>
                    <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${makeCountLink(row.analisados, row.prioridade_id, 'analisado', row.uf)}</td>
                    <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${makeCountLink(row.pendentes, row.prioridade_id, 'pendente', row.uf)}</td>
                </tr>
            `).join('');
            tableWrap.innerHTML = `
                <table style="width:100%; border-collapse:collapse; font-size:12px;">
                    <thead>
                        <tr style="background:#eef3f8;">
                            <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">UF</th>
                            <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Prioridade</th>
                            <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Total</th>
                            <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Analisados</th>
                            <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Pendentes</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            `;
        }

        const priorityUfCanvas = document.getElementById('kpiPriorityUfChart');
        const priorityUfCtx = priorityUfCanvas ? priorityUfCanvas.getContext('2d') : null;
        if (priorityUfCtx && priorityByUf.length && priorityByPriority.length) {
            const ufLabels = priorityByUf.map((item) => String(item.uf || 'SEM_UF'));
            const datasets = priorityByPriority.map((priorityItem, idx) => {
                const tagId = Number(priorityItem.prioridade_id || 0);
                return {
                    label: String(priorityItem.prioridade_nome || `Prioridade ${tagId || idx + 1}`),
                    data: ufLabels.map((ufCode) => {
                        const match = priorityRows.find((row) =>
                            String(row.uf || '') === ufCode
                            && Number(row.prioridade_id || 0) === tagId
                        );
                        return Number(match?.total || 0);
                    }),
                    backgroundColor: paletteColor(idx, 0.68),
                    borderColor: paletteColor(idx, 0.96),
                    borderWidth: 1,
                };
            });

            new Chart(priorityUfCtx, {
                type: 'bar',
                data: {
                    labels: ufLabels,
                    datasets,
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { boxWidth: 12, font: { size: 10 } },
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.dataset.label}: ${numberPt(context.parsed.y || 0)} cadastro(s)`,
                            },
                        },
                    },
                    scales: {
                        x: { stacked: true, ticks: { font: { size: 10 } }, grid: { display: false } },
                        y: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
                    },
                    onClick(event, elements) {
                        if (!elements || !elements.length) return;
                        const first = elements[0];
                        const datasetIndex = Number(first.datasetIndex);
                        const dataIndex = Number(first.index);
                        const priorityItem = priorityByPriority[datasetIndex];
                        const ufCode = ufLabels[dataIndex];
                        const tagId = Number(priorityItem?.prioridade_id || 0);
                        const url = buildPriorityKpiUrl(tagId, 'all', ufCode);
                        if (url) {
                            window.location.href = url;
                        }
                    },
                },
            });
        }

        const priorityStatusCanvas = document.getElementById('kpiPriorityStatusChart');
        const priorityStatusCtx = priorityStatusCanvas ? priorityStatusCanvas.getContext('2d') : null;
        if (priorityStatusCtx && priorityByPriority.length) {
            const labels = priorityByPriority.map((item) => String(item.prioridade_nome || `Prioridade ${item.prioridade_id || ''}`));
            const analyzedData = priorityByPriority.map((item) => Number(item.analisados || 0));
            const pendingData = priorityByPriority.map((item) => Number(item.pendentes || 0));

            new Chart(priorityStatusCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Analisados',
                            data: analyzedData,
                            backgroundColor: 'rgba(61, 109, 138, 0.72)',
                            borderColor: 'rgba(61, 109, 138, 0.96)',
                            borderWidth: 1,
                        },
                        {
                            label: 'Pendentes',
                            data: pendingData,
                            backgroundColor: 'rgba(212, 106, 74, 0.72)',
                            borderColor: 'rgba(212, 106, 74, 0.96)',
                            borderWidth: 1,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { boxWidth: 12, font: { size: 10 } },
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.dataset.label}: ${numberPt(context.parsed.y || 0)} cadastro(s)`,
                            },
                        },
                    },
                    scales: {
                        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
                        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
                    },
                    onClick(event, elements) {
                        if (!elements || !elements.length) return;
                        const first = elements[0];
                        const datasetIndex = Number(first.datasetIndex);
                        const dataIndex = Number(first.index);
                        const priorityItem = priorityByPriority[dataIndex];
                        const tagId = Number(priorityItem?.prioridade_id || 0);
                        const status = datasetIndex === 0 ? 'analisado' : 'pendente';
                        const url = buildPriorityKpiUrl(tagId, status, '');
                        if (url) {
                            window.location.href = url;
                        }
                    },
                },
            });
        }
    }

    if (productivityUsers.length || Number(productivityTotals.total || 0) > 0) {
        const productivitySection = document.createElement('section');
        productivitySection.style.marginTop = '16px';
        productivitySection.style.padding = '14px';
        productivitySection.style.border = '1px solid #d9e1ea';
        productivitySection.style.borderRadius = '10px';
        productivitySection.style.background = '#fff';
        productivitySection.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
                <h3 style="margin:0;">Produtividade por Usuário</h3>
                <div style="font-size:12px; color:#5d6f83;">Análises concluídas, tarefas e prazos concluídos.</div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                    Período:
                    <select class="kpi-productivity-period" style="padding:4px 8px;">
                        <option value="1">Hoje</option>
                        <option value="yesterday">Ontem</option>
                        <option value="month_current">Mês atual</option>
                        <option value="month_previous">Mês anterior</option>
                        <option value="7">Últimos 7 dias</option>
                        <option value="15">Últimos 15 dias</option>
                        <option value="30" selected>Últimos 30 dias</option>
                        <option value="60">Últimos 60 dias</option>
                        <option value="90">Últimos 90 dias</option>
                        <option value="180">Últimos 180 dias</option>
                        <option value="365">Últimos 365 dias</option>
                        <option value="all">Todo o histórico</option>
                    </select>
                </label>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                    De:
                    <input type="date" class="kpi-productivity-date-from" style="padding:4px 8px;">
                </label>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                    Até:
                    <input type="date" class="kpi-productivity-date-to" style="padding:4px 8px;">
                </label>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                    <input type="checkbox" class="kpi-productivity-compare-enabled">
                    Comparar com outro período
                </label>
                <label class="kpi-productivity-compare-wrap" style="display:none; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                    Comparar:
                    <select class="kpi-productivity-compare-period" style="padding:4px 8px;">
                        <option value="yesterday">Ontem</option>
                        <option value="1">Hoje</option>
                        <option value="month_previous" selected>Mês anterior</option>
                        <option value="month_current">Mês atual</option>
                        <option value="7">Últimos 7 dias</option>
                        <option value="15">Últimos 15 dias</option>
                        <option value="30">Últimos 30 dias</option>
                        <option value="60">Últimos 60 dias</option>
                        <option value="90">Últimos 90 dias</option>
                        <option value="180">Últimos 180 dias</option>
                        <option value="365">Últimos 365 dias</option>
                        <option value="all">Todo o histórico</option>
                    </select>
                </label>
                <label class="kpi-productivity-compare-wrap" style="display:none; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                    De (comp.):
                    <input type="date" class="kpi-productivity-compare-date-from" style="padding:4px 8px;">
                </label>
                <label class="kpi-productivity-compare-wrap" style="display:none; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                    Até (comp.):
                    <input type="date" class="kpi-productivity-compare-date-to" style="padding:4px 8px;">
                </label>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                    Usuário:
                    <select class="kpi-productivity-user" style="padding:4px 8px; min-width:180px;"></select>
                </label>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#46576b;">
                    Série diária:
                    <select class="kpi-productivity-metric" style="padding:4px 8px;">
                        <option value="analises" selected>Análises</option>
                        <option value="tarefas">Tarefas</option>
                        <option value="prazos">Prazos</option>
                    </select>
                </label>
            </div>
            <div class="kpi-productivity-summary" style="font-size:12px; color:#46576b; margin-bottom:10px;"></div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:10px; margin-bottom:10px;">
                <div style="height:320px; border:1px solid #e4ebf3; border-radius:8px; padding:8px;">
                    <canvas id="kpiProductivityUsersChart"></canvas>
                </div>
                <div style="height:320px; border:1px solid #e4ebf3; border-radius:8px; padding:8px;">
                    <canvas id="kpiProductivityDailyChart"></canvas>
                </div>
            </div>
            <div class="kpi-productivity-table-wrap" style="overflow:auto;"></div>
        `;
        chartContainer.appendChild(productivitySection);
        attachPrintButtonToPanel(productivitySection, 'Produtividade por Usuario');

        const periodSelect = productivitySection.querySelector('.kpi-productivity-period');
        const dateFromInput = productivitySection.querySelector('.kpi-productivity-date-from');
        const dateToInput = productivitySection.querySelector('.kpi-productivity-date-to');
        const compareEnabledInput = productivitySection.querySelector('.kpi-productivity-compare-enabled');
        const comparePeriodSelect = productivitySection.querySelector('.kpi-productivity-compare-period');
        const compareDateFromInput = productivitySection.querySelector('.kpi-productivity-compare-date-from');
        const compareDateToInput = productivitySection.querySelector('.kpi-productivity-compare-date-to');
        const compareWrapEls = Array.from(productivitySection.querySelectorAll('.kpi-productivity-compare-wrap'));
        const userSelect = productivitySection.querySelector('.kpi-productivity-user');
        const metricSelect = productivitySection.querySelector('.kpi-productivity-metric');
        const summaryEl = productivitySection.querySelector('.kpi-productivity-summary');
        const tableWrap = productivitySection.querySelector('.kpi-productivity-table-wrap');
        const usersCanvas = document.getElementById('kpiProductivityUsersChart');
        const dailyCanvas = document.getElementById('kpiProductivityDailyChart');
        if (periodSelect && dateFromInput && dateToInput && compareEnabledInput && comparePeriodSelect && compareDateFromInput && compareDateToInput && userSelect && metricSelect && summaryEl && tableWrap && usersCanvas && dailyCanvas) {
            if (productivityDateMin) {
                dateFromInput.min = productivityDateMin;
                dateToInput.min = productivityDateMin;
                compareDateFromInput.min = productivityDateMin;
                compareDateToInput.min = productivityDateMin;
            }
            if (productivityDateMax) {
                dateFromInput.max = productivityDateMax;
                dateToInput.max = productivityDateMax;
                compareDateFromInput.max = productivityDateMax;
                compareDateToInput.max = productivityDateMax;
            }
            const syncCompareVisibility = () => {
                const enabled = Boolean(compareEnabledInput.checked);
                compareWrapEls.forEach((el) => {
                    el.style.display = enabled ? 'inline-flex' : 'none';
                });
            };
            const parseDateKey = (value) => {
                const raw = String(value || '').trim();
                const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (!match) return null;
                return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            };
            const formatDateLabel = (value) => {
                const dt = parseDateKey(value);
                if (!dt) return String(value || '');
                return dt.toLocaleDateString('pt-BR');
            };
            const sumMetrics = (row) => (
                Number(row.analises || 0)
                + Number(row.tarefas || 0)
                + Number(row.prazos || 0)
            );
            const toDateKey = (dateObj) => {
                const yyyy = dateObj.getFullYear();
                const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                const dd = String(dateObj.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            };
            const latestDataDate = (() => {
                const lastDate = productivityDaily.length
                    ? parseDateKey(productivityDaily[productivityDaily.length - 1].date)
                    : null;
                return lastDate || new Date();
            })();
            const todayDate = new Date();
            const today = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());

            const getPeriodBounds = (periodValue) => {
                const periodKey = String(periodValue || '').trim().toLowerCase();
                if (periodKey === 'all') {
                    return { start: null, end: latestDataDate };
                }
                if (periodKey === 'yesterday') {
                    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                    yesterday.setDate(yesterday.getDate() - 1);
                    return { start: yesterday, end: yesterday };
                }
                if (periodKey === 'month_current') {
                    const start = new Date(today.getFullYear(), today.getMonth(), 1);
                    return { start, end: today };
                }
                if (periodKey === 'month_previous') {
                    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                    const end = new Date(today.getFullYear(), today.getMonth(), 0);
                    return { start, end };
                }
                const days = Number(periodKey || 0);
                if (!Number.isFinite(days) || days <= 0) {
                    return { start: null, end: latestDataDate };
                }
                const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
                start.setDate(start.getDate() - days + 1);
                return { start, end };
            };
            const getCustomBounds = (fromInputEl, toInputEl) => {
                const fromValue = String(fromInputEl?.value || '').trim();
                const toValue = String(toInputEl?.value || '').trim();
                if (!fromValue && !toValue) {
                    return null;
                }
                let start = fromValue ? parseDateKey(fromValue) : null;
                let end = toValue ? parseDateKey(toValue) : null;
                if (start && !end) {
                    end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                }
                if (start && end && start > end) {
                    const swap = start;
                    start = end;
                    end = swap;
                }
                return { start, end };
            };
            const getActiveBounds = (periodValue, fromInputEl, toInputEl) => {
                const customBounds = getCustomBounds(fromInputEl, toInputEl);
                if (customBounds) {
                    return { ...customBounds, source: 'custom' };
                }
                return { ...getPeriodBounds(periodValue), source: 'preset' };
            };
            const isDateInBounds = (dateKey, bounds) => {
                const dt = parseDateKey(dateKey);
                if (!dt) return false;
                if (bounds.start && dt < bounds.start) return false;
                if (bounds.end && dt > bounds.end) return false;
                return true;
            };
            const filterDailyByBounds = (dailyRows, bounds) => {
                if (!Array.isArray(dailyRows)) return [];
                return dailyRows.filter((row) => isDateInBounds(row.date, bounds));
            };
            const aggregateDailyRows = (dailyRows) => {
                return dailyRows.reduce((acc, row) => {
                    acc.analises += Number(row.analises || 0);
                    acc.tarefas += Number(row.tarefas || 0);
                    acc.prazos += Number(row.prazos || 0);
                    return acc;
                }, { analises: 0, tarefas: 0, prazos: 0 });
            };

            const sortedUsers = productivityUsers
                .slice()
                .sort((a, b) => {
                    const totalB = Number(b?.totals?.total || sumMetrics(b?.totals || {}));
                    const totalA = Number(a?.totals?.total || sumMetrics(a?.totals || {}));
                    if (totalB !== totalA) return totalB - totalA;
                    return String(a?.user_label || '').localeCompare(String(b?.user_label || ''), 'pt-BR');
                });

            userSelect.innerHTML = `
                <option value="ALL">Todos os usuários</option>
                ${sortedUsers.map((user) => `
                    <option value="${escapeHtml(user.user_key || '')}">
                        ${escapeHtml(user.user_label || 'Sem usuário')}
                    </option>
                `).join('')}
            `;
            userSelect.value = 'ALL';

            let usersChart = null;
            let dailyChart = null;
            const PRODUCTIVITY_COLOR_STORAGE_KEY = 'kpiProductivitySeriesColorsV1';
            const defaultSeriesColors = {
                analises: '#3D6D8A',
                tarefas: '#2E8BC0',
                prazos: '#4DAA57',
            };
            const seriesColors = (() => {
                try {
                    const raw = localStorage.getItem(PRODUCTIVITY_COLOR_STORAGE_KEY);
                    if (!raw) return { ...defaultSeriesColors };
                    const parsed = JSON.parse(raw);
                    if (!parsed || typeof parsed !== 'object') return { ...defaultSeriesColors };
                    return {
                        analises: normalizeHex(parsed.analises, defaultSeriesColors.analises),
                        tarefas: normalizeHex(parsed.tarefas, defaultSeriesColors.tarefas),
                        prazos: normalizeHex(parsed.prazos, defaultSeriesColors.prazos),
                    };
                } catch (error) {
                    return { ...defaultSeriesColors };
                }
            })();
            const saveSeriesColors = () => {
                try {
                    localStorage.setItem(PRODUCTIVITY_COLOR_STORAGE_KEY, JSON.stringify(seriesColors));
                } catch (error) {
                    // ignore storage failures
                }
            };
            const resolveSeriesColor = (metricKey) => normalizeHex(seriesColors[metricKey], defaultSeriesColors[metricKey] || '#417690');
            const getDatasetColors = (metricKey, compared = false) => {
                const baseHex = resolveSeriesColor(metricKey);
                return {
                    backgroundColor: hexToRgba(baseHex, compared ? 0.28 : 0.72),
                    borderColor: hexToRgba(baseHex, compared ? 0.70 : 0.96),
                };
            };
            const pickerSwatches = [
                '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4',
                '#009688', '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800', '#FF5722',
                '#795548', '#9E9E9E', '#607D8B', '#000000', '#FFFFFF',
            ];
            let legendColorPickr = null;
            let legendColorPickrHost = null;
            let legendColorPickrOnSave = null;

            const getPickerClientPoint = (triggerEvent) => {
                const sourceEvent = triggerEvent?.native || triggerEvent || {};
                const x = Number(sourceEvent.clientX);
                const y = Number(sourceEvent.clientY);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    return { x, y };
                }
                return {
                    x: Math.round(window.innerWidth / 2),
                    y: Math.round(window.innerHeight / 2),
                };
            };

            const moveLegendPickrHost = (triggerEvent) => {
                if (!legendColorPickrHost) return;
                const point = getPickerClientPoint(triggerEvent);
                const safeX = Math.max(12, Math.min(window.innerWidth - 12, point.x));
                const safeY = Math.max(12, Math.min(window.innerHeight - 12, point.y));
                legendColorPickrHost.style.left = `${safeX}px`;
                legendColorPickrHost.style.top = `${safeY}px`;
            };

            const positionLegendPickrApp = (triggerEvent, pickrInstance) => {
                window.requestAnimationFrame(() => {
                    const appEl = pickrInstance?.getRoot?.()?.app;
                    if (!appEl) return;
                    const point = getPickerClientPoint(triggerEvent);
                    const rect = appEl.getBoundingClientRect();
                    const margin = 8;
                    let left = point.x - 10;
                    let top = point.y + 12;
                    if (left + rect.width > window.innerWidth - margin) {
                        left = window.innerWidth - rect.width - margin;
                    }
                    if (left < margin) {
                        left = margin;
                    }
                    if (top + rect.height > window.innerHeight - margin) {
                        top = point.y - rect.height - 12;
                    }
                    if (top < margin) {
                        top = margin;
                    }
                    appEl.style.position = 'fixed';
                    appEl.style.left = `${Math.round(left)}px`;
                    appEl.style.top = `${Math.round(top)}px`;
                });
            };

            const ensureLegendPickr = () => {
                if (legendColorPickr) {
                    return legendColorPickr;
                }
                if (!window.Pickr || typeof window.Pickr.create !== 'function') {
                    return null;
                }
                legendColorPickrHost = document.createElement('span');
                legendColorPickrHost.id = 'productivity-legend-color-picker-host';
                legendColorPickrHost.style.position = 'fixed';
                legendColorPickrHost.style.left = '-9999px';
                legendColorPickrHost.style.top = '-9999px';
                legendColorPickrHost.style.width = '1px';
                legendColorPickrHost.style.height = '1px';
                legendColorPickrHost.style.opacity = '0';
                legendColorPickrHost.style.pointerEvents = 'none';
                legendColorPickrHost.style.zIndex = '9999';
                document.body.appendChild(legendColorPickrHost);

                legendColorPickr = window.Pickr.create({
                    el: legendColorPickrHost,
                    theme: 'classic',
                    default: '#417690',
                    swatches: pickerSwatches,
                    components: {
                        preview: true,
                        opacity: false,
                        hue: true,
                        interaction: {
                            hex: false,
                            rgba: false,
                            hsla: false,
                            hsva: false,
                            cmyk: false,
                            input: true,
                            clear: false,
                            save: true,
                        },
                    },
                });
                legendColorPickr.on('save', (color, instance) => {
                    const picked = color ? color.toHEXA().toString() : '';
                    if (picked && typeof legendColorPickrOnSave === 'function') {
                        legendColorPickrOnSave(picked);
                    }
                    legendColorPickrOnSave = null;
                    instance.hide();
                });
                legendColorPickr.on('hide', () => {
                    legendColorPickrOnSave = null;
                    if (legendColorPickrHost) {
                        legendColorPickrHost.style.left = '-9999px';
                        legendColorPickrHost.style.top = '-9999px';
                    }
                });
                return legendColorPickr;
            };

            const openColorPicker = (initialHex, onPick, triggerEvent) => {
                const pickrInstance = ensureLegendPickr();
                if (pickrInstance) {
                    legendColorPickrOnSave = onPick;
                    moveLegendPickrHost(triggerEvent);
                    pickrInstance.setColor(normalizeHex(initialHex, '#417690'), true);
                    pickrInstance.show();
                    positionLegendPickrApp(triggerEvent, pickrInstance);
                    return;
                }

                const input = document.createElement('input');
                input.type = 'color';
                input.value = normalizeHex(initialHex, '#417690');
                input.style.position = 'fixed';
                input.style.left = '-9999px';
                input.style.top = '0';
                document.body.appendChild(input);
                const cleanup = () => input.remove();
                input.addEventListener('change', () => {
                    onPick(String(input.value || '').trim());
                    cleanup();
                }, { once: true });
                input.addEventListener('blur', cleanup, { once: true });
                input.click();
            };
            const formatSignedNumber = (value) => {
                const numeric = Number(value || 0);
                if (numeric > 0) return `+${numberPt(numeric)}`;
                return numberPt(numeric);
            };
            const formatDeltaPct = (currentValue, referenceValue) => {
                const current = Number(currentValue || 0);
                const reference = Number(referenceValue || 0);
                if (!reference) {
                    if (!current) return '0,00%';
                    return 'n/a';
                }
                const pct = ((current - reference) / reference) * 100;
                const absPct = Math.abs(pct).toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                });
                return `${pct >= 0 ? '+' : '-'}${absPct}%`;
            };
            const getDeltaColor = (value) => (Number(value || 0) >= 0 ? '#207544' : '#b64040');
            const formatBoundsLabel = (bounds, periodValueKey) => {
                const toLabel = (dateObj) => (dateObj ? dateObj.toLocaleDateString('pt-BR') : '');
                if (bounds?.source === 'custom') {
                    const startLabel = bounds.start
                        ? toLabel(bounds.start)
                        : (productivityDateMin ? formatDateLabel(productivityDateMin) : 'início');
                    const endLabel = bounds.end
                        ? toLabel(bounds.end)
                        : 'hoje';
                    return `Período customizado: ${startLabel} até ${endLabel} (com data)`;
                }
                if (periodValueKey === 'all') {
                    return 'Todo o histórico com data';
                }
                if (periodValueKey === '1') {
                    return 'Hoje (com data)';
                }
                if (periodValueKey === 'yesterday') {
                    return 'Ontem (com data)';
                }
                if (periodValueKey === 'month_current') {
                    return 'Mês atual (com data)';
                }
                if (periodValueKey === 'month_previous') {
                    return 'Mês anterior (com data)';
                }
                return `Últimos ${Number(periodValueKey)} dias (com data)`;
            };

            const renderProductivity = () => {
                syncCompareVisibility();
                const periodValue = String(periodSelect.value || '30');
                const periodValueKey = periodValue.trim().toLowerCase();
                const selectedUserKey = String(userSelect.value || 'ALL');
                const metricValue = String(metricSelect.value || 'total');
                const bounds = getActiveBounds(periodValue, dateFromInput, dateToInput);
                const compareEnabled = Boolean(compareEnabledInput.checked);
                const comparePeriodValue = String(comparePeriodSelect.value || 'month_previous');
                const comparePeriodValueKey = comparePeriodValue.trim().toLowerCase();
                const compareBounds = compareEnabled
                    ? getActiveBounds(comparePeriodValue, compareDateFromInput, compareDateToInput)
                    : null;
                const metricLabels = {
                    analises: 'Análises',
                    tarefas: 'Tarefas',
                    prazos: 'Prazos',
                };
                const selectedMetricKey = ['analises', 'tarefas', 'prazos'].includes(metricValue) ? metricValue : 'analises';
                const selectedMetricLabel = metricLabels[selectedMetricKey];

                const rows = sortedUsers.map((user) => {
                    const dailyRows = filterDailyByBounds(user.daily || [], bounds);
                    const period = aggregateDailyRows(dailyRows);
                    const compareDailyRows = compareBounds ? filterDailyByBounds(user.daily || [], compareBounds) : [];
                    const compare = compareBounds ? aggregateDailyRows(compareDailyRows) : { analises: 0, tarefas: 0, prazos: 0 };
                    const semDataTotals = user.sem_data || {};
                    const semDataTotal = Number(semDataTotals.total || sumMetrics(semDataTotals));
                    const pendingTotals = user.pending || {};
                    const carteiraItems = Array.isArray(user.carteiras) ? user.carteiras : [];
                    const carteiraDetails = carteiraItems
                        .map((item) => {
                            const nome = String(item?.nome || '').trim();
                            const eventos = Number(item?.eventos || 0);
                            if (!nome) return '';
                            return `${nome}: ${numberPt(eventos)}`;
                        })
                        .filter(Boolean)
                        .join(' | ');
                    const pending = {
                        tarefas: Number(pendingTotals.tarefas || 0),
                        prazos: Number(pendingTotals.prazos || 0),
                    };
                    const currentMetric = Number(period[selectedMetricKey] || 0);
                    const compareMetric = Number(compare[selectedMetricKey] || 0);
                    const deltaMetric = currentMetric - compareMetric;
                    return {
                        user_key: user.user_key,
                        user_label: user.user_label || 'Sem usuário',
                        carteira_label: String(user.carteira_label || '').trim() || 'Sem carteira',
                        carteira_title: carteiraDetails,
                        period,
                        compare,
                        currentMetric,
                        compareMetric,
                        deltaMetric,
                        deltaPctMetric: formatDeltaPct(currentMetric, compareMetric),
                        semDataTotals,
                        semDataTotal,
                        pending,
                        dailyRows,
                    };
                });

                const periodTotals = rows.reduce((acc, row) => {
                    acc.analises += Number(row.period.analises || 0);
                    acc.tarefas += Number(row.period.tarefas || 0);
                    acc.prazos += Number(row.period.prazos || 0);
                    return acc;
                }, { analises: 0, tarefas: 0, prazos: 0 });
                const compareTotals = compareEnabled
                    ? rows.reduce((acc, row) => {
                        acc.analises += Number(row.compare.analises || 0);
                        acc.tarefas += Number(row.compare.tarefas || 0);
                        acc.prazos += Number(row.compare.prazos || 0);
                        return acc;
                    }, { analises: 0, tarefas: 0, prazos: 0 })
                    : { analises: 0, tarefas: 0, prazos: 0 };
                const metricCurrentTeam = Number(periodTotals[selectedMetricKey] || 0);
                const metricCompareTeam = Number(compareTotals[selectedMetricKey] || 0);
                const metricDeltaTeam = metricCurrentTeam - metricCompareTeam;
                const semDataTotalAll = Number(productivitySemData.total || sumMetrics(productivitySemData || {}));
                const pendingTotals = selectedUserKey === 'ALL'
                    ? {
                        tarefas: Number(productivityPending.tarefas || 0),
                        prazos: Number(productivityPending.prazos || 0),
                    }
                    : (rows.find((row) => String(row.user_key || '') === selectedUserKey)?.pending || { tarefas: 0, prazos: 0 });
                const periodLabel = formatBoundsLabel(bounds, periodValueKey);
                const compareLabel = compareEnabled ? formatBoundsLabel(compareBounds, comparePeriodValueKey) : '';
                const carteiraNames = Array.from(new Set(rows.map((row) => String(row.carteira_label || '').trim()).filter(Boolean)));
                const carteiraScopeLabel = carteiraNames.length === 1 ? carteiraNames[0] : 'recorte atual';
                const trendWord = metricDeltaTeam > 0 ? 'maior' : (metricDeltaTeam < 0 ? 'menor' : 'igual');
                const teamSentence = compareEnabled
                    ? `Equipe da carteira ${carteiraScopeLabel}: produtividade de ${selectedMetricLabel.toLowerCase()} ${trendWord} em ${formatDeltaPct(metricCurrentTeam, metricCompareTeam)} (${numberPt(metricCurrentTeam)} vs ${numberPt(metricCompareTeam)}).`
                    : `Equipe da carteira ${carteiraScopeLabel}: ${numberPt(metricCurrentTeam)} ${selectedMetricLabel.toLowerCase()} concluídas.`;
                const selectedUserRow = rows.find((row) => String(row.user_key || '') === selectedUserKey) || null;
                const candidateRows = rows.filter((row) => (Number(row.currentMetric || 0) > 0 || Number(row.compareMetric || 0) > 0));
                const highlightedRow = selectedUserRow
                    || (candidateRows.length
                        ? candidateRows.slice().sort((a, b) => Number(b.deltaMetric || 0) - Number(a.deltaMetric || 0))[0]
                        : null);
                const userSentence = (() => {
                    if (!highlightedRow) return 'Individualmente, sem produção registrada para o recorte selecionado.';
                    if (!compareEnabled) {
                        return `Individualmente, ${highlightedRow.user_label} concluiu ${numberPt(highlightedRow.currentMetric)} ${selectedMetricLabel.toLowerCase()}.`;
                    }
                    const userTrend = Number(highlightedRow.deltaMetric || 0) > 0 ? 'mais' : (Number(highlightedRow.deltaMetric || 0) < 0 ? 'menos' : 'o mesmo');
                    return `Individualmente, ${highlightedRow.user_label} produziu ${userTrend} ${selectedMetricLabel.toLowerCase()}: ${formatDeltaPct(highlightedRow.currentMetric, highlightedRow.compareMetric)} (${numberPt(highlightedRow.currentMetric)} vs ${numberPt(highlightedRow.compareMetric)}).`;
                })();

                summaryEl.innerHTML = `
                    <div><strong>Período informado:</strong> ${escapeHtml(periodLabel)}${compareEnabled ? ` &nbsp;|&nbsp; <strong>Comparação:</strong> ${escapeHtml(compareLabel)}` : ''}</div>
                    <div><strong>Base (A/T/P):</strong> ${numberPt(periodTotals.analises)} / ${numberPt(periodTotals.tarefas)} / ${numberPt(periodTotals.prazos)}${compareEnabled ? ` &nbsp;|&nbsp; <strong>Comparado (A/T/P):</strong> ${numberPt(compareTotals.analises)} / ${numberPt(compareTotals.tarefas)} / ${numberPt(compareTotals.prazos)}` : ''}</div>
                    <div style="margin-top:4px;"><strong>${escapeHtml(teamSentence)}</strong></div>
                    <div style="margin-top:2px;">${escapeHtml(userSentence)}</div>
                    <div style="margin-top:4px;"><strong>Pendentes atuais (tarefas/prazos):</strong> ${numberPt(pendingTotals.tarefas)} / ${numberPt(pendingTotals.prazos)} &nbsp;|&nbsp; <strong>Sem data de conclusão:</strong> ${numberPt(semDataTotalAll)}</div>
                `;

                const compareHeader = compareEnabled
                    ? `
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(selectedMetricLabel)}<br><span style="font-size:10px; color:#7d8da0; font-weight:400;">comparado</span></th>
                        <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Delta ${escapeHtml(selectedMetricLabel.toLowerCase())}<br><span style="font-size:10px; color:#7d8da0; font-weight:400;">atual - comparado</span></th>
                    `
                    : '';
                const tableRows = rows.map((row) => `
                    <tr>
                        <td style="text-align:left; padding:6px; border:1px solid #d8e1ea;" title="${escapeHtml(row.carteira_title || row.carteira_label)}">${escapeHtml(row.carteira_label)}</td>
                        <td style="text-align:left; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(row.user_label)}</td>
                        <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${numberPt(row.period.analises)}</td>
                        <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${numberPt(row.period.tarefas)}</td>
                        <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${numberPt(row.pending.tarefas)}</td>
                        <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${numberPt(row.period.prazos)}</td>
                        <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${numberPt(row.pending.prazos)}</td>
                        ${compareEnabled ? `<td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${numberPt(row.compareMetric)}</td>` : ''}
                        ${compareEnabled ? `<td style="text-align:right; padding:6px; border:1px solid #d8e1ea;"><span style="font-weight:600; color:${getDeltaColor(row.deltaMetric)};">${formatSignedNumber(row.deltaMetric)} (${row.deltaPctMetric})</span></td>` : ''}
                        <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${numberPt(row.semDataTotal)}</td>
                    </tr>
                `).join('');
                tableWrap.innerHTML = `
                    <table style="width:100%; border-collapse:collapse; font-size:12px;">
                        <thead>
                            <tr style="background:#eef3f8;">
                                <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Carteira</th>
                                <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Usuário</th>
                                <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Análises<br><span style="font-size:10px; color:#7d8da0; font-weight:400;">por período</span></th>
                                <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Tarefas concluídas<br><span style="font-size:10px; color:#7d8da0; font-weight:400;">por período</span></th>
                                <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Tarefas pendentes<br><span style="font-size:10px; color:#7d8da0; font-weight:400;">atual</span></th>
                                <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Prazos concluídos<br><span style="font-size:10px; color:#7d8da0; font-weight:400;">por período</span></th>
                                <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Prazos pendentes<br><span style="font-size:10px; color:#7d8da0; font-weight:400;">atual</span></th>
                                ${compareHeader}
                                <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Sem data</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                `;

                if (usersChart) usersChart.destroy();
                const usersCtx = usersCanvas.getContext('2d');
                if (usersCtx) {
                    const topRows = rows
                        .slice()
                        .sort((a, b) => Number(b.currentMetric || 0) - Number(a.currentMetric || 0))
                        .slice(0, 20);
                    const chartDatasets = [
                        {
                            label: 'Análises',
                            metricKey: 'analises',
                            compared: false,
                            data: topRows.map((row) => Number(row.period.analises || 0)),
                            ...getDatasetColors('analises', false),
                            borderWidth: 1,
                        },
                        {
                            label: 'Tarefas',
                            metricKey: 'tarefas',
                            compared: false,
                            data: topRows.map((row) => Number(row.period.tarefas || 0)),
                            ...getDatasetColors('tarefas', false),
                            borderWidth: 1,
                        },
                        {
                            label: 'Prazos',
                            metricKey: 'prazos',
                            compared: false,
                            data: topRows.map((row) => Number(row.period.prazos || 0)),
                            ...getDatasetColors('prazos', false),
                            borderWidth: 1,
                        },
                    ];
                    if (compareEnabled) {
                        chartDatasets.push(
                            {
                                label: 'Análises (comparado)',
                                metricKey: 'analises',
                                compared: true,
                                data: topRows.map((row) => Number(row.compare.analises || 0)),
                                ...getDatasetColors('analises', true),
                                borderWidth: 1,
                            },
                            {
                                label: 'Tarefas (comparado)',
                                metricKey: 'tarefas',
                                compared: true,
                                data: topRows.map((row) => Number(row.compare.tarefas || 0)),
                                ...getDatasetColors('tarefas', true),
                                borderWidth: 1,
                            },
                            {
                                label: 'Prazos (comparado)',
                                metricKey: 'prazos',
                                compared: true,
                                data: topRows.map((row) => Number(row.compare.prazos || 0)),
                                ...getDatasetColors('prazos', true),
                                borderWidth: 1,
                            },
                        );
                    }
                    usersChart = new Chart(usersCtx, {
                        type: 'bar',
                        data: {
                            labels: topRows.map((row) => truncateLabel(row.user_label, 24)),
                            datasets: chartDatasets,
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    position: 'bottom',
                                    labels: { boxWidth: 12, font: { size: 10 } },
                                    onClick(event, legendItem, legend) {
                                        const chart = legend?.chart;
                                        const datasetIndex = Number(legendItem?.datasetIndex);
                                        const dataset = chart?.data?.datasets?.[datasetIndex];
                                        const shiftPressed = Boolean(event?.native?.shiftKey || event?.shiftKey);
                                        if (shiftPressed && dataset && dataset.metricKey) {
                                            openColorPicker(resolveSeriesColor(dataset.metricKey), (pickedHex) => {
                                                const nextColor = normalizeHex(pickedHex, resolveSeriesColor(dataset.metricKey));
                                                seriesColors[dataset.metricKey] = nextColor;
                                                saveSeriesColors();
                                                chart.data.datasets.forEach((item) => {
                                                    if (item?.metricKey !== dataset.metricKey) return;
                                                    const colors = getDatasetColors(dataset.metricKey, Boolean(item?.compared));
                                                    item.backgroundColor = colors.backgroundColor;
                                                    item.borderColor = colors.borderColor;
                                                });
                                                chart.update();
                                            }, event);
                                            return;
                                        }
                                        Chart.defaults.plugins.legend.onClick(event, legendItem, legend);
                                    },
                                },
                                tooltip: {
                                    callbacks: {
                                        label: (context) => `${context.dataset.label}: ${numberPt(context.parsed.y || 0)}`,
                                    },
                                },
                            },
                            scales: {
                                x: {
                                    ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true },
                                    grid: { display: false },
                                },
                                y: {
                                    beginAtZero: true,
                                    ticks: { precision: 0, font: { size: 10 } },
                                },
                            },
                        },
                    });
                }

                const sourceDaily = (() => {
                    if (selectedUserKey === 'ALL') {
                        return filterDailyByBounds(productivityDaily, bounds);
                    }
                    const selectedUser = rows.find((row) => String(row.user_key || '') === selectedUserKey);
                    return selectedUser ? selectedUser.dailyRows : [];
                })();
                const sourceDailyMap = {};
                sourceDaily.forEach((row) => {
                    sourceDailyMap[String(row.date || '')] = row;
                });

                const dateLabels = [];
                if (bounds.start) {
                    const cursor = new Date(bounds.start.getFullYear(), bounds.start.getMonth(), bounds.start.getDate());
                    const end = bounds.end || today;
                    while (cursor <= end) {
                        dateLabels.push(toDateKey(cursor));
                        cursor.setDate(cursor.getDate() + 1);
                    }
                } else {
                    sourceDaily.forEach((row) => {
                        const key = String(row.date || '').trim();
                        if (key) dateLabels.push(key);
                    });
                }

                const metricResolver = (row) => {
                    if (!row) return 0;
                    return Number(row[selectedMetricKey] || 0);
                };
                const dailyValues = dateLabels.map((dateKey) => metricResolver(sourceDailyMap[dateKey]));

                if (dailyChart) dailyChart.destroy();
                const dailyCtx = dailyCanvas.getContext('2d');
                if (dailyCtx) {
                    const labelBase = selectedMetricKey === 'analises'
                        ? 'Análises/dia'
                        : selectedMetricKey === 'tarefas'
                            ? 'Tarefas/dia'
                            : 'Prazos/dia';
                    const labelUser = selectedUserKey === 'ALL'
                        ? 'Todos os usuários'
                        : (rows.find((row) => String(row.user_key || '') === selectedUserKey)?.user_label || 'Usuário');
                    dailyChart = new Chart(dailyCtx, {
                        type: 'line',
                        data: {
                            labels: dateLabels.map((dateKey) => formatDateLabel(dateKey)),
                            datasets: [{
                                label: `${labelBase} · ${labelUser}`,
                                data: dailyValues,
                                backgroundColor: 'rgba(61, 109, 138, 0.20)',
                                borderColor: 'rgba(61, 109, 138, 0.96)',
                                borderWidth: 2,
                                pointRadius: 2,
                                tension: 0.22,
                                fill: true,
                            }],
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    position: 'bottom',
                                    labels: { boxWidth: 12, font: { size: 10 } },
                                },
                                tooltip: {
                                    callbacks: {
                                        label: (context) => `${context.dataset.label}: ${numberPt(context.parsed.y || 0)}`,
                                    },
                                },
                            },
                            scales: {
                                x: {
                                    ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true },
                                    grid: { display: false },
                                },
                                y: {
                                    beginAtZero: true,
                                    ticks: { precision: 0, font: { size: 10 } },
                                },
                            },
                        },
                    });
                }
            };

            periodSelect.addEventListener('change', renderProductivity);
            dateFromInput.addEventListener('change', renderProductivity);
            dateToInput.addEventListener('change', renderProductivity);
            compareEnabledInput.addEventListener('change', renderProductivity);
            comparePeriodSelect.addEventListener('change', renderProductivity);
            compareDateFromInput.addEventListener('change', renderProductivity);
            compareDateToInput.addEventListener('change', renderProductivity);
            userSelect.addEventListener('change', renderProductivity);
            metricSelect.addEventListener('change', renderProductivity);
            syncCompareVisibility();
            renderProductivity();
        }
    }

    const onlinePresenceEnabled = Boolean(onlinePresenceKpi && onlinePresenceKpi.enabled && onlinePresenceKpi.snapshot_url);
    if (onlinePresenceEnabled) {
        const refreshSeconds = Math.max(5, Number(onlinePresenceKpi.heartbeat_seconds || 15));
        const idleSeconds = Math.max(60, Number(onlinePresenceKpi.idle_seconds || 300));
        const snapshotUrl = String(onlinePresenceKpi.snapshot_url || '').trim();
        const onlineSection = document.createElement('section');
        onlineSection.style.marginTop = '16px';
        onlineSection.style.padding = '14px';
        onlineSection.style.border = '1px solid #d9e1ea';
        onlineSection.style.borderRadius = '10px';
        onlineSection.style.background = '#fff';
        onlineSection.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
                <h3 style="margin:0;">KPI Online (Espião)</h3>
                <button type="button" class="kpi-online-refresh" style="padding:4px 10px; font-size:12px;">Atualizar</button>
            </div>
            <div class="kpi-online-summary" style="font-size:12px; color:#46576b; margin-bottom:10px;"></div>
            <div class="kpi-online-table-wrap" style="overflow:auto;"></div>
        `;
        chartContainer.appendChild(onlineSection);
        attachPrintButtonToPanel(onlineSection, 'KPI Online');

        const refreshButton = onlineSection.querySelector('.kpi-online-refresh');
        const summaryEl = onlineSection.querySelector('.kpi-online-summary');
        const tableWrap = onlineSection.querySelector('.kpi-online-table-wrap');
        if (refreshButton && summaryEl && tableWrap) {
            let inFlight = false;

            const formatDuration = (secondsValue) => {
                const total = Math.max(0, Number(secondsValue || 0));
                const hours = Math.floor(total / 3600);
                const minutes = Math.floor((total % 3600) / 60);
                const seconds = Math.floor(total % 60);
                const hh = String(hours).padStart(2, '0');
                const mm = String(minutes).padStart(2, '0');
                const ss = String(seconds).padStart(2, '0');
                return `${hh}:${mm}:${ss}`;
            };
            const formatDateTime = (epoch) => {
                const parsed = Number(epoch || 0);
                if (!parsed) return '-';
                return new Date(parsed * 1000).toLocaleString('pt-BR');
            };
            const formatTabLabel = (tabId) => {
                const value = String(tabId || '').trim();
                if (!value) return '-';
                if (value.length <= 10) return value;
                return value.slice(0, 10);
            };
            const renderRows = (payload) => {
                const rows = Array.isArray(payload?.rows) ? payload.rows : [];
                const onlineRows = rows.filter((item) => item && item.is_online);
                const idleRows = onlineRows.filter((item) => item.is_idle);
                const activeRows = onlineRows.length - idleRows.length;
                summaryEl.innerHTML = `
                    <strong>Abas online:</strong> ${numberPt(onlineRows.length)}
                    &nbsp;|&nbsp;
                    <strong>Em atividade:</strong> ${numberPt(activeRows)}
                    &nbsp;|&nbsp;
                    <strong>Ociosas:</strong> ${numberPt(idleRows.length)}
                    &nbsp;|&nbsp;
                    <strong>Ociosidade:</strong> após ${numberPt(idleSeconds / 60)} min
                    &nbsp;|&nbsp;
                    <strong>Atualização:</strong> a cada ${numberPt(refreshSeconds)}s
                `;
                if (!rows.length) {
                    tableWrap.innerHTML = '<div style="font-size:12px; color:#62758a; padding:6px 0;">Nenhum usuário online em cadastro/processo.</div>';
                    return;
                }
                const body = rows
                    .sort((a, b) => Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0))
                    .map((row) => {
                        const statusLabel = row.is_idle ? 'Ocioso' : 'Ativo';
                        const statusColor = row.is_idle ? '#a86f13' : '#2f7d32';
                        const processLabel = escapeHtml(row.processo_label || `Cadastro #${row.processo_id}`);
                        const processLink = row.processo_url
                            ? `<a href="${escapeHtml(row.processo_url)}" style="color:#1d5f9c; font-weight:600;">${processLabel}</a>`
                            : processLabel;
                        return `
                            <tr>
                                <td style="text-align:left; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(row.user_label || '-')}</td>
                                <td style="text-align:left; padding:6px; border:1px solid #d8e1ea;">${processLink}</td>
                                <td style="text-align:left; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(row.carteira_label || '-')}</td>
                                <td style="text-align:left; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(formatTabLabel(row.tab_id))}</td>
                                <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(formatDuration(row.elapsed_seconds))}</td>
                                <td style="text-align:right; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(formatDuration(row.idle_for_seconds))}</td>
                                <td style="text-align:center; padding:6px; border:1px solid #d8e1ea; color:${statusColor}; font-weight:700;">${statusLabel}</td>
                                <td style="text-align:left; padding:6px; border:1px solid #d8e1ea;">${escapeHtml(formatDateTime(row.last_seen_at))}</td>
                            </tr>
                        `;
                    })
                    .join('');
                tableWrap.innerHTML = `
                    <table style="width:100%; border-collapse:collapse; font-size:12px;">
                        <thead>
                            <tr style="background:#eef3f8;">
                                <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Usuário</th>
                                <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Cadastro/Processo</th>
                                <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Carteira</th>
                                <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Aba</th>
                                <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Tempo em atuação</th>
                                <th style="text-align:right; padding:6px; border:1px solid #d8e1ea;">Tempo ocioso</th>
                                <th style="text-align:center; padding:6px; border:1px solid #d8e1ea;">Status</th>
                                <th style="text-align:left; padding:6px; border:1px solid #d8e1ea;">Último heartbeat</th>
                            </tr>
                        </thead>
                        <tbody>${body}</tbody>
                    </table>
                `;
            };

            const fetchSnapshot = async () => {
                if (inFlight || !snapshotUrl) return;
                inFlight = true;
                refreshButton.disabled = true;
                try {
                    const response = await fetch(snapshotUrl, {
                        method: 'GET',
                        headers: { Accept: 'application/json' },
                        credentials: 'same-origin',
                    });
                    if (!response.ok) {
                        throw new Error('Falha ao carregar KPI online.');
                    }
                    const payload = await response.json();
                    renderRows(payload);
                } catch (error) {
                    tableWrap.innerHTML = '<div style="font-size:12px; color:#9d2f2f; padding:6px 0;">Não foi possível carregar a atividade online.</div>';
                } finally {
                    refreshButton.disabled = false;
                    inFlight = false;
                }
            };

            refreshButton.addEventListener('click', fetchSnapshot);
            fetchSnapshot();
            setInterval(fetchSnapshot, refreshSeconds * 1000);
        }
    }
});
