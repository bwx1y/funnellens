# DONE: Overview & Summary Analytics (`GET /api/analytics/summary`)

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 87 pass / 0 fail / 17 file).
- **Tanggal Selesai**: 2026-11-22
- **File Terkait**:
  - `src/shared/dates.ts` (baru)
  - `src/shared/health.ts` (baru)
  - `src/modules/analytics/schema.ts`, `src/modules/analytics/service.ts`, `src/modules/analytics/index.ts` (baru)
  - `src/infra/database/repositories/ad-account.repository.ts`
  - `src/infra/database/repositories/analytics.repository.ts`
  - `src/infra/database/repositories/ad-insight-daily.repository.ts`
  - `src/infra/database/repositories/lead.repository.ts`
  - `src/routes.ts`
  - `tests/unit/funnel-health.test.ts` (baru), `tests/integration/analytics-summary.test.ts` (baru)
  - `tests/integration/analytics-repositories.test.ts`, `tests/integration/repositories.test.ts`

## Ruang Lingkup
Halaman ikhtisar butuh satu endpoint yang merangkum lima kartu KPI (belanja, lead, CPL qualified, ROAS, funnel health) lengkap dengan delta periode sebelumnya dan sparkline 7 titik, panel kesehatan berbobot 40/30/30, time-series harian periode kini vs sebelumnya, lima hot lead tanpa balasan, tiga baris ringkasan, dan tabel performa campaign. Sebelum pekerjaan ini tidak ada modul `analytics/`, tidak ada guard `requireAccountScope`, tidak ada `funnelHealth()`, dan tidak ada helper tanggal.

## Implementasi

### 1. Helper tanggal murni (`src/shared/dates.ts`)
`toDateString`, `startOfDayUtc`, `endOfDayUtc`, `addDays`, `dayCount` (inklusif), `todayInZone`, `bucketIndex`. `todayInZone` memakai `Intl.DateTimeFormat("en-CA", {timeZone})`; nama zona tidak valid dari Meta jatuh ke tanggal UTC alih-alih melempar 500. `bucketIndex` memetakan tanggal ke salah satu dari 7 slot sparkline: `min(6, max(0, floor(dayDiff × 7 / days)))`.

### 2. Skor kesehatan (`src/shared/health.ts`)
`funnelHealth({conversion, baseline, onTimeReplyShare, emq, dedup})` mengembalikan `{score, badge, components, note?}` dengan komponen tetap 3 dan bobot tetap 40/30/30:

| Komponen | Skor |
|---|---|
| Konversi funnel | `clamp(100 × conversion / baseline)`; `null` bila baseline 0/`null` |
| Kecepatan balas | `clamp(onTimeReplyShare × 100)` |
| Kualitas tracking | rata-rata `clamp(emq × 10)` dan `clamp(dedup × 100)`; satu sisi saja dipakai apa adanya |

Komponen berskor `null` dikeluarkan dan bobot dinormalkan ulang; bila tersisa `< 2` → `{score: null, badge: null, note: "Komponen pengukuran belum cukup"}`. Agregat memakai nilai yang sudah dibulatkan 2 desimal, lalu `Math.round(Σ(w × skor) / Σw)`. Badge `≥ 80 "Prima"`, `60–79 "Perlu perhatian"`, `< 60 "Kritis"`.

### 3. Guard akun (`ad-account.repository.ts`)
`requireAccountScope(tenantId, accountId)` memanggil `findById(accountId, tenantId)` dan melempar `NotFoundError("Akun iklan tidak ditemukan")` bila akun tidak ada atau milik tenant lain. Tipe `AdAccount` diekspor dari file yang sama.

### 4. Perluasan repository

