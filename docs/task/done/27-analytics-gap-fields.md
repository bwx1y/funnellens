# Selesai: Field Analitik Lengkap — KPI Channel, Tracking Warnings, Lead Analysis, Creative KPI, Pola Kreatif

Dokumentasi implementasi fitur F-08.2, F-11.1, F-11.2, F-12.1, F-12.2, F-15.1, F-17.2.

## Ringkasan Fitur

- **KPI sadar channel (F-08.2)**:
  - `applicable: boolean` pada setiap `KpiCard`.
  - Percakapan (`leads`) hanya applicable pada campaign/ad set `wa`.
  - Pembelian/ROAS hanya applicable pada campaign/ad set `web`.
  - `cplQualified` hanya applicable saat cakupan memiliki tepat satu channel; saat dua channel berjalan bersamaan diset `applicable: false` dengan catatan eksplisit.
  - Channel scope ditentukan dari `objective_group` tabel `ad_sets`.
- **Tracking warnings & data freshness (F-11.1)**:
  - Field `dataFreshness` dan `warnings` pada respons `GET /api/tracking-health`.
  - Peringatan untuk `ATTRIBUTION_FRESHNESS`, `PIXEL_EVENT_MISSING`, `SYNC_FAILED`, `EMQ_LOW`, dan `DEDUP_LOW`.
  - Array kosong `[]` saat tidak ada peringatan (tidak pernah `null`).
- **Rule alert rekonsiliasi & kegagalan sync (F-11.2)**:
  - `conversation_reconciliation`: Deteksi selisih antara percakapan Meta (`onsite_conversion.messaging_conversation_started_7d`) dengan pesan `INBOUND` WhatsApp yang melebihi ambang batas 10%.
  - `sync_failed`: Alert kritis dari DLQ handler dengan entityId berupa `jobName` dan impact caption jumlah percobaan.
- **Field detail lead assessment (F-12.1, F-12.2)**:
  - Kolom `topic`, `response_type`, `mood`, `quote`, `reply_minutes`, `prior_level` pada `lead_assessments`.
  - Filter nilai enum untuk `mood` (`positif`, `netral`, `negatif`) dan `response_type`; nilai di luar enum disimpan sebagai `null` dengan log warning.
  - Nilai level sebelumnya terekam pada `prior_level`.
- **Creative KPI, campaign summary, dan tren (F-15.1)**:
  - Blok `kpi`, `campaignSummary`, dan `trend` (maks 30 titik) pada respons `GET /api/analytics/creatives`.
- **Pola kreatif (F-17.2)**:
  - Field `supported`, `consistent`, `clear`, `medianYesMinor`, `medianNoMinor` pada pola kreatif.
  - Status `eligible_for_test` hanya jika `clear === true` dan jumlah sampel kedua sisi memenuhi batas minimum.
- **Simulated explanation tag (F-09.4)**:
  - Flag `simulated: boolean` dan field `cachedAt` pada detail penjelasan narasi AI.

## Hasil Pengujian

- `bun test tests/integration/analytics-gap-fields.test.ts`: 10 test lulus.
- Seluruh 367 tes pada proyek lulus tanpa regresi.
