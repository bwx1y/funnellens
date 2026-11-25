# Selesai: Kelengkapan Funnel — klik harian, previous_count, priority_stage, riwayat kebocoran

Dokumentasi implementasi penutup F-06.1, F-08.3, F-09.1–F-09.3, F-10.2–F-10.3.

## Ringkasan Fitur

- **Klik harian di summary (F-08.3)**: `getDailyTrend` menjumlahkan `inline_link_clicks` per tanggal, `series.current[]`/`series.previous[]` membawa `clicks`, dan `cards.clicks` (`KpiCard`) diisi Σ klik tautan periode berjalan dengan `deltaPct` terhadap periode sebelumnya serta sparkline 7 bucket. Tanpa baseline → `deltaPct: null` + `note`, bukan `0`.
- **`previousValue` / `changeCount` / `share` per tahap (F-09.1)**: setiap `FunnelStageView` memuat nilai periode sebelumnya, selisih absolut, dan `share = value / stages[0].value` (4 desimal, `null` bila tayangan `0`).
- **`priorityStage` (F-09.3)**: `pickPriorityStage(pairs)` di `@shared/funnel` memilih transisi `eligible` dengan `deltaPp` negatif terkecil; tie-break ke tahap terdalam (`to` berindeks terbesar di `FUNNEL_STAGES[channel]`); tidak ada penurunan → `null`.
- **Riwayat kebocoran 4 periode (F-10.2)**: `GET /api/analytics/leaks/history` membangun `min(4, floor(availableDays / days))` window berurutan mundur dari `until`; tiap window memakai window sebelumnya sebagai baseline untuk `buildFunnelPairs` + `pickLeakage`. `values[]` per tahap `null` pada window tanpa baris (bukan `0`).
- **Perbandingan per campaign (F-10.3)**: `LeakageResponse.campaigns[]` mengulang transisi pemenang `pickLeakage` per campaign (`campaignRepo.findByAccountId`), urut `deltaPp` ascending, entri `null` di akhir, tie-break `name`.
- **Kontrak jumlah tahap (F-06.1)**: `FunnelResponse.stageCount` + `stageKeys`; `FUNNEL_STAGES` diberi komentar bahwa `wa` 7 tahap dan `web` 6 tahap serta alasan `observed` dipertahankan.
- **Detail tahap (F-09.2)**: `StageDetailResponse` memuat `history[]` (window yang sama dengan riwayat kebocoran, `value: null` bila window kosong), `explanation` (`context: "funnel_stage"`) dan `checks[]` statis per tahap dengan `route` terkait dan `done: false`.

## Perubahan File

- `src/shared/funnel.ts`: `FUNNEL_STAGES` terdokumentasi, `PriorityStage`, `pickPriorityStage`.
- `src/infra/database/repositories/ad-insight-daily.repository.ts`: `DailyTrendPoint.linkClicks` + `coalesce(sum(i.inline_link_clicks), 0) as link_clicks`, `getOldestInsightDate` untuk `availableDays`.
- `src/modules/analytics/service.ts`: `cards.clicks`, `series[].clicks`, `FunnelStageView.previousValue/changeCount/share`, `stageCount/stageKeys/priorityStage`, `getLeakHistory`, `leakageCampaigns`, `history`/`explanation`/`checks` pada detail tahap, helper `trailingWindows`/`windowCounts`/`stageHistory`/`availableDays`, `STAGE_CHECKS`.
- `src/modules/analytics/schema.ts`, `src/modules/analytics/index.ts`: `AnalyticsSchema.leakHistory` + route `GET /analytics/leaks/history`.
- `src/modules/explanations/rules.ts`, `src/modules/explanations/contexts.ts`: konteks `funnel_stage` (label, placeholder wajib, enum `nextCheck`, fallback netral dan turun).
- `tests/unit/funnel-pairs.test.ts`: test `pickPriorityStage` (drop terbesar, tie-break tahap terdalam, ineligible/null/naik, funnel kosong) dan `direction` pada helper pair.
- `tests/integration/analytics-funnel.test.ts`: kontrak funnel (`stageCount`, `stageKeys`, `previousValue`, `changeCount`, `share`, `priorityStage`), `campaigns` pada leakage, `history`/`explanation`/`checks` detail tahap, serta endpoint `leaks/history` (2 window berdata, batas 4 window, akun tanpa data).
- `tests/integration/analytics-summary.test.ts`, `tests/integration/repositories.test.ts`: penyesuaian `cards.clicks` dan `series[].clicks`/`linkClicks`.
- `tests/unit/explanation-rules.test.ts`: jumlah konteks narasi menjadi 14.

## Hasil Pengujian

- `bun test` penuh: **278 test di 39 file lulus** tanpa regresi.
- `bunx tsc --noEmit` bersih.
- Kunci perilaku: `GET /api/analytics/funnel` → `priorityStage = {from: "link_clicks", to: "messaging_started", deltaPp: -5}` pada fixture; akun tanpa data → `priorityStage: null`; `GET /api/analytics/leaks/history?days=7` → 4 periode dengan `values` `null`; window tanpa baris lead → `values` `null`, bukan `0`.
