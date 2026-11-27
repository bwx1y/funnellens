# DONE: Tracking Health & CAPI Monitoring

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 191 pass / 0 fail / 29 file).
- **Tanggal Selesai**: 2026-11-22
- **File Terkait**:
  - `src/shared/tracking.ts` (baru)
  - `src/infra/meta/types.ts`, `src/infra/meta/base.meta.ts`, `src/infra/meta/adapters/facebook-sdk.adapter.ts`
  - `src/infra/database/repositories/tracking-health.repository.ts`, `insight-alert.repository.ts`
  - `src/modules/meta/pixel-stats.service.ts` (baru), `queue.ts`, `worker.ts`, `schema.ts`, `index.ts`
  - `src/modules/tracking-health/service.ts` (baru), `schema.ts` (baru), `index.ts` (baru)
  - `src/routes.ts`
  - `tests/unit/tracking-helpers.test.ts` (baru), `tests/unit/facebook-sdk-pixel.test.ts` (baru), `tests/unit/meta-pixel-stats-sync.test.ts` (baru)
  - `tests/integration/tracking-health.test.ts` (baru), `tests/integration/repositories.test.ts`

## Ruang Lingkup
Satu endpoint baca `GET /api/tracking-health?accountId=` dengan kartu Meta Pixel, CAPI, EMQ, tabel enam event browser-vs-server, dan blok `sample`. Satu penulis tabel (`pixel_sources`, `tracking_health_daily`, alert `tracking_emq`): job `sync-pixel-stats` di queue `meta-sync`, dipicu `POST /api/meta/queue/sync-pixels` atau scheduler harian `30 1 * * *`.

Angka tak terukur selalu `null` + `note` (tidak pernah `0` pengganti), tidak ada klaim penyebab — hanya `nextCheck`.

## Implementasi

### 1. Helper bersama (`src/shared/tracking.ts`)
| Kelompok | Isi |
|---|---|
| Konstanta | `EVENT_NAMES` (urutan kolom tabel), `EMQ_KEY_EVENTS` (`Lead`, `Purchase`), `EMQ_SCALE 10`, `EMQ_THRESHOLD 6`, `EMQ_CRITICAL 4`, `DEDUP_TARGET 0.9`, `DEDUP_WARNING 0.9`, `DEDUP_CRITICAL 0.8`, `DEDUP_ALERT_THRESHOLD 0.85`, `EVENT_SAMPLE_DENOMINATOR 100`, `EVENT_GATE "≥ 100 event"` |
| Rasio | `dedupRate` (`1 - duplicate / (browser + server)`, 4 desimal), `browserShare` (4 desimal); keduanya `null` bila ada input `null` atau penyebut 0 |
| Status | `eventStatus` (aturan pertama menang: EMQ < 4 atau dedup < 0.8 → `Bermasalah`; EMQ < 6 atau dedup < 0.9 → `Perlu optimalisasi`; sisanya `Sehat`), `emqStatus` (dari rata-rata 0–10 saja) |
| Match key | `missingMatchKeys` (banding case-insensitive terhadap `ph`/`em`; daftar kosong/`null` → `[]`, tidak ada klaim) |
| Alert & urutan | `trackingAlertNeeded` (EMQ < 6 atau dedup < 0.85), `orderEventNames` (kanonik lalu abjad, input tidak dimutasi) |

### 2. Adapter Meta
`MetaAdPixelDto` + `MetaPixelStatsRowDto` di `types.ts`. `IMetaPixelAdapter` di `base.meta.ts` sengaja terpisah dari `IMetaAdsAdapter` (tiga double unit test lama mengimplementasikan interface itu). `FacebookSdkAdapter` kini mengimplementasikan tiga interface:

