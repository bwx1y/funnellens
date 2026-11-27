import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useWorkspace } from '../context.jsx';
import {
  Badge, Button, EmptyState, Notice, PageHead, Panel, SearchInput, SectionHead, useToast,
} from '../components/ui.jsx';
import { apiDownload, apiRequest } from '../lib/supabase.js';

const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

function number(value) {
  return value == null ? '—' : numberFormat.format(value);
}

function percent(value) {
  return value == null ? '—' : `${percentFormat.format(value * 100)}%`;
}

function duration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${number(seconds)} dtk`;
  const minutes = seconds / 60;
  return `${number(minutes)} mnt`;
}

function localDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
}

function periodPath(path, preferences, { campaign = false, extra = {} } = {}) {
  const period = ['7', '14', '30'].includes(String(preferences.period))
    ? String(preferences.period)
    : '30';
  const query = new URLSearchParams({ days: period, ...extra });
  if (campaign && preferences.campaign && preferences.campaign !== 'all') {
    query.set('campaignId', preferences.campaign);
  }
  return `${path}?${query.toString()}`;
}

function useApiData(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    setLoading(true);
    apiRequest(path)
      .then(result => { if (!cancelled) setData(result); })
      .catch(requestError => {
        if (!cancelled) setError(requestError.message || 'Data tidak dapat dimuat.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, version]);

  return { data, loading, error, reload };
}

function RequestFeedback({ loading, error }) {
  return (
    <>
      {loading && <p className="muted" role="status">Memuat data dari backend…</p>}
      {error && <Notice tone="red">{error}</Notice>}
    </>
  );
}

function Metrics({ items }) {
  return (
    <div className="intel-metrics">
      {items.map(item => (
        <div className="intel-metric" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value ?? '—'}</strong>
          {item.detail && <small>{item.detail}</small>}
        </div>
      ))}
    </div>
  );
}

function DataTable({ columns, rows, rowKey }) {
  if (!rows.length) {
    return <EmptyState title="Belum ada data pada periode ini" description="Data akan muncul setelah sumber terkait tersinkron dan memiliki aktivitas." />;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey ? rowKey(row) : index}>
              {columns.map(column => (
                <td key={column.key}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusColor(status) {
  if (status === 'Sehat' || status === 'connected' || status === 'Winner') return 'teal';
  if (['Bermasalah', 'Perlu optimalisasi', 'Waspada', 'Jenuh', 'Perlu ditinjau', 'Pantau', 'disconnected', 'expired', 'simulation', 'Pertimbangkan dihentikan'].includes(status)) return 'amber';
  return 'gray';
}

function sourceStatusLabel(status) {
  return ({
    connected: 'Terhubung',
    simulation: 'Terhubung, belum sinkron',
    disconnected: 'Belum terhubung',
    expired: 'Kredensial kedaluwarsa',
    out_of_scope: 'Tidak digunakan',
  })[status] || status || 'Belum diketahui';
}

export function LeakagePage() {
  const { workspace } = useWorkspace();
  const query = periodPath('/api/analytics/leakage', workspace.preferences);
  const historyQuery = periodPath('/api/analytics/leaks/history', workspace.preferences, { extra: { objectiveGroup: 'wa' } });
  const current = useApiData(query);
  const history = useApiData(historyQuery);
  const data = current.data;

  return (
    <div className="stack">
      <PageHead eyebrow="FUNNEL INTELLIGENCE" title="Kebocoran funnel." description="Tinjau perubahan konversi dan titik kehilangan prospek dari data akun terhubung."/>
      <RequestFeedback loading={current.loading} error={current.error}/>
      {data && (
        <>
          <Metrics items={[
            { label: 'Transisi', value: data.transition || 'Belum terukur' },
            { label: 'Rasio saat ini', value: percent(data.rate) },
            { label: 'Baseline', value: percent(data.baseline) },
            { label: 'Perkiraan gap', value: number(data.estimatedGap), detail: data.severity || 'Tidak ada level risiko terukur' },
          ]}/>
          {data.note && <Notice>{data.note}</Notice>}
          <Panel>
            <SectionHead title="Kebocoran per campaign" caption="Hanya campaign yang tersedia pada data backend."/>
            <DataTable
              rows={data.campaigns || []}
              rowKey={row => row.campaignId}
              columns={[
                { key: 'name', label: 'Campaign' },
                { key: 'rate', label: 'Rasio', render: row => percent(row.rate) },
                { key: 'baseline', label: 'Baseline', render: row => percent(row.baseline) },
                { key: 'deltaPp', label: 'Perubahan', render: row => row.deltaPp == null ? '—' : `${number(row.deltaPp)} pp` },
                { key: 'estimatedGap', label: 'Perkiraan gap', render: row => number(row.estimatedGap) },
                { key: 'eligible', label: 'Status', render: row => <Badge color={row.eligible ? 'teal' : 'gray'}>{row.eligible ? 'Memenuhi sampel' : 'Sampel terbatas'}</Badge> },
              ]}
            />
          </Panel>
          <Panel>
            <SectionHead title="Riwayat funnel" caption="Periode dan nilai yang dikembalikan backend."/>
            <RequestFeedback loading={history.loading} error={history.error}/>
            {!history.loading && !history.error && (
              <DataTable
                rows={history.data?.periods || []}
                rowKey={row => `${row.since}-${row.until}`}
                columns={[
                  { key: 'label', label: 'Periode' },
                  { key: 'transition', label: 'Transisi' },
                  { key: 'rate', label: 'Rasio', render: row => percent(row.rate) },
                  { key: 'deltaPp', label: 'Perubahan', render: row => row.deltaPp == null ? '—' : `${number(row.deltaPp)} pp` },
                  { key: 'severity', label: 'Status', render: row => row.severity ? <Badge color={row.severity === 'CRITICAL' ? 'amber' : 'blue'}>{row.severity}</Badge> : '—' },
                ]}
              />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

export function SpeedPage() {
  const { workspace } = useWorkspace();
  const { data, loading, error } = useApiData(periodPath('/api/analytics/audience/speed', workspace.preferences));

  return (
    <div className="stack">
      <PageHead eyebrow="FUNNEL INTELLIGENCE" title="Kecepatan respons." description="Pantau waktu balas dan prospek yang menunggu berdasarkan catatan percakapan."/>
      <RequestFeedback loading={loading} error={error}/>
      {data && (
        <>
          <Metrics items={[
            { label: 'Rata-rata balasan pertama', value: duration(data.avgFirstReplySeconds) },
            { label: 'Waktu tunggu terlama', value: data.longestWaitMinutes == null ? '—' : `${number(data.longestWaitMinutes)} mnt` },
            { label: 'Lead menunggu >24 jam', value: number(data.stuckLeads) },
          ]}/>
          {data.note && <Notice>{data.note}</Notice>}
          <Panel>
            <SectionHead title="Distribusi waktu respons" caption="Jumlah prospek per bucket dari data aktual."/>
            <DataTable
              rows={data.buckets || []}
              columns={[
                { key: 'label', label: 'Waktu respons' },
                { key: 'count', label: 'Prospek', render: row => number(row.count) },
              ]}
            />
          </Panel>
          {data.cohortHeatmap?.cells?.length > 0 && (
            <Panel>
              <SectionHead title="Kecepatan menurut temperatur lead"/>
              <DataTable
                rows={data.cohortHeatmap.cells}
                rowKey={row => `${row.level}-${row.bucket}`}
                columns={[
                  { key: 'level', label: 'Temperatur' },
                  { key: 'bucket', label: 'Bucket' },
                  { key: 'leads', label: 'Lead', render: row => number(row.leads) },
                  { key: 'share', label: 'Porsi', render: row => percent(row.share) },
                ]}
              />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

export function TrackingPage() {
  const health = useApiData('/api/tracking-health');
  const sources = useApiData('/api/sources');
  const data = health.data;
  const sourceRows = sources.data?.sources || [];

  return (
    <div className="stack">
      <PageHead eyebrow="FUNNEL INTELLIGENCE" title="Kesehatan tracking." description="Periksa status Pixel, CAPI, kualitas event, dan koneksi sumber data." action={<Link className="btn btn-secondary" to="/app/settings">Atur integrasi</Link>}/>
      <RequestFeedback loading={health.loading || sources.loading} error={health.error || sources.error}/>
      {data && (
        <>
          <Metrics items={[
            { label: 'Pixel Meta', value: data.pixel?.connected == null ? 'Belum diketahui' : data.pixel.connected ? 'Terhubung' : 'Belum terhubung', detail: data.pixel?.name || data.pixel?.pixelId || '' },
            { label: 'CAPI', value: data.capi?.connected == null ? 'Belum diketahui' : data.capi.connected ? 'Aktif' : 'Tidak aktif' },
            { label: 'Rata-rata EMQ', value: data.emq?.average == null ? '—' : `${number(data.emq.average)} / ${number(data.emq.scale)}`, detail: data.emq?.status || '' },
            { label: 'Tanggal data', value: data.date || 'Belum tersedia' },
          ]}/>
          {data.pixel?.note && <Notice>{data.pixel.note}</Notice>}
          <Panel>
            <SectionHead title="Koneksi sumber data" caption="Status aktual dari layanan koneksi backend."/>
            <DataTable
              rows={sourceRows}
              rowKey={row => row.key}
              columns={[
                { key: 'label', label: 'Sumber' },
                { key: 'status', label: 'Status', render: row => <Badge color={statusColor(row.status)}>{sourceStatusLabel(row.status)}</Badge> },
                { key: 'lastSyncAt', label: 'Sinkron terakhir', render: row => localDate(row.lastSyncAt) },
                { key: 'lastError', label: 'Catatan', render: row => row.lastError || '—' },
              ]}
            />
          </Panel>
          <Panel>
            <SectionHead title="Event tracking" caption="Jumlah event browser/server, deduplikasi, dan kualitas pencocokan."/>
            <DataTable
              rows={data.events || []}
              columns={[
                { key: 'eventName', label: 'Event' },
                { key: 'browserCount', label: 'Browser', render: row => number(row.browserCount) },
                { key: 'serverCount', label: 'Server', render: row => number(row.serverCount) },
                { key: 'dedupRate', label: 'Dedup', render: row => percent(row.dedupRate) },
                { key: 'matchQuality', label: 'Kualitas match', render: row => row.matchQuality == null ? '—' : `${number(row.matchQuality)} / ${number(data.emq?.scale)}` },
                { key: 'status', label: 'Status', render: row => row.status ? <Badge color={statusColor(row.status)}>{row.status}</Badge> : '—' },
              ]}
            />
          </Panel>
        </>
      )}
    </div>
  );
}

export function PipelinePage() {
  const { workspace } = useWorkspace();
  const [search, setSearch] = useState('');
  const path = periodPath('/api/analytics/audience/pipeline', workspace.preferences, { extra: search ? { q: search } : {} });
  const { data, loading, error } = useApiData(path);
  const rows = (data?.lanes || []).flatMap(lane => (lane.rows || []).map(row => ({ ...row, level: lane.level })));

  return (
    <div className="stack">
      <PageHead eyebrow="AUDIENCE INTELLIGENCE" title="Pipeline lead." description="Lihat progres lead berdasarkan temperatur, tahap, dan bukti percakapan."/>
      <Panel>
        <SectionHead title="Lead dalam pipeline" caption={`${number(data?.lanes?.reduce((sum, lane) => sum + lane.count, 0) || 0)} lead dalam cakupan periode`} action={<SearchInput value={search} onChange={setSearch} placeholder="Cari nama atau nomor…"/>}/>
        <RequestFeedback loading={loading} error={error}/>
        {!loading && !error && (
          <DataTable
            rows={rows}
            rowKey={row => row.leadId}
            columns={[
              { key: 'name', label: 'Lead', render: row => <strong>{row.name || row.phoneMasked || `Lead ${row.leadId}`}</strong> },
              { key: 'level', label: 'Temperatur', render: row => <Badge color={row.level === 'HOT' ? 'amber' : row.level === 'WARM' ? 'teal' : 'blue'}>{row.level}</Badge> },
              { key: 'stage', label: 'Tahap' },
              { key: 'topic', label: 'Topik', render: row => row.topic || row.reason || '—' },
              { key: 'firstSeenAt', label: 'Pertama terlihat', render: row => localDate(row.firstSeenAt) },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}

export function ConversationsPage() {
  const { workspace } = useWorkspace();
  const { data, loading, error } = useApiData(periodPath('/api/analytics/audience/conversations', workspace.preferences));
  const sentiment = data?.sentiment || {};

  return (
    <div className="stack">
      <PageHead eyebrow="AUDIENCE INTELLIGENCE" title="Analisis percakapan." description="Ringkasan respons, waktu balas, dan sentimen dari percakapan yang tercatat."/>
      <RequestFeedback loading={loading} error={error}/>
      {data && (
        <>
          <Metrics items={[
            { label: 'Lead terklasifikasi', value: number(data.classifiedLeads) },
            { label: 'Median respons pertama', value: duration(data.timed?.medianSeconds) },
            { label: 'Percakapan terukur', value: number(data.timed?.measuredLeads), detail: `dari ${number(data.timed?.observedLeads)} terpantau` },
            { label: 'Sentimen positif', value: number(sentiment.positif) },
          ]}/>
          {data.note && <Notice>{data.note}</Notice>}
          <div className="intel-panels">
            <Panel>
              <SectionHead title="Jenis respons"/>
              <DataTable
                rows={data.counts || []}
                columns={[
                  { key: 'responseType', label: 'Respons' },
                  { key: 'count', label: 'Jumlah', render: row => number(row.count) },
                ]}
              />
            </Panel>
            <Panel>
              <SectionHead title="Sentimen percakapan"/>
              <Metrics items={[
                { label: 'Positif', value: number(sentiment.positif) },
                { label: 'Netral', value: number(sentiment.netral) },
                { label: 'Negatif', value: number(sentiment.negatif) },
              ]}/>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

export function FatiguePage() {
  const { workspace } = useWorkspace();
  const { data, loading, error } = useApiData(periodPath('/api/analytics/creatives/fatigue', workspace.preferences));
  const rows = data?.creatives || [];

  return (
    <div className="stack">
      <PageHead eyebrow="CREATIVE INTELLIGENCE" title="Kejenuhan kreatif." description="Identifikasi kreatif yang menunjukkan penurunan performa atau frekuensi tinggi."/>
      <Panel>
        <SectionHead title="Status kejenuhan" caption={data?.sample ? `Sampel: ${number(data.sample.n)} impresi` : 'Penilaian berdasarkan rentang yang dipilih.'}/>
        <RequestFeedback loading={loading} error={error}/>
        {data?.note && <Notice>{data.note}</Notice>}
        {!loading && !error && (
          <DataTable
            rows={rows}
            rowKey={row => row.creativeId}
            columns={[
              { key: 'name', label: 'Kreatif', render: row => <strong>{row.name || row.creativeId}</strong> },
              { key: 'status', label: 'Status', render: row => <Badge color={statusColor(row.status)}>{row.status}</Badge> },
              { key: 'drop', label: 'Perubahan performa', render: row => percent(row.drop) },
              { key: 'frequency', label: 'Frekuensi terkini', render: row => number(row.frequency?.now) },
              { key: 'consecutiveDays', label: 'Hari berturut-turut', render: row => number(row.consecutiveDays) },
              { key: 'confounded', label: 'Kondisi', render: row => row.confounded ? 'Ada faktor pengganggu' : 'Tidak terdeteksi' },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}

export function QualityPage() {
  const { workspace } = useWorkspace();
  const { data, loading, error } = useApiData(periodPath('/api/analytics/creatives/lead-quality', workspace.preferences));
  const rows = data?.rows || [];

  return (
    <div className="stack">
      <PageHead eyebrow="CREATIVE INTELLIGENCE" title="Kualitas lead per kreatif." description="Bandingkan kualitas lead aktual dan kelengkapan sinyal pada tiap kreatif."/>
      <Panel>
        <SectionHead title="Kualitas lead" caption={data?.sample ? `Sampel: ${number(data.sample.n)}` : 'Menggunakan data lead yang sudah dinilai.'}/>
        <RequestFeedback loading={loading} error={error}/>
        {data?.note && <Notice>{data.note}</Notice>}
        {!loading && !error && (
          <DataTable
            rows={rows}
            rowKey={row => row.creativeId}
            columns={[
              { key: 'name', label: 'Kreatif', render: row => <strong>{row.name || row.creativeId}</strong> },
              { key: 'hotLeads', label: 'Lead HOT', render: row => number(row.hotLeads) },
              { key: 'assessedMatureLeads', label: 'Lead dinilai', render: row => number(row.assessedMatureLeads) },
              { key: 'hotRate', label: 'Rasio HOT', render: row => percent(row.hotRate) },
              { key: 'completeness', label: 'Kelengkapan data', render: row => percent(row.completeness) },
              { key: 'messageEvidence', label: 'Bukti pesan', render: row => `${number(row.messageEvidence?.present)} / ${number(row.messageEvidence?.assessed)}` },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}

export function ComparisonPage() {
  const { workspace } = useWorkspace();
  const { data, loading, error } = useApiData(periodPath('/api/analytics/creatives', workspace.preferences, { campaign: true }));
  const [selectedIds, setSelectedIds] = useState([]);
  const creatives = data?.creatives || [];
  const selected = selectedIds.map(id => creatives.find(row => row.creativeId === id)).filter(Boolean);

  const toggle = id => setSelectedIds(current => (
    current.includes(id)
      ? current.filter(value => value !== id)
      : current.length < 2 ? [...current, id] : current
  ));

  return (
    <div className="stack">
      <PageHead eyebrow="CREATIVE INTELLIGENCE" title="Bandingkan kreatif." description="Pilih hingga dua kreatif untuk membandingkan metrik aktual dalam periode yang sama."/>
      <Panel>
        <SectionHead title="Pilih kreatif" caption="Perbandingan deskriptif dari data backend, bukan hasil eksperimen kausal."/>
        <RequestFeedback loading={loading} error={error}/>
        {!loading && !error && (
          <DataTable
            rows={creatives}
            rowKey={row => row.creativeId}
            columns={[
              { key: 'select', label: 'Pilih', render: row => (
                <input
                  type="checkbox"
                  aria-label={`Bandingkan ${row.name || row.creativeId}`}
                  checked={selectedIds.includes(row.creativeId)}
                  disabled={!selectedIds.includes(row.creativeId) && selectedIds.length >= 2}
                  onChange={() => toggle(row.creativeId)}
                />
              ) },
              { key: 'name', label: 'Kreatif', render: row => <strong>{row.name || row.creativeId}</strong> },
              { key: 'results', label: 'Hasil', render: row => number(row.results) },
              { key: 'ctr', label: 'CTR', render: row => percent(row.ctr) },
              { key: 'roas', label: 'ROAS', render: row => number(row.roas) },
              { key: 'frequency', label: 'Frekuensi', render: row => number(row.frequency) },
              { key: 'status', label: 'Status', render: row => <Badge color={row.fatigued ? 'amber' : 'gray'}>{row.status}</Badge> },
            ]}
          />
        )}
      </Panel>
      {selected.length > 0 && (
        <Panel>
          <SectionHead title="Ringkasan perbandingan" caption={`${selected.length} kreatif dipilih.`}/>
          <DataTable
            rows={[
              { metric: 'Hasil', ...Object.fromEntries(selected.map((row, index) => [`creative-${index}`, number(row.results)])) },
              { metric: 'CTR', ...Object.fromEntries(selected.map((row, index) => [`creative-${index}`, percent(row.ctr)])) },
              { metric: 'ROAS', ...Object.fromEntries(selected.map((row, index) => [`creative-${index}`, number(row.roas)])) },
              { metric: 'Frekuensi', ...Object.fromEntries(selected.map((row, index) => [`creative-${index}`, number(row.frequency)])) },
            ]}
            columns={[
              { key: 'metric', label: 'Metrik' },
              ...selected.map((row, index) => ({
                key: `creative-${index}`,
                label: row.name || row.creativeId,
              })),
            ]}
          />
        </Panel>
      )}
    </div>
  );
}

export function ReportsPage() {
  const { workspace } = useWorkspace();
  const toast = useToast();
  const query = periodPath('/api/reports/exports', workspace.preferences, { extra: { page_size: '20' } });
  const { data, loading, error, reload } = useApiData(query);
  const [busy, setBusy] = useState('');

  const exportReport = async report => {
    setBusy(report);
    try {
      const path = periodPath(
        report === 'campaigns' ? '/api/reports/campaigns.csv' : '/api/reports/creative-trend.csv',
        workspace.preferences,
        { campaign: report === 'campaigns' },
      );
      await apiDownload(path);
      toast('Laporan berhasil diunduh.');
      await reload();
    } catch (downloadError) {
      toast(downloadError.message || 'Laporan gagal diunduh.', 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="stack">
      <PageHead eyebrow="LAPORAN" title="Laporan & ekspor." description="Unduh laporan dari data tersinkron dan lihat riwayat ekspor akun."/>
      <Panel>
        <SectionHead
          title="Unduh laporan"
          caption="File dibuat oleh backend berdasarkan periode dan campaign yang dipilih."
          action={(
            <div className="intel-actions">
              <Button variant="secondary" icon={FileSpreadsheet} loading={busy === 'campaigns'} disabled={Boolean(busy)} onClick={() => exportReport('campaigns')}>Performa campaign</Button>
              <Button variant="secondary" icon={Download} loading={busy === 'creative-trend'} disabled={Boolean(busy)} onClick={() => exportReport('creative-trend')}>Tren kreatif</Button>
            </div>
          )}
        />
        <p className="muted small">Ekspor akan memakai filter global periode. Laporan campaign juga mengikuti campaign terpilih.</p>
      </Panel>
      <Panel>
        <SectionHead title="Riwayat ekspor" caption="Riwayat aktual yang tercatat untuk akun terpilih."/>
        <RequestFeedback loading={loading} error={error}/>
        {!loading && !error && (
          <DataTable
            rows={data?.items || []}
            rowKey={row => row.id}
            columns={[
              { key: 'report', label: 'Laporan', render: row => row.report === 'creative-trend' ? 'Tren kreatif' : row.report === 'campaigns' ? 'Performa campaign' : row.report },
              { key: 'rowCount', label: 'Baris data', render: row => number(row.rowCount) },
              { key: 'createdAt', label: 'Waktu ekspor', render: row => localDate(row.createdAt) },
              { key: 'userName', label: 'Pengguna', render: row => row.userName || '—' },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
