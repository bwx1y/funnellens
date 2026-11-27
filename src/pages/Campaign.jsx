import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { useWorkspace } from '../context.jsx';
import { Badge, EmptyState, PageHead, Panel, SectionHead } from '../components/ui.jsx';
import { number, shortMoneyMinor } from '../lib/domain.js';
import { apiRequest } from '../lib/supabase.js';

export default function Campaign() {
  const { workspace } = useWorkspace();
  const { campaign, period } = workspace.preferences;
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const days = ['7', '14', '30'].includes(String(period)) ? period : '30';
    const qs = new URLSearchParams({ days, ...(campaign && campaign !== 'all' ? { campaignId: campaign } : {}) });
    apiRequest(`/api/analytics/summary?${qs.toString()}`)
      .then(res => { if (!cancelled) setCampaigns(res?.campaigns || []); })
      .catch(() => { if (!cancelled) setCampaigns([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaign, period]);

  return (
    <div className="stack">
      <PageHead
        eyebrow="CAMPAIGN & BUDGET"
        title="Performa campaign Meta Ads."
        description="Belanja iklan, klik, dan konversi per campaign dari Ad Account aktif."
      />

      <Panel>
        <SectionHead title="Daftar Campaign" caption={`${campaigns.length} campaign`}/>
        {loading ? (
          <p className="muted">Memuat campaign…</p>
        ) : !campaigns.length ? (
          <EmptyState
            icon={Layers}
            title="Belum ada campaign"
            description="Hubungkan Meta OAuth dan pilih Ad Account di Integrations & Data."
            action={<Link className="btn btn-primary" to="/app/integrations">Hubungkan Meta Ads</Link>}
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Belanja</th>
                  <th>Lead</th>
                  <th>Biaya / lead</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => {
                  const leads = c.leads ?? 0;
                  return (
                    <tr key={c.campaignId || c.id}>
                      <td><strong>{c.name}</strong></td>
                      <td><Badge color={c.status === 'ACTIVE' ? 'teal' : 'gray'}>{c.status || '—'}</Badge></td>
                      <td>{shortMoneyMinor(c.spendMinor)}</td>
                      <td>{number(leads)}</td>
                      <td>{c.costPerLeadMinor == null ? '—' : shortMoneyMinor(c.costPerLeadMinor)}</td>
                      <td>{c.roas == null ? '—' : `${number(c.roas)}x`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
