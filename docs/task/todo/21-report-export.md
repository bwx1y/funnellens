# TODO: Report & Export — Tren Kreatif, CSV Campaign, Audit Ekspor

## Gambaran Fitur
Tidak ada satu pun endpoint export atau report di backend. Checklist menuntut seri tren kreatif berparameter, dua file CSV dengan kolom dan format persis, serta audit log setiap ekspor. Task ini menutup F-16.1, F-16.2, F-20.1, F-20.3.

## Daftar Pekerjaan

### 1. Helper CSV (`src/shared/csv.ts`)
- [ ] Buat `export function toCsv(headers: string[], rows: (string | number | null)[][]): string`:
  - Awalan BOM `\uFEFF`, akhir baris `\r\n`, setiap sel dibungkus `"` dengan `"` di-escape menjadi `""`.
  - `null`/`undefined` → sel kosong `""`, bukan `"null"`.
- [ ] Buat `export function csvResponse(filename: string, body: string): Response` mengembalikan `content-type: text/csv; charset=utf-8` dan `content-disposition: attachment; filename="<filename>"`.

### 2. Tren kreatif berparameter (F-16.1)
- [ ] Tambah `GET /api/analytics/creatives/trend` pada `CreativeController` (`src/modules/creative/index.ts`) — daftarkan **sebelum** route `/:id` agar `trend` tidak terbaca sebagai id.
- [ ] Query: `{accountId, metric, days?, since?, until?, creativeId?}` dengan `metric` wajib `t.Union([t.Literal("impressions"), t.Literal("clicks"), t.Literal("ctr"), t.Literal("spend")])`.
- [ ] Service `getTrend(tenantId, query)`:
  ```ts
  {
    metric, period, previousPeriod,
    current: [{date, value: number | null}],
    previous: [{date, value: number | null}],
    total: {current: number, previous: number, deltaPct: number | null},
    sample, note?
  }
  ```
  - `spend` memakai `spend_minor`; `ctr` = `clicks / impressions` 4 desimal, `null` bila `impressions = 0`.
  - `current.length === days` (7/14/30) dan `previous.length === days`; hari tanpa baris insight → `value: null`, bukan `0`.
  - `creativeId` opsional memfilter ke satu kreatif; tanpa filter, agregasi seluruh kreatif akun.
- [ ] Ambil data dari `ad_insight_metrics` (view) via `AnalyticsRepository`, bukan query baru per kreatif.

### 3. `GET /api/reports/creative-trend.csv` (F-16.2)
- [ ] Buat `src/modules/reports/{index.ts,service.ts,schema.ts}` dan daftarkan `ReportsController` di `src/routes.ts` dengan prefix `/reports`.
- [ ] Kolom persis, urutan persis: `Periode,Tanggal,Tayangan,Klik link,CTR link (%),Belanja (IDR)`.
  - `Periode` = `"current"` atau `"previous"`; `Tanggal` = `YYYY-MM-DD`.
  - `CTR link (%)` = 4 desimal dengan titik desimal (mis. `1.8000`), bukan format id-ID, agar terbaca mesin.
  - `Belanja (IDR)` = nilai minor dibagi `currency_offset`, bilangan bulat tanpa pemisah ribuan.
- [ ] Baris = `days` baris `current` diikuti `days` baris `previous`; `days=7` → 14 baris data + 1 header.
- [ ] Angka CSV wajib identik dengan `/analytics/creatives/trend` untuk parameter yang sama (test membandingkan sel CSV dengan respons JSON).

### 4. `GET /api/reports/campaigns.csv` (F-20.1)
- [ ] Kolom persis, urutan persis: `Campaign,Jalur,Belanja IDR,Tayangan,Klik link,Jenis hasil,Jumlah hasil`.
  - `Jalur` = `"WhatsApp"` bila `ad_sets.objective_group = 'wa'`, `"Website"` bila `'web'`.
  - `Jenis hasil` = `"Percakapan"` untuk `wa`, `"Pembelian"` untuk `web`.
  - `Jumlah hasil` = `leads` (wa) atau `purchases` (web) dari view `ad_insight_metrics`.
- [ ] Mengikuti filter aktif: `campaignId?`, `days?`, `since?`, `until?`. Periode default mengikuti `resolvePeriod` (30 hari).
- [ ] Angka wajib sama dengan `/api/analytics/summary` untuk `campaigns[]` yang sama (test membandingkan per baris).

### 5. Audit log ekspor (F-20.3)
- [ ] Tambah tabel `export_audit` (`src/infra/database/schema/ads/export-audit.entity.ts`):
  `id bigserial pk`, `tenant_id uuid not null references tenants(id) on delete cascade`, `user_id uuid not null references users(id)`, `report text not null`, `filter jsonb not null default '{}'`, `row_count bigint not null`, `created_at timestamptz not null default now()`; index `(tenant_id, created_at desc)`.
- [ ] Generate migrasi lewat `bun run db:generate`.
- [ ] Kedua endpoint CSV menulis satu baris `export_audit` **setelah** body terbentuk dan sebelum respons dikirim; kegagalan insert tidak boleh menggagalkan unduhan — log `warn` saja.
- [ ] Tambah `GET /api/reports/exports` (`{accountId?}`) mengembalikan 50 audit terakhir tenant: `{id, report, filter, rowCount, userName, createdAt}`.

## File yang Disentuh
- `src/shared/csv.ts` (baru)
- `src/modules/creative/index.ts`, `src/modules/creative/schema.ts`, `src/modules/creative/service.ts`
- `src/modules/reports/{index,service,schema}.ts` (baru), `src/routes.ts`
- `src/infra/database/schema/ads/export-audit.entity.ts` (baru), `src/infra/database/schema/index.ts`, migrasi
- `src/infra/database/repositories/export-audit.repository.ts` (baru)

## Uji Selesai
- `GET /api/analytics/creatives/trend?accountId=…&metric=ctr&days=7` → `current.length === 7`, `previous.length === 7`.
- Hari tanpa data → `value: null`; tidak ada `0` pengganti.
- `GET /api/reports/creative-trend.csv?accountId=…&days=7` → 15 baris (1 header + 14 data), byte pertama `EF BB BF`, akhir baris `\r\n`, `CTR link (%)` 4 desimal.
- `GET /api/reports/campaigns.csv?accountId=…` → header persis `Campaign,Jalur,Belanja IDR,Tayangan,Klik link,Jenis hasil,Jumlah hasil`; `Jalur` hanya berisi `WhatsApp`/`Website`.
- Sel CSV = angka JSON `/analytics/summary` untuk campaign yang sama.
- Setelah dua unduhan, `GET /api/reports/exports` mengembalikan 2 baris dengan `report` berbeda dan `filter` berisi parameter yang dipakai.
