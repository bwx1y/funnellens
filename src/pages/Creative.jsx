import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Image } from 'lucide-react';
import { useWorkspace } from '../context.jsx';
import { Badge, EmptyState, PageHead, Panel, SectionHead } from '../components/ui.jsx';
import { number, shortMoneyMinor } from '../lib/domain.js';
import { apiRequest } from '../lib/supabase.js';

export default function Creative() {
  const { workspace } = useWorkspace();
  const { campaign, period } = workspace.preferences;
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const days = ['7', '14', '30'].includes(String(period)) ? period : '30';
    const qs = new URLSearchParams({
      days,
      ...(campaign && campaign !== 'all' ? { campaignId: campaign } : {}),
    });
    apiRequest(`/api/analytics/creatives?${qs.toString()}`)
      .then(res => { if (!cancelled) setCreatives(res?.creatives || []); })
      .catch(() => { if (!cancelled) setCreatives([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaign, period]);

  return (
    <div className="stack">
      <PageHead
        eyebrow="CREATIVE INTELLIGENCE"
        title="Efektivitas materi iklan."
        description="Analisis performa kreatif, kejenuhan frekuensi, dan kualitas prospek."
      />

      {loading ? (
        <Panel><p className="muted">Memuat data kreatif…</p></Panel>
      ) : !creatives.length ? (
        <Panel>
          <EmptyState
            icon={Image}
            title="Belum ada data kreatif"
            description="Sinkronkan materi iklan dari Meta Ads melalui Integrations & Data untuk melihat analisis kreatif."
            action={<Link className="btn btn-primary" to="/app/integrations">Hubungkan Meta Ads</Link>}
          />
        </Panel>
      ) : (
        <div className="creative-grid">
          {creatives.map(c => (
            <Panel key={c.id} className="creative-card">
              <div className="flex between" style={{ marginBottom: 10 }}>
                <strong>{c.name || c.creativeId}</strong>
                <Badge color={c.fatigued ? 'amber' : 'blue'}>{c.status || c.objectiveGroup || 'Ad'}</Badge>
              </div>
              {c.thumbnailUrl && (
                <div className="ad-art" style={{ marginBottom: 12 }}>
                  <img src={c.thumbnailUrl} alt={c.name || 'Creative'}/>
                </div>
              )}
              <p className="small muted">{c.note || c.body || '-'}</p>
              <div className="flex between" style={{ marginTop: 12 }}>
                <span className="small">Spend: <strong>{shortMoneyMinor(c.spendMinor)}</strong></span>
                <span className="small">Hasil: <strong>{number(c.results || 0)}</strong></span>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
