import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Layers, MessageCircle, MousePointer2, Sparkles } from 'lucide-react';
import { useWorkspace } from '../context.jsx';
import { EmptyState, PageHead, Panel, SectionHead, TextLink } from '../components/ui.jsx';
import { number, percent, shortMoneyMinor } from '../lib/domain.js';
import { apiRequest } from '../lib/supabase.js';

export default function Overview() {
  const { workspace } = useWorkspace();
  const { campaign, period } = workspace.preferences;
  const [summary, setSummary] = useState(null);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const days = ['7', '14', '30'].includes(String(period)) ? period : '30';
    const qs = new URLSearchParams({ days, ...(campaign && campaign !== 'all' ? { campaignId: campaign } : {}) });

    Promise.all([
      apiRequest(`/api/analytics/summary?${qs.toString()}`).catch(() => null),
      apiRequest('/api/insights?tab=active').catch(() => null),
    ]).then(([sumData, insData]) => {
      if (cancelled) return;
      setSummary(sumData);
      setInsights(insData?.items || insData?.insights || []);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [campaign, period]);

  const campaigns = summary?.campaigns || [];
  const kpis = summary?.cards || {};
  const totalSpend = kpis.spend?.value;
  const totalClicks = kpis.clicks?.value;
  const totalLeads = kpis.leads?.value;
  const clickToLead = totalClicks ? totalLeads / totalClicks : 0;
  const maxLeads = Math.max(...campaigns.map(c => c.leads || 0), 0);
  const dailyRows = summary?.series?.current || [];
  const maxClicks = Math.max(...dailyRows.map(row => row.clicks || 0), 0);

  return (
    <div className="stack page-overview">
      <PageHead
        title="Ringkasan"
        description="Performa Meta Ads, WhatsApp, dan website dari akun yang terhubung."
      />

      <section className="dashboard-kpis" aria-label="Metrik utama">
        {[
          { label: 'Belanja iklan', value: totalSpend == null ? '—' : shortMoneyMinor(totalSpend), icon: Layers, detail: `${campaigns.length} campaign` },
          { label: 'Klik semua kanal', value: totalClicks == null ? '—' : number(totalClicks), icon: MousePointer2, detail: 'Klik pada periode terpilih' },
          { label: 'Lead', value: totalLeads == null ? '—' : number(totalLeads), icon: MessageCircle, detail: `${percent(clickToLead)} dari klik` },
          { label: 'ROAS', value: kpis.roas?.value == null ? '—' : `${number(kpis.roas.value)}x`, icon: BarChart3, detail: 'Meta Ads' },
        ].map(({ label, value, icon: Icon, detail }) => (
          <article className="dashboard-kpi" key={label}>
            <div className="dashboard-kpi-label"><span>{label}</span><Icon size={17}/></div>
            <strong>{loading ? '…' : value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      {!loading && !campaigns.length ? (
        <Panel>
          <EmptyState
            title="Belum ada data performa"
            description="Hubungkan akun Meta Ads melalui OAuth di halaman Integrations & Data untuk mulai menampilkan metrik asli."
            action={<Link className="btn btn-primary" to="/app/integrations">Hubungkan Meta OAuth</Link>}
          />
        </Panel>
      ) : (
        <div className="dashboard-analytics">
          <Panel className="dashboard-panel dashboard-conversion">
            <SectionHead title="Lead per campaign" caption="Dari data Meta Ads"/>
            <div className="conversion-chart">
              {campaigns.map(row => {
                const leads = row.leads || 0;
                return (
                  <Link className="conversion-column" key={row.campaignId} to={`/app/campaigns?select=${row.campaignId}`}>
                    <div className="conversion-bars">
                      <i style={{ height: `${maxLeads ? (leads / maxLeads) * 100 : 0}%` }}/>
                    </div>
                    <strong>{number(leads)}</strong>
                    <span>{row.name}</span>
                  </Link>
                );
              })}
            </div>
          </Panel>

          <Panel className="dashboard-panel dashboard-funnel">
            <SectionHead title="Konversi funnel" caption="Ringkasan alur"/>
            <div className="funnel-readouts">
              <div><span>Klik → lead</span><strong>{percent(clickToLead)}</strong></div>
              <div><span>ROAS</span><strong>{kpis.roas?.value == null ? '—' : `${number(kpis.roas.value)}x`}</strong></div>
            </div>
            <div className="funnel-ring" style={{ '--ring-progress': `${clickToLead * 100}%` }}>
              <span><BarChart3 size={18}/><small>Dari klik</small></span>
            </div>
            <TextLink to="/app/funnel">Lihat funnel</TextLink>
          </Panel>

          <Panel className="dashboard-panel dashboard-trend">
            <SectionHead title="Distribusi klik" caption="Klik menurut campaign"/>
            <div className="trend-total"><strong>{number(totalClicks || 0)}</strong> klik periode ini</div>
            <div className="daily-chart">
              {dailyRows.map(row => (
                <div className="daily-column" key={row.date} title={`${row.date}: ${number(row.clicks || 0)} klik`}>
                  <i style={{ height: `${maxClicks ? ((row.clicks || 0) / maxClicks) * 100 : 0}%` }}/>
                  <span>{row.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <div className="dashboard-details">
        <Panel className="dashboard-panel">
          <SectionHead title="Insight prioritas" action={<TextLink to="/app/insights">Semua insight</TextLink>}/>
          {insights.length ? (
            <div className="dashboard-findings">
              {insights.slice(0, 3).map(insight => (
                <Link to={`/app/insights?select=${insight.id}`} key={insight.id}>
                  <span className="finding-icon"><Sparkles size={16}/></span>
                  <span><strong>{insight.title}</strong><small>{insight.category || insight.domain || 'Insight'}</small></span>
                  <ArrowRight size={16}/>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Belum ada insight"
              description="Insight akan muncul setelah data campaign dan percakapan masuk."
            />
          )}
        </Panel>

        <Panel className="dashboard-panel">
          <SectionHead title="Status koneksi" action={<TextLink to="/app/integrations">Kelola integrasi</TextLink>}/>
          <p className="muted">Pastikan Meta Ads OAuth, WhatsApp OpenWA, dan Pixel sudah terhubung agar seluruh modul analitik terisi otomatis.</p>
          <div style={{ marginTop: 14 }}>
            <Link className="btn btn-secondary" to="/app/integrations">Buka Integrations &amp; Data</Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
