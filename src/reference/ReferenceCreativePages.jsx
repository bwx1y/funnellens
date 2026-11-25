import React from 'react';
import { useReference } from './ReferenceContext.jsx';
import ReferenceSelect from './ReferenceSelect.jsx';
import {
  campaignName,
  channelName,
  creativeAnalysis,
  creativeWhy,
  dailyRows,
  dimensions,
  fatigueAnalysis,
  formatStageRate,
  money,
  num,
  periods,
  pct,
  ratio,
  statusClass,
} from './domain.js';
import { downloadCsv } from './domain.js';
import { Button, Chip, Empty, Explanation, Icon, Panel, Table, Tabs } from './ui.jsx';

const creativePhotos = {
  'CL-101': 'factory',
  'CL-102': 'package',
  'CL-103': 'warehouse',
  'CL-104': 'warehouse',
  'CL-105': 'catalog',
  'CL-106': 'factory',
  'CL-107': 'factory',
  'CL-108': 'warehouse',
  'CL-109': 'package',
  'CL-110': 'catalog',
  'CL-111': 'package',
};

const chartMetrics = [
  { id: 'impressions', label: 'Tayangan', value: row => row[1], format: num },
  { id: 'clicks', label: 'Klik link', value: row => row[2], format: num },
  { id: 'ctr', label: 'CTR link', value: row => ratio(row[2], row[1]), format: pct },
  { id: 'spend', label: 'Belanja', value: row => row[0], format: money },
];

function creativeScope(context) {
  return context.scope.filter(item => context.creativeChannel === 'all' || item.channel === context.creativeChannel);
}

function creativeTrendRows(scope, days) {
  return [0, days].map(offset => Array.from({ length: days }, (_, index) => {
    const day = offset + days - index - 1;
    return scope.reduce((total, campaign) => total.map((value, field) => value + dailyRows[campaign.id][day][field]), [0, 0, 0]);
  }));
}

function summarize(items) {
  return items.reduce((total, { creative }) => ({
    count: total.count + 1,
    spend: total.spend + creative.spend,
    impressions: total.impressions + creative.impressions,
    results: total.results + creative.results,
    leads: total.leads + creative.leads,
    hot: total.hot + creative.hot,
    messages: total.messages + creative.message[0],
    elements: total.elements + creative.message[1],
  }), { count: 0, spend: 0, impressions: 0, results: 0, leads: 0, hot: 0, messages: 0, elements: 0 });
}

function CreativeSymbol({ name, tone = '' }) {
  return <span className={`ca-symbol ${tone}`}><Icon name={name} /></span>;
}

function CreativePanelHeading({ icon, title, copy, id }) {
  return <div className="ca-panel-heading"><CreativeSymbol name={icon} /><div><h2 id={id}>{title}</h2><p>{copy}</p></div></div>;
}

function CreativeToolbar() {
  const context = useReference();
  return <div className="ca-toolbar">
    <Tabs items={ [['all', 'Semua jalur'], ['wa', 'WhatsApp'], ['web', 'Website']] } value={context.creativeChannel} onChange={context.setCreativeChannel} label="Jalur tujuan" />
    <span className="ca-context"><Icon name="calendar-days" />Data simulasi · Snapshot 19 Nov 2026</span>
  </div>;
}

function CreativeKpis({ analyzed }) {
  const totals = summarize(analyzed);
  const whatsapp = summarize(analyzed.filter(({ creative }) => creative.campaign !== 'web'));
  const website = summarize(analyzed.filter(({ creative }) => creative.campaign === 'web'));
  const enough = analyzed.filter(({ analysis }) => analysis.status !== 'Belum cukup data').length;
  const stats = [
    ['Belanja Campaign', money(totals.spend), 'Snapshot kreatif', 'target', ''],
    ['Tayangan', num(totals.impressions), 'Snapshot kreatif', 'monitor-check', 'teal'],
    ['Kreatif', num(totals.count), `${num(enough)} dapat dinilai`, 'clapperboard', ''],
    ['Percakapan WhatsApp', whatsapp.count ? num(whatsapp.results) : '—', 'Khusus jalur WhatsApp', 'message-circle', 'green'],
    ['Pembelian website', website.count ? num(website.results) : '—', 'Khusus jalur Website', 'shopping-bag', 'teal'],
    ['Proporsi lead Hot', whatsapp.leads ? pct(ratio(whatsapp.hot, whatsapp.leads)) : '—', whatsapp.leads ? `Dari ${num(whatsapp.leads)} lead matang` : 'Khusus jalur WhatsApp', 'flame', 'orange'],
  ];
  return <div className="ca-kpis">{stats.map(([label, value, context, icon, tone]) => <section className="ca-kpi" key={label}><CreativeSymbol name={icon} tone={tone} /><h2>{label}</h2><strong>{value}</strong><small>{context}</small></section>)}</div>;
}

