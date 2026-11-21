# TODO: Tracking Health & CAPI Monitoring

## Gambaran Fitur
Endpoint dan service untuk memantau kesehatan infrastruktur tracking iklan: konektivitas Meta Pixel, Conversions API (CAPI), Event Match Quality (EMQ), rasio deduplikasi, serta volume event browser vs server.

## Daftar Pekerjaan

### 1. Status Koneksi Tracking
- [ ] Endpoint `GET /api/tracking-health`:
  - Query parameters: `accountId`.
- [ ] Kartu Status Infrastruktur:
  - **Status Meta Pixel**:
    - Status koneksi ("Terhubung" / "Terputus").
    - Persentase event diterima browser (misal 98,4%).
    - Waktu sinyal terakhir diterima (`last_seen_at`, misal "4 menit lalu").
  - **Status Conversions API (CAPI)**:
    - Status koneksi server-side ("Terhubung" / "Belum Terkonfigurasi").
    - Rasio deduplikasi event server & browser (target > 90%).
  - **Skor Kualitas Pencocokan (Event Match Quality / EMQ)**:
    - Nilai rata-rata EMQ skala 0–10 (misal 5.8/10) pada event kunci (`Lead` atau `Purchase`).
    - Peringatan jika nilai EMQ di bawah ambang batas rekomendasi (misal < 6.0).

### 2. Tabel Rincian Event Tracking (Events Table)
- [ ] Data rincian per jenis event standar:
  - Event kunci: `PageView`, `ViewContent`, `Lead`, `Purchase`, `AddToCart`, `InitiateCheckout`.
  - Kolom metrik per event:
    1. **Browser Count**: jumlah event yang terekam dari sisi klien (Pixel).
    2. **Server Count**: jumlah event yang terekam dari sisi server (CAPI).
    3. **Deduplication Rate (%)**: persentase event duplikat yang berhasil digabungkan menggunakan `event_id`.
    4. **Match Quality Score**: skor kecocokan parameter pengguna (email hash, phone hash, fbp, fbc).
    5. **Status Kesehatan**: "Sehat", "Perlu Optimalisasi", atau "Bermasalah".

### 3. Sinkronisasi Data Events Manager / CAPI Diagnostics
- [ ] Integrasikan pembacaan statistik event dari Graph API:
  - Request edge `GET /{pixel_id}/stats` atau query diagnostic CAPI.
- [ ] Penyimpanan snapshot berkala ke tabel `tracking_health_daily`:
  - Fields: `pixel_id`, `date`, `event_name`, `browser_count`, `server_count`, `deduplication_rate`, `match_quality_score`, `status`.
- [ ] Rekomendasi Perbaikan Parameter:
  - Generate peringatan jika event `Lead` tidak menyertakan hash nomor telepon (`ph`) atau email (`em`).
