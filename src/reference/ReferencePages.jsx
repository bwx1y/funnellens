import React from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../components/ui.jsx';
import { useReference } from './ReferenceContext.jsx';
import CreativePages from './ReferenceCreativePages.jsx';
import ReferenceSelect from './ReferenceSelect.jsx';
import {
  campaignName,
  channelName,
  creativeAnalysis,
  creativeWhy,
  dateLabel,
  dailyRows,
  downloadCsv,
  formatStageRate,
  funnelStages,
  largestDecline,
  leads,
  leakEvidence,
  money,
  num,
  pct,
  previousPeriodLabel,
  ratio,
  responseTypes,
  stageNames,
  stageRate,
  stageTotals,
  statusClass,
  sumStages,
} from './domain.js';
import { Button, Chip, DetailMetrics, Empty, Explanation, Icon, Info, Panel, StatusChip, Table, Tabs } from './ui.jsx';

const levelRank = { Cold: 0, Warm: 1, Hot: 2 };
const iconByType = {
  'Funnel Intelligence': 'funnel',
  'Audience Intelligence': 'users',
  'Creative Intelligence': 'clapperboard',
};

function currentInsights(context) {
  const { scope, days, filteredLeads, visibleCreatives } = context;
  if (!scope.length) return [];
  const items = [];
  if (scope.some(item => item.channel === 'wa')) {
    const evidence = leakEvidence('wa', scope, days);
    if (evidence.loss > 0) {
      items.push({
        id: 'leak',
        type: 'Funnel Intelligence',
        icon: 'funnel',
        title: 'Konversi klik ke percakapan WhatsApp turun',
        summary: `${num(evidence.current[3])} percakapan dari ${num(evidence.current[2])} klik iklan WhatsApp.`,
        copy: `${pct(evidence.actual)} klik menjadi chat, dari ${pct(evidence.baseline)} pada periode sebelumnya.`,
        action: 'Telusuri kebocoran',
        route: 'kebocoran',
        signal: evidence,
      });
    }
    const lead = filteredLeads.find(item => item.level === 'Hot');
    if (lead) {
      items.push({
        id: 'intent',
        type: 'Audience Intelligence',
        icon: 'users',
        title: `${lead.alias} ${lead.id === 'WA-4821' ? 'meminta invoice grosir' : 'mengonfirmasi paket grosir'}`,
        summary: `${lead.prior} ke ${lead.level} · ${lead.type.toLowerCase()} · ${lead.minutes} menit setelah pesan CS`,
        copy: lead.why,
        action: 'Buka bukti percakapan',
        target: lead.id,
      });
    }
  }
  const tired = visibleCreatives.find(item => {
    const [ctr0, ctr1, freq0, freq1, cost0, cost1, daysAfter] = item.fatigue;
    const drop = (ctr0 - ctr1) / ctr0;
    return item.days >= 7 && drop >= 0.25 && freq1 > freq0 && cost1 > cost0 && daysAfter >= 3;
  });
  if (tired) {
    const [ctr0, ctr1, freq0, freq1, cost0, cost1, daysAfter] = tired.fatigue;
    items.push({
      id: 'fatigue',
      type: 'Creative Intelligence',
      icon: 'clapperboard',
      title: `Kreatif “${tired.name}” menunjukkan kejenuhan`,
      summary: `CTR turun ${pct((ctr0 - ctr1) / ctr0)} · frekuensi dan biaya per hasil naik selama ${daysAfter} hari`,
      copy: 'Pertimbangkan menguji hook baru di Ads Manager pada ad set yang sama.',
      action: 'Periksa sinyal kejenuhan',
      target: tired.id,
      fatigue: [ctr0, ctr1, freq0, freq1, cost0, cost1],
    });
  }
  if (scope.some(item => item.channel === 'web') && !scope.some(item => item.channel === 'wa')) {
    const evidence = leakEvidence('web', scope, days);
    items.push({
      id: 'website',
      type: 'Funnel Intelligence',
      icon: 'globe',
      title: 'Sebagian klik belum tercatat sebagai pemuatan halaman',
      summary: `${num(evidence.current[3])} pemuatan dari ${num(evidence.current[2])} klik iklan website.`,
      copy: `${pct(1 - evidence.actual)} klik belum tercatat sebagai landing page view pada snapshot website.`,
      action: 'Lihat funnel website',
      route: 'funnel',
      signal: evidence,
    });
  }
  return items.map(item => ({
    ...item,
    historyKey: item.id === 'intent' && item.target
      ? `${item.id}-${item.target}`
      : item.id === 'fatigue' && item.target
        ? `${item.id}-${item.target}`
        : [context.account, context.campaign, context.days, item.id].join('-'),
  }));
}

function Kpis() {
  const { scope, days } = useReference();
  const current = sumStages(scope, days);
  const previous = sumStages(scope, days, days);
  const wa = scope.filter(item => item.channel === 'wa');
  const web = scope.filter(item => item.channel === 'web');
  const waCurrent = sumStages(wa, days);
  const waPrevious = sumStages(wa, days, days);
  const webCurrent = sumStages(web, days);
  const webPrevious = sumStages(web, days, days);
  const items = [
    { title: 'Belanja iklan', value: current[0], prior: previous[0], format: money, icon: 'layers-2', neutral: true },
    {
      title: wa.length && web.length ? 'Klik semua kanal' : wa.length ? 'Klik iklan WhatsApp' : 'Klik iklan website',
      value: current[2],
      prior: previous[2],
      format: num,
      icon: 'mouse-pointer',
    },
  ];
  if (wa.length) items.push({ title: 'Percakapan WhatsApp', value: waCurrent[3], prior: waPrevious[3], format: num, icon: 'message-circle' });
  if (web.length) items.push({ title: 'Pembelian website', value: webCurrent[6], prior: webPrevious[6], format: num, icon: 'shopping-bag' });
  if (wa.length && !web.length) items.push({ title: 'Biaya per percakapan', value: ratio(waCurrent[0], waCurrent[3]), prior: ratio(waPrevious[0], waPrevious[3]), format: money, icon: 'message-circle', neutral: true });
  if (web.length && !wa.length) items.push({ title: 'Biaya per pembelian', value: ratio(webCurrent[0], webCurrent[6]), prior: ratio(webPrevious[0], webPrevious[6]), format: money, icon: 'shopping-bag', neutral: true });

  return (
    <section className="kpi-grid" aria-label="Metrik utama">
      {items.map(item => {
        const change = item.prior ? (item.value - item.prior) / item.prior : null;
        const delta = change === null ? 'Tanpa pembanding' : `${change >= 0 ? '+' : '−'}${pct(Math.abs(change))}`;
        const tone = item.neutral || change === null ? 'neutral' : change >= 0 ? 'up' : 'down';
        return (
          <article className="kpi" key={item.title}>
            <span className="kpi-label">{item.title}<Icon name={item.icon} /></span>
            <strong>{item.format(item.value)}</strong>
            <div className="kpi-foot"><span className={`kpi-delta ${tone}`}>{delta}</span>{change !== null && <span>vs periode lalu</span>}</div>
          </article>
        );
      })}
    </section>
  );
}

