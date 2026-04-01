(function () {
    'use strict';

    if (window.__adminNavigationLoadingInitialized) {
        return;
    }
    window.__adminNavigationLoadingInitialized = true;

    const PROCESSO_LIST_PATH = '/admin/contratos/processojudicial/';
    const PROCESSO_CHANGE_RE = /^\/admin\/contratos\/processojudicial\/\d+\/change\/$/i;

    const normalizePath = (path) => {
        if (!path) {
            return '/';
        }
        let normalized = path;
        if (!normalized.startsWith('/')) {
            normalized = `/${normalized}`;
        }
        normalized = normalized.replace(/\/{2,}/g, '/');
        if (normalized !== '/' && !normalized.endsWith('/')) {
            normalized = `${normalized}/`;
        }
        return normalized;
    };

    const isListPath = (path) => normalizePath(path) === PROCESSO_LIST_PATH;
    const isChangePath = (path) => PROCESSO_CHANGE_RE.test(normalizePath(path));
    const isTrackedSourcePath = (path) => isListPath(path) || isChangePath(path);
    const isTrackedTransition = (fromPath, toPath) => {
        return (
            (isListPath(fromPath) && isChangePath(toPath))
            || (isChangePath(fromPath) && isListPath(toPath))
        );
    };

    let overlay = null;
    let isVisible = false;
    let overlayText = 'Carregando cadastro...';

    const ensureOverlay = () => {
        if (overlay) {
            return overlay;
        }
        overlay = document.createElement('div');
        overlay.id = 'admin-navigation-loading';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="admin-navigation-loading__content" role="status" aria-live="polite">
                <div class="admin-navigation-loading__brand">CFF SYSTEM</div>
                <div class="admin-navigation-loading__bar" aria-hidden="true">
                    <span class="admin-navigation-loading__square"></span>
                    <span class="admin-navigation-loading__square"></span>
                    <span class="admin-navigation-loading__square"></span>
                    <span class="admin-navigation-loading__square"></span>
                    <span class="admin-navigation-loading__square"></span>
                    <span class="admin-navigation-loading__square"></span>
                    <span class="admin-navigation-loading__square"></span>
                    <span class="admin-navigation-loading__square"></span>
                </div>
                <div class="admin-navigation-loading__text">${overlayText}</div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    };

    const setOverlayText = (text) => {
        const normalizedText = String(text || '').trim() || 'Carregando cadastro...';
        overlayText = normalizedText;
        if (!overlay) {
            return;
        }
        const textNode = overlay.querySelector('.admin-navigation-loading__text');
        if (textNode) {
            textNode.textContent = normalizedText;
        }
    };

    const showLoading = (text) => {
        if (text) {
            setOverlayText(text);
        }
        if (isVisible) {
            return;
        }
        isVisible = true;
        const el = ensureOverlay();
        el.classList.add('is-active');
        el.setAttribute('aria-hidden', 'false');
        document.body.classList.add('admin-navigation-loading-active');
    };

    const hideLoading = () => {
        if (!overlay) {
            return;
        }
        isVisible = false;
        overlay.classList.remove('is-active');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('admin-navigation-loading-active');
    };

    window.__adminNavigationLoading = {
        show: showLoading,
        hide: hideLoading,
        setText: setOverlayText,
    };

    const shouldIgnoreAnchor = (anchor) => {
        if (!anchor) {
            return true;
        }
        if (anchor.dataset.loadingIgnore === '1') {
            return true;
        }
        if (anchor.hasAttribute('download')) {
            return true;
        }
        const target = (anchor.getAttribute('target') || '').trim().toLowerCase();
        if (target && target !== '_self') {
            return true;
        }
        const href = (anchor.getAttribute('href') || '').trim();
        if (!href || href.startsWith('#')) {
            return true;
        }
        const lowerHref = href.toLowerCase();
        if (
            lowerHref.startsWith('javascript:')
            || lowerHref.startsWith('mailto:')
            || lowerHref.startsWith('tel:')
        ) {
            return true;
        }
        return false;
    };

    const navigateWithLoading = (targetUrlRaw) => {
        let targetUrl;
        try {
            targetUrl = new URL(targetUrlRaw, window.location.href);
        } catch (error) {
            window.location.href = targetUrlRaw;
            return;
        }
        showLoading();
        // Pequeno atraso para permitir o repaint do overlay antes da troca de página.
        window.setTimeout(() => {
            window.location.href = targetUrl.href;
        }, 24);
    };

    window.__adminNavigateWithLoading = navigateWithLoading;

    if (!isTrackedSourcePath(window.location.pathname)) {
        window.addEventListener('pageshow', () => {
            hideLoading();
        });
        return;
    }

    document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0) {
            return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        const anchor = event.target?.closest?.('a[href]');
        if (!(anchor instanceof HTMLAnchorElement)) {
            return;
        }
        if (shouldIgnoreAnchor(anchor)) {
            return;
        }

        let targetUrl;
        try {
            targetUrl = new URL(anchor.href, window.location.href);
        } catch (error) {
            return;
        }
        if (targetUrl.origin !== window.location.origin) {
            return;
        }

        if (!isTrackedTransition(window.location.pathname, targetUrl.pathname)) {
            return;
        }

        event.preventDefault();
        navigateWithLoading(targetUrl.href);
    }, true);

    window.addEventListener('admin:navigation-loading:start', (event) => {
        const targetUrlRaw = event?.detail?.targetUrl || '';
        const loadingText = event?.detail?.text || '';
        if (targetUrlRaw) {
            try {
                const targetUrl = new URL(targetUrlRaw, window.location.href);
                if (
                    targetUrl.origin !== window.location.origin
                    || !isTrackedTransition(window.location.pathname, targetUrl.pathname)
                ) {
                    return;
                }
            } catch (error) {
                return;
            }
        }
        showLoading(loadingText);
    });

    window.addEventListener('pageshow', () => {
        hideLoading();
    });
})();
