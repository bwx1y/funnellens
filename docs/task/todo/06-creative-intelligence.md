# TODO: Creative Intelligence & Fatigue Detection

## Gambaran Fitur
Endpoint dan service untuk mengevaluasi efektivitas materi iklan (kreatif video & gambar), perhitungan skor performa, hook rate, hold rate, deteksi kejenuhan iklan (ad fatigue), dan metadata tag kreatif.

## Daftar Pekerjaan

### 1. Creative Performance Ranking & List
- [ ] Endpoint `GET /api/analytics/creatives`:
  - Query parameters: `accountId`, `since`, `until`, `campaignId`, `format`, `status`, `sortBy`.
- [ ] Kalkulasi metrik performa kreatif:
  - **Belanja (`spend`)**: akumulasi biaya per materi kreatif.
  - **Hasil (`results` / `leads`)**: jumlah pesan dimulai atau formulir lead per materi iklan.
  - **Biaya per Hasil (`cost_per_result`)**: `spend / results`.
  - **CTR (`ctr`)**: `clicks / impressions * 100`.
  - **ROAS (`roas`)**: `purchase_value / spend`.
  - **Skor Performa Kreatif (`creative_score` 0–100)**:
    - Rumus gabungan bobot dari CTR relatif, Hook Rate, Hold Rate, dan Cost per Result.
- [ ] Status / Badge Kreatif:
  - Klasifikasi status performa ("Juara / Winner", "Stabil", "Perlu Uji", "Kelelahan / Fatigued").

### 2. Metrik Video Kritis (Hook Rate & Hold Rate)
- [ ] Kalkulasi **Hook Rate** (persentase audiens yang bertahan menonton di detik awal):
  - Rumus standar: `(video_3_sec_watched_actions / impressions) * 100` (atau fallback `video_play_actions / impressions * 100` jika 3-sec tidak tersedia).
- [ ] Kalkulasi **Hold Rate** (daya tahan penonton hingga materi pesan tersampaikan):
  - Rumus standar: `(video_thruplay_watched_actions / video_3_sec_watched_actions) * 100`.
- [ ] Drop-off Durasi Video:
  - Visualisasi persentase penonton pada p25, p50, p75, dan p100 (`video_p25_watched_actions` s/d `video_p100_watched_actions`).

### 3. Deteksi Kejenuhan Iklan (Ad Fatigue Detection)
- [ ] Endpoint `GET /api/analytics/creatives/fatigue`:
  - Query parameters: `accountId`, `since`, `until`.
- [ ] Rule Engine Deteksi Fatigue:
  - Evaluasi kenaikan frekuensi penayangan: `frequency > 3.0` atau `frequency > 4.0`.
  - Evaluasi tren CTR harian: penurunan CTR signifikan (> 25% drop dalam 7 hari terakhir).
  - Evaluasi tren CPM: lonjakan biaya impresi CPM (> 30% naik).
- [ ] Tindakan Rekomendasi (Actionable Next Steps):
  - Rekomendasi pergantian hook pembuka, rotasi audiens baru, atau penggantian format kreatif.

### 4. Detail Kreatif (Creative Drawer) & Tagging
- [ ] Endpoint `GET /api/analytics/creatives/:id`:
  - Data detail: URL thumbnail/preview, durasi video (detik & format mm:ss), judul, teks materi (`body`), CTA (`call_to_action_type`).
  - Riwayat metrik harian kreatif tersebut (grafik spend, ctr, cpm harian).
- [ ] Sistem Tagging Kreatif (`creative_tags`):
  - Endpoint `POST /api/analytics/creatives/:id/tags`: tambah/hapus tag format, gaya pembuka (hook type), tone bahasa, tema produk.
  - Tagging otomatis via LLM/Gemini adapter atau penandaan manual.
