(function () {
    'use strict';

    const config = window.__processo_online_presence;
    if (!config || !config.enabled || !config.endpoint_url || !config.token) {
        return;
    }

    const body = document.body;
    if (!body || !body.classList.contains('change-form')) {
        return;
    }

    const getCsrfToken = () => {
        const name = 'csrftoken=';
        const raw = String(document.cookie || '');
        const cookies = raw.split(';');
        for (let i = 0; i < cookies.length; i += 1) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith(name)) {
                return decodeURIComponent(cookie.slice(name.length));
            }
        }
        return '';
    };

    const getTabId = () => {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    };

    const endpointUrl = String(config.endpoint_url || '').trim();
    const token = String(config.token || '').trim();
    const tabId = getTabId();
    const heartbeatSeconds = Math.max(5, Number(config.heartbeat_seconds || 15));
    const heartbeatMs = heartbeatSeconds * 1000;
    let inFlight = false;
    let lastInteractionTs = Math.floor(Date.now() / 1000);

    const markInteraction = () => {
        lastInteractionTs = Math.floor(Date.now() / 1000);
    };

    ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach((eventName) => {
        document.addEventListener(eventName, markInteraction, { passive: true });
    });

    const sendHeartbeat = async () => {
        if (!endpointUrl || !token || inFlight) {
            return;
        }
        inFlight = true;
        try {
            await fetch(endpointUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    token,
                    tab_id: tabId,
                    visible: !document.hidden,
                    path: `${window.location.pathname}${window.location.search || ''}`,
                    last_interaction_ts: lastInteractionTs,
                }),
            });
        } catch (error) {
            // Ignore heartbeat errors; next interval retries.
        } finally {
            inFlight = false;
        }
    };

    sendHeartbeat();
    setInterval(sendHeartbeat, heartbeatMs);
    document.addEventListener('visibilitychange', sendHeartbeat);
})();
