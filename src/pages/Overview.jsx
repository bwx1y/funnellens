import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Layers, MessageCircle, MousePointer2, ShoppingBag, Sparkles } from 'lucide-react';
import { useWorkspace } from '../context.jsx';
import { Badge, PageHead, Panel, SectionHead, TextLink } from '../components/ui.jsx';
import { INSIGHTS, campaignData, totals } from '../lib/data.js';
import { money, number, percent, shortMoney } from '../lib/domain.js';

export default function Overview() {
  const { workspace } = useWorkspace();
  const { campaign, period } = workspace.preferences;
  const rows = campaignData(campaign, period);
  const total = totals(rows);
  const clickToLead = total.clicks ? total.ql / total.clicks : 0;
  const leadToCustomer = total.ql ? total.customers / total.ql : 0;
  const campaigns = rows.map(row => ({ ...row, rate: row.clicks ? row.ql / row.clicks : 0 }));
  const maxCampaignRate = Math.max(...campaigns.map(row => row.rate), 0);
  const maxCampaignClicks = Math.max(...campaigns.map(row => row.clicks), 0);

  return (
    <div className="stack page-overview">
      <PageHead
        title="Ringkasan"
        description="Performa Meta Ads untuk WhatsApp dan website · Data simulasi"
      />

      <section className="dashboard-kpis" aria-label="Metrik utama">
        {[
          { label: 'Belanja iklan', value: shortMoney(total.spend), icon: Layers, detail: `${rows.length} campaign` },
          { label: 'Klik semua kanal', value: number(total.clicks), icon: MousePointer2, detail: 'Klik pada periode ini' },
          { label: 'Qualified leads', value: number(total.ql), icon: MessageCircle, detail: `${percent(clickToLead)} dari klik` },
          { label: 'Pelanggan', value: number(total.customers), icon: ShoppingBag, detail: `${percent(leadToCustomer)} dari QL` },
        ].map(({ label, value, icon: Icon, detail }) => (
          <article className="dashboard-kpi" key={label}>
            <div className="dashboard-kpi-label"><span>{label}</span><Icon size={17}/></div>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      <div className="dashboard-analytics">
        <Panel className="dashboard-panel dashboard-conversion">
          <SectionHead title="Konversi per campaign" caption="Klik → qualified lead"/>
          <div className="dashboard-legend"><span><i/>Periode terpilih</span></div>
          <div className="conversion-chart" role="img" aria-label="Konversi klik ke qualified lead per campaign">
            {campaigns.map(row => (
              <Link
                className="conversion-column"
                key={row.id}
                to={`/app/campaigns?select=${row.id}`}
                aria-label={`${row.name}: ${percent(row.rate)} klik menjadi qualified lead`}
              >
                <div className="conversion-bars">
                  <i style={{ height: `${maxCampaignRate ? row.rate / maxCampaignRate * 100 : 0}%` }}/>
                </div>
                <strong>{percent(row.rate)}</strong>
                <span>{row.name}</span>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel className="dashboard-panel dashboard-funnel">
          <SectionHead title="Konversi funnel" caption="Langkah pertama setelah klik"/>
          <div className="funnel-readouts">
            <div><span>Klik → qualified lead</span><strong>{percent(clickToLead)}</strong></div>
            <div><span>Qualified lead → pelanggan</span><strong>{percent(leadToCustomer)}</strong></div>
          </div>
          <div className="funnel-ring" style={{ '--ring-progress': `${clickToLead * 100}%` }}>
            <span><BarChart3 size={18}/><small>Dari klik</small></span>
          </div>
          <TextLink to="/app/funnel">Lihat funnel</TextLink>
        </Panel>

        <Panel className="dashboard-panel dashboard-trend">
          <SectionHead title="Distribusi klik" caption="Klik menurut campaign pada periode terpilih"/>
          <div className="trend-total"><strong>{number(total.clicks)}</strong> klik periode ini</div>
          <div className="dashboard-legend"><span><i/>Jumlah klik</span></div>
          <div className="daily-chart" role="img" aria-label="Klik menurut campaign">
            {rows.map(row => (
              <div className="daily-column" key={row.id} title={`${row.name}: ${number(row.clicks)} klik`}>
                <i style={{ height: `${maxCampaignClicks ? row.clicks / maxCampaignClicks * 100 : 0}%` }}/>
                <span>{row.name}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="dashboard-details">
        <Panel className="dashboard-panel">
          <SectionHead title="Insight prioritas" action={<TextLink to="/app/insights">Semua peringatan</TextLink>}/>
          <div className="dashboard-findings">
            {INSIGHTS.slice(0, 3).map(insight => (
              <Link to={`/app/insights?select=${insight.id}`} key={insight.id}>
                <span className="finding-icon"><Sparkles size={16}/></span>
                <span><strong>{insight.title}</strong><small>{insight.domain}</small></span>
                <ArrowRight size={16}/>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel className="dashboard-panel">
          <SectionHead
            title="Kinerja campaign"
            caption="Periode dan campaign mengikuti filter aktif"
            action={<Badge color="gray">{rows.length} campaign</Badge>}
          />
          <div className="dashboard-table-wrap" role="region" aria-label="Tabel kinerja campaign" tabIndex="0">
            <table>
              <thead><tr><th>Campaign</th><th>Belanja iklan</th><th>Klik</th><th>Qualified leads</th><th>Biaya / QL</th></tr></thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <th scope="row"><Link to={`/app/campaigns?select=${row.id}`}>{row.name}</Link><small>{row.segment} · {row.role}</small></th>
                    <td>{shortMoney(row.spend)}</td>
                    <td>{number(row.clicks)}</td>
                    <td>{number(row.ql)}</td>
                    <td><strong>{money(row.ql ? row.spend / row.ql : 0)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
