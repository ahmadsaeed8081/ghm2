// Transaction history persistence via MongoDB API.
async function recordTxHistory(type, amount, status, transactionHash = '') {
            if (!userWalletAddress) return;
            try {
                await ensureApiSession();
                await apiRequest('/api/transactions', { method: 'POST', body: JSON.stringify({ type, amount, status, transactionHash }) });
                await loadPersistentTransactionHistory();
            } catch (error) {
                console.warn('Could not persist transaction history in MongoDB:', error.message);
            }
        }

        async function loadPersistentTransactionHistory() {
            const tbody = document.getElementById('txHistoryBody');
            if (!tbody) return;
            if (!userWalletAddress) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Connect wallet to view your database transaction history.</td></tr>';
                return;
            }
            try {
                const result = await apiRequest('/api/transactions/me');
                const history = result.items || [];
                if (!history.length) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">No transactions saved yet.</td></tr>';
                    return;
                }
                tbody.innerHTML = history.map(tx => '<tr><td>' + escapeHtml(tx.type) + '</td><td>' + escapeHtml(tx.amount) + '</td><td style="color: var(--neon-emerald);">' + escapeHtml(tx.status) + '</td><td>' + escapeHtml(new Date(tx.createdAt).toLocaleString()) + '</td></tr>').join('');
            } catch (error) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Sign in to load MongoDB history.</td></tr>';
            }
        }