| Method | Isi |
|---|---|
| `getAdPixels` | `AdAccount(act_…).getAdsPixels(["id","name","code","last_fired_time","automatic_matching_fields"], {limit:100})` via `fetchAllSdk`; `last_fired_time` tak valid → `null`; `automatic_matching_fields` non-array → `[]` |
| `getPixelStats` | `AdsPixel(id).getStats(["data"], {aggregation:"event", start_time, end_time})`; baris tanpa nama event dilewati; hitungan dibaca lewat `pickNumber` (menerima angka maupun string numerik) sehingga kunci yang tidak dilaporkan tetap `null` |
| `isPermissionError` | diperluas: `status`/`response.status` `403` → izin kurang. Berlaku juga untuk `getAdStudies` (403 = izin kurang, perilaku tetap benar) |

### 3. Repository
| Method | Isi |
|---|---|
| `TrackingHealthRepository` | literal status diseragamkan ke `"Perlu optimalisasi"` pada union `TrackingHealthSummary.status`, `STATUS_RANK`, dan `STATUS_BY_RANK` |
| `InsightAlertRepository.upsert` (baru) | idempoten pada `(account_id, rule_key, entity_id)`; set blok me-reset `status: "ACTIVE"`, `snoozedUntil: null`, `resolvedAt: null` sehingga alert yang muncul lagi terbuka kembali |
| `InsightAlertRepository.resolveByRuleKey` (baru) | menutup alert rule yang kondisinya tidak lagi terpenuhi (`status "DONE"`, `resolvedAt`), `returning({id})` → jumlah baris |

### 4. Service sinkron (`src/modules/meta/pixel-stats.service.ts`)
Ditempatkan di modul `meta` (pemilik adapter Graph) agar tidak ada impor lintas modul. Urutan: `findById(accountId, tenantId)` → `NotFoundError`; `findByTenantId(tenantId)` → `UnauthorizedError` (pesan disalin dari `syncMaster`); cek `expiresAt`; `date = todayInZone(account.timezoneName)`; `syncRunRepo.create({resource:"pixels"})`; seluruh sisa langkah di dalam `try` dengan `fail()` di `catch`.

- `getAdPixels` → `hasAccess false`: `logger.warn` + `complete(syncRun, 0)` + return `{pixelCount: 0, eventCount: 0}` tanpa menulis apa pun.
- Akumulator lintas pixel per `eventName` (tabel tidak punya kolom pixel): `null + angka = angka`, `null + null = null`; `emq` dikumpulkan per baris.
- `pixel_sources.upsert`: `id = "{accountId}:{pixelId}"`, `capiConfigured = available && ada serverCount > 0`, `emqAvg` = rata-rata EMQ event kunci pixel itu (`toFixed(2)`).
- `tracking_health_daily.upsertDaily`: `dedupRate` `toFixed(6)`, `matchQuality` `toFixed(2)`, `status` dari `eventStatus`, `raw` = payload baris pertama event itu.
- Alert `tracking_emq`: `trackingAlertNeeded(mean(emq), mean(rates))` → `upsert` (`WARNING`, `entityType "account"`, `entityId ""`, `route "/tracking-health"`, `evidence {emqAvg, dedupRate, date}`); selain itu `resolveByRuleKey`.

### 5. Queue, worker, pemicu HTTP
- `MetaSyncJobName` + `"sync-pixel-stats"`; `scheduleCronJobs()` menambah scheduler `30 1 * * *`.
- `MetaSyncWorkerProcessor` menerima parameter ke-4 `pixelStatsService` (default, pemanggil 3 argumen tetap valid) dan cabang `handlePixelStatsSync` yang memakai `resolveSyncTargets`.
- `POST /api/meta/queue/sync-pixels` (body opsional `{accountId}`) menambahkan job ke queue `meta-sync`.

### 6. Endpoint baca (`src/modules/tracking-health/`)
`getTrackingHealth` memanggil `requireAccountScope` lebih dulu, lalu `Promise.all([pixelSourceRepo.findByAccountId, trackingHealthRepo.getLatestStatus])`.

