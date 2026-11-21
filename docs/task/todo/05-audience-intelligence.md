# TODO: Audience Intelligence & Leads Management

## Gambaran Fitur
Endpoint dan service untuk segmentasi temperatur audiens (Hot, Warm, Cold), analisis kecepatan respons chat (speed KPI & lead macet), segmentasi penempatan (placement/device), serta manajemen data leads.

## Daftar Pekerjaan

### 1. Ikhtisar Temperatur Audiens
- [ ] Endpoint `GET /api/analytics/audience`:
  - Query parameters: `accountId`, `since`, `until`, `campaignId`.
- [ ] Distribusi Temperatur (Donut Chart & Cards):
  - Jumlah & persentase **Hot** (`score >= 70`).
  - Jumlah & persentase **Warm** (`score BETWEEN 40 AND 69`).
  - Jumlah & persentase **Cold** (`score < 40`).
  - Perubahan persentase (delta vs periode sebelumnya) untuk tiap temperatur.
- [ ] Sankey Cohort Flow:
  - Pergerakan status audiens antar periode (mis. Cold -> Warm, Warm -> Hot).
- [ ] Ranking Campaign Berdasarkan Hot Lead Rate:
  - Daftar kampanye terurut dari persentase hot lead tertinggi (`hot_leads / total_leads * 100`).

### 2. Response Speed KPI & Lead Macet
- [ ] Endpoint `GET /api/analytics/audience/speed`:
  - Query parameters: `accountId`, `since`, `until`.
- [ ] Key Performance Indicators:
  - Rata-rata waktu respons pertama (`avg_first_reply_time` dalam menit/jam).
  - Waktu tunggu terlama saat ini.
  - Jumlah **Lead Macet > 24 jam**: lead yang masuk tanpa balasan selama lebih dari 24 jam (`first_replied_at IS NULL AND NOW() - first_seen_at > INTERVAL '24 hours'`).
- [ ] Speed Bar Distribution:
  - Distribusi kecepatan respons dalam kategori (misal: < 15 menit, 15–60 menit, 1–4 jam, > 4 jam).
- [ ] Cohort Heatmap Waktu vs Konversi:
  - Matriks perbandingan rentang waktu respons terhadap persentase closing konversi.

### 3. Segmentasi Placement & Device
- [ ] Endpoint `GET /api/analytics/audience/segments`:
  - Query parameters: `accountId`, `since`, `until`.
- [ ] Pengelompokan metrik per placement (`publisher_platform`: Facebook, Instagram, Audience Network, Messenger; `platform_position`: Feed, Stories, Reels, Explore):
  - Total Spend.
  - Leads Masuk.
  - Hot Lead Rate (`hot_leads / total_leads * 100`).
  - Cost per Hot Lead (`spend / hot_leads`).
- [ ] Pengelompokan metrik per device (`impression_device`: iPhone, Android Smartphone, Desktop).

### 4. Lead Scoring Engine & Webhook Integration
- [ ] Hook webhook pesan masuk WhatsApp (`/wa/webhook`) ke pembuatan / pembaruan `leads`:
  - Cocokkan nomor telepon pengirim ke `phone_hash` dan `phone_masked`.
  - Rekam `first_seen_at` pada pesan pertama dan `first_replied_at` pada balasan pertama dari nomor bisnis/agen.
- [ ] Evaluasi sinyal skor (`score` 0–100):
  - Bobot panjang percakapan / frekuensi chat.
  - Deteksi kata kunci niat beli tinggi (AI sentiment / keyword rules: harga, rekening, ongkir, pesan sekarang).
  - Klasifikasi otomatis kolom `temperature` (`HOT`, `WARM`, `COLD`) dan `stage` (`CHAT_STARTED`, `REPLIED`, `QUALIFIED`, `CLOSING`).

### 5. Leads Management API
- [ ] Endpoint `GET /api/leads`:
  - Query parameters: `accountId`, `temperature`, `stage`, `search` (nama/no telepon), `page`, `limit`, `sortBy`.
  - Kembalikan data list lead: `id`, `name`, `phone_masked`, `temperature`, `score`, `stage`, `campaign_name`, `waiting_time_minutes`, `created_at`.
- [ ] Endpoint `PATCH /api/leads/:id`:
  - Update manual stage lead (`stage`), suhu (`temperature`), atau nilai closing (`deal_value_minor`).
