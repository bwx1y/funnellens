# TODO: Tracking Health & CAPI Monitoring

## Gambaran Fitur
Endpoint dan service untuk memantau kesehatan infrastruktur tracking iklan: konektivitas Meta Pixel, Conversions API (CAPI), Event Match Quality (EMQ), rasio deduplikasi, serta volume event browser vs server. Satu-satunya penulis tabel adalah job `sync-pixel-stats`.

## Daftar Pekerjaan

### 1. Penyimpanan
- [x] Tabel `pixel_sources`: `accountId`, `pixelId`, `name`, `capiConfigured`, `lastEventAt`, `emqAvg`, `lastSyncedAt`, `raw`; unik pada `(account_id, pixel_id)`.
- [x] `tracking_health_daily` (sudah ada): satu baris per `(account_id, date, event_name)`.
- [x] Job `sync-pixel-stats` (queue `meta-sync`, harian) sebagai **satu-satunya penulis** kedua tabel:
  - `GET /act_{id}/adspixels` untuk daftar pixel.
  - `GET /{pixel_id}/stats` untuk hitungan event.
  - `dedupRate = 1 - duplicateCount / (browserCount + serverCount)`; `null` bila `duplicateCount` tidak tersedia.
  - `matchQuality` dari EMQ payload.
  - `status` per event: `Sehat` / `Perlu optimalisasi` / `Bermasalah`.

### 2. Endpoint
- [x] `GET /api/tracking-health` (`accountId`), memakai `JwtUtil.isAuthenticated` + `requireAccountScope`.
- [x] Kartu infrastruktur:
  - **Meta Pixel**: terhubung/terputus, porsi event dari browser, `last_seen_at`.
  - **CAPI**: terhubung/belum terkonfigurasi, rasio deduplikasi (target > 90%).
  - **EMQ**: rata-rata skala 0–10 untuk event kunci (`Lead`, `Purchase`), peringatan bila < 6,0.
- [x] Tabel event: `PageView`, `ViewContent`, `Lead`, `Purchase`, `AddToCart`, `InitiateCheckout` dengan `browserCount`, `serverCount`, `dedupRate`, `matchQuality`, `status`.
- [x] Bila `GET /{pixel_id}/stats` mengembalikan 403 atau kosong: `pixel_sources.capiConfigured = false`, tabel event kosong, dan respons memuat `note: "Statistik event tidak tersedia untuk akun ini."` — tidak ada angka karangan.
- [x] Setiap nilai `null` disertai `note`.

### 3. Rekomendasi Parameter
- [x] Peringatan bila event `Lead` tidak menyertakan hash nomor telepon (`ph`) atau email (`em`), ditulis sebagai `nextCheck`, tanpa klaim penyebab.

## Uji Selesai
- Akun tanpa pixel → kartu Pixel/CAPI `null` dengan `note`, tabel event kosong, tidak ada `0` pengganti.
- `dedupRate` untuk `browserCount 100` + `serverCount 80` + `duplicateCount 60` → `1 - 60/180 = 0.6667`.
- EMQ `5.8` memicu status `Perlu optimalisasi` dan alert `tracking_emq`.
