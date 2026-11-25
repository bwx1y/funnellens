import test from 'node:test';
import assert from 'node:assert/strict';
import {
  campaigns,
  funnelStages,
  leads,
  selectCampaigns,
  stageTotals,
  visibleLeads,
} from '../src/reference/domain.js';

test('reference daily rows aggregate back to each campaign snapshot', () => {
  for (const campaign of campaigns) {
    assert.deepEqual(stageTotals(campaign, 7), campaign.weekly);
  }
});

test('reference filters select only matching account campaigns and recent leads', () => {
  assert.deepEqual(selectCampaigns('web').map(campaign => campaign.id), ['web']);
  assert.deepEqual(selectCampaigns('all', 'empty'), []);
  assert.deepEqual(visibleLeads(leads, 'all', 7).map(lead => lead.id), [
    'WA-4821',
    'WA-3174',
    'WA-9062',
    'WA-6418',
    'WA-7265',
    'WA-1538',
    'WA-4816',
  ]);
});

test('funnel stage rates use the prior stage count as denominator', () => {
  const stages = funnelStages('wa', campaigns, 7);
  assert.equal(stages[1].rate, 3300 / 156500);
  assert.equal(stages[2].rate, 612 / 3300);
  assert.equal(stages[5].count, 13);
});
