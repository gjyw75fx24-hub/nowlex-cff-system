(function () {
    'use strict';

    if (window.__adminRowOpenChoiceInitialized) {
        return;
    }
    window.__adminRowOpenChoiceInitialized = true;

    const BODY = document.body;
    if (!BODY || !BODY.classList.contains('change-list')) {
        return;
    }

    const RESULT_TABLE_SELECTOR = '#result_list';
    const ROW_SELECTOR = `${RESULT_TABLE_SELECTOR} tbody tr`;
    const INTERACTIVE_SELECTOR = [
        'input',
        'button',
        'select',
        'textarea',
        'label',
        '[role="button"]',
        '.cnj-nav-control',
        '.cnj-nav-wrapper',
        '.analysis-exclude'
    ].join(', ');

    const ensurePromptStyle = () => {
        if (document.getElementById('row-open-prompt-style')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'row-open-prompt-style';
        style.textContent = `
            ${ROW_SELECTOR}[data-open-choice-enabled="1"] {
                cursor: pointer;
            }
            .row-open-choice-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.35);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 12000;
                padding: 16px;
            }
            .row-open-choice-overlay.open {
                display: flex;
            }
            .row-open-choice-modal {
                width: min(420px, calc(100vw - 24px));
                background: #fff9df;
                border: 1px solid #f3e1a1;
                border-radius: 12px;
                box-shadow: 0 16px 32px rgba(0, 0, 0, 0.2);
                padding: 16px;
                color: #3e2a00;
            }
            .row-open-choice-title {
                margin: 0 0 8px 0;
                font-size: 1rem;
                font-weight: 700;
            }
            .row-open-choice-text {
                margin: 0 0 14px 0;
                font-size: 0.9rem;
                line-height: 1.4;
            }
            .row-open-choice-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            .row-open-choice-actions button {
                border: 1px solid #d7c484;
                background: #fff;
                border-radius: 8px;
                padding: 6px 12px;
                cursor: pointer;
                font-weight: 600;
                color: #3e2a00;
            }
            .row-open-choice-actions .row-open-choice-here {
                background: #f5c242;
                border-color: #d7a72f;
            }
        `;
        document.head.appendChild(style);
    };

    const buildPrompt = () => {
        ensurePromptStyle();
        const overlay = document.createElement('div');
        overlay.className = 'row-open-choice-overlay';
        overlay.innerHTML = `
            <div class="row-open-choice-modal" role="dialog" aria-modal="true" aria-labelledby="row-open-choice-title">
                <h3 class="row-open-choice-title" id="row-open-choice-title">Abrir cadastro</h3>
                <p class="row-open-choice-text">Como você deseja abrir este cadastro?</p>
                <div class="row-open-choice-actions">
                    <button type="button" class="row-open-choice-cancel">Cancelar</button>
                    <button type="button" class="row-open-choice-newtab">Abrir em nova aba</button>
                    <button type="button" class="row-open-choice-here">Abrir aqui</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    };

    const promptOverlay = buildPrompt();
    const buttonCancel = promptOverlay.querySelector('.row-open-choice-cancel');
    const buttonNewTab = promptOverlay.querySelector('.row-open-choice-newtab');
    const buttonHere = promptOverlay.querySelector('.row-open-choice-here');
    let resolvePrompt = null;
    let promptOpen = false;
    let inNavigation = false;

    const closePrompt = (choice) => {
        if (!promptOpen) {
            return;
        }
        promptOpen = false;
        promptOverlay.classList.remove('open');
        if (resolvePrompt) {
            resolvePrompt(choice);
            resolvePrompt = null;
        }
    };

    const openPrompt = () => new Promise((resolve) => {
        resolvePrompt = resolve;
        promptOpen = true;
        promptOverlay.classList.add('open');
    });

    promptOverlay.addEventListener('click', (event) => {
        if (event.target === promptOverlay) {
            closePrompt('cancel');
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && promptOpen) {
            closePrompt('cancel');
        }
    });
    buttonCancel.addEventListener('click', () => closePrompt('cancel'));
    buttonNewTab.addEventListener('click', () => closePrompt('new_tab'));
    buttonHere.addEventListener('click', () => closePrompt('here'));

    const navigateWithChoice = async (targetUrl) => {
        if (!targetUrl || inNavigation) {
            return;
        }
        const choice = await openPrompt();
        if (choice === 'cancel') {
            return;
        }
        inNavigation = true;
        if (choice === 'new_tab') {
            window.open(targetUrl, '_blank', 'noopener');
            inNavigation = false;
            return;
        }
        if (typeof window.__adminNavigateWithLoading === 'function') {
            window.__adminNavigateWithLoading(targetUrl);
            return;
        }
        window.dispatchEvent(new CustomEvent('admin:navigation-loading:start', {
            detail: { targetUrl, source: 'row_open_choice' },
        }));
        window.location.href = targetUrl;
    };

    window.__adminNavigateWithRowChoice = navigateWithChoice;

    const getChangeLinkForRow = (row) => {
        if (!row) {
            return null;
        }
        const primary = row.querySelector('th a[href]');
        if (primary) {
            return primary;
        }
        return row.querySelector('a[href*="/change/"]');
    };

    document.querySelectorAll(ROW_SELECTOR).forEach((row) => {
        if (getChangeLinkForRow(row)) {
            row.setAttribute('data-open-choice-enabled', '1');
        }
    });

    document.addEventListener('click', async (event) => {
        if (event.defaultPrevented || event.button !== 0 || inNavigation) {
            return;
        }
        const row = event.target.closest(ROW_SELECTOR);
        if (!row) {
            return;
        }
        const changeLink = getChangeLinkForRow(row);
        if (!changeLink) {
            return;
        }

        const clickedAnchor = event.target.closest('a[href]');
        const clickedInteractive = event.target.closest(INTERACTIVE_SELECTOR);
        const clickedChangeLink = clickedAnchor === changeLink;

        if (clickedAnchor && !clickedChangeLink) {
            return;
        }
        if (clickedInteractive && !clickedChangeLink) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const targetUrl = changeLink.href;
        await navigateWithChoice(targetUrl);
    }, true);
})();
