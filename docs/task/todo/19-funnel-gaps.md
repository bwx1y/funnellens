# TODO: Kelengkapan Funnel — klik harian, previous_count, priority_stage, riwayat kebocoran

## Gambaran Fitur
Funnel sudah punya tahap per channel, pasangan dengan `deltaPp`, dan pemilihan kebocoran tunggal. Yang belum: klik harian di summary, `previous_count`/`share` per tahap, `priority_stage`, riwayat kebocoran 4 periode, perbandingan kebocoran per campaign, dan kontrak jumlah tahap. Task ini menutup F-06.1, F-08.3, F-09.1–F-09.3, F-10.2–F-10.3.

## Daftar Pekerjaan

### 1. `daily_clicks` di summary (F-08.3)
- [ ] Tambah `linkClicks` ke `DailyTrendPoint` dan query `getDailyTrend` di `src/infra/database/repositories/ad-insight-daily.repository.ts`: `coalesce(sum(i.link_clicks), 0) as link_clicks`.
- [ ] Tambah `clicks: number` pada `SummaryResponse.series.current[]` dan `.previous[]` di `src/modules/analytics/service.ts`, diisi dari `linkClicks`.
- [ ] Tambah `cards.clicks: KpiCard` (value = Σ `linkClicks` periode berjalan, `deltaPct` terhadap previous, `sparkline` 7 bucket).

### 2. `previous_count` + `share` per tahap (F-09.1)
- [ ] Tambah `previousValue: number` dan `share: number | null` pada `FunnelStageView` (`src/modules/analytics/service.ts`).
  - `previousValue` dari `analyticsRepo.getFunnelCounts(..., prevStart, prevEnd)` + `getLeadStageCounts(..., prevStart, prevEnd)` yang sudah dipanggil `getSummary`; `getFunnel` perlu memanggilnya juga.
  - `share = value / stages[0].value`, 4 desimal, `null` bila tayangan `0`.
- [ ] Tambah `changeCount: number` = `value - previousValue`.

### 3. `priority_stage` (F-09.3)
- [ ] Tambah `export function pickPriorityStage(pairs: FunnelPair[]): {from: FunnelStageKey; to: FunnelStageKey; deltaPp: number} | null` di `src/shared/funnel.ts`:
  - Hanya `pairs` dengan `eligible === true` dan `deltaPp !== null` dan `deltaPp < 0`.
  - Ambil `deltaPp` terkecil; tie-break deterministik → tahap terdalam (indeks `to` terbesar di `FUNNEL_STAGES[channel]`).
  - Tidak ada penurunan → `null`.
- [ ] Tambah `priorityStage: ReturnType<typeof pickPriorityStage>` ke `FunnelResponse`, diisi dari `pickPriorityStage(pairs)`.

### 4. Riwayat kebocoran 4 periode (F-10.2)
- [ ] Tambah endpoint `GET /api/analytics/leaks/history` dengan query `{accountId, since?, until?, days?, objectiveGroup?}` pada `AnalyticsController` (`src/modules/analytics/index.ts`) + schema `AnalyticsSchema.leakHistory`.
- [ ] Service `getLeakHistory(tenantId, query)`:
  - Bangun 4 window berurutan mundur dari `period.until`: window ke-`i` = `[addDays(until, -(i+1)*days + 1), addDays(until, -i*days)]`.
  - Untuk tiap window panggil `getFunnelCounts` + `getLeadStageCounts`, hitung `buildFunnelPairs`, ambil `pickLeakage`.
  - Respons: `{objectiveGroup, periods: [{since, until, label, transition, rate, baseline, deltaPp, estimatedGap, severity}], stages: [{key, label, values: number[]}], sample, note?}` — `values[]` sepanjang 4, urut periode terbaru lebih dulu.
  - Window yang datanya kosong → `values` `null` pada indeks itu, bukan `0`.
- [ ] Batasi jumlah window dengan `min(4, floor(availableDays / days))` seperti aturan `Accept` F-09; `availableDays` = jumlah hari sejak baris insight tertua.

