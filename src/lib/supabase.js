const apiBase = import.meta.env?.VITE_API_URL || '';
const SESSION_KEY = 'funnellens_session';

let selectedAccountToken = null;
let selectedAccountId = null;
let selectedAccountRequest = null;

function getToken() {
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(SESSION_KEY) : null;
    return saved ? JSON.parse(saved)?.access_token || null : null;
  } catch {
    return null;
  }
}

function apiUrl(path) {
  const base = apiBase || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  return new URL(path, base);
}

function unwrap(result) {
  if (result?.data !== undefined && (result?.meta?.requestId || result?.status === true)) {
    return result.data;
  }
  return result;
}

async function request(url, options, token) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok) {
    const error = new Error(
      result?.message || result?.error?.message || result?.error || `API gagal (${response.status}).`
    );
    error.status = response.status;
    throw error;
  }
  return unwrap(result);
}

function needsSelectedAccount(method, pathname) {
  if (method !== 'GET') return false;
  return pathname === '/api/analytics/summary'
    || pathname === '/api/analytics/funnel'
    || pathname === '/api/analytics/funnel/stage-detail'
    || pathname === '/api/analytics/leakage'
    || pathname === '/api/analytics/leaks/history'
    || pathname === '/api/analytics/audience'
    || pathname.startsWith('/api/analytics/audience/')
    || pathname === '/api/analytics/creatives'
    || pathname.startsWith('/api/analytics/creatives/')
    || pathname === '/api/leads'
    || pathname.startsWith('/api/leads/')
    || pathname === '/api/insights'
    || pathname === '/api/insights/unread-count'
    || pathname === '/api/alerts'
    || pathname === '/api/alerts/badge'
    || pathname === '/api/tracking-health'
    || pathname === '/api/reports/exports'
    || pathname === '/api/reports/campaigns.csv'
    || pathname === '/api/reports/creative-trend.csv';
}

async function getSelectedAccountId(token) {
  if (selectedAccountToken === token && selectedAccountId) return selectedAccountId;
  if (selectedAccountRequest && selectedAccountToken === token) return selectedAccountRequest;

  selectedAccountToken = token;
  selectedAccountRequest = request(apiUrl('/api/meta/accounts/selected'), {}, token)
    .then((account) => {
      const id = account?.id || account?.accountId;
      if (!id) throw new Error('Pilih Ad Account Meta di halaman Integrations & Data terlebih dahulu.');
      selectedAccountId = id;
      return id;
    })
    .catch((error) => {
      selectedAccountId = null;
      selectedAccountRequest = null;
      throw error;
    });

  return selectedAccountRequest;
}

function invalidateSelectedAccount() {
  selectedAccountToken = null;
  selectedAccountId = null;
  selectedAccountRequest = null;
}

export const supabaseConfigured = true;
export const supabase = null;

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const url = apiUrl(path);
  const method = (options.method || 'GET').toUpperCase();

  if (needsSelectedAccount(method, url.pathname) && !url.searchParams.has('accountId')) {
    url.searchParams.set('accountId', await getSelectedAccountId(token));
  }

  const result = await request(url.toString(), options, token);

  if ((url.pathname === '/api/meta/accounts/select' && method === 'POST')
    || (url.pathname === '/api/meta/connection' && method === 'DELETE')) {
    invalidateSelectedAccount();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('funnellens:account-changed'));
    }
  }

  return result;
}

export async function apiDownload(path, options = {}) {
  const token = getToken();
  const url = apiUrl(path);
  const method = (options.method || 'GET').toUpperCase();

  if (needsSelectedAccount(method, url.pathname) && !url.searchParams.has('accountId')) {
    url.searchParams.set('accountId', await getSelectedAccountId(token));
  }

  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let result = null;
    try {
      result = await response.clone().json();
    } catch {
      result = null;
    }
    throw new Error(
      result?.message || result?.error?.message || result?.error || `Unduhan gagal (${response.status}).`
    );
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get('content-disposition') || '';
  const defaultFilename = url.pathname.endsWith('/campaigns.csv')
    ? 'campaigns.csv'
    : url.pathname.endsWith('/creative-trend.csv') ? 'creative-trend.csv' : 'funnellens-report.csv';
  const filename = contentDisposition.match(/filename="?([^";]+)"?/i)?.[1] || defaultFilename;
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 500);
}
