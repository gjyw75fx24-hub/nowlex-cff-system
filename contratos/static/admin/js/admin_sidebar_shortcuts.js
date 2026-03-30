(function () {
    const managerUrl = String(window.__admin_slack_supervision_manager_url || '').trim();
    const canShowManager = Boolean(window.__admin_is_supervisor_developer) && Boolean(managerUrl);

    if (!canShowManager) {
        return;
    }

    function buildSlackManagerShortcut() {
        const wrapper = document.createElement('div');
        wrapper.className = 'slack-msgs-shortcut';

        const link = document.createElement('a');
        link.href = managerUrl;
        link.className = 'slack-msgs-link';
        link.textContent = 'Msgs Slack';
        if (window.location.pathname === new URL(managerUrl, window.location.origin).pathname) {
            link.classList.add('slack-msgs-link--active');
        }

        wrapper.appendChild(link);
        return wrapper;
    }

    function normalize(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
    }

    function ensureSlackManagerShortcut() {
        const navSidebar = document.getElementById('nav-sidebar');
        if (!navSidebar) {
            return;
        }
        Array.from(navSidebar.querySelectorAll('.slack-msgs-shortcut-prev')).forEach(function (module) {
            module.classList.remove('slack-msgs-shortcut-prev');
        });
        const adminModule = Array.from(navSidebar.querySelectorAll('.module'))
            .find((module) => normalize(module.querySelector('h2, caption')?.textContent) === 'menu adm');
        if (!adminModule || !adminModule.parentNode) {
            return;
        }
        let shortcut = navSidebar.querySelector('.slack-msgs-shortcut');
        if (!shortcut) {
            shortcut = buildSlackManagerShortcut();
        }
        const legacyRow = navSidebar.querySelector('.slack-msgs-row');
        if (legacyRow) {
            legacyRow.remove();
        }
        if (adminModule.previousElementSibling !== shortcut) {
            adminModule.parentNode.insertBefore(shortcut, adminModule);
        }
        let previousModule = shortcut.previousElementSibling;
        while (previousModule && !previousModule.classList?.contains('module')) {
            previousModule = previousModule.previousElementSibling;
        }
        if (previousModule && previousModule !== shortcut) {
            previousModule.classList.add('slack-msgs-shortcut-prev');
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        ensureSlackManagerShortcut();
        const navSidebar = document.getElementById('nav-sidebar');
        if (!navSidebar) {
            return;
        }
        const observer = new MutationObserver(function () {
            ensureSlackManagerShortcut();
        });
        observer.observe(navSidebar, { childList: true, subtree: true });
    });
})();