### 5. Perbandingan kebocoran per campaign (F-10.3)
- [ ] Tambah `campaigns: {campaignId, name, rate, baseline, deltaPp, estimatedGap, eligible}[]` ke `LeakageResponse`.
- [ ] Isi dengan memanggil `getFunnelCounts`/`getLeadStageCounts` per `campaignId` dari `campaignRepo.findByAccountId`, hanya untuk transition yang sedang dipilih `pickLeakage`.
- [ ] Urutkan `deltaPp` ascending; entri dengan `deltaPp === null` di akhir; tie-break `name` ascending.

### 6. Kontrak jumlah tahap (F-06.1)
- [ ] Pertahankan 7 tahap `wa` (tahap `observed` tidak boleh dihapus: `replied`/`qualified` diukur terhadapnya). Tambahkan `stageCount: number` dan `stageKeys: FunnelStageKey[]` ke `FunnelResponse` agar klien merender urutan tetap tanpa menebak.
- [ ] Tambah komentar di `FUNNEL_STAGES` yang menyatakan jumlah final per channel (`wa` 7, `web` 6) beserta alasan `observed` dipertahankan, supaya deviasi dari checklist terdokumentasi di kode.

### 7. Detail tahap: riwayat 4 periode, narasi, langkah pemeriksaan (F-09.2)
- [ ] Perluas `StageDetailResponse` (`src/modules/analytics/service.ts`) dengan:
  ```ts
  history: {since, until, label, value: number | null}[],
  explanation: ExplanationRef | null,
  checks: {key: string, label: string, done: boolean, route: string | null}[]
  ```
- [ ] `history` diisi `min(4, floor(availableDays / period.days))` window berurutan mundur, memakai helper window yang sama dengan riwayat kebocoran (bagian 4); window tanpa data → `value: null`.
- [ ] `explanation` dari `ExplanationService.ensure` dengan `context: "funnel_stage"`, fakta `{stage, current, previous, rate, deltaPp}`, `snapshotId` = `"{since}..{until}"`; tambah `funnel_stage` ke `ExplanationContext` bila belum ada.
- [ ] `checks` = daftar langkah pemeriksaan statis per tahap, ditentukan `StageDefinition.key`:
  - `impressions`/`link_clicks` → `["Periksa status campaign di Meta", "Bandingkan objective campaign dengan channel funnel"]`.
  - `messaging_started`/`observed`/`replied` → `["Periksa kecepatan balas CS", "Cek atribusi CTWA pada lead baru"]`.
  - `lpv`/`view_content`/`add_to_cart`/`purchase` → `["Periksa tracking-health event terkait", "Bandingkan event Meta dengan pesanan tercatat"]`.
  - `qualified`/`closed` → `["Tinjau lead qualified tanpa closing", "Periksa nilai deal yang belum tercatat"]`.
  - Tiap entri punya `route` ke halaman terkait (`/app/tracking`, `/app/audience`, `/app/funnel`); `done` selalu `false` (langkah manual, bukan status otomatis).

## File yang Disentuh
- `src/shared/funnel.ts`
- `src/infra/database/repositories/ad-insight-daily.repository.ts`
- `src/modules/analytics/schema.ts`, `src/modules/analytics/service.ts`, `src/modules/analytics/index.ts`

## Uji Selesai
- `GET /api/analytics/summary?...` → `series.current[0].clicks` berupa angka dan `cards.clicks.value` = Σ `link_clicks` periode.
- `GET /api/analytics/funnel?...` → tiap `stages[i]` punya `previousValue` dan `share`; `priorityStage` menunjuk pasangan dengan `deltaPp` negatif terkecil.
- Dua pasangan dengan `deltaPp` sama → `priorityStage` memilih `to` yang lebih dalam (test unit di `tests/unit/funnel-pairs.test.ts`).
- `GET /api/analytics/leaks/history?days=7` → `periods.length === 4`, tiap `stages[i].values.length === 4`.
- `GET /api/analytics/leakage?...` → `campaigns` terurut `deltaPp` ascending, entri `null` di akhir.
- `getFunnel` tanpa data → `priorityStage === null`, bukan objek kosong.