function CreativeTrend({ scope }) {
  const context = useReference();
  const [current, previous] = creativeTrendRows(scope, context.days);
  const metric = chartMetrics.find(item => item.id === context.creativeMetric) || chartMetrics[1];
  const currentValues = current.map(metric.value);
  const previousValues = previous.map(metric.value);
  const max = Math.max(1, ...currentValues, ...previousValues);
  const maxStep = max / 4;
  const points = values => values.map((value, index) => `${1000 * index / (values.length - 1)},${200 * (1 - value / max)}`).join(' ');
  const currentPoints = points(currentValues);
  const previousPoints = points(previousValues);
  const exportTrend = () => {
    const rows = [['Periode', 'Tanggal', 'Tayangan', 'Klik link', 'CTR link (%)', 'Belanja (IDR)']];
    [current, previous].forEach((group, periodIndex) => group.forEach((totals, index) => {
      const offset = periodIndex * context.days;
      const day = offset + context.days - index - 1;
      const date = new Date(Date.UTC(2026, 10, 19 - day)).toISOString().slice(0, 10);
      rows.push([periodIndex ? 'Pembanding' : 'Aktif', date, totals[1], totals[2], +(100 * ratio(totals[2], totals[1])).toFixed(4), totals[0]]);
    }));
    downloadCsv(rows, `FunnelLens-tren-campaign-${context.days}hari.csv`);
    context.toast('CSV diunduh.');
  };
  return <section className="ca-panel" aria-labelledby="ca-trend-heading">
    <header className="ca-panel-head"><CreativePanelHeading icon="activity" title="Tren performa campaign" copy="Data harian campaign sesuai filter." id="ca-trend-heading" /><Button icon="download" onClick={exportTrend}>Unduh CSV</Button></header>
    <div className="ca-chart-controls">
      <Tabs items={chartMetrics.map(item => [item.id, item.label])} value={context.creativeMetric} onChange={context.setCreativeMetric} label="Metrik tren" />
      <ReferenceSelect
        label="Periode tren"
        value={context.days}
        options={periods.map(period => ({ value: period.id, label: `${period.id} hari` }))}
        onChange={context.setDays}
        icon="calendar-days"
      />
    </div>
    <div className="ca-legend"><span><i className="ca-key" />Periode aktif</span><span><i className="ca-key prior" />Pembanding</span></div>
    <div className="ca-chart">
      <div className="ca-axis" aria-hidden="true">{[4, 3, 2, 1, 0].map(value => <span key={value}>{metric.format(max * value / 4)}</span>)}</div>
      <div className="ca-plot" role="img" aria-label={`${metric.label}: ${currentValues.map(value => metric.format(value)).join(', ')}`}>
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={previousPoints} fill="none" stroke="#6889AD" strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <polyline points={currentPoints} fill="none" stroke="#2D65A6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="ca-ticks" aria-hidden="true"><span>13 Nov</span><span>16 Nov</span><span>19 Nov</span></div>
    </div>
  </section>;
}

