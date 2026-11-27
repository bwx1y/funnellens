import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Badge, Button, EmptyState, PageHead, Panel, SectionHead, useToast } from '../components/ui.jsx';
import { apiRequest } from '../lib/supabase.js';

export default function Insights() {
  const [insights, setInsights] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [ins, al] = await Promise.all([
        apiRequest('/api/insights?tab=active'),
        apiRequest('/api/alerts?status=active'),
      ]);
      setInsights(ins?.insights || ins?.items || []);
      setAlerts(al?.alerts || al?.items || []);
    } catch (error) {
      setInsights([]);
      setAlerts([]);
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markReviewed = async (item) => {
    try {
      await apiRequest(`/api/insights/${encodeURIComponent(item.key)}/review`, {
        method: 'PATCH',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ status: 'read' }),
      });
      toast('Insight ditandai sudah dibaca.');
      load();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <div className="stack">
      <PageHead
        eyebrow="AI INSIGHT CENTER"
        title="Temuan & peringatan otomatis."
        description="Rekomendasi berbasis data asli dari Meta Ads, Pixel, dan percakapan WhatsApp."
      />

      {loading ? (
        <Panel><p className="muted">Memuat insight &amp; peringatan…</p></Panel>
      ) : !insights.length && !alerts.length ? (
        <Panel>
          <EmptyState
            icon={Sparkles}
            title="Belum ada insight atau peringatan"
            description="Insight otomatis akan dibuat setelah Meta Ads dan WhatsApp terhubung dan tersinkronisasi."
            action={<Link className="btn btn-primary" to="/app/integrations">Atur Integrasi</Link>}
          />
        </Panel>
      ) : (
        <div className="grid grid-2">
          <Panel>
            <SectionHead title="Insight AI" caption={`${insights.length} temuan`}/>
            {insights.length ? (
              <div className="stack">
                {insights.map(item => (
                  <div key={item.id} className="decision-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div className="flex between" style={{ width: '100%' }}>
                      <Badge color="blue">{item.category || 'Insight'}</Badge>
                      <Badge color={item.review?.status === 'read' ? 'teal' : 'amber'}>{item.review?.status || item.status || 'ACTIVE'}</Badge>
                    </div>
                    <h3 style={{ marginTop: 8 }}>{item.title}</h3>
                    <p className="small muted">{item.body || item.summary || item.finding || item.recommendation}</p>
                    {item.review?.status !== 'read' && (
                      <Button variant="secondary" onClick={() => markReviewed(item)}>Tandai sudah dibaca</Button>
                    )}
                  </div>
                ))}
              </div>
            ) : <p className="muted">Belum ada insight.</p>}
          </Panel>

          <Panel>
            <SectionHead title="Peringatan Aktif" caption={`${alerts.length} peringatan`}/>
            {alerts.length ? (
              <div className="stack">
                {alerts.map(a => (
                  <div key={a.id} className="decision-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <Badge color={a.level === 'CRITICAL' ? 'red' : 'amber'}>{a.level || a.severity || 'WARNING'}</Badge>
                    <h3 style={{ marginTop: 8 }}>{a.title}</h3>
                    <p className="small muted">{a.body || a.message || a.caption}</p>
                  </div>
                ))}
              </div>
            ) : <p className="muted">Tidak ada peringatan aktif.</p>}
          </Panel>
        </div>
      )}
    </div>
  );
}