| Blok | Isi |
|---|---|
| `pixel` | pixel dengan `lastEventAt` terbaru (seri → `pixelId` menaik); `connected`/`pixelId`/`name`/`lastSeenAt`/`browserShare` (dari total akun) + `note` bila belum tersinkron atau porsi tidak tersedia |
| `capi` | `connected` = `capiConfigured`, `dedupRate` = mean dedup event (4 desimal), `target 0.9` + `note` |
| `emq` | `average` dari `keyEvents` (`Lead`, `Purchase`), `scale 10`, `threshold 6`, `status` dari `emqStatus` + `note` bila kosong |
| `events` | diurutkan `orderEventNames`; `status` dihitung ulang saat baca dengan `eventStatus` yang sama dengan job; `nextCheck` hanya untuk `Lead` bila `raw.automaticMatchingFields` tidak memuat `ph`/`em`; `note` per baris untuk nilai `null` |
| `sample` | `n = browserCount + serverCount` (0 bila belum ada tanggal), `denominator 100`, `eligible = n ≥ 100`, `gate "≥ 100 event"` |

`TrackingHealthController` (`prefix /tracking-health`) dipasang setelah `CreativeController`.

## Testing

| Assertion | Nilai |
|---|---|
| `dedupRate(100, 80, 60)` / `(100, 80, null)` / `(0, 0, 0)` / `(null, 80, 60)` | `0.6667` / `null` / `null` / `null` |
| `browserShare(100, 80)` / `(0, 0)` | `0.5556` / `null` |
| `eventStatus` | `{0.98, 7.5}` → `Sehat`; `{0.9, 5.8}` → `Perlu optimalisasi`; `{0.7, 8}` → `Bermasalah`; `{null, null}` → `null` |
| `emqStatus` | `5.8` → `Perlu optimalisasi`; `6` → `Sehat`; `3.9` → `Bermasalah`; `null` → `null` |
| `missingMatchKeys` | `["em","fn"]` → `["ph"]`; `null` → `[]`; `["PH","em"]` → `[]` |
| `trackingAlertNeeded` | `(5.8, 0.95)` true; `(6, 0.9)` false; `(6.1, 0.8)` true; `(null, null)` false |
| `orderEventNames(["Zeta","Lead","PageView","Alpha"])` | `["PageView","Lead","Alpha","Zeta"]`; input tidak berubah |
| `getAdPixels` | `hasAccess true`; `px1` terpetakan (`lastFiredTime` = `Date`, `automaticMatchingFields ["em","ph"]`); baris tanpa field → `null`/`[]` |
| `getPixelStats` | baris `Lead` → `100/80/60/5.8`; baris `{value:"PageView"}` → semua `null` |
| `getPixelStats` error | `{status:403}` → `{hasAccess:false, rows:[]}`; `{code:1}` → dilempar |
| sync happy path | `upsertDaily` menerima `dedupRate "0.666700"`, `matchQuality "5.80"`, `status "Bermasalah"`; `pixel_sources` `id "act_x:px1"`, `capiConfigured true`, `emqAvg "5.80"`; alert `tracking_emq` `WARNING`; `complete(7, 1)` |
| sync 403 | `upsertDaily` tidak dipanggil; `capiConfigured false`, `emqAvg null`; `resolveByRuleKey("act_x","tracking_emq")` |
| sync sehat | `alertRepo.upsert` tidak dipanggil, `resolveByRuleKey` dipanggil |
| sync koneksi/akun hilang | `UnauthorizedError("Meta connection not found…")` / `NotFoundError("Akun iklan tidak ditemukan")`, `fail()` tidak dipanggil |
| integrasi `sync` | `pixelCount 1`, `eventCount 2`; `pixel_sources` `capiConfigured true`, `emqAvg "5.80"`, `raw.automaticMatchingFields ["em"]`; `Lead` `dedupRate "0.666700"`, `status "Bermasalah"` |
| integrasi alert | satu baris `tracking_emq` `WARNING`/`ACTIVE`/`entityId ""` walau `sync` dijalankan dua kali |
| `getTrackingHealth` pixel | `connected true`, `pixelId px_*`, `lastSeenAt "2026-03-02T10:00:00.000Z"`, `browserShare 0.5357` |
| `getTrackingHealth` capi | `connected true`, `dedupRate ≈ 0.807`, `target 0.9`, tanpa `note` |
| `getTrackingHealth` emq | `average 5.8`, `status "Perlu optimalisasi"`, `scale 10`, `threshold 6`, `keyEvents [{Lead,5.8},{Purchase,null}]` |
| `getTrackingHealth` events | `events[0].eventName "PageView"`; `Lead` `dedupRate 0.6667`, `matchQuality 5.8`, `status "Bermasalah"`, `nextCheck "Lengkapi parameter ph pada event Lead."`; `PageView.nextCheck null` |
| `getTrackingHealth` sample/note | `{n 560, denominator 100, eligible true, gate "≥ 100 event"}`, `note` undefined |
| akun tanpa pixel | `pixel {null…, note "Pixel Meta belum tersinkron untuk akun ini."}`, `capi.connected null` + note, `emq.average null` + note, `events []`, `note "Statistik event tidak tersedia untuk akun ini."`, `sample.n 0` — tidak ada `0` pengganti pada metrik |
| akun stats 403 | `pixel_sources` ada (`capiConfigured false`, `emqAvg null`); tidak ada baris `tracking_health_daily`; endpoint: `pixel.connected true`, `capi.connected false`, `capi.dedupRate null` + note, `events []` + note |
| route smoke / isolasi | `GET /api/tracking-health?accountId=<akun>` → `200` dengan 2 event; akun tenant lain → `404 {status:false, message:"Akun iklan tidak ditemukan"}` |
| `repositories.test.ts` | lulus dengan literal `"Perlu optimalisasi"` (ringkasan tetap `"Bermasalah"` dari baris terburuk) |

