(function() {
    const OFFLINE_HTML = `
        <div id="offline-overlay">
            <div class="offline-container">
                <!--<span class="material-symbols-rounded offline-icon">wifi_off</span>-->
                <h2 style="color: var(--blue-900); font-weight: 800;">You are offline!</h2>
                <p style="color: var(--blue-500); margin: 15px 0 25px;">Summitra requires an active connection.</p>
                <button class="primary-btn" onclick="window.location.reload()" style="width: 100%;">Retry Again</button>
            </div>
        </div>
    `;

    function syncConnectivity() {
        if (!navigator.onLine) {
            if (!document.getElementById('offline-overlay')) {
                document.body.insertAdjacentHTML('afterbegin', OFFLINE_HTML);
            }
            document.body.classList.add('is-offline');
        } else {
            document.body.classList.remove('is-offline');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncConnectivity);
    } else {
        syncConnectivity();
    }

    window.addEventListener('online', syncConnectivity);
    window.addEventListener('offline', syncConnectivity);
})();