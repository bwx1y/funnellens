import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { useWorkspace } from '../context.jsx';
import { Badge, EmptyState, PageHead, Panel, SectionHead } from '../components/ui.jsx';
import { number, percent } from '../lib/domain.js';
import { apiRequest } from '../lib/supabase.js';

export default function Funnel() {
  const { workspace } = useWorkspace();
  const { campaign, period } = workspace.preferences;
  const [funnel, setFunnel] = useState(null);
  const [leakage, setLeakage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const days = ['7', '14', '30'].includes(String(period)) ? period : '30';
    const qs = new URLSearchParams({ days, ...(campaign && campaign !== 'all' ? { campaignId: campaign } : {}) });

    Promise.all([
      apiRequest(`/api/analytics/funnel?${qs.toString()}`).catch(() => null),
      apiRequest(`/api/analytics/leakage?${qs.toString()}`).catch(() => null),
    ]).then(([f, l]) => {
      if (cancelled) return;
      setFunnel(f);
      setLeakage(l);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [campaign, period]);

  const stages = funnel?.stages || [];

  return (
    <div className="stack">
      <PageHead
        eyebrow="FUNNEL INTELLIGENCE"
        title="Volume dan konversi setiap tahap."
        description="Analisis drop-off dan titik kebocoran funnel dari data Meta Ads & WhatsApp."
      />

      {loading ? (
        <Panel><p className="muted">Memuat data funnel…</p></Panel>
      ) : !stages.length ? (
        <Panel>
          <EmptyState
            icon={BarChart3}
            title="Belum ada data funnel"
            description="Hubungkan Meta Ads OAuth dan lakukan sinkronisasi untuk melihat tahap funnel dan deteksi kebocoran."
            action={<Link className="btn btn-primary" to="/app/integrations">Hubungkan Meta Ads</Link>}
          />
        </Panel>
      ) : (
        <>
          <Panel>
            <SectionHead title="Tahapan Funnel" caption="Perbandingan volume antar tahap"/>
            <div className="stage-chart">
              {stages.map((s, idx) => {
                const maxVal = Math.max(...stages.map(x => x.value || x.count || 0), 1);
                const val = s.value ?? s.count ?? 0;
                return (
                  <div className="stage-row" key={s.key || idx}>
                    <div className="stage-label">
                      <strong>{s.label || s.name}</strong>
                      <small>{s.channel || 'Semua kanal'}</small>
                    </div>
                    <div className="stage-bar-wrap">
                      <div className="stage-bar" style={{ width: `${(val / maxVal) * 100}%`, background: '#2563eb' }}/>
                    </div>
                    <div className="stage-number">
                      <strong>{number(val)}</strong>
                      {s.rate !== undefined && <small>{percent(s.rate)}</small>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          {leakage?.transition && (
            <Panel>
              <SectionHead title="Deteksi Kebocoran Utama" action={<Badge color={leakage.severity === 'CRITICAL' ? 'red' : 'amber'}>{leakage.severity || 'Info'}</Badge>}/>
              <p><strong>{leakage.transition}</strong></p>
              {leakage.rate != null && <p>Tingkat transisi: {percent(leakage.rate)}</p>}
              <p className="muted">{leakage.note || leakage.impactCaption}</p>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
