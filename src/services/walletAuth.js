const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `API request failed (${response.status})`);
  return payload;
}

/** Sign in to the Express API with SIWE after a wallet is connected. This is separate from connect-only UX. */
export async function signInWithWallet({ walletProvider, address, chainId }) {
  if (!walletProvider || !address) throw new Error('Connect a wallet before signing in.');
  const origin = window.location.origin;
  const domain = window.location.host;
  const { nonce } = await request('/api/auth/nonce');
  const message = `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to GHM21.

URI: ${origin}
Version: 1
Chain ID: ${Number(chainId)}
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`;
  const signature = await walletProvider.request({ method: 'personal_sign', params: [message, address] });
  return request('/api/auth/verify', { method: 'POST', body: JSON.stringify({ message, signature }) });
}

export async function getWalletSession() {
  return request('/api/auth/me');
}

export async function signOutWalletSession() {
  return request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
}
