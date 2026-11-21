# TODO: Alerts & Health Scoring Engine

## Gambaran Fitur
Engine komputasi untuk menghitung skor kesehatan bisnis dan funnel secara dinamis, mengidentifikasi anomali/kebocoran konversi, serta menghasilkan notifikasi peringatan pintar (smart insights & alerts) beserta rekomendasi aksi perbaikan.

## Daftar Pekerjaan

### 1. Funnel & Business Health Composite Score Engine
- [ ] Formula Skor Kesehatan Funnel (0–100):
  - Bobot Konversi Funnel (40%): rasio konversi klik ke chat dan chat ke closing dibanding benchmark historis.
  - Bobot Kecepatan Respons (30%): persentase chat yang dibalas di bawah 15 menit dan ketiadaan lead macet.
  - Bobot Kualitas Tracking (30%): skor EMQ Pixel/CAPI dan kelengkapan parameter event.
- [ ] Formula Skor Kesehatan Bisnis (0–100):
  - Gabungan nilai ROAS relatif terhadap target, stabilitas CPA / Cost per Lead, dan tren pertumbuhan volume lead mingguan.
- [ ] Penentuan Label & Badge Status:
  - Skor >= 80: "Kondisi Prima / Sangat Sehat" (badge hijau).
  - Skor 60–79: "Perlu Perhatian" (badge kuning).
  - Skor < 60: "Kritis / Butuh Tindakan Segera" (badge merah).

### 2. Rule Engine Pembuatan Alert Otomatis (`insight_alerts`)
- [ ] **Rule 1: Kebocoran Konversi Signifikan (Leakage Alert)**
  - Trigger: Drop rate klik-ke-landing atau chat-ke-balas melampaui ambang batas (> 40%).
  - Payload: Tingkat keparahan (`HIGH`), judul ("Kebocoran tahap landing page terdeteksi"), estimasi nominal kerugian Rp, rekomendasi tindakan.
- [ ] **Rule 2: Hot Lead Menunggu Balasan Lama (Unreplied Alert)**
  - Trigger: Ada lead berstatus `temperature = 'HOT'` yang belum mendapat balasan > 30 menit.
  - Payload: Tingkat keparahan (`CRITICAL`), judul ("Lead siap beli belum direspons"), daftar nama/kontak lead, direct link ke chat.
- [ ] **Rule 3: Ad Fatigue / Penurunan Performa Kreatif**
  - Trigger: Frekuensi iklan > 3.5× disertai drop CTR > 25% pada kreatif unggulan.
  - Payload: Tingkat keparahan (`MEDIUM`), judul ("Iklan [Nama Ad] mengalami kejenuhan"), rekomendasi penyegaran visual.
- [ ] **Rule 4: Masalah Kualitas Tracking (Tracking EMQ Alert)**
  - Trigger: EMQ event Lead turun di bawah 6.0/10 atau deduplikasi CAPI < 85%.
  - Payload: Tingkat keparahan (`HIGH`), panduan perbaikan parameter hashing.

### 3. Alerts Management API
- [ ] Endpoint `GET /api/alerts`:
  - Query parameters: `accountId`, `status` (`active` | `snoozed` | `resolved`).
  - Response: daftar alert terstruktur dengan level (`critical`, `warning`, `info`), judul, deskripsi, estimasi dampak, confidence level, dan action items.
- [ ] Endpoint `PATCH /api/alerts/:id/snooze`:
  - Menunda peringatan untuk jangka waktu tertentu (misal 24 jam / 7 hari).
  - Simpan `snoozed_until` di database.
- [ ] Endpoint `PATCH /api/alerts/:id/resolve`:
  - Menandai peringatan telah ditangani atau diabaikan oleh pengguna.
  - Rekam `resolved_at` dan `resolved_by`.
- [ ] Badge Notifikasi Shell Global:
  - Hitung jumlah alert aktif yang belum di-resolve untuk icon lonceng notifikasi di topbar UI.