function OverviewLegend() {
  return <div className="ov-legend" aria-hidden="true"><span><i className="ov-dot" />Periode ini</span><span><i className="ov-dot prior" />Periode lalu</span></div>;
}

function ConversionPanel() {
  const { scope, days } = useReference();
  const rows = scope.map(campaign => {
    const current = stageTotals(campaign, days);
    const previous = stageTotals(campaign, days, days);
    const outcome = campaign.channel === 'wa' ? 3 : 6;
    return { campaign, rate: stageRate(current[outcome], current[2]), priorRate: stageRate(previous[outcome], previous[2]) };
  });
  const max = Math.max(0.2, Math.ceil(Math.max(0, ...rows.flatMap(row => [row.rate || 0, row.priorRate || 0])) * 5) / 5);
  const shortNames = { grosir: 'Grosir', toko: 'Reseller', web: 'Katalog' };
  return (
    <section className="ov-panel" aria-labelledby="ov-campaign-conversion" style={{ '--ov-groups': rows.length }}>
      <header className="ov-panel-head"><div><h2 id="ov-campaign-conversion">Konversi per campaign</h2><p>Klik → percakapan atau pembelian</p></div></header>
      <OverviewLegend />
      <div role="img" aria-label={rows.map(row => `${row.campaign.name}, ${formatStageRate(row.rate)} periode ini dan ${formatStageRate(row.priorRate)} pada periode lalu.`).join(' ')}>
        <div className="ov-chart-area" aria-hidden="true">
          <div className="ov-axis">{[0, 0.5, 1].map(fraction => <span key={fraction} style={{ top: `${100 * (1 - fraction)}%` }}>{num(max * fraction * 100)}%</span>)}</div>
          <div className="ov-plot"><div className="ov-bar-groups">{rows.map(({ campaign, rate, priorRate }) => (
            <div className="ov-bar-pair" key={campaign.id}>
              <i className="ov-bar" style={{ '--height': `${100 * (rate || 0) / max}%` }} />
              <i className="ov-bar prior" style={{ '--height': `${100 * (priorRate || 0) / max}%` }} />
            </div>
          ))}</div></div>
        </div>
        <div className="ov-bar-labels" aria-hidden="true">{rows.map(({ campaign, rate }) => <div key={campaign.id}><strong>{formatStageRate(rate)}</strong>{shortNames[campaign.id] || campaign.name}</div>)}</div>
      </div>
    </section>
  );
}

function FunnelConversionPanel() {
  const { scope, days } = useReference();
  const channels = ['wa', 'web'].filter(channel => scope.some(item => item.channel === channel));
  const results = channels.map(channel => {
    const evidence = leakEvidence(channel, scope, days);
    return { channel, rate: stageRate(evidence.current[3], evidence.current[2]) };
  });
  return (
    <section className="ov-panel ov-white" aria-labelledby="ov-funnel-conversion">
      <header className="ov-panel-head"><div><h2 id="ov-funnel-conversion">Konversi funnel</h2><p>Langkah pertama setelah klik</p></div><Link className="ov-link" to="/app/funnel">Lihat funnel</Link></header>
      <div className="ov-ring-content">
        <dl className="ov-ring-key">{results.map(({ channel, rate }) => (
          <div key={channel}><dt><i className={`ov-dot ${channel}`} />{channel === 'wa' ? 'Klik → chat' : 'Klik → halaman'}</dt><dd>{formatStageRate(rate)}</dd></div>
        ))}</dl>
        <div className="ov-rings" aria-hidden="true">
          {results.map(({ channel, rate }, index) => <i key={channel} className={`ov-ring ${index ? 'inner' : ''}`} style={{ '--arc': `${100 * Math.min(1, rate || 0)}%`, '--ring-color': channel === 'wa' ? 'var(--ov-accent)' : 'var(--ov-blue)' }} />)}
          <span className="ov-ring-center"><Icon name="funnel" />Dari klik</span>
        </div>
      </div>
    </section>
  );
}

function TrendPanel() {
  const { scope, days } = useReference();
  const collect = offset => Array.from({ length: days }, (_, index) => {
    const day = offset + days - index - 1;
    return scope.reduce((total, campaign) => total + dailyRows[campaign.id][day][2], 0);
  });
  const current = collect(0);
  const previous = collect(days);
  const max = Math.max(200, Math.ceil(Math.max(...current, ...previous) / 200) * 200);
  const positions = values => values.map((value, index) => [index / (values.length - 1) * 100, 100 - value / max * 100]);
  const polygon = points => points.map(([x, y]) => `${x}% ${y}%`).join(',');
  const area = points => polygon([[0, 100], ...points, [100, 100]]);
  const line = points => polygon([...points, ...[...points].reverse().map(([x, y]) => [x, Math.min(100, y + 1.6)])]);
  const currentPoints = positions(current);
  const previousPoints = positions(previous);
  const shortDate = offset => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 19 - offset)));
  const currentTotal = current.reduce((sum, count) => sum + count, 0);
  return (
    <section className="ov-panel" aria-labelledby="ov-clicks">
      <header className="ov-panel-head"><div><h2 id="ov-clicks">Tren klik iklan</h2><p>Klik per hari pada campaign terpilih</p></div></header>
      <div className="ov-trend-total"><strong>{num(currentTotal)}</strong> klik periode ini</div>
      <OverviewLegend />
      <div className="ov-trend-chart" role="img" aria-label={`Klik harian. ${current.map(value => num(value)).join(', ')} pada periode ini.`}>
        <div className="ov-chart-area" aria-hidden="true">
          <div className="ov-axis">{[0, 0.5, 1].map(fraction => <span key={fraction} style={{ top: `${100 * (1 - fraction)}%` }}>{num(max * fraction)}</span>)}</div>
          <div className="ov-plot">
            <div className="ov-area prior" style={{ '--points': area(previousPoints) }} />
            <div className="ov-area" style={{ '--points': area(currentPoints) }} />
            <div className="ov-area ov-series prior" style={{ '--points': line(previousPoints) }} />
            <div className="ov-area ov-series" style={{ '--points': line(currentPoints) }} />
          </div>
        </div>
        <div className="ov-trend-ticks"><span>{shortDate(days - 1)}</span><span>{shortDate(Math.floor((days - 1) / 2))}</span><span>{shortDate(0)}</span></div>
      </div>
    </section>
  );
}