| Method | Perubahan |
|---|---|
| `AnalyticsRepository.getFunnelCounts` | tambah `spendMinor` dan `results` (`coalesce(sum(i.results), 0)` dari view) |
| `AdInsightDailyRepository.getDailyTrend` | tambah `purchaseValueMinor` per hari (pembilang sparkline ROAS) |
| `AnalyticsRepository.getDailyQualifiedLeads` | baru: lead dan qualified per tanggal UTC, `group by 1` |
| `AnalyticsRepository.getCampaignLeadMetrics` | baru: lead teratribusi dan subset HOT per campaign, join milestone dibatasi periode |
| `LeadRepository.getReplyTimeliness` | baru: `totalLeads` + `onTimeReplies` (`first_replied_at − first_seen_at ≤ 15 menit`) |
| `LeadRepository.countUnrepliedHotLeads` | baru: `count(*)`; `getUnrepliedHotLeads` dibatasi satu halaman sehingga tidak boleh dihitung |

### 5. Endpoint
`AnalyticsController` (`prefix: "/analytics"`, tag `Analytics`, `bearerAuth`) men-dekorasi `analyticsService` dan memasang `JwtUtil.isAuthenticated`; `GET /summary` divalidasi `AnalyticsSchema.summary` (`accountId` wajib, `since`/`until` pola `YYYY-MM-DD`, `campaignId` opsional). Controller dipasang di `src/routes.ts` setelah `MetaController`.

`AnalyticsService.getSummary` menjalankan satu `Promise.all` berisi 15 query (funnel kini/lalu, stage kini/lalu, tren kini/lalu, lead qualified harian, ketepatan balas, tracking, hot lead + hitungannya, alert aktif, performa campaign, daftar campaign, metrik lead per campaign). Setelah itu:

- **Periode**: `until` default hari ini di zona akun, `since` default `until − 29 hari`; `since > until` → `BadRequestError("Rentang tanggal tidak valid")`. Periode sebelumnya sama panjang dan berakhir `since − 1`.
- **Kartu**: nilai `null` selalu disertai `note`; delta `null` (pembanding nol) juga disertai `note`. Urutan catatan: nilai dulu, baru delta.
- **Sparkline**: 7 bucket untuk belanja, lead, CPL qualified, dan ROAS; kartu `funnelHealth` memakai `sparkline: null` + catatan karena delta skor belum punya baseline historis.
- **Health**: `conversion = results / inline_link_clicks`, `baseline` dari periode sebelumnya, `onTimeReplyShare` dari `getReplyTimeliness`, `emq`/`dedup` dari `tracking_health_daily` terbaru.
- **Ringkasan**: kebocoran = jumlah `insight_alerts` `ACTIVE` dengan `rule_key` berawalan `leak_`; hot lead menunggu = `countUnrepliedHotLeads` (akun, bukan periode); kreatif winner = `null` + catatan `"Status kreatif belum tersedia"` (engine empat dimensi adalah tugas 06).
- **Tabel campaign**: baris dari `getCampaignPerformance` (urut belanja menurun), `status` dari tabel `campaigns`, `hotLeadRate = hotLeads / attributedLeads` dibulatkan 4 desimal, `null` + catatan bila tidak ada lead teratribusi. Filter `campaignId` juga menyaring tabel ini.

## Testing

`tests/unit/funnel-health.test.ts` — 5 kasus murni tanpa DB: bobot 40/30/30 (skor 70, badge `Perlu perhatian`), normalisasi bobot saat baseline hilang (skor 83, `Prima`), `score: null` saat komponen tersisa satu, tracking tunggal dari `dedup` saja, dan penjepitan konversi di 100.

`tests/integration/analytics-summary.test.ts` — 4 test terhadap DB nyata. Fixture: tenant + akun `Asia/Jakarta`/`IDR`, campaign `ACTIVE`, adset `objective_group 'wa'`, 2 ad, insight `2026-03-01` (belanja 100000, tayangan 1000, klik 40, `lead` 5, `purchase` 1 nilai 300000), `2026-03-02` (belanja 50000, tayangan 500, `lead` 2), dan `2026-02-20` (belanja 80000, klik 20, `lead` 4) sebagai periode sebelumnya; tiga lead (HOT tanpa balasan dengan assessment `0.9000`; QUALIFIED dibalas 5 menit; CLOSED dibalas 60 menit), satu milestone HOT, satu baris `tracking_health_daily` (EMQ 8.00, dedup 0.90), dua alert `ACTIVE` (`leak_chat_to_reply`, `tracking_emq`).