function CampaignSummary({ scope, analyzed }) {
  const context = useReference();
  const totalSpend = summarize(analyzed).spend;
  return <section className="ca-panel">
    <CreativePanelHeading icon="layers-2" title="Ringkasan campaign" copy="Porsi belanja dalam filter dan kelengkapan pesan." />
    <div className="ca-campaigns">{scope.map(campaign => {
      const items = analyzed.filter(({ creative }) => creative.campaign === campaign.id);
      const totals = summarize(items);
      return <article className="ca-campaign" key={campaign.id}>
        <div className="ca-campaign-title"><button type="button" onClick={() => context.changeCampaign(campaign.id)}>{campaign.name}</button><Chip tone={campaign.channel === 'wa' ? 'blue' : 'green'}>{channelName(campaign.channel)}</Chip></div>
        <p>{num(totals.count)} kreatif · {num(totals.results)} {campaign.channel === 'wa' ? 'percakapan' : 'pembelian'}</p>
        <dl className="ca-campaign-meters">
          <div><dt>Porsi belanja<strong>{pct(ratio(totals.spend, totalSpend))}</strong></dt><dd><i style={{ '--fill': `${100 * ratio(totals.spend, totalSpend)}%` }} /></dd></div>
          <div><dt>Pesan kunci<strong>{pct(ratio(totals.messages, totals.elements))}</strong></dt><dd><i className="teal" style={{ '--fill': `${100 * ratio(totals.messages, totals.elements)}%` }} /></dd></div>
        </dl>
      </article>;
    })}</div>
  </section>;
}

