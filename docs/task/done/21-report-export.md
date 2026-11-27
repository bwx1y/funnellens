# Selesai: Report & Export — Tren Kreatif, CSV Campaign, Audit Ekspor

Dokumentasi implementasi penutup F-16.1, F-16.2, F-20.1, F-20.3.

## Ringkasan Fitur

- **Helper CSV (`src/shared/csv.ts`)**: `toCsv` menulis BOM `\uFEFF`, akhir baris `\r\n`, setiap sel dibungkus `"` dengan `""` untuk kutip di dalamnya, dan `null`/`undefined` menjadi sel kosong (bukan `"null"`). `csvResponse` mengembalikan `text/csv; charset=utf-8` + `content-disposition: attachment`. `csvDecimal` memformat angka dengan titik desimal (bukan koma id-ID) agar terbaca mesin.
- **`GET /api/analytics/creatives/trend` (F-16.1)**: rute didaftarkan sebelum `/:id` sehingga `trend` tidak pernah dibaca sebagai id kreatif. Query `{accountId, metric, days?, since?, until?, creativeId?}`; `metric` wajib salah satu `impressions|clicks|ctr|spend`. Respons `{metric, creativeId, period, previousPeriod, current, previous, total, sample, note?}`.
  - `current`/`previous` selalu tepat `days` entri (7/14/30, default 30) hasil `dateRange`; hari tanpa baris insight bernilai `null`, bukan `0`.
  - `ctr` = `clicks / impressions` dibulatkan 4 desimal, `null` bila `impressions = 0`; `spend` memakai `spend_minor`.
  - `creativeId` memfilter satu kreatif; tanpa filter seluruh kreatif akun dijumlahkan per tanggal. Sumber data tetap `ad_insight_metrics` lewat `AnalyticsRepository.getCreativeDailySeries` (satu query per periode, bukan per kreatif).
  - `total` memakai jumlah counter (bukan rata-rata harian); `deltaPct` `null` bila periode sebelumnya 0. `note` menjelaskan hari tanpa tayangan, periode kosong, atau pembanding yang tidak tersedia.
- **`GET /api/reports/creative-trend.csv` (F-16.2)**: kolom persis `Periode,Tanggal,Tayangan,Klik link,CTR link (%),Belanja (IDR)`; `days` baris `current` lalu `days` baris `previous`. `CTR link (%)` 4 desimal bertitik, `Belanja (IDR)` = `spend_minor / currency_offset` dibulatkan ke bilangan bulat. CSV dibangun dari `CreativeService.getTrendSeries`, sumber yang sama dengan JSON, sehingga sel dan angka layar tidak bisa berbeda.
- **`GET /api/reports/campaigns.csv` (F-20.1)**: kolom persis `Campaign,Jalur,Belanja IDR,Tayangan,Klik link,Jenis hasil,Jumlah hasil`, urut nama campaign. `Jalur`/`Jenis hasil` mengikuti `ad_sets.objective_group` (`wa` → WhatsApp/Percakapan, `web` → Website/Pembelian); `Jumlah hasil` = `leads` atau `purchases` dari view. Campaign yang menjalankan kedua channel dilaporkan sebagai WhatsApp agar tetap satu baris per campaign dan angkanya sebanding dengan `/api/analytics/summary`.
- **Audit log ekspor (F-20.3)**: tabel `export_audit` (`id`, `tenant_id` cascade, `user_id`, `report`, `filter jsonb`, `row_count`, `created_at`) dengan index `(tenant_id, created_at desc)`. Kedua endpoint CSV menulis audit setelah body terbentuk dan sebelum respons dikirim; kegagalan insert hanya `logger.warn` sehingga unduhan tetap berhasil. `filter` menyimpan hanya parameter yang benar-benar dikirim klien (tidak mengarang default). `GET /api/reports/exports?accountId=` mengembalikan 50 audit terakhir tenant: `{id, report, filter, rowCount, userName, createdAt}`.

