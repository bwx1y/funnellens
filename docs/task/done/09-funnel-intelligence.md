# DONE: Funnel Intelligence & Leakage Detection

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 111 pass / 0 fail / 19 file).
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/shared/funnel.ts` (baru)
  - `src/shared/dates.ts`
  - `src/infra/database/repositories/analytics.repository.ts`
  - `src/modules/analytics/schema.ts`, `src/modules/analytics/service.ts`, `src/modules/analytics/index.ts`
  - `tests/unit/funnel-pairs.test.ts` (baru), `tests/integration/analytics-funnel.test.ts` (baru)

## Ruang Lingkup
Tiga endpoint: peta tahap funnel per kanal (WhatsApp & Website) dengan perbandingan dua periode, deteksi transisi yang menurun, dan detail satu tahap (tren harian + tabel perbandingan). Tidak ada perhitungan kerugian dalam uang dan tidak ada klaim penyebab.

Modul `analytics/` (tugas 08) sudah menyediakan `AnalyticsService`, `AnalyticsController`, `AnalyticsSchema`, `getFunnelCounts`/`getLeadStageCounts`/`getTrackingSummary`, view `ad_insight_metrics`, `requireAccountScope`, dan helper `@shared/dates`. Semua dipakai ulang; tidak ada modul baru. Segmentasi per jam/perangkat tetap milik `GET /api/analytics/audience/segments` (tugas 05), bukan endpoint baru di sini.

## Implementasi

### 1. Helper murni (`src/shared/funnel.ts`)
Tanpa I/O, dipakai ulang oleh generator alert (tugas 08 lanjutan).

- `FUNNEL_STAGES` — dua kanal, urutan tetap:

| Kanal | Tahap | Label | Sumber |
|---|---|---|---|
| `wa` | `impressions` | Tayangan | `meta` |
| | `link_clicks` | Klik tautan | `meta` |
| | `messaging_started` | Chat dimulai | `meta` |
| | `observed` | Lead tercatat | `cross`, `estimated: true` |
| | `replied` | Dibalas | `cross` |
| | `qualified` | Qualified | `cross` |
| | `closed` | Closing | `cross` |
| `web` | `impressions` | Tayangan | `meta` |
| | `link_clicks` | Klik tautan | `meta` |
| | `lpv` | Landing page view | `meta` |
| | `view_content` | View content | `meta` |
| | `add_to_cart` | Tambah ke keranjang | `meta` |
| | `purchase` | Pembelian | `meta` |

- `computePair` — `rate`/`baseline` dibulatkan 4 desimal, `deltaPp` 2 desimal (`100 × (rate − baseline)`), `estimatedGap = max(0, round(before × baseline − after))`.
- Gerbang sampel: tahap asal `impressions`/`link_clicks` → `≥ 100 per periode`; tahap lain → `≥ 30 per periode`; `eligible` juga menuntut `trackingState === "up_to_date"`.
- `note` berprioritas: `deltaPp === null` → `"Rasio tidak tersedia karena salah satu periode tidak memiliki angka pada tahap sebelumnya."`; selain itu `!eligible` → `"Gerbang sampel belum terpenuhi sehingga perbandingan belum dapat diandalkan."`.
- `pairStatus`: `≤ −15` `kritis`, `≤ −5` `perlu_perhatian`, selain itu `normal`, `null` → `null`.
- `pickLeakage` memilih `deltaPp` negatif terkecil di antara pasangan `eligible`; `leakageCaption(gap)` → `"≈{gap} chat hilang"`; `stageChannel` memetakan `stageKey` ke kanal; `trackingStateOf` memisahkan `unknown` (belum pernah sync) dari `stale` (overdue).

### 2. Helper tanggal
`dateRange(since, until)` di `src/shared/dates.ts`: daftar tanggal UTC inklusif, `[]` bila `since > until`. Dipakai untuk zero-fill tren harian.

### 3. Repository (`analytics.repository.ts`)

| Method | Isi |
|---|---|
| `getDailyMetaStages(accountId, since, until, objectiveGroup)` | satu baris per tanggal dari view `ad_insight_metrics`; kolom `impressions`, `inline_link_clicks`, `leads`, `lpv`, `view_content`, `add_to_cart`, `purchases`; scope lewat `insightScope` privat (termasuk `objective_group`) |
| `getDailyLeadStages(accountId, since, until)` | satu baris per tanggal UTC dari `leads`; filter cohort identik dengan `getLeadStageCounts` (`observed`, `replied`, `qualified`, `closed`) |

Tidak ada method lain yang diubah.

### 4. Service (`src/modules/analytics/service.ts`)
- **`resolvePeriod`** — langkah periode `getSummary` (default `until` hari ini di zona akun, `since = until − 29`, validasi `since > until`, `days`, periode sebelumnya sama panjang, empat batas `Date`) diekstrak ke private method dan dipakai keempat endpoint. Perilaku `getSummary` tidak berubah (test lamanya tetap 4 pass).
- **`loadFunnel`** — satu `Promise.all` empat query (funnel kini/lalu dengan `objectiveGroup`, stage lead kini/lalu) lalu memetakan `FUNNEL_STAGES[objectiveGroup]` dan membangun `pairs` + `sample`.
- **`getFunnel`** — `objectiveGroup` default `wa`; `stages[].rateFromFirst = value / tayangan` (bukan pembanding lintas periode, tahap pertama bernilai `1`); `note` bila tracking tidak `up_to_date` atau semua pasangan tidak eligible.
- **`getLeakage`** — selalu kanal `wa` (caption berbicara tentang chat); `severity` `CRITICAL` (`≤ −15`) / `WARNING` (`≤ −5`); `impactMinor` selalu `null`, `impactCaption` hanya berisi jumlah chat.
- **`getStageDetail`** — `stageChannel` menentukan kanal, `FUNNEL_STAGES[...].find` menjaga type-safety, `stageKey` tak dikenal → `BadRequestError("Tahap funnel tidak dikenal")` (400). Tren harian di-zero-fill lewat `dateRange`; pembaca tahap dipakai ulang (`definition.read`) sehingga tren dan total funnel tidak bisa menyimpang. `comparisonTable` berisi seluruh tahap kanal dengan `changePct`, `conversionRate` (dari pasangan masuk), dan `status`.

### 5. Endpoint
`GET /api/analytics/funnel`, `GET /api/analytics/funnel/stage-detail`, `GET /api/analytics/leakage` ditambahkan ke `AnalyticsController` yang sudah ada (guard `JwtUtil.isAuthenticated`, dekorasi `analyticsService`). `src/routes.ts` tidak berubah.

## Testing

`tests/unit/funnel-pairs.test.ts` — 14 kasus murni tanpa DB: 180/900 vs 250/1000 → `0.2` / `0.25` / `−5` / `45` / `perlu_perhatian`; denominator nol → semua `null` + catatan rasio; gerbang `≥ 100` vs `≥ 30`; `stale` menggugurkan `eligible`; batas `pairStatus` (`−15`, `−5`, `−4.99`, `null`); `pickLeakage` memilih `−12` dari `−5`/`−12` dan mengabaikan yang tidak eligible; `leakageCaption(45)`; pemetaan `stageChannel`; `trackingStateOf`.

`tests/integration/analytics-funnel.test.ts` — 10 test terhadap DB nyata. Fixture: tenant + akun `Asia/Jakarta`/`IDR`, campaign `ACTIVE`, adset `objective_group 'wa'`, satu creative, satu ad; insight `2026-02-27` (tayangan 12000, klik 1000, `lead` 250) dan `2026-03-01` (tayangan 10000, klik 900, `lead` 180); tiga lead pada `2026-03-01` (HOT tanpa balasan; QUALIFIED dibalas 5 menit; CLOSED dibalas 60 menit); satu `sync_runs` `SUCCESS`. Akun kedua tanpa data, akun ketiga milik tenant lain.

Angka yang diuji (periode `2026-03-01..2026-03-02`, sebelumnya `2026-02-27..2026-02-28`):

| Assertion | Nilai |
|---|---|
| `stages` keys / values | 7 tahap `wa` / `10000, 900, 180, 3, 2, 1, 1` |
| `stages[3].estimated` / `stages[0].estimated` | `true` / `undefined` |
| `stages[2].rateFromFirst` | `0.018` |
| `pairs[0]` | `0.09 / 0.0833 / 0.67 / gap 0 / normal / eligible` |
| `pairs[1]` | `0.2 / 0.25 / −5 / gap 45 / perlu_perhatian / eligible` |
| `pairs[2]` | `0.0167 / 0 / 1.67 / gap 0 / normal / eligible` |
| `pairs[3]` | `0.6667 / null / null / status null / tidak eligible` + catatan rasio |
| `sample` | `{n: 10000, denominator: 100, eligible: true, gate: "≥ 100 tayangan"}` |
| `period` / `previousPeriod` | `{2026-03-01, 2026-03-02, 2}` / `{2026-02-27, 2026-02-28}` |
| `note` | `undefined` |
| `getLeakage` | `link_clicks→messaging_started`, `0.2 / 0.25 / −5 / 45`, `WARNING`, `up_to_date`, `impactMinor null`, caption `"≈45 chat hilang"` |
| `getStageDetail("messaging_started").daily` | `[{2026-03-01, 180}, {2026-03-02, 0}]` |
| `comparisonTable` baris `impressions` | `10000 / 12000 / −16.67 / null / normal` |
| `comparisonTable` baris `messaging_started` | `180 / 250 / −28 / 0.2 / perlu_perhatian` |
| `getStageDetail("closed").daily` | `1` lalu `0` |
| akun tanpa sync | semua `value 0`, semua `rate null` & tidak eligible, `note` status tracking; `getLeakage` → `transition null`, `trackingState "unknown"`, `note "Cakupan belum cukup untuk membandingkan konversi."` |
| route smoke | `funnel` 200 + `pairs` 6, `leakage` 200 + caption, `stage-detail` 200 + 7 baris |
| `stageKey=bogus` | `400`, `{status: false, message: "Tahap funnel tidak dikenal"}` |
| akun tenant lain | `404`, `{status: false, message: "Akun iklan tidak ditemukan"}` |

Hasil verifikasi:

| Perintah | Hasil |
|---|---|
| `bunx tsc --noEmit` | 0 error |
| `bun test tests/unit/funnel-pairs.test.ts` | 14 pass |
| `bun test tests/integration/analytics-funnel.test.ts` | 10 pass |
| `bun test tests/integration/analytics-summary.test.ts` | 4 pass (refaktor `resolvePeriod` tidak mengubah perilaku) |
| `bun test` | 111 pass / 0 fail / 19 file |

## Catatan Teknis
- **Precedence aksi ada di view, bukan konstanta.** `LEAD_ACTION_PRECEDENCE`/`PURCHASE_ACTION_PRECEDENCE` tidak lagi ada setelah tugas 07; "satu representasi per aksi" dipenuhi dengan membaca kolom `leads`/`purchases`/`lpv`/`view_content`/`add_to_cart` dari `ad_insight_metrics`.
- **Kanal default `wa`.** `objectiveGroup` opsional dengan default `wa` karena produk ini funnel WhatsApp; `web` harus diminta eksplisit. `leakage` selalu `wa` karena captionnya berbicara tentang chat — bila kelak perlu kanal web, tambahkan `objectiveGroup` ke query `leakage`, bukan mengubah `getFunnel`.
- **`eligible` menuntut sync sukses.** `trackingState` berasal dari `getTrackingSummary`; akun yang belum pernah sync berstatus `unknown` sehingga semua pasangan tidak eligible dan `leakage` mengembalikan `transition: null` — perilaku yang diharapkan, bukan bug.
- **`deltaPp` dihitung dari nilai yang sudah dibulatkan 4 desimal**, jadi bisa berbeda < 0,01pp dari perhitungan atas nilai mentah. Test memakai aturan ini.
- **`estimatedGap` dihitung untuk semua pasangan**, tetapi caption `"≈{n} chat hilang"` hanya dipakai `leakage` (kanal `wa`). Belum ada caption untuk pasangan web karena belum ada spesifikasi produknya.
- **`stageKey` tidak dikenal → 400, bukan 404**: parameter query yang salah, bukan resource yang hilang.
