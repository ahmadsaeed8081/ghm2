const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}
export const api = {
  health: () => request('/api/health'),
  me: () => request('/api/auth/me'),
  profile: () => request('/api/profile/me'),
  updateProfile: (payload) => request('/api/profile/me', { method: 'PUT', body: JSON.stringify(payload) }),
  tasks: () => request('/api/tasks?limit=50&page=1'),
  transactions: () => request('/api/transactions/me')
};