function OverviewFindings() {
  const context = useReference();
  const items = currentInsights(context).filter(item => context.history[item.historyKey] !== 'done').slice(0, 3);
  return (
    <section className="ov-panel">
      <header className="ov-panel-head"><h2>Insight prioritas</h2><Link className="ov-link" to="/app/peringatan">Semua peringatan</Link></header>
      {items.length ? (
        <div className="ov-findings">{items.map(item => (
          <button type="button" className="ov-finding" key={item.id} onClick={() => context.setModal({ type: 'insight', id: item.id })}>
            <span className="ov-finding-mark"><Icon name={item.icon} /></span>
            <span><strong>{item.title}</strong><small>{item.type}</small></span><Icon name="chevron-right" />
          </button>
        ))}</div>
      ) : <p className="ov-empty-note">Tidak ada temuan aktif pada filter ini.</p>}
    </section>
  );
}

function OverviewTable() {
  const { scope, days } = useReference();
  const rows = scope.map(campaign => {
    const current = stageTotals(campaign, days);
    const outcome = campaign.channel === 'wa' ? 3 : 6;
    return { campaign, spend: current[0], clicks: current[2], results: current[outcome], rate: stageRate(current[outcome], current[2]) };
  });
  return (
    <section className="ov-panel ov-white">
      <header className="ov-panel-head"><div><h2>Ringkasan campaign</h2><p>Performa dalam periode aktif</p></div><Link className="ov-link" to="/app/laporan">Ekspor</Link></header>
      <div className="ov-table">
        <table>
          <thead><tr><th>Campaign</th><th>Kanal</th><th className="ov-numeric">Belanja iklan</th><th className="ov-numeric">Klik</th><th className="ov-numeric">Hasil</th><th className="ov-numeric">Konversi</th></tr></thead>
          <tbody>{rows.map(({ campaign, spend, clicks, results, rate }) => (
            <tr key={campaign.id}><th scope="row">{campaign.name}</th><td><span className={`ov-channel ${campaign.channel === 'web' ? 'web' : ''}`}>{channelName(campaign.channel)}</span></td><td className="ov-numeric">{money(spend)}</td><td className="ov-numeric">{num(clicks)}</td><td className="ov-numeric">{num(results)}</td><td className="ov-numeric">{formatStageRate(rate)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function Overview() {
  const { scope, setAccount } = useReference();
  if (!scope.length) return <Empty title="Akun belum terhubung">Pilih akun demo untuk menjelajahi laporan dan insight.<Button variant="primary" onClick={() => setAccount('demo')}>Buka akun demo</Button></Empty>;
  return (
    <>
      <Kpis />
      <div className="ov-analytics"><ConversionPanel /><FunnelConversionPanel /><TrendPanel /></div>
      <div className="ov-details"><OverviewFindings /><OverviewTable /></div>
    </>
  );
}

function channelTabs(channel, onChange) {
  return <Tabs items={ [['wa', 'WhatsApp'], ['web', 'Website']] } value={channel} onChange={onChange} />;
}

function Funnel() {
  const context = useReference();
  const { channel, setChannel, scope, days, setModal } = context;
  const list = scope.filter(item => item.channel === channel);
  if (!list.length) return <>{channelTabs(channel, setChannel)}<Empty title="Campaign tidak memakai jalur ini">Ganti jalur atau pilih semua campaign.<Button onClick={() => context.changeCampaign('all')}>Tampilkan semua campaign</Button></Empty></>;
  const stages = funnelStages(channel, scope, days);
  const priority = largestDecline(stages);
  const current = sumStages(list, days);
  const previous = sumStages(list, days, days);
  const rate = current[2] ? current[3] / current[2] : 0;
  const baseline = previous[2] ? previous[3] / previous[2] : 0;
  return (
    <>
      {channelTabs(channel, setChannel)}
      <div className="split">
        <Panel title="Tahap funnel" subtitle={channel === 'wa' ? 'Meta Ads dan chat WhatsApp' : 'Meta Ads dan event Pixel agregat'}>
          <div className="stages">{stages.map(stage => (
            <button type="button" className={`stage ${priority === stage ? 'leak-stage' : ''}`} key={stage.index} onClick={() => setModal({ type: 'stage', id: stage.index })}>
              <span className="stage-name">{stageNames[channel][stage.index]}</span><strong>{num(stage.count)}</strong><Icon name="chevron-right" />
              <span className="stage-meta">{stage.index < 3 ? 'Meta Ads' : channel === 'wa' ? (stage.index === 5 ? 'Indikasi dari chat' : 'Chat WhatsApp') : 'Meta Pixel'}
                {stage.index > 0 && ` · ${formatStageRate(stage.rate)} dari ${stageNames[channel][stage.index - 1]}`}</span>
            </button>
          ))}</div>
        </Panel>
        <Panel title="Titik yang perlu ditinjau" subtitle={channel === 'wa' ? 'Konversi klik → percakapan' : 'Konversi klik → pemuatan halaman'}>
          <div className="panel-body">
            <DetailMetrics items={channel === 'wa'
              ? [['Konversi sekarang', pct(rate)], ['Periode sebelumnya', pct(baseline)], ['Perkiraan selisih chat', num(Math.max(0, Math.round(baseline * current[2] - current[3])))]]
              : [['Klik link', num(current[2])], ['Landing page view', num(current[3])], ['Rasio pemuatan', pct(rate)]]} />
            <Explanation>{channel === 'wa'
              ? 'Bandingkan rasio klik ke percakapan per campaign. Mulai dengan memeriksa tautan dan pesan pembuka pada campaign dengan rasio terendah.'
              : 'Event Pixel tersedia pada snapshot. Selisih klik dan pemuatan dapat dipakai untuk menentukan halaman mana yang perlu diperiksa.'}</Explanation>
            <Link className="text-button" to="/app/kebocoran">Lihat deteksi kebocoran <Icon name="chevron-right" /></Link>
          </div>
        </Panel>
      </div>
      {channel === 'wa' ? (
        <Panel title="Dari chat ke keputusan" subtitle="Tonggak Warm dan Hot memakai pencapaian pertama.">
          <div className="panel-body"><Info>Indikasi closing berasal dari percakapan WhatsApp.</Info><div className="button-row"><Link className="button secondary" to="/app/kecepatan"><Icon name="clock-3" />Kecepatan & respons</Link><Link className="button secondary" to="/app/pipeline"><Icon name="users" />Lihat pipeline lead</Link></div></div>
        </Panel>
      ) : <Panel title="Cakupan event"><div className="panel-body"><Info>Pixel menampilkan hitungan agregat per event. Tahap yang tersedia mengikuti event campaign.</Info></div></Panel>}
    </>
  );
}

function LeakHistory({ index }) {
  const { channel, scope, days } = useReference();
  const list = scope.filter(item => item.channel === channel);
  const totalDays = Math.min(...list.map(item => dailyRows[item.id].length));
  const count = Math.min(4, Math.floor(totalDays / days));
  const periods = Array.from({ length: count }, (_, periodIndex) => {
    const offset = days * (count - periodIndex - 1);
    const counts = sumStages(list, days, offset).slice(1);
    return { offset, counts, current: offset === 0 };
  });
  const values = periods.map(item => index === 0 ? item.counts[0] : stageRate(item.counts[index], item.counts[index - 1]));
  const scale = index === 0 ? Math.max(1, ...values) : 1;
  return (
    <span className="leak-history">
      <span className="leak-history-title">{index === 0 ? 'Tayangan per periode' : 'Konversi per periode'}</span>
      <span className="leak-history-grid" role="list" aria-label={index === 0 ? 'Tayangan per periode' : 'Konversi per periode'} style={{ '--leak-periods': periods.length }}>
        {periods.map((item, i) => {
          const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
          const label = `${date.format(new Date(Date.UTC(2026, 10, 20 - days - item.offset)))}–${date.format(new Date(Date.UTC(2026, 10, 19 - item.offset)))}`;
          return <span className={`leak-history-period ${item.current ? 'is-current' : ''}`} role="listitem" key={label}>
            <span className="leak-history-value">{index === 0 ? num(values[i]) : formatStageRate(values[i], true)}</span>
            <span className="leak-history-track"><span className="leak-history-bar" style={{ '--height': `${100 * Math.max(0, Math.min(1, (values[i] || 0) / scale))}%` }} /></span>
            <span className="leak-history-date">{label}</span>
          </span>;
        })}
      </span>
    </span>
  );
}

function Leakage() {
  const { channel, setChannel, scope, days, setModal } = useReference();
  const list = scope.filter(item => item.channel === channel);
  const tabs = channelTabs(channel, setChannel);
  const stages = funnelStages(channel, scope, days);
  const priority = largestDecline(stages);
  if (!list.length) return <Panel className="leak-panel" title={`Alur konversi ${channelName(channel)}`} subtitle={`${contextPeriod(days)} dibanding ${previousPeriodLabel(days)}`}>{tabs}<Empty title="Campaign tidak memakai jalur ini">Ganti jalur atau pilih semua campaign.</Empty></Panel>;
  const names = stageNames[channel];
  const maxImpressions = Math.max(1, ...stages.map(stage => stage.count), ...stages.map(stage => stage.previousCount));
  const transition = priority ? `${names[priority.index - 1]} → ${names[priority.index]}` : '';
  return (
    <div className="leak-workspace">
      <section className="leak-panel leak-chart">
        <header className="leak-panel-header"><div><h2>Alur konversi {channelName(channel)}</h2><p>{contextPeriod(days)} dibanding {previousPeriodLabel(days)}</p></div>{tabs}</header>
        <ol className="leak-stages" aria-label="Tahap funnel">{stages.map(stage => {
          const isEntry = stage.index === 0;
          const scale = isEntry ? maxImpressions : 1;
          const height = value => `${100 * Math.max(0, Math.min(1, (value || 0) / scale))}%`;
          const previousRate = isEntry ? stage.previousCount : stage.baseline;
          const currentRate = isEntry ? stage.count : stage.rate;
          return <li key={stage.index}><button type="button" className={`leak-step ${priority === stage ? 'is-priority' : ''}`} onClick={() => setModal({ type: 'stage', id: stage.index, history: true })}>
            <span className="leak-step-name">{names[stage.index]}</span><strong className="leak-step-count">{num(stage.count)}</strong>
            <span className="leak-step-compact"><span className="leak-step-pair"><i style={{ '--height': height(currentRate) }} /><i className="prior" style={{ '--height': height(previousRate) }} /></span><span><span className="leak-step-rate">{isEntry ? num(stage.previousCount) : formatStageRate(stage.rate)}</span><br /><span className="leak-step-caption">{isEntry ? 'Tayangan periode lalu' : stage.change === null ? 'Tanpa pembanding' : pointChange(stage.change)}</span></span></span>
            <LeakHistory index={stage.index} />
          </button></li>;
        })}</ol>
        <div className="leak-legend"><span><i className="ov-dot" />Periode ini</span><span><i className="ov-dot prior" />Periode lalu</span><span>Tayangan 0–{num(maxImpressions)} · Tahap lain 0–100%</span></div>
      </section>
      <section className="leak-panel blue leak-highlight">
        <header className="leak-panel-header"><h2>Penurunan terbesar</h2></header>
        {priority ? <><h3>{transition}</h3><strong className="leak-delta">{pointChange(priority.change).replace(' poin', ' pp')}</strong><p className="leak-delta-label">Poin persentase dibanding periode lalu</p>
          <dl className="leak-metrics"><div><dt>Periode ini</dt><dd>{formatStageRate(priority.rate)}</dd></div><div><dt>Periode lalu</dt><dd>{formatStageRate(priority.baseline)}</dd></div></dl>
          <Button variant="primary" onClick={() => setModal({ type: 'stage', id: priority.index })}>Lihat detail tahap</Button></>
          : <p className="ov-empty-note">Belum ada tahap dengan penurunan konversi yang terukur.</p>}
      </section>
      <div className="leak-lower">
        <Panel className="leak-panel" title="Perbandingan per campaign" subtitle={transition}>
          <ul className="leak-campaign">{list.map(campaign => {
            const current = stageTotals(campaign, days);
            const previous = stageTotals(campaign, days, days);
            const rate = stageRate(current[(priority?.index ?? 2) + 1], current[priority?.index ?? 2]);
            const baseline = stageRate(previous[(priority?.index ?? 2) + 1], previous[priority?.index ?? 2]);
            return <li key={campaign.id}><b>{campaign.name}</b><p className="leak-campaign-metrics"><strong>{formatStageRate(rate)}</strong><span>vs {formatStageRate(baseline)}</span></p></li>;
          })}</ul>
        </Panel>
        <Panel className="leak-panel" title="Langkah pemeriksaan">
          <ul className="leak-checks"><li><Icon name="search" /><span><b>{channel === 'wa' ? 'Uji tautan WhatsApp' : 'Uji halaman tujuan'}</b><small>{channel === 'wa' ? 'Buka iklan, cek nomor tujuan, lalu coba kirim pesan pembuka.' : 'Buka tautan iklan di ponsel dan periksa pemuatan halaman.'}</small></span></li><li><Icon name="search" /><span><b>Bandingkan campaign</b><small>Periksa rasio pada tahap yang sama dan rentang tanggal yang setara.</small></span></li></ul>
        </Panel>
      </div>
      <Panel className="leak-panel blue" title="Cakupan data" subtitle="Simulasi · snapshot 19 Nov 2026">
        <ul className="leak-sources">{(channel === 'wa' ? [['Meta Ads', 'Tayangan, klik, dan percakapan dimulai'], ['WhatsApp', 'Sampel chat termasking untuk tahapan Warm, Hot, dan indikasi closing']] : [['Meta Ads', 'Tayangan dan klik link'], ['Meta Pixel', 'Event agregat dari pemuatan halaman hingga pembelian']]).map(([source, detail]) => <li key={source}><b>{source}</b><small>{detail}</small></li>)}</ul>
        <p className="leak-sources-footer"><Link className="ov-link" to="/app/tracking">Lihat kesehatan tracking</Link></p>
      </Panel>
    </div>
  );
}

function contextPeriod(days) {
  return ({ 7: '13–19 Nov 2026', 14: '6–19 Nov 2026', 30: '21 Okt–19 Nov 2026' })[days];
}

function pointChange(change) {
  const size = Math.abs(change);
  if (size < 1e-8) return 'Stabil';
  return `${change < 0 ? 'Turun ' : 'Naik '}${size < 0.1 ? '<0,1' : num(size, 1)} poin`;
}

function Tracking() {
  const { account, setAccount } = useReference();
  if (account === 'empty') return <Empty title="Belum ada sumber terhubung">Pilih akun demo untuk melihat contoh cakupan sumber data.<Button variant="primary" onClick={() => setAccount('demo')}>Buka akun demo</Button></Empty>;
  const rows = [
    ['Meta Ads', 'Aktif pada snapshot', 'Tayangan, klik link, belanja, percakapan dimulai, metadata kreatif'],
    ['Meta Pixel', 'Aktif pada snapshot', 'Landing page view, ViewContent, AddToCart, Purchase'],
    ['WhatsApp Cloud API', 'Cakupan simulasi', 'Sampel chat termasking dan rujukan iklan'],
  ];
  return <>
    <Panel title="Sumber dan cakupan" subtitle="Snapshot demo 19 November 2026, 09.20 WIB">
      <Table headings={['Sumber', 'Status', 'Data yang ditampilkan']}>{rows.map(([name, status, copy]) => <tr key={name}><th scope="row">{name}</th><td><Chip tone="green">{status}</Chip></td><td>{copy}</td></tr>)}</Table>
    </Panel>
    <Panel title="Cara membaca data"><div className="panel-body stack"><Info>Kesegaran data atribusi dan rekonsiliasi jumlah percakapan Meta dengan chat masih membutuhkan aturan produksi.</Info><Info>Sambungan pada layar ini menggambarkan data simulasi.</Info></div></Panel>
  </>;
}

function leadComparator(key, a, b) {
  if (key === 'name') return a.alias.localeCompare(b.alias, 'id', { numeric: true });
  if (key === 'response') return a.date.localeCompare(b.date);
  if (key === 'temperature') return levelRank[a.level] - levelRank[b.level];
  if (key === 'analysis') return a.status.localeCompare(b.status, 'id');
  return campaignName(a.campaign).localeCompare(campaignName(b.campaign), 'id');
}

function LeadIdentity({ lead }) {
  return <span className="pipeline-identity"><span className="pipeline-avatar">{lead.alias.split(' ').at(-1).slice(-2)}</span><span><strong>{lead.alias}</strong><small>{lead.id}</small></span></span>;
}

function LeadList() {
  const context = useReference();
  const { filteredLeads, leadLevel, setLeadLevel, leadSearch, setLeadSearch, leadSort, setLeadSort, leadSortDirection, setLeadSortDirection, leadPage, setLeadPage, leadPageSize, setLeadPageSize, setModal } = context;
  const filtered = filteredLeads.filter(lead => (
    (leadLevel === 'Semua' || lead.level === leadLevel) &&
    [lead.id, lead.alias, lead.topic, lead.type, campaignName(lead.campaign)].join(' ').toLocaleLowerCase('id').includes(leadSearch.trim().toLocaleLowerCase('id'))
  )).sort((a, b) => leadSortDirection * leadComparator(leadSort, a, b) || b.date.localeCompare(a.date));
  const pages = Math.max(1, Math.ceil(filtered.length / leadPageSize));
  const currentPage = Math.min(leadPage, pages);
  const start = (currentPage - 1) * leadPageSize;
  const rows = filtered.slice(start, start + leadPageSize);
  const headings = [
    ['name', 'Lead'],
    ['response', 'Respons terakhir'],
    ['temperature', 'Temperatur'],
    ['analysis', 'Status analisis'],
    ['campaign', 'Campaign asal'],
  ];
  const sortBy = key => {
    const defaultDirection = ['temperature', 'response'].includes(key) ? -1 : 1;
    if (leadSort === key) setLeadSortDirection(value => -value);
    else setLeadSortDirection(defaultDirection);
    setLeadSort(key);
    setLeadPage(1);
  };
  return (
    <div className="lead-list-layout">
      <div className="lead-list-controls"><Tabs items={['Semua', 'Cold', 'Warm', 'Hot'].map(level => [level, `${level === 'Semua' ? 'Semua lead' : level} (${level === 'Semua' ? filteredLeads.length : filteredLeads.filter(lead => lead.level === level).length})`, level === 'Semua' ? 'users' : level === 'Cold' ? 'snowflake' : level === 'Warm' ? 'thermometer' : 'flame'])} value={leadLevel} onChange={level => { setLeadLevel(level); setLeadPage(1); }} label="Filter temperatur lead" />
        <Link className="button secondary" to="/app/pipeline"><Icon name="layout-dashboard" />Papan pipeline</Link></div>
      <section className="panel lead-table-panel" aria-label="Daftar lead WhatsApp">
        <div className="lead-table-toolbar"><label className="input-control"><Icon name="search" /><span className="sr">Cari lead</span><input placeholder="Cari lead, topik, atau campaign" value={leadSearch} onChange={event => { setLeadSearch(event.target.value); setLeadPage(1); }} type="search" /></label>
          <div className="lead-page-options"><ReferenceSelect
            label="Jumlah lead per halaman"
            value={leadPageSize}
            options={[5, 10, 15].map(size => ({ value: size, label: `${size} per halaman` }))}
            onChange={value => { setLeadPageSize(value); setLeadPage(1); }}
          /><span role="status">{filtered.length ? `${num(start + 1)}–${num(start + rows.length)} dari ${num(filtered.length)} lead` : '0 lead'}</span></div>
        </div>
        <div className="lead-table-wrap" tabIndex={0} role="region" aria-label="Tabel lead WhatsApp">
          <table className="lead-table"><thead><tr>{headings.map(([key, title]) => <th scope="col" key={key} aria-sort={leadSort === key ? leadSortDirection === 1 ? 'ascending' : 'descending' : undefined}><button type="button" className="lead-sort" aria-pressed={leadSort === key} onClick={() => sortBy(key)}>{title} {leadSort === key ? (leadSortDirection === 1 ? '↑' : '↓') : <Icon name="arrow-up-down" />}</button></th>)}<th scope="col">Aksi</th></tr></thead>
            <tbody>{rows.map(lead => <tr key={lead.id}>
              <th scope="row" className="lead-table-identity"><button type="button" className={`row-link lead-${lead.level.toLowerCase()}`} onClick={() => setModal({ type: 'lead', id: lead.id })}><LeadIdentity lead={lead} /></button></th>
              <td className="lead-table-response">{lead.type}<small>{lead.topic} · {dateLabel(lead.date)}</small></td>
              <td><StatusChip value={lead.level} /></td>
              <td><Chip tone={lead.status === 'Awal' ? 'blue' : 'green'}>{lead.status}</Chip><small>Keyakinan {lead.confidence.toLowerCase()}</small></td>
              <td className="lead-table-source">{campaignName(lead.campaign)}<small>WhatsApp · {lead.creative}</small></td>
              <td className="lead-table-action"><button type="button" className="icon-button" aria-label={`Buka detail ${lead.alias}`} onClick={() => setModal({ type: 'lead', id: lead.id })}><Icon name="chevron-right" /></button></td>
            </tr>)}</tbody>
          </table>
          {!rows.length && <p className="lead-table-empty">Belum ada lead yang cocok. Ubah pencarian atau filter.</p>}
        </div>
        {pages > 1 && <nav className="lead-pagination" aria-label="Halaman daftar lead"><button className="previous" type="button" aria-label="Halaman sebelumnya" disabled={currentPage === 1} onClick={() => setLeadPage(currentPage - 1)}><Icon name="chevron-right" /></button>{Array.from({ length: pages }, (_, index) => index + 1).map(page => <button type="button" key={page} aria-current={page === currentPage ? 'page' : undefined} onClick={() => setLeadPage(page)}>{page}</button>)}<button type="button" aria-label="Halaman berikutnya" disabled={currentPage === pages} onClick={() => setLeadPage(currentPage + 1)}><Icon name="chevron-right" /></button></nav>}
      </section>
    </div>
  );
}

function Pipeline() {
  const { filteredLeads, pipelineSearch, setPipelineSearch, setModal } = useReference();
  const query = pipelineSearch.trim().toLocaleLowerCase('id');
  const records = filteredLeads.filter(lead => [lead.alias, lead.id, lead.topic, campaignName(lead.campaign)].join(' ').toLocaleLowerCase('id').includes(query)).sort((a, b) => b.date.localeCompare(a.date));
  if (!filteredLeads.length) return <Empty title="Belum ada sampel WhatsApp">Pilih campaign dengan percakapan untuk melihat pipeline.</Empty>;
  return <section className="panel pipeline-panel">
    <header className="pipeline-toolbar"><h2><Icon name="layout-dashboard" />Pipeline WhatsApp <span className="pipeline-count">{num(filteredLeads.length)} lead</span></h2>
      <div className="pipeline-tools"><label className="input-control"><Icon name="search" /><span className="sr">Cari di pipeline</span><input type="search" placeholder="Cari lead atau topik" value={pipelineSearch} onChange={event => setPipelineSearch(event.target.value)} /></label><Link className="button secondary" to="/app/lead">Daftar lead</Link></div>
    </header>
    <div className="pipeline-board">{['Cold', 'Warm', 'Hot'].map(level => {
      const entries = records.filter(lead => lead.level === level);
      return <section className={`pipeline-column lead-${level.toLowerCase()}`} key={level} aria-labelledby={`pipeline-${level.toLowerCase()}`}>
        <header className="pipeline-lane-header"><h3 id={`pipeline-${level.toLowerCase()}`}><i className="pipeline-dot" />{level}</h3><span className="pipeline-count">{num(entries.length)} lead</span></header>
        {entries.length ? <ul className="pipeline-lane-cards">{entries.map(lead => <li key={lead.id}><button type="button" className="pipeline-card" onClick={() => setModal({ type: 'lead', id: lead.id })}>
          <LeadIdentity lead={lead} /><span className="pipeline-line"><Icon name="message-circle" /><span>{lead.type} · {lead.topic}</span></span><span className="pipeline-line"><Icon name="layers-2" /><span>{campaignName(lead.campaign)}</span></span>
        </button></li>)}</ul> : <p className="pipeline-empty">Belum ada lead di tahap ini.</p>}
      </section>;
    })}</div>
    {!records.length && <p className="pipeline-no-results">Tidak ada lead yang cocok dengan pencarian ini.</p>}
  </section>;
}

function Conversations() {
  const { filteredLeads, setModal } = useReference();
  if (!filteredLeads.length) return <Empty title="Belum ada sampel chat">Pilih campaign WhatsApp atau periode lain.</Empty>;
  const breakdown = responseTypes.map(type => ({ type, count: filteredLeads.filter(lead => lead.type === type).length }));
  const measured = filteredLeads.filter(lead => lead.minutes !== null);
  const max = Math.max(...breakdown.map(item => item.count));
  const top = breakdown.filter(item => item.count === max);
  const summary = top.length === 1
    ? `Respons terbanyak pada filter ini adalah “${top[0].type}” (${max} dari ${filteredLeads.length} lead).`
    : `Frekuensi tertinggi terbagi di ${top.length} jenis respons: ${top.map(item => item.type).join(', ')}. Masing-masing muncul ${max} kali dari ${filteredLeads.length} lead.`;
  const median = measured.length ? measured.map(lead => lead.minutes).sort((a, b) => a - b)[Math.floor(measured.length / 2)] : null;
  return <>
    <div className="split">
      <Panel title="Jenis respons" subtitle="Tujuh jenis jawaban lead yang dipakai dalam analisis">
        <div className="panel-body"><div className="breakdown">{breakdown.map(({ type, count }) => <div key={type}><span>{type}</span><div className="meter"><i style={{ '--size': `${100 * ratio(count, filteredLeads.length)}%` }} /></div><strong>{count}</strong></div>)}</div><section className="conversation-summary response-summary"><Explanation>{summary}</Explanation></section></div>
      </Panel>
      <Panel title="Jeda balasan & sentimen" subtitle="Pesan CS → jawaban lead">
        <div className="panel-body">{measured.map(lead => <button className="movement-item" type="button" key={lead.id} onClick={() => setModal({ type: 'lead', id: lead.id })}><span>{lead.alias}</span><span>{lead.minutes} mnt · {lead.mood}</span><Icon name="chevron-right" /></button>)}<Info>Cakupan interval bergantung pada ketersediaan pesan keluar CS.</Info></div>
      </Panel>
    </div>
    <section className="conversation-summary" aria-label="Ringkasan percakapan"><Explanation>{median === null ? 'Belum ada jeda balasan yang bisa diukur dari pesan CS.' : `Dari ${measured.length} lead dengan jeda terukur, median balasannya ${num(median)} menit setelah pesan CS.`} {filteredLeads.some(lead => lead.mood === 'Negatif') && `Ada ${filteredLeads.filter(lead => lead.mood === 'Negatif').length} lead dengan sentimen negatif. Buka detail percakapan untuk melihat alasannya.`}</Explanation></section>
  </>;
}

function Velocity() {
  const { filteredLeads, setModal } = useReference();
  const recent = filteredLeads.filter(lead => lead.minutes !== null).sort((a, b) => a.minutes - b.minutes);
  if (!filteredLeads.length) return <Empty title="Belum ada sampel WhatsApp">Pilih campaign dengan percakapan untuk melihat waktu balasan.</Empty>;
  const median = recent.length ? recent.length % 2 ? recent[(recent.length - 1) / 2].minutes : (recent[recent.length / 2 - 1].minutes + recent[recent.length / 2].minutes) / 2 : null;
  return <>
    <Panel title="Jeda balasan lead" subtitle="Pesan pengiklan atau CS sampai lead membalas">
      <div className="panel-body"><DetailMetrics items={ [['Median balasan lead', median === null ? '—' : `${num(median)} menit`], ['Sampel dengan jeda terukur', `${recent.length} dari ${filteredLeads.length}`]] } /></div>
      <Table headings={['Lead', 'Jeda CS → lead', 'Sentimen', 'Jenis respons']}>{recent.map(lead => <tr key={lead.id}><th scope="row"><button type="button" className="row-link" onClick={() => setModal({ type: 'lead', id: lead.id })}>{lead.alias}</button></th><td>{lead.minutes} menit</td><td>{lead.mood}</td><td>{lead.type}</td></tr>)}</Table>
    </Panel>
    <Panel title="Cakupan pengukuran"><div className="panel-body"><Info>Interval tersedia ketika pesan CS dan jawaban lead tercatat. Ambang diam dan definisi umur lead produksi masih dibahas.</Info></div></Panel>
  </>;
}

function Reports() {
  const { scope, days, toast } = useReference();
  const download = () => {
    const rows = [['Campaign', 'Jalur', 'Belanja IDR', 'Tayangan', 'Klik link', 'Jenis hasil', 'Jumlah hasil'], ...scope.map(campaign => {
      const [spend, impressions, clicks, conversations, , , purchases] = stageTotals(campaign, days);
      return [campaign.name, channelName(campaign.channel), spend, impressions, clicks, campaign.channel === 'wa' ? 'Percakapan dimulai' : 'Pembelian', campaign.channel === 'wa' ? conversations : purchases];
    })];
    downloadCsv(rows, `FunnelLens-${days}hari.csv`);
    toast('CSV diunduh.');
  };
  return <Panel title="Ekspor metrik" subtitle={`Periode ${contextPeriod(days)}`}><div className="panel-body"><p>CSV berisi belanja, tayangan, klik, dan hasil sesuai jalur campaign.</p><Button variant="primary" icon="download" onClick={download}>Unduh CSV</Button></div></Panel>;
}

function Settings() {
  return <Panel title="Ruang kerja ABT Grosir" subtitle="Konfigurasi prototipe">
    <div className="panel-body"><Info>Akses baca saja. FunnelLens dirancang untuk membaca data Meta Ads, Pixel, dan WhatsApp, lalu menyajikan insight.</Info><div className="button-row"><Link className="button secondary" to="/app/tracking"><Icon name="activity" />Status sumber data</Link><Link className="button secondary" to="/app/integrations"><Icon name="settings" />Integrasi backend</Link></div></div>
  </Panel>;
}

function Alerts() {
  const context = useReference();
  const items = currentInsights(context);
  const filtered = items.filter(item => context.alertTab === 'done' ? context.history[item.historyKey] === 'done' : context.history[item.historyKey] !== 'done');
  return <>
    <Tabs items={ [['active', 'Perlu ditinjau'], ['done', 'Ditindaklanjuti']] } value={context.alertTab} onChange={context.setAlertTab} />
    {filtered.length ? <div className="insight-list">{filtered.map(item => <article className="insight-row" key={item.id}>
      <div className="insight-row-copy"><p className="insight-area">{item.type}</p><h3>{item.title}</h3><p className="insight-evidence">{item.summary}</p></div>
      <Button onClick={() => context.setModal({ type: 'insight', id: item.id })}>{item.action}</Button>
      <Button onClick={() => { const done = context.history[item.historyKey] === 'done'; context.updateHistory(item.historyKey, done ? 'read' : 'done'); context.toast(done ? 'Temuan kembali ke daftar tinjauan.' : 'Temuan ditandai ditindaklanjuti.'); }}>{context.history[item.historyKey] === 'done' ? 'Kembalikan ke daftar' : 'Tandai ditindaklanjuti'}</Button>
    </article>)}</div> : <Empty title="Tidak ada temuan dalam tampilan ini">Ganti filter atau buka tab lain.</Empty>}
  </>;
}

function LeadDetails({ lead }) {
  return <>
    <div className="insight-tags"><StatusChip value={lead.level} /><Chip tone="blue">Keyakinan {lead.confidence.toLowerCase()}</Chip><Chip tone="blue">{lead.status}</Chip></div>
    <dl className="definitions lead-metrics">{[['Campaign', campaignName(lead.campaign)], ['ID kreatif', lead.creative], ['Jenis respons', lead.type], ['Sentimen', lead.mood]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <h3>{lead.prior === lead.level ? `${lead.level} tetap` : `${lead.prior} → ${lead.level}`}</h3><Explanation>{lead.why}</Explanation>
    <div className="conversation-trail">{lead.before && <><div className="message"><span>CS · pesan sumber</span><p>{lead.before}</p></div><div className="message-gap"><Icon name="clock-3" />{lead.minutes} menit · CS sampai lead membalas</div></>}<blockquote className="message reply"><span>Lead · kutipan termasking</span><p>“{lead.quote}”</p></blockquote></div>
  </>;
}

function StageDetails({ index, withHistory }) {
  const { channel, scope, days } = useReference();
  const stage = funnelStages(channel, scope, days)[index];
  if (!stage) return null;
  const name = stageNames[channel][index];
  const entries = [['Jumlah tercatat', num(stage.count)], ['Jumlah periode lalu', num(stage.previousCount)], ['Sumber', index < 3 ? 'Meta Ads' : channel === 'wa' ? 'WhatsApp' : 'Meta Pixel'], ['Periode', contextPeriod(days)]];
  if (index) entries.push(['Bagian dari tayangan', formatStageRate(stage.share, true)], [`Konversi dari ${stageNames[channel][index - 1]}`, formatStageRate(stage.rate, true)], ['Konversi periode lalu', formatStageRate(stage.baseline, true)], ['Perubahan konversi', stage.change === null ? 'Tanpa pembanding' : pointChange(stage.change).replace(' poin', ' poin persentase')]);
  return <>
    <h3>Bukti tahap</h3><dl className="definitions">{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {withHistory && <div className="leak-history-detail"><LeakHistory index={index} /></div>}
    <section className="insight-next stage-explanation"><header><h3><Icon name="sparkles" />Penjelasan AI</h3><Chip>Simulasi</Chip></header><p>{index === 0 ? `Periode ini mencatat ${num(stage.count)} tayangan, dibanding ${num(stage.previousCount)} pada periode sebelumnya.` : `Konversi dari ${stageNames[channel][index - 1]} ${stage.change === null ? 'belum bisa dibandingkan' : pointChange(stage.change).toLowerCase()} (${formatStageRate(stage.baseline, true)} menjadi ${formatStageRate(stage.rate, true)}).`}</p><p><strong>Yang perlu dicek</strong>{channel === 'wa' ? 'Uji tautan dan nomor tujuan WhatsApp, lalu coba kirim pesan pembuka dari iklan.' : 'Uji kecepatan buka halaman tujuan dari ponsel dan pastikan event tercatat.'}</p></section>
    <Info>{channel === 'web' ? 'Event website ditampilkan sebagai hitungan agregat.' : index === 5 ? 'Closing merupakan indikasi dari chat.' : index > 2 ? 'Tahap temperatur menggunakan pencapaian pertama dari chat.' : 'Metrik sumber berasal dari Meta Ads pada simulasi.'}</Info>
  </>;
}

function InsightDetails({ insight }) {
  const context = useReference();
  const key = insight.historyKey;
  const lead = insight.target ? leads.find(item => item.id === insight.target) : null;
  const markDone = () => {
    const done = context.history[key] === 'done';
    context.updateHistory(key, done ? 'read' : 'done');
    context.setModal(null);
    context.toast(done ? 'Temuan kembali ke daftar tinjauan.' : 'Temuan ditandai ditindaklanjuti.');
  };
  return <>
    <div className="insight-tags"><Chip tone="green">Keyakinan sedang</Chip><Chip tone="blue">Data simulasi</Chip></div>
    {lead && <dl className="definitions">{[['Temperatur', `${lead.prior} → ${lead.level}`], ['Bukti chat', lead.quote], ['Interval CS → lead', `${lead.minutes ?? 'Belum terukur'} menit`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    <Explanation>{insight.copy}</Explanation>
    <section className="insight-next"><h3>Langkah berikutnya</h3><p>{insight.copy}</p>
      <div className="button-row">{insight.route && <Button variant="primary" onClick={() => context.goTo(insight.route)}>Buka halaman terkait</Button>}{insight.target && <Button variant="primary" onClick={() => context.setModal({ type: insight.id === 'intent' ? 'lead' : 'creative', id: insight.target })}>Lihat bukti</Button>}<Button onClick={markDone}>{context.history[key] === 'done' ? 'Kembalikan ke daftar' : 'Tandai ditindaklanjuti'}</Button></div>
    </section>
  </>;
}

function ReferenceDialog() {
  const context = useReference();
  const { modal, setModal } = context;
  if (!modal) return null;
  let title = 'Detail';
  let content = null;
  if (modal.type === 'lead') {
    const lead = leads.find(item => item.id === modal.id);
    if (!lead) return null;
    title = lead.alias;
    content = <LeadDetails lead={lead} />;
  } else if (modal.type === 'stage') {
    title = stageNames[context.channel][modal.id];
    content = <StageDetails index={modal.id} withHistory={modal.history} />;
  } else if (modal.type === 'insight') {
    const insight = currentInsights(context).find(item => item.id === modal.id);
    if (!insight) return null;
    title = insight.title;
    content = <InsightDetails insight={insight} />;
  } else if (modal.type === 'creative') {
    const creative = context.visibleCreatives.find(item => item.id === modal.id);
    if (!creative) return null;
    title = creative.name;
    const { dim, status, fatigue } = creativeAnalysis(creative);
    content = <>
      <div className="insight-tags"><Chip tone={statusClass(status)}>{status}</Chip><Chip tone={statusClass(dim[0].certainty)}>{dim[0].certainty}</Chip></div>
      <Explanation>{creativeWhy(creative, { dim, status, fatigue })}</Explanation>
      <h3>Empat dimensi</h3><div className="dimension-list">{dim.map(item => <div className="measure" key={item.name}><strong>{item.name} <Chip tone={statusClass(item.label)}>{item.label}</Chip></strong><span>{num(item.count)} {item.sample} · {item.certainty}</span></div>)}</div>
      <h3>Kejenuhan kreatif</h3><dl className="definitions">{[['Status', fatigue.status], ['CTR link', `${num(fatigue.ctr0, 1)}% → ${num(fatigue.ctr1, 1)}%`], ['Frekuensi', `${num(fatigue.freq0, 1)}× → ${num(fatigue.freq1, 1)}×`], ['Biaya per hasil', `${money(fatigue.cost0)} → ${money(fatigue.cost1)}`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </>;
  } else if (modal.type === 'about') {
    title = 'Tentang FunnelLens';
    content = <><p>Prototipe menggunakan metrik, prospek, dan narasi simulasi. Tanggal snapshot adalah 19 November 2026.</p><p>Temuan dipakai untuk meninjau sumber iklan, aktivitas halaman, dan percakapan. Perubahan iklan dilakukan pengguna di Ads Manager.</p></>;
  }
  return <Modal open onClose={() => setModal(null)} title={title} wide={modal.type === 'lead'}><div className="dialog-body">{content}</div></Modal>;
}

export default function ReferencePage() {
  const context = useReference();
  const { route, account, setAccount } = context;
  if (account === 'empty' && !['ringkasan', 'tracking', 'pengaturan', 'peringatan'].includes(route)) {
    return <>
      <Empty title="Akun belum terhubung">Halaman ini membutuhkan sumber data. Pilih akun demo untuk melihat simulasi.
        <Button variant="primary" onClick={() => { setAccount('demo'); context.changeCampaign('all'); }}>Buka akun demo</Button>
      </Empty>
      <ReferenceDialog />
    </>;
  }
  const pages = {
    ringkasan: <Overview />,
    funnel: <Funnel />,
    kebocoran: <Leakage />,
    tracking: <Tracking />,
    lead: <LeadList />,
    pipeline: <Pipeline />,
    percakapan: <Conversations />,
    kecepatan: <Velocity />,
    laporan: <Reports />,
    pengaturan: <Settings />,
    peringatan: <Alerts />,
  };
  return <>
    {pages[route] || <CreativePages route={route} />}
    <ReferenceDialog />
  </>;
}
export { currentInsights };
