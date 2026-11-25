# TODO: Field Analitik yang Masih Kurang — KPI Channel, Tracking Warnings, Lead Analysis, Creative KPI, Pola Kreatif

## Gambaran Fitur
Beberapa respons analitik sudah ada tetapi kehilangan field yang dijanjikan checklist: KPI tidak sadar channel, `/tracking-health` tanpa `warnings[]` dan `data_freshness`, `lead_assessments` tanpa `topic`/`type`/`mood`/`quote`/`reply_minutes`/`prior_level`, `GET /analytics/creatives` tanpa blok KPI dan ringkasan campaign, dan `patterns` tanpa `supported`/`consistent`/`clear`. Task ini menutup F-08.2, F-11.1, F-11.2, F-12.1, F-12.2, F-15.1, F-17.2.

## Daftar Pekerjaan

### 1. KPI sadar channel (F-08.2)
- [ ] Tambah `applicable: boolean` pada `KpiCard` (`src/modules/analytics/service.ts`).
- [ ] Aturan di `getSummary`:
  - KPI percakapan (`leads`) hanya `applicable` bila scope memuat minimal satu ad set `objective_group = 'wa'`.
  - KPI pembelian/ROAS hanya `applicable` bila scope memuat `objective_group = 'web'`.
  - `cplQualified` hanya `applicable` bila scope memuat **satu** channel; dua channel → `applicable: false`, `value: null`, `note: "Biaya per hasil tidak sebanding lintas channel."`.
- [ ] `campaignId` yang menunjuk campaign `web` → `cards.leads.applicable === false`, `value: null` (bukan `0`).
- [ ] Hitung channel scope dari `ad_sets` (`select distinct objective_group from ad_sets where ...`), bukan dari nama campaign.

### 2. `warnings[]` + `data_freshness` (F-11.1)
- [ ] Tambah `dataFreshness: {eventName: string; lastSeenAt: string | null; hoursOld: number | null; stale: boolean}[]` ke `TrackingHealthResponse`, dihitung dari `tracking_health_daily.date` terbaru per event; `stale = true` bila `hoursOld > 48` atau `null`.
- [ ] Tambah `warnings: {code: string; level: "INFO"|"WARNING"|"CRITICAL"; message: string; route: string | null}[]` dengan kode:
  - `ATTRIBUTION_FRESHNESS` — `dataFreshness` punya event `stale`.
  - `PIXEL_EVENT_MISSING` — event kunci (`EMQ_KEY_EVENTS`) tanpa baris 7 hari terakhir.
  - `SYNC_FAILED` — `sync_runs` terbaru berstatus gagal.
  - `EMQ_LOW` — `emq.average < EMQ_THRESHOLD`.
  - `DEDUP_LOW` — `capi.dedupRate < DEDUP_WARNING`.
- [ ] `warnings` kosong → `[]`, bukan `null`.

### 3. Rule alert tambahan (F-11.2)
- [ ] Tambah ke `AlertRuleKey` (`src/shared/alerts.ts`): `conversation_reconciliation` dan `sync_failed`.
- [ ] `conversation_reconciliation`: bandingkan `onsite_conversion.messaging_conversation_started_7d` (Meta) dengan jumlah `conversation_messages` `INBOUND` pada periode yang sama; selisih > 10% → alert `WARNING` dengan `metric` = selisih dan `evidence` berisi kedua angka.
- [ ] `sync_failed`: dipicu dari handler DLQ (`23-ops-production.md`); `entityId` = `jobName`, `impactCaption` = jumlah percobaan.
- [ ] Daftarkan kedua rule di `EVALUATED_RULES` (`src/modules/alerts/evaluate.service.ts`) agar ikut auto-resolve saat kondisi hilang.

### 4. Field `lead_assessments` (F-12.1, F-12.2)
- [ ] Migrasi `lead_assessments`: tambah `topic text`, `response_type text`, `mood text check (mood in ('positif','netral','negatif'))`, `quote text`, `reply_minutes integer`.
- [ ] `AssessService` mengisi kelima kolom dari hasil AI; nilai yang tidak tersedia → `null`, tidak ditebak.
- [ ] Tambah `priorLevel: "COLD"|"WARM"|"HOT"|null` pada `lead_assessments` (diisi level assessment sebelumnya yang `applied = true`), dan ekspos sebagai `prior_level` di `LeadListRow` dan `getLeadDetail.movement[]`.
- [ ] `PipelineRow` dan `LeadListRow` menyertakan `topic` dan `responseType`.
- [ ] Prompt assessment (`src/modules/audience/constants.ts` atau prompt terkait) diperluas agar mengembalikan kelima field; validasi nilai `mood`/`response_type` terhadap `SENTIMENTS`/`REPLY_TYPES` dan tolak nilai di luar enum (simpan `null` + log `warn`).

