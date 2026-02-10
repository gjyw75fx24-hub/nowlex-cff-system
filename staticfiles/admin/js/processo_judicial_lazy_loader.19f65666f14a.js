(function () {
    'use strict';

    const STATIC_BASE = window.__static_url || '/static/';
    const CACHE_BUST = '20260210i';
    const scriptRegistry = {
        analise: `${STATIC_BASE}admin/js/analise_processo_arvore.js?v=${CACHE_BUST}`,
        arquivos: `${STATIC_BASE}admin/js/arquivos_peticoes_tab.js`,
        tarefas: `${STATIC_BASE}admin/js/tarefas_prazos_interface.js`,
        pickr: 'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/pickr.min.js',
    };
    const cssRegistry = {
        analise: `${STATIC_BASE}admin/css/analise_processo.css?v=${CACHE_BUST}`,
        arquivos: `${STATIC_BASE}admin/css/arquivos_peticoes_tab.css`,
        pickr: 'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/themes/classic.min.css',
    };
    const loaded = new Set();
    const loading = new Map();
    const cssLoaded = new Set();

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

    const loadCssOnce = (key) => {
        if (!cssRegistry[key]) return;
        if (cssLoaded.has(key)) return;
        const href = cssRegistry[key];
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.lazyCss = key;
        document.head.appendChild(link);
        cssLoaded.add(key);
    };

    const handleTabActivation = (title = '') => {
        const normalized = normalizeText(title);
        if (normalized.includes('analise de processo')) {
            loadCssOnce('analise');
            loadScriptOnce('analise');
        }
        if (normalized.includes('arquivo')) {
            loadCssOnce('arquivos');
            loadScriptOnce('arquivos');
        }
        if (normalized.includes('tarefas') || normalized.includes('prazos')) {
            loadScriptOnce('tarefas');
        }
    };

    document.addEventListener('cff:adminTabActivated', (event) => {
        handleTabActivation(event?.detail?.title || '');
    });

    const shouldLoadPickr = (target) => {
        if (!target) return false;
        if (target.closest && target.closest('#open-etiqueta-modal')) return true;
        if (target.closest && target.closest('#open-create-etiqueta-btn')) return true;
        if (target.closest && target.closest('#add-new-etiqueta-btn')) return true;
        return false;
    };

    document.addEventListener('click', (event) => {
        if (!shouldLoadPickr(event.target)) {
            return;
        }
        loadCssOnce('pickr');
        loadScriptOnce('pickr');
    });
})();
