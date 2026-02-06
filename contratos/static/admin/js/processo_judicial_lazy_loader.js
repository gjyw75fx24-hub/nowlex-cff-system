(function () {
    'use strict';

    const STATIC_BASE = window.__static_url || '/static/';
    const scriptRegistry = {
        analise: `${STATIC_BASE}admin/js/analise_processo_arvore.js`,
        arquivos: `${STATIC_BASE}admin/js/arquivos_peticoes_tab.js`,
        tarefas: `${STATIC_BASE}admin/js/tarefas_prazos_interface.js`,
    };
    const loaded = new Set();
    const loading = new Map();

    const normalizeText = (value) => {
        if (!value) return '';
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    };

    const loadScriptOnce = (key) => {
        if (!scriptRegistry[key]) return Promise.resolve();
        if (loaded.has(key)) return Promise.resolve();
        if (loading.has(key)) return loading.get(key);
        const src = scriptRegistry[key];
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => {
                loaded.add(key);
                resolve();
            };
            script.onerror = () => {
                console.error(`Falha ao carregar ${src}`);
                reject(new Error(`Falha ao carregar ${src}`));
            };
            document.head.appendChild(script);
        });
        loading.set(key, promise);
        return promise;
    };

    const handleTabActivation = (title = '') => {
        const normalized = normalizeText(title);
        if (normalized.includes('analise de processo')) {
            loadScriptOnce('analise');
        }
        if (normalized.includes('arquivo')) {
            loadScriptOnce('arquivos');
        }
        if (normalized.includes('tarefas') || normalized.includes('prazos')) {
            loadScriptOnce('tarefas');
        }
    };

    document.addEventListener('cff:adminTabActivated', (event) => {
        handleTabActivation(event?.detail?.title || '');
    });
})();
