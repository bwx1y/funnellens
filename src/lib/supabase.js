const apiBase = import.meta.env.VITE_API_URL || '';

export const supabaseConfigured = true;
export const supabase = null;

export async function apiRequest(path, options = {}) {
  let token = null;
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('funnellens_session') : null;
    if (saved) {
      const parsed = JSON.parse(saved);
      token = parsed?.access_token || null;
    }
  } catch {}

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || result.error || `API gagal (${response.status}).`);
  }
  return result?.data !== undefined && result?.status === true ? result.data : result;
}