function CreativeGallery({ analyzed, setModal }) {
  const order = ['Winner', 'Pertimbangkan dihentikan', 'Pantau', 'Belum cukup data'];
  const sorted = [...analyzed].sort((a, b) => order.indexOf(a.analysis.status) - order.indexOf(b.analysis.status));
  const finding = sorted.find(({ analysis }) => analysis.status === 'Pertimbangkan dihentikan') || sorted.find(({ analysis }) => analysis.status === 'Winner');
  return <section className="ca-panel" aria-labelledby="ca-gallery-heading">
    <header className="ca-panel-head"><CreativePanelHeading icon="clapperboard" title="Galeri kreatif" copy="Buka kartu untuk melihat empat dimensi penilaian dan ketersampaian pesan." id="ca-gallery-heading" /><div className="ca-gallery-actions" /></header>
    {finding && <div className="ca-finding"><p><strong>{finding.creative.name}.</strong> {creativeWhy(finding.creative, finding.analysis)}</p><button type="button" onClick={() => setModal({ type: 'creative', id: finding.creative.id })}>Lihat bukti</button></div>}
    <ul className="ca-gallery" aria-label="Daftar kreatif">{sorted.map(({ creative, analysis }) => {
      const isWeb = creative.campaign === 'web';
      const measureList = [[isWeb ? 'Pembelian' : 'Chat', num(creative.results)], [isWeb ? 'Biaya/beli' : 'Biaya/chat', creative.results ? money(ratio(creative.spend, creative.results)) : '—'], ['Pesan kunci', `${creative.message[0]}/${creative.message[1]}`]];
      return <li key={creative.id}><button type="button" className="ca-card" onClick={() => setModal({ type: 'creative', id: creative.id })}>
        <span className="ca-card-info"><small className="ca-card-meta">{creative.id} · {campaignName(creative.campaign)}</small><strong className="ca-card-title">{creative.name}</strong><span className="ca-status"><Chip tone={statusClass(analysis.status)}>{analysis.status}</Chip>{analysis.status !== 'Belum cukup data' && <small>{analysis.cost.certainty}</small>}</span>
          <span className="ca-card-metrics">{measureList.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</span>
        </span>
        <span className={`ca-thumb ${creativePhotos[creative.id] || 'catalog'}`}><span className="ca-format"><Icon name={creative.format === 'Video' ? 'play' : creative.format === 'Gambar' ? 'image' : 'layers-2'} />{creative.format}</span></span>
      </button></li>;
    })}</ul>
  </section>;
}

function CreativeDashboard() {
  const context = useReference();
  const scope = creativeScope(context);
  const analyzed = scope.flatMap(campaign => context.visibleCreatives.filter(creative => creative.campaign === campaign.id).map(creative => ({ creative, analysis: creativeAnalysis(creative) })));
  if (!analyzed.length) return <><CreativeToolbar /><Empty title="Belum ada kreatif pada filter ini">Pilih jalur atau campaign lain.</Empty></>;
  return <div className="ca-page">
    <CreativeToolbar />
    <CreativeKpis analyzed={analyzed} />
    <div className="ca-main"><CreativeTrend scope={scope} /><CampaignSummary scope={scope} analyzed={analyzed} /></div>
    <CreativeGallery analyzed={analyzed} setModal={context.setModal} />
  </div>;
}

function Fatigue() {
  const context = useReference();
  const rows = context.visibleCreatives.map(creative => ({ creative, analysis: fatigueAnalysis(creative) })).sort((a, b) => b.analysis.drop - a.analysis.drop);
  return <Panel title="Kejenuhan per kreatif" subtitle="Pembanding: 7 hari pertama setelah kreatif matang">
    <Table headings={['Kreatif / ad set', 'Status', 'CTR link', 'Frekuensi', 'Biaya per hasil', '']}>{rows.map(({ creative, analysis }) => <tr key={creative.id}>
      <th scope="row"><button type="button" className="row-link creative-link" onClick={() => context.setModal({ type: 'creative', id: creative.id })}><span className={`glyph ${creative.color} creative-glyph`}><Icon name={creative.format === 'Video' ? 'play' : creative.format === 'Gambar' ? 'image' : 'layers-2'} /></span><span>{creative.name}<small>{creative.id} · {campaignName(creative.campaign)}</small></span></button></th>
      <td><Chip tone={statusClass(analysis.status)}>{analysis.status}</Chip>{analysis.confound && <small>Alokasi diatur Meta</small>}</td>
      <td>{num(analysis.ctr0, 1)}% → {num(analysis.ctr1, 1)}%</td><td>{num(analysis.freq0, 1)}× → {num(analysis.freq1, 1)}×</td><td>{money(analysis.cost0)} → {money(analysis.cost1)}</td>
      <td><button className="text-button" type="button" onClick={() => context.setModal({ type: 'creative', id: creative.id })}><Icon name="sparkles" />Alasan</button></td>
    </tr>)}</Table>
  </Panel>;
}

function Quality() {
  const context = useReference();
  const list = context.visibleCreatives.filter(creative => creative.leads > 0);
  if (!list.length) return <Panel title="Kualitas prospek per kreatif"><Empty title="Tidak ada data chat">Pilih campaign WhatsApp.</Empty></Panel>;
  return <Panel title="Kualitas prospek per kreatif" subtitle="Sumber iklan dihubungkan melalui rujukan chat. Persentase dari lead matang.">
    <Table headings={['Kreatif', 'Biaya per percakapan', 'Lead matang', 'Hot', 'Kelengkapan pesan', 'Rincian penilaian']}>{list.map(creative => {
      const enough = creative.leads >= dimensions[2].min;
      return <tr key={creative.id}><th scope="row"><button type="button" className="row-link creative-link" onClick={() => context.setModal({ type: 'creative', id: creative.id })}>{creative.name}<small>{creative.id}</small></button></th>
        <td>{money(ratio(creative.spend, creative.results))}</td><td>{num(creative.leads)}</td><td>{enough ? `${pct(ratio(creative.hot, creative.leads))}<small>{creative.hot} hot lead</small>` : <Chip>Belum cukup data</Chip>}</td>
        <td>{pct(ratio(creative.message[0], creative.message[1]))}</td><td><Button onClick={() => context.setModal({ type: 'creative', id: creative.id })}>Lihat penilaian</Button></td>
      </tr>;
    })}</Table>
  </Panel>;
}

function Compare() {
  const context = useReference();
  const { visibleCreatives, selection, setSelection, compareType, setCompareType, compareObjective, setCompareObjective, compareSort, setCompareSort, compact, setCompact } = context;
  const selected = visibleCreatives.filter(creative => selection.has(creative.id) && creativeAnalysis(creative).status !== 'Belum cukup data');
  const objectiveGroups = {
    wa: selected.filter(creative => creative.campaign !== 'web'),
    web: selected.filter(creative => creative.campaign === 'web'),
  };
  const list = [...(objectiveGroups[compareObjective] || [])].sort((a, b) => compareSort === 'name' ? a.name.localeCompare(b.name, 'id') : creativeAnalysis(b).dim[Number(compareSort)].percentile - creativeAnalysis(a).dim[Number(compareSort)].percentile);
  if (compareType === 'ab') return <><Tabs items={ [['obs', 'Perbandingan observasional'], ['ab', 'Uji A/B Meta']] } value={compareType} onChange={setCompareType} /><Panel title="Uji A/B Meta" subtitle="Hasil studi yang dijalankan di Meta Ads Manager"><Empty title="Belum ada uji A/B Meta">Hasil eksperimen akan muncul di sini setelah tersedia dari sumber Meta.</Empty></Panel></>;
  return <>
    <Tabs items={ [['obs', 'Perbandingan observasional'], ['ab', 'Uji A/B Meta']] } value={compareType} onChange={setCompareType} />
    <Panel title="Pilihan kreatif" subtitle="Mulai dari kreatif dengan tujuan, penempatan, dan periode sebanding.">
      <details className="disclosure picker"><summary>Pilih kreatif <span>{selected.length} dipilih</span></summary><div className="picker-grid">{visibleCreatives.map(creative => {
        const denied = creativeAnalysis(creative).status === 'Belum cukup data';
        return <label className={`pick ${denied ? 'disabled' : ''}`} key={creative.id}><input type="checkbox" checked={selection.has(creative.id)} disabled={denied} onChange={event => setSelection(current => { const next = new Set(current); if (event.target.checked) next.add(creative.id); else next.delete(creative.id); return next; })} /><span><strong>{creative.name}</strong><small>{denied ? 'Belum cukup data' : campaignName(creative.campaign)}</small></span></label>;
      })}</div></details>
    </Panel>
    <Panel title="Matriks perbandingan" subtitle="Hasil observasional · indikatif">
      <div className="objective-tabs"><Tabs items={ [['wa', `Percakapan WhatsApp (${objectiveGroups.wa.length})`], ['web', `Penjualan website (${objectiveGroups.web.length})`]] } value={compareObjective} onChange={setCompareObjective} label="Tujuan campaign" /></div>
      {list.length ? <>
        <div className="table-controls"><ReferenceSelect
          label="Urutkan dimensi"
          value={compareSort}
          options={[{ value: 'name', label: 'Urutkan: Nama kreatif' }, ...dimensions.map((dimension, index) => ({ value: index, label: dimension.name }))]}
          onChange={setCompareSort}
        /><label className="toggle"><input type="checkbox" checked={compact} onChange={event => setCompact(event.target.checked)} /> Tampilan ringkas</label></div>
        <div className="matrix"><Table headings={['Kreatif', ...dimensions.map(item => item.name), 'Ketersampaian pesan', 'Rincian penilaian']}>{list.map(creative => {
          const analysis = creativeAnalysis(creative);
          return <tr key={creative.id}><th scope="row"><button type="button" className="row-link" onClick={() => context.setModal({ type: 'creative', id: creative.id })}>{creative.name}<small>{creative.id}</small></button></th>
            {analysis.dim.map(dimension => <td key={dimension.name}><Chip tone={statusClass(dimension.label)}>{dimension.label}</Chip>{!compact && dimension.certainty !== 'Belum cukup data' && <small>{dimension.certainty} · {dimension.baseline ? 'baseline akun' : `${dimension.percentile} persentil`}</small>}</td>)}
            <td>{pct(ratio(creative.message[0], creative.message[1]))}</td><td><Button onClick={() => context.setModal({ type: 'creative', id: creative.id })}>Lihat penilaian</Button></td>
          </tr>;
        })}</Table></div>
        {list.length === 1 ? <p className="matrix-note">Pilih satu kreatif lagi dengan tujuan ini untuk membandingkan hasil.</p> : <div className="panel-body matrix-note"><Explanation>Status tiap dimensi tetap mengikuti peringkat akun. Efisiensi biaya dan kualitas hasil dibaca di dalam tujuan yang sama.</Explanation></div>}
      </> : <Empty title="Belum ada kreatif yang dipilih">Pilih kreatif dengan tujuan ini atau ubah filter campaign.</Empty>}
    </Panel>
  </>;
}

export default function CreativePages({ route }) {
  if (route === 'kreatif') return <CreativeDashboard />;
  if (route === 'kejenuhan') return <Fatigue />;
  if (route === 'kualitas') return <Quality />;
  if (route === 'bandingkan') return <Compare />;
  return <Empty title="Halaman tidak ditemukan">Pilih halaman dari menu navigasi.</Empty>;
}