Hasil verifikasi:

| Perintah | Hasil |
|---|---|
| `bunx tsc --noEmit` | 0 error |
| `bun test tests/unit/tracking-helpers.test.ts` | 7 pass |
| `bun test tests/unit/facebook-sdk-pixel.test.ts` | 4 pass |
| `bun test tests/unit/meta-pixel-stats-sync.test.ts` | 4 pass |
| `bun test tests/integration/tracking-health.test.ts` | 5 pass |
| `bun test tests/integration/repositories.test.ts` | 10 pass |
| `bun test` | 191 pass / 0 fail / 29 file |

## Catatan Teknis
- **Literal status kanonik = `"Perlu optimalisasi"`.** Sebelum tugas ini repository memakai `"Perlu Optimalisasi"` (huruf O besar); karena belum ada penulis sama sekali, tidak ada data lama yang perlu dimigrasikan.
- **Sumber hitungan browser/server = payload `aggregation: "event"`.** Meta hanya melaporkan pemisahan itu pada pixel dengan lalu lintas CAPI; kunci yang tidak ada dipetakan `null` lewat `pickNumber`, sehingga tabel jujur menampilkan "tidak tersedia". Bila payload produksi memakai nama kunci lain, cukup tambah di picker `getPixelStats` (satu tempat).
- **`nextCheck` ph/em dibaca dari `automatic_matching_fields` pixel** (`pixel_sources.raw`). Bila field tidak tersedia → `nextCheck: null`; tidak ada klaim penyebab.
- **Cron `sync-pixel-stats` disiapkan tetapi belum berjalan sendiri** karena `scheduleCronJobs()` belum dipanggil di `src/index.ts`. Pemicu yang bekerja sekarang: `POST /api/meta/queue/sync-pixels`. Mengaktifkan scheduler akan menyalakan tiga scheduler lain sekaligus (tugas 05), jadi di luar lingkup.
- **Alert ditulis oleh job, bukan endpoint baca**, agar aturan "satu penulis" tetap utuh; tugas 08 memakai `InsightAlertRepository.upsert` yang sama dan idempoten pada `(account_id, rule_key, entity_id)`.
- **`date` = hari ini di zona akun** (`todayInZone`), satu jendela harian per run; tidak ada backfill karena tabel unik per `(account, date, event_name)`.
- **Dua pixel yang melaporkan event sama dijumlahkan**, bukan saling menimpa, karena `tracking_health_daily` tidak punya kolom pixel.
- **403 diperlakukan sebagai izin kurang** pada `isPermissionError`, karena `/{pixel_id}/stats` menolak dengan HTTP 403 tanpa kode Graph.