### 5. KPI + ringkasan campaign di `/analytics/creatives` (F-15.1)
- [ ] Tambah ke `CreativeListResponse`:
  ```ts
  kpi: {spendMinor, impressions, count, assessed, conversations, purchases, hotShare},
  campaignSummary: [{campaignId, name, spendShare: number | null, messageCompleteness: number | null}],
  trend: [{date, spendMinor, results}]
  ```
  - `assessed` = jumlah kreatif dengan `dimensions.cost.certainty !== 'kurang'`.
  - `conversations`/`purchases` dari `ad_insight_metrics` per objective group; `null` bila channel tidak ada di scope.
  - `hotShare` = `hotLeads / assessedMatureLeads`, `null` bila penyebut `0`.
  - `spendShare` = `spend kreatif dalam campaign / total spend`; `messageCompleteness` dari `messageEvidence.present / expected` (rata-rata kreatif campaign itu).
  - `trend` maksimal 30 titik terakhir; `results` mengikuti objective group.

### 6. Pola kreatif: `supported` / `consistent` / `clear` (F-17.2)
- [ ] Tambah ke `PatternRow` (`src/modules/creative/service.ts`):
  - `supported: boolean` = `significant === true && withCount >= PATTERN_MIN_PER_SIDE && withoutCount >= PATTERN_MIN_PER_SIDE`.
  - `consistent: boolean` = arah selisih median biaya sama pada dua sub-periode (paruh pertama vs paruh kedua rentang).
  - `clear: boolean` = `supported && consistent`.
  - `medianYesMinor` / `medianNoMinor` = median biaya per hasil untuk kreatif dengan dan tanpa tag (nilai yang sudah ada di `withMedianCostPerResultMinor`/`withoutMedianCostPerResultMinor`, dipertahankan).
- [ ] `state` dihitung ulang: `eligible_for_test` hanya bila `clear === true`; selain itu `no_clear_pattern` atau `insufficient_sample` sesuai gerbang.

### 7. Penanda narasi simulasi (F-09.4)
- [ ] Tambah `simulated: boolean` pada `ExplanationRef` (`src/modules/explanations/service.ts`), `true` selama belum ada koneksi Meta produksi (`Config.meta.appId` kosong/placeholder atau `meta_connection` tidak ada).
- [ ] Cache narasi tetap per `(context, entity, filter, snapshotId)` seperti sekarang; tambahkan `cachedAt` pada `ExplanationDetail` agar umur cache terlihat.

## File yang Disentuh
- `src/modules/analytics/service.ts` (KPI)
- `src/modules/tracking-health/service.ts`
- `src/modules/alerts/{evaluate.service.ts}`, `src/shared/alerts.ts`
- `src/infra/database/schema/wa/lead-assessment.entity.ts`, migrasi
- `src/modules/audience/{assess.service.ts,service.ts,constants.ts}`
- `src/modules/creative/{service.ts,schema.ts}`
- `src/shared/creative.ts`

## Uji Selesai
- `GET /api/analytics/summary?accountId=…&campaignId=<web>` → `cards.leads.applicable === false`, `cards.leads.value === null`; `cards.roas.applicable === true`.
- Scope dengan dua channel → `cards.cplQualified.applicable === false` dan `note` terisi.
- `/tracking-health` pada akun tanpa baris event 7 hari → `warnings` memuat `PIXEL_EVENT_MISSING`, dan `dataFreshness` memuat entri `stale: true`.
- Meta melaporkan 100 percakapan, `conversation_messages` 70 → alert `conversation_reconciliation` aktif dengan `metric` = 30.
- Assessment baru menyimpan `topic`, `response_type`, `mood`, `quote`, `reply_minutes`; nilai `mood` di luar enum → tersimpan `null` + log `warn`, assessment tetap tersimpan.
- Assessment kedua menyimpan `prior_level` = level assessment pertama.
- `GET /api/analytics/creatives?...` → `kpi.count` = jumlah kreatif, `campaignSummary[].spendShare` berjumlah ≈ 1, `trend.length <= 30`.
- `patterns` dengan `pValue` signifikan tetapi `withCount = 2` → `supported === false`, `state !== 'eligible_for_test'`.