## Perbaikan Bug Lintas Modul

Parameter query `days` di `analytics`, `audience`, `creative`, dan `reports` memakai `t.Union([t.Literal(7), t.Literal(14), t.Literal(30)])`. Nilai query selalu berupa string, dan union literal angka tidak melakukan coercion, sehingga **setiap** permintaan HTTP dengan `?days=7` ditolak `422 Expected union value` — termasuk seluruh endpoint yang sudah ada. Keempat skema kini memakai `t.Optional(t.Numeric())`; coercion dilakukan Elysia dan gerbang 7/14/30 tetap milik `resolvePeriod` (`400 code: "INVALID_DAYS"`), sesuai kontrak task 18. Nilai `days=9` kini 400 `INVALID_DAYS`, bukan 422.

## Perubahan File

- `src/shared/csv.ts` (baru): `toCsv`, `csvResponse`, `csvDecimal`.
- `src/modules/creative/service.ts`: tipe `CreativeTrendMetric`/`CreativeTrendQuery`/`CreativeTrendDay`/`CreativeTrendSeries`/`CreativeTrendResponse`, `getTrendSeries`, `getTrend`, `trendNote`.
- `src/modules/creative/schema.ts`: `trend` (metric union, periode, `creativeId`), `days` memakai `t.Numeric()`.
- `src/modules/creative/index.ts`: `GET /trend` sebelum `/:id`.
- `src/modules/reports/{index,service,schema}.ts` (baru): dua rute CSV + `GET /exports`, `ReportsService`, skema query.
- `src/routes.ts`: registrasi `ReportsController` (prefix `/reports`).
- `src/infra/database/schema/ads/export-audit.entity.ts` (baru), `src/infra/database/schema/index.ts`: entitas `ExportAuditEntity` + relasi tenant/user.
- `src/infra/database/repositories/export-audit.repository.ts` (baru): `record`, `findRecent` (join `users.full_name`, filter `filter->>'accountId'`, limit 50).
- `src/infra/database/repositories/ad-insight-daily.repository.ts`: `CampaignChannelPerformance`, `getCampaignChannelPerformance`.
- `src/infra/database/migration/0019_unusual_mariko_yashida.sql` (+ snapshot/journal): tabel `export_audit`, FK, index.
- `src/modules/analytics/schema.ts`, `src/modules/audience/schema.ts`: `days` memakai `t.Numeric()`.
- `tests/integration/reports-export.test.ts` (baru): 10 test.

## Hasil Pengujian

- `bun test` penuh: **302 test di 41 file lulus** tanpa regresi.
- `bunx tsc --noEmit` bersih.
- Kunci perilaku yang diuji:
  - `GET /api/analytics/creatives/trend?...&metric=ctr&days=7` → `current.length = previous.length = 7`; `days=9` → 400 `INVALID_DAYS`.
  - Hari tanpa baris → `value: null`; hari dengan baris bertayangan 0 → `ctr: null` tetapi counter `0` (bukan `null`).
  - CSV tren: 15 baris (1 header + 14 data), byte pertama `EF BB BF`, akhir baris `\r\n`, `CTR link (%)` `0.0300`, `Belanja (IDR)` `500`; `?days=7` menghasilkan 15 baris dengan jendela 13–19 Nov 2026 dan 6–12 Nov 2026.
  - Setiap sel CSV sama dengan `getTrendSeries` untuk parameter yang sama.
  - CSV campaign: header persis; baris `Website/Pembelian` dan `WhatsApp/Percakapan`; `Belanja IDR` dan `Jumlah hasil` sama dengan `/api/analytics/summary` untuk campaign yang sama.
  - Dua unduhan menulis audit (`creative-trend` 14 baris, `campaigns` 2 baris) dengan `filter` berisi parameter yang dikirim; unduhan dengan token user yang tidak ada di `users` tetap mengembalikan file dan tidak menambah audit.
  - Akun tenant lain → 404 `Akun iklan tidak ditemukan`.
