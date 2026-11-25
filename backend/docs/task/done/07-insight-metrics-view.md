# DONE: View `ad_insight_metrics` untuk Query Insight Analitik

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 78 pass / 0 fail / 15 file).
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/infra/database/schema/ads/ad-insight-metrics.view.ts` (baru)
  - `src/infra/database/migration/0017_insight_metrics_view.sql` (baru)
  - `src/infra/database/migration/meta/{0017_snapshot.json,_journal.json}`
  - `src/infra/database/repositories/analytics.repository.ts`
  - `src/infra/database/repositories/ad-insight-daily.repository.ts`
  - `tests/integration/analytics-repositories.test.ts`

## Ruang Lingkup
Sebelum pekerjaan ini rollup `ad_insight_actions` per baris insight punya dua definisi yang bisa menyimpang: `ANALYTICS_ACTIONS_SQL` (6 kolom, 5 query) dan `PER_INSIGHT_ACTIONS_SQL` (2 kolom, 3 query). Aturan "satu representasi per aksi" dan resolusi `objective_group` karena itu hidup di TS dan mudah dilewati query baru. Sekarang keduanya hidup di satu tempat: view Postgres `ad_insight_metrics`.

## Implementasi

### 1. Definisi tunggal: view `ad_insight_metrics`
`src/infra/database/schema/ads/ad-insight-metrics.view.ts` mendeklarasikan `AD_INSIGHT_METRICS_SQL` (SQL mentah) dan `AdInsightMetricsView = pgView("ad_insight_metrics", {...kolom eksplisit}).as(AD_INSIGHT_METRICS_SQL)`.

Satu baris per `ad_insights_daily`:

| Kolom | Isi |
|---|---|
| `id`, `account_id`, `campaign_id`, `adset_id`, `ad_id`, `date`, `level`, `attribution_window` | salinan kolom insight (dipakai filter scope) |
| `spend_minor`, `impressions`, `reach`, `clicks`, `inline_link_clicks` | salinan metrik aditif |
| `objective_group` | `coalesce(ad_sets.objective_group, 'web')` |
| `leads`, `purchases`, `purchase_value_minor`, `lpv`, `view_content`, `add_to_cart` | hasil precedence `max(...) filter (where action_type = ...)`, `coalesce(..., 0)` |
| `results` | `wa` → `leads`, selain itu → `purchases`, `coalesce(..., 0)` |

Dua keputusan yang mengikat:
- **Kolom eksplisit wajib**: `pgView(name).as()` hanya menerima query builder; bentuk yang dipakai adalah `pgView(name, columns).as(sql)`.
- **`.existing()` tidak dipakai**: `drizzle-kit push` (jalur deploy di `docker-entrypoint.sh`) melewati view `existing`, sehingga view tidak akan pernah dibuat di deploy.
- **View tidak join ke `ads`**: `ad_insights_daily.ad_id` nullable, jadi join ke `ads` akan membuang baris tanpa `ad_id` dan mengubah `getFunnelCounts`. Query yang butuh `creative_id` melakukan join sendiri.

### 2. Delapan query pindah ke view
`analytics.repository.ts` (alias `i` dipertahankan, hanya tabel pengganti dan join rollup yang dihapus):

| Query | Perubahan |
|---|---|
| `getFunnelCounts` | `from ad_insight_metrics i`; hapus join rollup dan `ad_sets`; `sum(per.X)` → `sum(i.X)` |
| `getCreativeAggregates` | hapus join `ad_sets` + rollup; `objective_group` dari `i.objective_group`; `sum(i.results)`; `group by ad.creative_id, i.objective_group` |
| `getCreativeDaily` | hapus join `ad_sets` + rollup; `sum(i.results)`; join `ads` tetap |
| `getCreativeLeadQuality` (CTE `perf`) | hapus dua join; `sum(i.results)` |
| `getPatternGroups` | `join ad_insight_metrics i on i.ad_id = ad.id`; hapus dua join; `sum(i.results)` |

`ad-insight-daily.repository.ts`:

| Query | Perubahan |
|---|---|
| `getAggregatedKPIs` | `from ad_insight_metrics i`; hapus join `PER_INSIGHT_ACTIONS_SQL`; `sum(i.leads)`, `sum(i.purchase_value_minor)` |
| `getDailyTrend` | idem (`sum(i.leads)`) |
| `getCampaignPerformance` | idem (join `campaigns` tetap) |

`insightScope` hanya berubah satu fragmen: `and coalesce(s.objective_group, 'web') = ${objectiveGroup}` → `and i.objective_group = ${objectiveGroup}`. `scopeFilter` di `ad-insight-daily.repository.ts` tidak berubah sama sekali: view mengekspos `level`, `attribution_window`, `account_id`, `date`, `campaign_id` dengan nama yang sama.

### 3. Kode yang dihapus
- `analytics.repository.ts`: `LPV_COUNT_SQL`, `VIEW_CONTENT_COUNT_SQL`, `ADD_TO_CART_COUNT_SQL`, `ANALYTICS_ACTIONS_SQL`, `RESULTS_SQL`, impor `LEAD_COUNT_SQL`/`PURCHASE_COUNT_SQL`/`PURCHASE_VALUE_SQL`.
- `ad-insight-daily.repository.ts`: `LEAD_COUNT_SQL`, `PURCHASE_VALUE_SQL`, `PURCHASE_COUNT_SQL`, `PER_INSIGHT_ACTIONS_SQL`, `LEAD_ACTION_PRECEDENCE`, `PURCHASE_ACTION_PRECEDENCE` (dua konstanta precedence tidak punya pemakai).
- `ATTRIBUTION_WINDOW` tetap diekspor dari `ad-insight-daily.repository.ts` dan tetap diimpor `analytics.repository.ts`.

### 4. Migrasi
`drizzle-kit generate --name insight_metrics_view` → `0017_insight_metrics_view.sql` berisi satu statement `CREATE VIEW "public"."ad_insight_metrics" AS ( ... )`, dan `meta/0017_snapshot.json` memuat `views."public.ad_insight_metrics"` (`isExisting: false`, `materialized: false`) dengan definisi dan 21 kolom.

Bukan materialized view: data berubah tiap sync harian dan per jam, sedangkan gate `≥ 100` butuh angka segar; REFRESH harus ditempel ke `publishCompleteSlice` dan menambah jalur data basi.

## Testing
`tests/integration/analytics-repositories.test.ts` — 17 test (16 lama + 1 baru), semuanya terhadap DB nyata. Test baru:

- `ad_insight_metrics exposes one row per insight with resolved objective group and results`: `db.select().from(AdInsightMetricsView)` mengembalikan 2 baris; ad1 (`objective_group = 'wa'`) `leads 5`, `purchases 1`, `purchaseValueMinor 300000`, `lpv 30`, `viewContent 20`, `addToCart 10`, `results 5`; ad2 (tanpa baris aksi `purchase`) `leads 2`, `purchases 0`, `purchaseValueMinor 0`, `results 2`.

Test itu sekaligus membuktikan nama kolom deklarasi Drizzle cocok dengan kolom view di DB (Drizzle menulis daftar kolom eksplisit pada `select`) dan bahwa `coalesce(..., 0)` bekerja untuk insight tanpa baris aksi.

Angka lama tidak berubah setelah delapan query pindah ke view — `getFunnelCounts` tetap `{impressions: 1500, linkClicks: 45, lpv: 30, viewContent: 20, addToCart: 10, purchase: 1, messagingStarted: 7, purchaseValueMinor: 300000}`, `getCreativeLeadQuality` tetap `{cr1: spend 100000, results 5, hotLeads 1, assessedMatureLeads 3}`.

Hasil verifikasi:

| Perintah | Hasil |
|---|---|
| `bunx tsc --noEmit` | 0 error |
| `bun test tests/integration/analytics-repositories.test.ts` | 17 pass |
| `bun test tests/integration/repositories.test.ts` | 10 pass |
| `bun test` | 78 pass / 0 fail / 15 file |
| `bunx drizzle-kit push --force` (ulang) | tidak ada statement view yang dieksekusi |

## Catatan Teknis
- **`drizzle-kit generate`/`push` gagal bila view diekspor dari barrel `schema/index.ts`.** Barrel mengimpor file view, lalu `schema/**/*.ts` mengimpor file yang sama sekali lagi; drizzle-kit melihat dua entri view dengan nama sama dan keluar dengan `We've found duplicated view name across public schema. Please rename your view` (exit 1). Karena itu file view **tidak** di-export dari `src/infra/database/schema/index.ts`; file tetap terdeteksi oleh glob `drizzle.config.ts` untuk generate/push. Import dilakukan langsung dari path-nya (`@db/schema/ads/ad-insight-metrics.view`), sehingga `db` di `src/infra/database/index.ts` juga tidak memuatnya di objek `schema`.
- **Generator butuh TTY**: `drizzle-kit generate` menolak berjalan tanpa TTY, jadi dijalankan lewat pty dengan Enter otomatis.
- **Perubahan semantik yang disengaja**: `getCreativeAggregates`, `getCreativeDaily`, `getCreativeLeadQuality`, dan `getPatternGroups` sebelumnya mengambil `objective_group` dari `ad_sets` via `ads.adset_id` (adset ad saat ini); sekarang memakai `ad_insights_daily.adset_id` (adset yang tercatat di baris insight), sama seperti `getFunnelCounts`. Perbedaan hanya muncul bila ad berpindah adset setelah tanggal insight, dan baris insight adalah sumber yang benar. Tidak ada test yang mengunci perilaku lama.
- **`COALESCE` wajib di dalam view, bukan di query**: `left join` ke rollup aksi menghasilkan `NULL` untuk insight tanpa baris aksi, dan `sum(NULL)` mengabaikan baris; `coalesce(..., 0)` di definisi view menjaga total tetap benar.
- **Drift `push` yang sudah ada sebelumnya** (di luar lingkup pekerjaan ini): `drizzle-kit` 0.31.11 selalu mengeluarkan `DROP INDEX`/`CREATE INDEX "idx_lead_assessments_lead_event"` pada setiap `push` karena indeks memakai ekspresi `event_at desc`. Terbukti bukan berasal dari view ini (drift muncul juga saat file view disingkirkan sementara).
- **Rantai migrasi lama masih belum sehat** (di luar lingkup): `drizzle-kit migrate` dari DB kosong berhenti di `0003_brown_iceman.sql`. Entrypoint Docker memakai `push`, dan `push` membuat view ini dengan benar.
