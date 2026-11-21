# TODO: Funnel Intelligence & Leakage Detection

## Gambaran Fitur
Endpoint dan service untuk visualisasi 6-stage funnel multi-kanal (Website & WhatsApp), deteksi kebocoran konversi (leakage), estimasi kerugian nominal Rupiah, serta detail tren tiap stage.

## Daftar Pekerjaan

### 1. 6-Stage Multi-Channel Funnel
- [ ] Endpoint `GET /api/analytics/funnel`:
  - Query parameters: `accountId`, `since`, `until`, `campaignId`, `objective` (`website` | `whatsapp`).
- [ ] Kalkulasi metrik 6 tahapan funnel:
  1. **Impresi (`impressions`)**: `SUM(impressions)` dari Ads Insights.
  2. **Klik Link (`clicks`)**: `SUM(inline_link_clicks)` (atau `clicks`).
  3. **Landing Page View (`landing`)**: `SUM(actions[landing_page_view])` atau estimasi rasio klik-ke-halaman jika tracking belum terpasang.
  4. **Chat Dimulai / Lead Masuk (`leads`)**: `SUM(actions[messaging_conversation_started_7d])` atau `leads` CRM.
  5. **Dibalas (`replied`)**: jumlah lead dengan `first_replied_at IS NOT NULL`.
  6. **Qualified (`qualified`)**: jumlah lead dengan status `stage IN ('QUALIFIED', 'CLOSING')` atau `score >= 70`.
  7. **Closing (`closed`)**: jumlah lead dengan status `stage = 'CLOSING'` atau `closed_at IS NOT NULL`.
- [ ] Rasio konversi:
  - Rasio tahap: `(stage[n] / stage[n-1]) * 100`.
  - Rasio dari impresi pertama: `(stage[n] / impressions) * 100`.
  - Delta persentase per tahap dibanding periode sebelumnya.

### 2. Rule Engine Deteksi Kebocoran (Leakage Detection)
- [ ] Endpoint `GET /api/analytics/leakage`:
  - Query parameters: `accountId`, `since`, `until`.
- [ ] Evaluasi 3 titik kebocoran utama:
  1. **Kebocoran Klik ke Landing Page**:
     - Persentase drop: `1 - (landing_page_views / inline_link_clicks)`.
     - Ambang batas wajar (misal drop > 35%).
     - Analisis kemungkinan penyebab: waktu muat halaman (page speed) lambat, bounce rate tinggi, redirect lag.
  2. **Kebocoran Chat Masuk ke Balasan**:
     - Persentase drop: `1 - (replied_leads / total_chats)`.
     - Analisis kemungkinan penyebab: keterlambatan respons agen/CS di luar jam operasional.
  3. **Kebocoran Qualified ke Closing**:
     - Persentase drop: `1 - (closing_deals / qualified_leads)`.
     - Analisis kemungkinan penyebab: penanganan objection harga, follow-up kurang intensif.
- [ ] Kalkulasi Dampak Finansial (Financial Impact Rp):
  - Rumus: `lost_leads * downstream_conversion_rate * average_order_value (AOV)`.
  - Simpan konfigurasi AOV per akun atau hitung dari rata-rata `deal_value_minor`.
- [ ] Action Checklist:
  - Kembalikan daftar rekomendasi tindakan taktis yang dapat diceklis pengguna untuk mengatasi masing-masing kebocoran.
- [ ] Segmentasi Kebocoran:
  - Breakdown kebocoran berdasarkan perangkat (`impression_device`: Mobile vs Desktop vs Tablet) dan jam aktivitas (`hourly_stats`).

### 3. Detail Tahap Funnel (Stage Detail)
- [ ] Endpoint `GET /api/analytics/funnel/stage-detail`:
  - Query parameters: `accountId`, `stageKey`, `since`, `until`.
- [ ] Daily time-series per stage: jumlah event per hari sepanjang rentang tanggal.
- [ ] Stage Comparison Table:
  - Kolom: Nama Tahap, Volume Periode Ini, Volume Periode Lalu, Perubahan (%), Rasio Konversi Tahap, Status (Normal / Perlu Perhatian / Kritis).
