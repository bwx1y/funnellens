import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  createWorkspace,
  mergeWorkspace,
  loadWorkspace,
  saveWorkspace,
  clearWorkspace,
  validateStep,
  daysBetween,
  csv,
} from '../src/lib/domain.js';

const store = () => {
  const map = new Map();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
  };
};

const ready = () => {
  const w = createWorkspace();
  Object.assign(w.business, {
    name: 'Business',
    category: 'Services',
    product: 'Product',
    price: 10000,
    benefits: 'Product facts',
    audience: 'Customers',
    area: 'City',
  });
  Object.assign(w.brand, { name: 'Brand', positioning: 'Positioning' });
  Object.assign(w.campaign, {
    name: 'Campaign',
    phone: '081234567890',
    location: 'City',
    budget: '100000',
    start: '2026-10-01',
    end: '2026-10-07',
    creative: 'Ad copy',
    lpHeadline: 'Page headline',
  });
  Object.assign(w.meta, { connected: true, account: 'act_123' });
  return w;
};

test('new workspace starts without prefilled business, brand, or campaign data', () => {
  const w = createWorkspace();
  assert.equal(w.business.name, '');
  assert.equal(w.business.product, '');
  assert.equal(w.brand.name, '');
  assert.equal(w.campaign.name, '');
  assert.equal(w.campaign.budget, '');
  assert.equal(w.meta.account, '');
});

test('onboarding data survives storage round trip; reset owns only its key', () => {
  const storage = store();
  const w = ready();
  w.onboarding.maxStep = 6;
  w.leadNotes = { 'lead-1': [{ text: 'Follow up' }] };
  storage.setItem('other-app', 'keep');
  assert.equal(saveWorkspace(storage, w), '');
  assert.deepEqual(loadWorkspace(storage).workspace, w);
  clearWorkspace(storage);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem('other-app'), 'keep');
});

test('corrupt and blocked storage return recoverable status without deleting original', () => {
  const storage = store();
  storage.setItem(STORAGE_KEY, 'broken{');
  const loaded = loadWorkspace(storage);
  assert.ok(loaded.error);
  assert.equal(storage.getItem(STORAGE_KEY), 'broken{');
  assert.ok(saveWorkspace({ setItem() { throw Error(); } }, ready()));
});

test('import rejects invalid nested profile values and restores blank defaults', () => {
  const w = ready();
  w.brand.name = 25;
  assert.throws(() => mergeWorkspace(w));
  assert.throws(() => mergeWorkspace({ version: 2, business: {} }));
  const merged = mergeWorkspace({ version: 1, business: { name: 'Store' } });
  assert.equal(merged.business.name, 'Store');
  assert.equal(merged.campaign.destination, 'wa');
  assert.equal(merged.campaign.budget, '');
  assert.deepEqual(merged.strategy.proposed, {});
});

test('destination validation applies WA and LP requirements independently', () => {
  const w = ready();
  assert.deepEqual(validateStep(3, w), {});
  w.campaign.phone = '';
  assert.ok(validateStep(3, w).phone);
  w.campaign.destination = 'lp';
  w.campaign.lpUrl = 'https://example.com';
  assert.deepEqual(validateStep(3, w), {});
  w.campaign.lpUrl = 'javascript:alert(1)';
  assert.ok(validateStep(3, w).lpUrl);
  w.campaign.lpUrl = 'https://example.com';
  w.campaign.destination = 'both';
  assert.ok(validateStep(3, w).phone);
});

test('campaign plan validation checks schedule, audience, and budget', () => {
  const w = ready();
  assert.equal(daysBetween(w.campaign.start, w.campaign.end), 7);
  w.campaign.end = '2026-09-20';
  w.campaign.ageMin = 70;
  w.campaign.budget = 0;
  const errors = validateStep(3, w);
  assert.ok(errors.schedule && errors.age && errors.budget);
  assert.equal(daysBetween('bad', 'bad'), 0);
});

test('Meta setup requires a connected account but not unsupported page or WhatsApp assets', () => {
  const w = ready();
  assert.deepEqual(validateStep(5, w), {});
  w.meta.account = '';
  assert.ok(validateStep(5, w).meta);
});

test('CSV safely preserves quotes, commas, and line breaks', () => {
  const result = csv([['Name', 'Notes'], ['A, B', 'The word "test"\nnew line']]);
  assert.ok(result.startsWith('\uFEFF'));
  assert.ok(result.includes('"A, B","The word ""test""\nnew line"'));
});
