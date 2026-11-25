import {
  campaigns,
  creatives,
  dailyRows,
  dailyShares,
  dimensions,
  leads,
  stageNames,
} from '../lib/referenceData.js';

export { campaigns, creatives, dimensions, leads, stageNames };

export const periods = [
  { id: 7, label: '13–19 Nov 2026' },
  { id: 14, label: '6–19 Nov 2026' },
  { id: 30, label: '21 Okt–19 Nov 2026' },
];

export const responseTypes = [
  'Komitmen',
  'Tanya lanjut',
  'Keberatan',
  'Menunda',
  'Menolak',
  'Pengakuan netral',
  'Di luar topik',
];

export const num = (value, digits = 0) =>
  new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

export const money = value =>
  `Rp ${value >= 1e6 ? `${num(value / 1e6, 2)} jt` : num(value)}`;

export const pct = ratio => `${num(100 * ratio, 1)}%`;
export const ratio = (a, b) => (b ? a / b : 0);
export const channelName = channel => (channel === 'wa' ? 'WhatsApp' : 'Website');

export function campaignName(id) {
  return campaigns.find(campaign => campaign.id === id)?.name || 'Semua campaign';
}

export function stageTotals(campaign, days, offset = 0) {
  return dailyRows[campaign.id]
    .slice(offset, offset + days)
    .reduce(
      (totals, row) => totals.map((value, index) => value + row[index]),
      Array(7).fill(0),
    );
}

export function sumStages(list, days, offset = 0) {
  return list.reduce((totals, campaign) => {
    const counts = stageTotals(campaign, days, offset);
    return totals.map((value, index) => value + counts[index]);
  }, Array(7).fill(0));
}

export function selectCampaigns(campaign, account = 'demo') {
  if (account === 'empty') return [];
  return campaigns.filter(item => campaign === 'all' || item.id === campaign);
}

export function visibleLeads(list, campaign, days) {
  const start = new Date(Date.UTC(2026, 10, 20 - days)).toISOString().slice(0, 10);
  return list.filter(
    lead => (campaign === 'all' || lead.campaign === campaign) && lead.date >= start,
  );
}

export function stageRate(value, base) {
  return base > 0 ? value / base : null;
}

export function formatStageRate(rate, detail = false) {
  if (rate === null) return '—';
  if (rate === 0) return '0%';
  if (rate < 0.001) return detail ? `${num(rate * 100, 4)}%` : '<0,1%';
  return pct(rate);
}

export function previousPeriodLabel(days) {
  const end = new Date(Date.UTC(2026, 10, 19 - days));
  const start = new Date(Date.UTC(2026, 10, 20 - days * 2));
  const date = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `${date.format(start)} – ${date.format(end)} 2026`;
}

