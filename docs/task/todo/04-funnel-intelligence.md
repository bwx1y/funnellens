# TODO: Funnel Intelligence & Leakage Detection

## Gambaran Fitur
Endpoint dan service untuk visualisasi tahap funnel per kanal (WhatsApp & Website), perbandingan dua periode, deteksi transisi yang menurun, dan detail tren tiap tahap. Tidak ada perhitungan kerugian dalam uang dan tidak ada klaim penyebab.

## Daftar Pekerjaan

### 1. Tahap Funnel Per Kanal
- [ ] Endpoint `GET /api/analytics/funnel`:
  - Query parameters: `accountId`, `since`, `until`, `campaignId`, `objectiveGroup` (`wa` | `web`).
- [ ] Tahap kanal **WhatsApp**:
  1. `impressions` — `SUM(impressions)`.
  2. `link_clicks` — `SUM(inline_link_clicks)`.
  3. `messaging_started` — action percakapan dimulai, sumber `"meta"`.
  4. `observed` — lead yang tercatat di FunnelLens, sumber `"cross"`, `estimated: true`.
  5. `replied` — lead dengan `first_replied_at IS NOT NULL`.
  6. `qualified` — `stage IN ('QUALIFIED','CLOSING')`.
  7. `closed` — `stage = 'CLOSED'` atau `closed_at IS NOT NULL`.
- [ ] Tahap kanal **Website**: `impressions → link_clicks → lpv → view_content → add_to_cart → purchase`.
- [ ] Setiap event diambil dengan satu representasi saja memakai `LEAD_ACTION_PRECEDENCE` / `PURCHASE_ACTION_PRECEDENCE` (`ad-insight-daily.repository.ts`) agar tipe umum dan tipe pixel tidak dihitung dua kali. Tidak ada estimasi rasio klik-ke-halaman.
- [ ] Per pasangan tahap: `rate` (kini), `baseline` (periode lalu), `deltaPp`, `estimatedGap`, `eligible`.
  - `rate = now.before > 0 ? now.after / now.before : null`.
  - `baseline = prior.before > 0 ? prior.after / prior.before : null`.
  - `deltaPp = 100 * (rate - baseline)`; `estimatedGap = max(0, round(now.before * baseline - now.after))`.
  - `eligible` hanya bila kedua periode memenuhi gerbang: `before ≥ 100` untuk tahap pertama, `≥ 30` setelah chat, dan status tracking `up_to_date`.
- [ ] Rasio terhadap impresi pertama dihitung terpisah dan ditandai bukan pembanding lintas periode.
- [ ] Respons: `{stages, pairs, objectiveGroup, period, previousPeriod, note?}`; setiap blok menyertakan `sample: {n, denominator, eligible, gate}`.

### 2. Deteksi Kebocoran
- [ ] Endpoint `GET /api/analytics/leakage` (`accountId`, `since`, `until`).
- [ ] Pilih `deltaPp` negatif terkecil dari pasangan yang `eligible`; kembalikan `{transition, rate, baseline, deltaPp, estimatedGap, trackingState, note}`.
- [ ] Tanpa pasangan eligible → `{transition: null, note: "Cakupan belum cukup untuk membandingkan konversi."}`.
- [ ] Ambang keparahan: `WARNING` bila `deltaPp ≤ −5`, `CRITICAL` bila `≤ −15`.
- [ ] `impactMinor = null`; `impactCaption = "≈{estimatedGap} chat hilang"` (jumlah chat, bukan uang).
- [ ] Tidak ada bagian dampak finansial, AOV, atau daftar penyebab (page speed, bounce, jam operasional, objection harga).

### 3. Detail Tahap
- [ ] Endpoint `GET /api/analytics/funnel/stage-detail` (`accountId`, `stageKey`, `since`, `until`).
- [ ] `daily[]`: jumlah event per hari sepanjang rentang.
- [ ] `comparisonTable[]`: nama tahap, volume periode ini, volume periode lalu, perubahan (%), rasio konversi tahap, status `normal | perlu_perhatian | kritis` (delta ≤ −5pp / ≤ −15pp).
- [ ] Segmentasi per jam dan perangkat dipenuhi `GET /api/analytics/audience/segments` (`hours[]`), bukan endpoint baru.

## Uji Selesai
- 250 chat dari 1.000 klik (periode lalu) vs 180 dari 900 (kini) → `rate 0.2`, `baseline 0.25`, `deltaPp -5`, `estimatedGap 45`, status `perlu_perhatian`.
- Tanpa klik pada salah satu periode → `rate null`, `deltaPp null`, dan `note` yang menjelaskan gerbang.
- `estimatedGap` muncul sebagai jumlah chat pada `impactCaption`; `impactMinor` tetap `null`.
