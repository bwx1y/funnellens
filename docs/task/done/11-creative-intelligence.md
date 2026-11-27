# DONE: Creative Intelligence & Fatigue Detection

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 171 pass / 0 fail / 25 file).
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/shared/creative.ts` (baru)
  - `src/infra/database/repositories/analytics.repository.ts`
  - `src/infra/database/repositories/ad-creative.repository.ts`
  - `src/infra/database/repositories/sync-run.repository.ts`
  - `src/infra/database/repositories/meta-connection.repository.ts`
  - `src/infra/meta/types.ts`, `src/infra/meta/base.meta.ts`, `src/infra/meta/adapters/facebook-sdk.adapter.ts`
  - `src/modules/creative/service.ts` (baru), `schema.ts` (baru), `index.ts` (baru), `queue.ts` (baru), `worker.ts` (baru)
  - `src/routes.ts`
  - `tests/unit/creative-helpers.test.ts` (baru), `tests/unit/creative-tagging-worker.test.ts` (baru), `tests/unit/facebook-sdk-ad-studies.test.ts` (baru)
  - `tests/integration/analytics-creative.test.ts` (baru), `tests/integration/analytics-repositories.test.ts`

## Ruang Lingkup
Sembilan endpoint di prefix `/api/analytics/creatives`: peringkat kreatif dengan empat dimensi bergerbang + status (`GET /`), kejenuhan (`/fatigue`), pola atribut (`/patterns`), kualitas lead per kreatif (`/lead-quality`), ketersediaan studi A/B Meta (`/experiments`), perbandingan per snapshot (`POST /comparisons`), detail kreatif (`GET /:id`), dan tagging manual/AI (`POST /:id/tags`, `DELETE /:id/tags/:tagId`, `POST /:id/tags/ai`).

Tidak ada skor gabungan kreatif di mana pun: setiap angka adalah rasio mentah atau persentil cohort akun, uang selalu `*_minor`, dan angka tak terukur dikembalikan `null` + `note`.

## Implementasi

### 1. Helper bersama (`src/shared/creative.ts`)
| Kelompok | Isi |
|---|---|
| Persentil | `percentileRank` (midrank `(below + 0.5 × equal) / n`, 4 desimal, `null` bila cohort < 5), `dimensionLabel` (≥ 0.7 kuat, ≥ 0.3 rata-rata, sisanya lemah) |
| Empat dimensi | `costDimension` (persentil dibalik; gerbang 10 hasil indikatif / 50 terukur), `attentionDimension` (3.000 / 5.000 tayangan), `qualityDimension` (10 / 20 sampel), `healthDimension` (7 / 14 hari + `ctrDrop`) |
| Status | `overallStatus(input)` — objek 7 field; urutan: semua `kurang` → `Belum cukup data`, `fatigued` → `Pertimbangkan dihentikan`, tiga `lemah` → `Pertimbangkan dihentikan`, `mature` + cost/attention `kuat` → `Winner`, sisanya `Pantau`; `allocationLimited` menurunkan `Winner`/`Pertimbangkan dihentikan` ke `Pantau` + `note` |
| Kejenuhan | `fatigue(base, now, consecutiveDays, complete, confounded)`, `aggregateWindow`, `trailingCtrDeclineDays`, `trendDrop` |
| Statistik | `mannWhitneyU` (koreksi tie, aproksimasi normal, kontinuitas 0,5, `erf` Abramowitz-Stegun 7.1.26), `benjaminiHochberg` (satu koreksi lintas baris), `costPattern` (8 kreatif total, 3 per sisi) |
| Konten | `CONTENT_ELEMENTS` (7), `contentElementStatuses` (kata kunci deterministik + `\b(rp\|idr)\b`), `contentCompleteness` (`null` bila ada `tak_teramati`) |
| Lain | `experimentState`, konstanta `MIN_COMPARATORS`/`PATTERN_MIN_CREATIVES`/`PATTERN_MIN_PER_SIDE`/`PATTERN_Q` |

### 2. Repository
| Method | Isi |
|---|---|
| `AnalyticsRepository.getCreativeAggregates` | tambah `clicks` (total klik, dasar CTR kreatif) |
| `AnalyticsRepository.getCreativeDailySeries` (baru) | satu round trip untuk seluruh cohort: `group by creative_id, date`, dipetakan ke `CreativeDailyPoint` (`clicks`, `reach` ikut) |
| `AnalyticsRepository.getCreativeDaily` | kini delegasi ke `getCreativeDailySeries(...).find(...)`; perilaku tetap |
| `AnalyticsRepository.getCreativeAllocation` (baru) | `distinct creative_id, adset_id, daily_budget_minor, effective_status` untuk gerbang alokasi |
| `AnalyticsRepository.getCreativeVideoMetrics` (baru) | `sum()` tanpa `coalesce` pada lima kolom video: `null` = tidak terukur, `0` = terukur nol |
| `AdCreativeRepository.findById` / `findByIdForTenant` (baru) | lookup polos untuk worker, lookup ber-scope tenant untuk route |
| `AdCreativeRepository.eligibleByIds` | parameter ketiga opsional `{since, until}` — snapshot diverifikasi lewat jendela `ad_insights_daily` |
| `SyncRunRepository.findById`, `MetaConnectionRepository.findByTenantId` (baru) | snapshot per id; token Meta terbaru per tenant |

### 3. Adapter Meta
`MetaAdStudyDto` di `types.ts`; `IMetaAdStudiesAdapter` di `base.meta.ts` sengaja terpisah dari `IMetaAdsAdapter` (tiga double di unit test mengimplementasikan interface itu). `FacebookSdkAdapter` mengimplementasikan keduanya: `User(metaUserId).getAdStudies(fields, {limit:100})` via `fetchAllSdk`; error izin (code 10/200/294 atau pesan memuat `permission`) → `{hasAccess: false, studies: []}`, error lain dilempar.

### 4. Service (`src/modules/creative/service.ts`)
Semua method memanggil `requireAccountScope` lebih dulu lalu `resolvePeriod`. `loadCohort` mengumpulkan agregat, kualitas lead, alokasi, salinan kreatif, dan deret harian (mulai `min(firstSeen)` agar baseline tidak terpotong periode) dalam satu `Promise.all`; persentil selalu dari cohort akun, bukan dari baris hasil filter campaign.

- **`listCreatives`** — `campaignId` hanya memfilter baris (persentil tetap akun); `sortBy` default `spend`, `costPerResult` menaik, `null` selalu di akhir, seri → `creativeId` menaik.
- **`getFatigue`** — baseline 7 hari pertama setelah `firstSeen`, `now` = 3 titik terakhir, `complete` = semua tanggal `firstSeen..period.until` ada, `confounded` = CPM kini lebih murah, `nextCheck` hanya untuk `Waspada`/`Jenuh`.
- **`getPatterns`** — `withAttr`/`withoutAttr` dari cohort akun; BH satu kali untuk seluruh baris; `state` jadi `eligible_for_test` hanya bila signifikan.
- **`getLeadQuality`** — `hotRate` hanya bila `assessedMatureLeads ≥ 10`; status elemen konten dari salinan kreatif (`title`/`body`/`callToActionType`).
- **`compareCreatives`** — snapshot harus `SUCCESS` + `insights` + rentang terisi + milik akun; semua ID harus punya baris insight pada jendela itu; tab `wa` lalu `web`, `canCompare = items.length ≥ 2`, `evidenceType: "observational"`.
- **`getExperiments`** — tanpa koneksi → `permission_missing` + `note`; kegagalan izin Graph bukan 500.
- **`getCreativeDetail`** — baris agregat dengan `spendMinor` terbesar; metrik video tidak memengaruhi status; `note` menggabungkan catatan video dan daftar dimensi bergerbang.
- **`addTag`/`removeTag`/`queueAiTags`** — semua ber-scope tenant (`NotFoundError("Kreatif tidak ditemukan")`), `deleteTag` gagal → `NotFoundError("Tag tidak ditemukan")`.

### 5. Endpoint & worker
`CreativeController` (`prefix /analytics/creatives`) dipasang setelah `LeadController`; rute statis didaftarkan sebelum `/:id`. `CreativeTaggingQueue` (`creative-tagging`, attempts 3, backoff eksponensial 5s) dan `CreativeTaggingWorkerProcessor` yang memakai `GeminiAdapter.generateObject` dengan skema empat `tagType`; nilai kosong dilewati, confidence dijepit 0..1 lalu `toFixed(4)`; kreatif hilang → `logger.warn` tanpa retry; kegagalan model diteruskan agar BullMQ retry.

## Testing

| Assertion | Nilai |
|---|---|
| `listCreatives` jumlah & baris `cr1` | 8 baris; `spendMinor 60000`, `results 14`, `ctr 0.02`, `costPerResultMinor 4286`, `objectiveGroup "wa"` (3 ad → 1 baris) |
| `listCreatives` dimensi | `cost {kuat, indikatif}`, `attention.label "rata-rata"`, `status "Pantau"` |
| `listCreatives` kejenuhan & urutan | `crf` `fatigued true`, `status "Pertimbangkan dihentikan"`, `creatives[0] = crf` (sort `spend`) |
| `listCreatives` sampel & alokasi | `sample {8, 5, true, "≥ 5 kreatif"}`; `cr5.allocationLimited true` (ad set `PAUSED`), `cr1 false` |
| `listCreatives sortBy costPerResult` | `creatives[0]` = `cr5`, `costPerResultMinor 3000` |
| `getCreativeDetail(cr1)` | `metrics.ctr 0.02`, `costPerResultMinor 4286`, `daily.length 1`, `sample {3000, 3000, true, "≥ 3.000 tayangan"}`, `video.hookRate null`, `note` memuat `"Metrik video belum tersedia"` |
| `getCreativeDetail` kreatif tenant lain | `NotFoundError("Kreatif tidak ditemukan")` |
| `getFatigue crf` | `Jenuh`, `drop 0.2963`, `frequency {2, 2.5}`, `consecutiveDays 5`, `complete true`, `confounded false`, `nextCheck "2026-03-13"` |
| `getFatigue cr1` | `Belum cukup data` + `note "Rentang pengamatan belum lengkap sehingga kejenuhan belum bisa dinilai."` |
| `getPatterns hook_type/question` | `insufficient_sample`, `withCount 2`, `pValue null` |
| `getPatterns format/video` | `state ≠ insufficient_sample`, `withCount 4`, `withoutCount 4`, `pValue !== null` |
| `getPatterns` sampel | `{8, 8, true, "≥ 8 kreatif"}`, `tested ≥ 1`, `note` undefined |
| `getLeadQuality cr1` | `costPerConversationMinor 4286`, `hotLeads 3`, `assessedMatureLeads 12`, `hotRate 0.25`, `completeness 0.5714`, `messageEvidence {4, 7, 7}`, `cta "hadir"`, `target "absen"` |
| `getLeadQuality cr5 / cr3` | `completeness null` + `note "Elemen konten kreatif tidak teramati."` / `hotRate null` + `note "Lead matang belum mencapai 10 sehingga hot rate belum diukur."` |
| `compareCreatives([cr1, crw])` | dua tab `wa`/`web`, masing-masing 1 item, `canCompare false`, `evidenceType "observational"`, `snapshotId` sama |
| `compareCreatives([cr1, cr3])` | satu tab `wa`, 2 item, `canCompare true` |
| `compareCreatives` snapshot/ID invalid | `BadRequestError("Pilihan kreatif tidak tersedia pada snapshot ini")` |
| `getExperiments` | tanpa koneksi → `permission_missing` + `"Koneksi Meta belum tersedia."`; stub `hasAccess true` + hasil → `results_available`, `studies[0].hasResult true`; `hasAccess false` → `"Izin Meta belum mencakup ad studies."` |
| `addTag`/`removeTag`/`queueAiTags` | `addTag` → `source "manual"`; `removeTag` → `{deleted: true}`; kedua kali → `NotFoundError("Tag tidak ditemukan")`; kreatif tenant lain → `NotFoundError("Kreatif tidak ditemukan")`; `queueAiTags` → `{jobId: "tag:<id>:ai", queued: true}` |
| route smoke | 6 GET + `POST /comparisons` + `POST /:id/tags` + `POST /:id/tags/ai` + `DELETE /:id/tags/:tagId` semuanya `200`; `GET /fatigue` mengembalikan `creatives` (bukan detail kreatif) |
| isolasi tenant | `GET /api/analytics/creatives?accountId=<akun tenant lain>` → `404 {status: false, message: "Akun iklan tidak ditemukan"}` |

Hasil verifikasi:

| Perintah | Hasil |
|---|---|
| `bunx tsc --noEmit` | 0 error |
| `bun test tests/unit/creative-helpers.test.ts` | 24 pass |
| `bun test tests/unit/creative-tagging-worker.test.ts tests/unit/facebook-sdk-ad-studies.test.ts` | 6 pass |
| `bun test tests/integration/analytics-creative.test.ts` | 12 pass |
| `bun test tests/integration/analytics-repositories.test.ts` | 17 pass (ekspektasi `clicks`/`reach` diperbarui) |
| `bun test` | 171 pass / 0 fail / 25 file |

## Catatan Teknis
- **Gerbang biaya indikatif = 10 hasil.** `docs/task/todo/06` menyebut 15 hasil, tetapi uji selesainya menuntut kreatif 14 hasil berstatus `indikatif`; 14 < 15. `terukur` tetap 50. Ubah satu perbandingan di `costDimension` bila produk menetapkan 15.
- **Tidak ada skor.** Status hanya dari urutan aturan `overallStatus`; persentil selalu cohort akun sehingga filter `campaignId` tidak menggeser label.
- **`complete` dihitung terhadap `period.until`.** Kreatif yang hanya tayang satu hari dalam periode 12 hari tetap `Belum cukup data` — jendela pengamatan yang tidak lengkap tidak boleh menghasilkan `Sehat`.
- **Elemen konten dibaca dari salinan kreatif**, bukan dari chat lead; `tak_teramati` berarti salinan untuk elemen itu tidak ada, dan job `creative-tagging` hanya menulis empat `tagType`.
- **Snapshot = `sync_runs`.** `ad_insights_daily` tidak punya kolom snapshot, jadi baris insight diverifikasi lewat `range_since..range_until`; snapshot tanpa rentang dianggap tidak tersedia.
- **`jobId` = `tag:<creativeId>:ai`.** BullMQ menolak custom id yang memuat `:` kecuali tepat tiga segmen, sehingga bentuk dua segmen gagal saat enqueue.
- **`IMetaAdStudiesAdapter` terpisah dari `IMetaAdsAdapter`** agar tiga double di unit test lama tidak perlu diubah.
- **Rute statis sebelum `/:id`.** `GET /creatives/fatigue` diverifikasi mengembalikan `creatives`, bukan detail kreatif.