export function dateLabel(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function leakEvidence(channel, scope, days) {
  const current = sumStages(scope.filter(item => item.channel === channel), days);
  const previous = sumStages(
    scope.filter(item => item.channel === channel),
    days,
    days,
  );
  const actual = ratio(current[3], current[2]);
  const baseline = ratio(previous[3], previous[2]);
  return {
    current,
    previous,
    actual,
    baseline,
    loss: Math.max(0, Math.round(baseline * current[2] - current[3])),
    gap: (baseline - actual) * 100,
  };
}

export function stageData(channel, scope, days) {
  return sumStages(scope.filter(item => item.channel === channel), days).slice(1);
}

export function funnelStages(channel, scope, days) {
  const current = stageData(channel, scope, days);
  const previous = sumStages(
    scope.filter(item => item.channel === channel),
    days,
    days,
  ).slice(1);
  return current.map((count, index) => {
    const rate = index ? stageRate(count, current[index - 1]) : null;
    const baseline = index ? stageRate(previous[index], previous[index - 1]) : null;
    return {
      index,
      count,
      rate,
      baseline,
      previousCount: previous[index],
      share: stageRate(count, current[0]),
      change: rate === null || baseline === null ? null : (rate - baseline) * 100,
    };
  });
}

export function largestDecline(stages) {
  return stages.reduce(
    (worst, stage) =>
      stage.change !== null && stage.change < (worst?.change ?? -1e-8) ? stage : worst,
    null,
  );
}

export function fatigueAnalysis(creative) {
  const [ctr0, ctr1, freq0, freq1, cost0, cost1, days] = creative.fatigue;
  const drop = (ctr0 - ctr1) / ctr0;
  const watch = drop >= 0.15 && freq1 > freq0;
  const status =
    creative.days < 7
      ? 'Belum cukup data'
      : watch && drop >= 0.25 && cost1 > cost0 && days >= 3
        ? 'Jenuh'
        : watch
          ? 'Waspada'
          : 'Sehat';
  return {
    status,
    drop,
    ctr0,
    ctr1,
    freq0,
    freq1,
    cost0,
    cost1,
    days,
    confound: creative.controlled,
    engagement: creative.engagement,
  };
}

export function creativeScope(creative) {
  return creatives.filter(
    item => item.campaign === creative.campaign && item.results >= 15 && item.days >= 7,
  ).length;
}

export function creativeAnalysis(creative) {
  const isWeb = creative.campaign === 'web';
  const samples = [
    creative.results,
    creative.impressions,
    isWeb ? 360 : creative.leads,
    creative.days,
  ];
  const objectives = creativeScope(creative);
  const dim = dimensions.map((dimension, index) => {
    const sample = index === 2 && isWeb ? 'klik link' : dimension.sample;
    const [min, mature] =
      index === 2 && isWeb ? [15, 50] : [dimension.min, dimension.mature];
    return {
      ...dimension,
      sample,
      min,
      mature,
      count: samples[index],
      percentile: creative.p[index],
      certainty:
        samples[index] < min
          ? 'Belum cukup data'
          : samples[index] < mature
            ? 'Indikatif'
            : 'Terukur',
      label:
        samples[index] < min
          ? 'Belum cukup data'
          : creative.p[index] >= 67
            ? 'Kuat'
            : creative.p[index] <= 33
              ? 'Lemah'
              : 'Rata-rata',
      baseline: objectives < 5,
    };
  });
  const [cost, , quality, health] = dim;
  const fatigue = fatigueAnalysis(creative);
  const weak =
    dim.slice(1).some(item => item.label === 'Lemah') || fatigue.status === 'Jenuh';
  const status =
    cost.certainty === 'Belum cukup data'
      ? 'Belum cukup data'
      : cost.certainty !== 'Terukur'
        ? 'Pantau'
        : cost.label === 'Kuat' &&
            quality.label !== 'Lemah' &&
            health.label !== 'Lemah' &&
            quality.certainty === 'Terukur' &&
            health.certainty === 'Terukur'
          ? 'Winner'
          : cost.label === 'Lemah' && weak && !creative.controlled
            ? 'Pertimbangkan dihentikan'
            : 'Pantau';
  return { dim, cost, status, fatigue };
}

export function creativeWhy(creative, analysis = creativeAnalysis(creative)) {
  const weak = analysis.dim.filter(item => item.label === 'Lemah').map(item => item.name);
  if (analysis.status === 'Winner') {
    return 'Efisiensi biaya kuat, dengan sampel kualitas hasil dan umur kreatif yang sudah terukur.';
  }
  if (analysis.status === 'Belum cukup data') {
    return 'Sampel hasil atau masa tayang belum memenuhi ambang minimum untuk dibandingkan.';
  }
  if (analysis.status === 'Pertimbangkan dihentikan') {
    return `Efisiensi biaya lemah${weak.length ? ` dan ${weak.join(', ').toLowerCase()} juga perlu ditinjau` : ''}.`;
  }
  return `Pantau kembali setelah sampel matang${weak.length ? `; perhatikan ${weak.join(', ').toLowerCase()}` : ''}.`;
}

export function statusClass(value) {
  return (
    {
      Winner: 'green',
      Pantau: 'amber',
      Jenuh: 'orange',
      Waspada: 'amber',
      Sehat: 'green',
      'Pertimbangkan dihentikan': 'orange',
      Kuat: 'green',
      Lemah: 'orange',
      'Rata-rata': 'blue',
      Terukur: 'green',
      Indikatif: 'blue',
    }[value] || 'neutral'
  );
}

export function downloadCsv(rows, filename) {
  const csv = rows
    .map(row =>
      row
        .map(value => `"${String(value ?? '').replaceAll('"', '""')}"`)
        .join(','),
    )
    .join('\r\n');
  const url = URL.createObjectURL(
    new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { dailyRows, dailyShares };