Angka yang diuji:

| Assertion | Nilai |
|---|---|
| `cards.spend` | `150000`, delta `87.5` |
| `cards.leads` | `7`, delta `75` |
| `cards.cplQualified` | `150000` (150000 / 1 qualified) |
| `cards.roas` | `2` |
| `cards.funnelHealth` | `70`, badge `Perlu perhatian`, `deltaPct`/`sparkline` `null` |
| `health.components` | `87.5`, `33.33`, `85` (score 70 dari 70,499) |
| `series.current` / `series.previous` | 2 baris / 1 baris sesuai fixture |
| `campaigns[0]` | `hotLeadRate 0.3333`, `costPerLeadMinor 21429`, `roas 2`, `status ACTIVE` |
| akun tanpa data | `spend.value 0` + catatan, `health.score null` + `"Komponen pengukuran belum cukup"` |
| route smoke | `200`, body memuat `cards.spend` |
| akun tenant lain | `404`, `{status: false, message: "Akun iklan tidak ditemukan"}` |

Hasil verifikasi:

| Perintah | Hasil |
|---|---|
| `bunx tsc --noEmit` | 0 error |
| `bun test tests/unit/funnel-health.test.ts` | 5 pass |
| `bun test tests/integration/analytics-summary.test.ts` | 4 pass |
| `bun test tests/integration/analytics-repositories.test.ts` | 17 pass |
| `bun test tests/integration/repositories.test.ts` | 10 pass |
| `bun test` | 87 pass / 0 fail / 17 file |

## Catatan Teknis
- **`FunnelCounts` sebelumnya tanpa belanja.** Rencana mengasumsikan `spendMinor` dan `inlineLinkClicks` sudah ada; kenyataannya `getFunnelCounts` tidak mengembalikan belanja dan kolom klik bernama `linkClicks` (isinya `inline_link_clicks`). Karena itu `spendMinor` ditambahkan ke `FunnelCounts` (satu kolom view yang sudah di-`sum`, tanpa query tambahan) dan komponen konversi memakai `current.linkClicks`. Test `getFunnelCounts` ikut mendapat `spendMinor: 150000`.
- **Batas hari lead memakai UTC.** `first_seen_at`/`first_replied_at` adalah instant, jadi filter memakai `startOfDayUtc`/`endOfDayUtc`; `ad_insights_daily.date` sudah tanggal lokal akun sehingga tidak digeser. Bila kelak perlu batas hari lokal akun, ubah pemanggil di service, bukan repository.
- **`getReplyTimeliness` menyertakan lead tanpa balasan di penyebut** (mereka terlambat, bukan dikecualikan) agar rasionya sebanding dengan target 15 menit.
- **Jendela test 10 hari, bukan 2 hari.** `since`/`until` 2 hari akan menaruh periode sebelumnya di `2026-02-27..2026-02-28` dan mengeluarkan fixture `2026-02-20`; periode 10 hari (`2026-02-21..2026-03-02`) menempatkan `2026-02-20` di periode sebelumnya tanpa memasukkan baris lain.
- **Akun tanpa baris insight** mengembalikan kartu belanja/lead `0` (angka aditif yang benar-benar nol) dengan delta `null` + catatan, sedangkan skor kesehatan `null` — bukan `0`.
- **`campaigns[]` hanya memuat campaign yang punya baris insight pada periode**; campaign dengan insight tetapi tidak ada di tabel `campaigns` tampil dengan `status: null`.
