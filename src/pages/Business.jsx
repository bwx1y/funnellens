import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { useWorkspace } from '../context.jsx';
import { EmptyState, PageHead, Panel, SectionHead } from '../components/ui.jsx';
import { number, shortMoneyMinor } from '../lib/domain.js';
import { apiRequest } from '../lib/supabase.js';

export default function Business() {
  const { workspace } = useWorkspace();
  const { campaign, period } = workspace.preferences;
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const days = ['7', '14', '30'].includes(String(period)) ? period : '30';
    const qs = new URLSearchParams({ days, ...(campaign && campaign !== 'all' ? { campaignId: campaign } : {}) });
    apiRequest(`/api/analytics/summary?${qs.toString()}`)
      .then(res => { if (!cancelled) setSummary(res); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaign, period]);

  const cards = summary?.cards || {};
  const spend = cards.spend?.value;
  const clicks = cards.clicks?.value;
  const leads = cards.leads?.value;
  const roas = cards.roas?.value;

  return (
    <div className="stack">
      <PageHead
        eyebrow="BUSINESS IMPACT"
        title="Dampak bisnis & atribusi."
        description="Metrik belanja dan hasil yang tersedia dari akun iklan Meta terpilih."
      />

      <section className="dashboard-kpis">
        {[
          { label: 'Total Spend', value: spend == null ? '—' : shortMoneyMinor(spend) },
          { label: 'Klik', value: clicks == null ? '—' : number(clicks) },
          { label: 'Lead', value: leads == null ? '—' : number(leads) },
          { label: 'ROAS', value: roas == null ? '—' : `${number(roas)}x` },
        ].map(item => (
          <article className="dashboard-kpi" key={item.label}>
            <div className="dashboard-kpi-label"><span>{item.label}</span></div>
            <strong>{loading ? '…' : item.value}</strong>
          </article>
        ))}
      </section>

      {!loading && !summary?.campaigns?.length && (
        <Panel>
          <EmptyState
            icon={TrendingUp}
            title="Belum ada data campaign"
            description="Hubungkan Meta Ads, pilih Ad Account, lalu sinkronkan insight. Revenue transaksi belum tersedia di backend."
            action={<Link className="btn btn-primary" to="/app/integrations">Hubungkan Sumber Data</Link>}
          />
        </Panel>
      )}
    </div>
  );
}
