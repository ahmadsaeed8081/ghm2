// Shared API client and SIWE session helpers for the legacy compatibility shell.
// Persistent user/task data is stored in MongoDB through the Express API, never in localStorage.
        function apiBaseUrl() {
            return (window.__GHM21_CONFIG__?.apiBaseUrl || window.__GHM21_API_BASE_URL__ || ACTIVE_CHAIN_CONFIG.apiBaseUrl || '').replace(/\/$/, '');
        }
        async function apiRequest(path, options = {}) {
            const headers = { ...(options.headers || {}) };
            if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
            const response = await fetch(apiBaseUrl() + path, { credentials: 'include', ...options, headers });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || ('API request failed (' + response.status + ')'));
            return payload;
        }
        async function ensureApiSession() {
            if (!userWalletAddress || !signer) throw new Error('Connect your wallet first.');
            try {
                const current = await apiRequest('/api/auth/me');
                if (String(current.walletAddress || '').toLowerCase() === userWalletAddress.toLowerCase()) return current;
            } catch (error) {
                if (!String(error.message).includes('Not authenticated') && !String(error.message).includes('Session user')) throw error;
            }
            const nonceResult = await apiRequest('/api/auth/nonce');
            const domain = window.location.host;
            const origin = window.location.origin;
            const message = domain + ' wants you to sign in with your Ethereum account:\n' + userWalletAddress + '\n\nSign in to GHM21 database services.\n\nURI: ' + origin + '\nVersion: 1\nChain ID: ' + ACTIVE_CHAIN_CONFIG.chainId + '\nNonce: ' + nonceResult.nonce + '\nIssued At: ' + new Date().toISOString();
            const signature = await signer.signMessage(message);
            return apiRequest('/api/auth/verify', { method: 'POST', body: JSON.stringify({ message, signature }) });
        }
        function escapeHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        }


let profilePreferenceSaveTimer = null;
let legacyMigrationWallet = '';
async function migrateLegacyLocalData() {
    if (!userWalletAddress) return;
    const walletKey = userWalletAddress.toLowerCase();
    if (legacyMigrationWallet === walletKey) return;
    let telegramHandle = '';
    let transactions = [];
    let tasks = [];
    let selectedTier = '';
    let referralUpliner = '';
    try {
        telegramHandle = localStorage.getItem('ghm21_tg_' + walletKey) || '';
        try { transactions = JSON.parse(localStorage.getItem('ghm21_tx_' + walletKey) || '[]'); } catch { transactions = []; }
        try { tasks = JSON.parse(localStorage.getItem('ghm21_shared_global_feed') || '[]'); } catch { tasks = []; }
        selectedTier = localStorage.getItem('ghm21_selected_tier') || '';
        referralUpliner = localStorage.getItem('ghm21_ref_upliner') || '';
    } catch (error) {
        console.warn('Legacy browser storage is not available for migration:', error.message);
        return;
    }
    try {
        const result = await apiRequest('/api/profile/migrate-legacy', {
            method: 'POST',
            body: JSON.stringify({ telegramHandle, transactions, tasks, selectedTier, referralUpliner })
        });
        // Delete only wallet-specific records after the server confirms the import.
        try {
            localStorage.removeItem('ghm21_tg_' + walletKey);
            localStorage.removeItem('ghm21_tx_' + walletKey);
            localStorage.removeItem('ghm21_selected_tier');
            localStorage.removeItem('ghm21_ref_upliner');
        } catch { /* Migration is already saved server-side. */ }
        legacyMigrationWallet = walletKey;
        console.info('Legacy local data migration completed:', result);
    } catch (error) {
        console.warn('Legacy local data migration will retry on the next connection:', error.message);
    }
}
function saveProfilePreferences(preferences = {}) {
    if (!userWalletAddress) return;
    if (profilePreferenceSaveTimer) clearTimeout(profilePreferenceSaveTimer);
    profilePreferenceSaveTimer = setTimeout(async () => {
        try {
            await ensureApiSession();
            await apiRequest('/api/profile/me', { method: 'PUT', body: JSON.stringify(preferences) });
        } catch (error) { console.warn('Could not save profile preferences:', error.message); }
    }, 600);
}
