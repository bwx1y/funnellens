import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../src/lib/supabase.js';

test('analytics requests use the selected Meta account and account changes invalidate the cache', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const calls = [];
  let selectedAccount = 'act_123';

  globalThis.window = {
    localStorage: {
      getItem: () => JSON.stringify({ access_token: 'test-token' }),
    },
    location: { origin: 'http://localhost:5173' },
    dispatchEvent: () => {},
  };
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(url);
    calls.push({ path: requestUrl.pathname, accountId: requestUrl.searchParams.get('accountId'), options });
    const data = requestUrl.pathname === '/api/meta/accounts/selected'
      ? { id: selectedAccount }
      : requestUrl.pathname === '/api/meta/accounts/select'
        ? { account: { id: 'act_456', name: 'Selected account' } }
        : {};
    if (requestUrl.pathname === '/api/meta/accounts/select') selectedAccount = 'act_456';
    return new Response(JSON.stringify({ data, meta: { requestId: 'test-request' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await apiRequest('/api/analytics/summary');
    await apiRequest('/api/meta/accounts/select', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'act_456' }),
    });
    await apiRequest('/api/analytics/summary');

    assert.deepEqual(
      calls.filter(call => call.path === '/api/meta/accounts/selected').map(call => call.path),
      ['/api/meta/accounts/selected', '/api/meta/accounts/selected'],
    );
    assert.deepEqual(
      calls.filter(call => call.path === '/api/analytics/summary').map(call => call.accountId),
      ['act_123', 'act_456'],
    );
    assert.equal(calls.find(call => call.path === '/api/meta/accounts/select').options.method, 'POST');
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('tracking and report requests include the currently selected Meta account', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.window = {
    localStorage: {
      getItem: () => JSON.stringify({ access_token: 'selected-account-test-token' }),
    },
    location: { origin: 'http://localhost:5173' },
  };
  globalThis.fetch = async url => {
    const requestUrl = new URL(url);
    calls.push({
      path: requestUrl.pathname,
      accountId: requestUrl.searchParams.get('accountId'),
    });
    const data = requestUrl.pathname === '/api/meta/accounts/selected'
      ? { id: 'act_selected' }
      : {};
    return new Response(JSON.stringify({ data, meta: { requestId: 'test-request' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await apiRequest('/api/tracking-health');
    await apiRequest('/api/reports/exports');

    assert.deepEqual(
      calls.filter(call => call.path === '/api/tracking-health' || call.path === '/api/reports/exports'),
      [
        { path: '/api/tracking-health', accountId: 'act_selected' },
        { path: '/api/reports/exports', accountId: 'act_selected' },
      ],
    );
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
