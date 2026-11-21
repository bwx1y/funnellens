# TODO: Overview & Summary Analytics

## Gambaran Fitur
Endpoint dan service untuk menyediakan data halaman utama/ikhtisar (`app.js:overview()`), mencakup KPI cards, sparklines tren mini, perbandingan periode sebelumnya, time-series grafik, panel kesehatan bisnis, dan tabel performa campaign.

## Daftar Pekerjaan

### 1. KPI Summary Service & Endpoint
- [ ] Buat modul baru `src/modules/analytics/` (atau tambahkan di controller analitik).
- [ ] Endpoint `GET /api/analytics/summary`:
  - Query parameters:
    - `accountId`: string (required)
    - `since`: string YYYY-MM-DD (required)
    - `until`: string YYYY-MM-DD (required)
    - `campaignId`: string (optional)
- [ ] Kalkulasi KPI Cards:
  - **Belanja Iklan (`spend`)**: `SUM(spend)` dalam mata uang akun.
  - **Lead Masuk (`leads`)**: `SUM(actions)` untuk action type primer (WhatsApp chat / Lead form).
  - **Biaya / Lead Qualified (`cpl_qualified`)**: `total_spend / qualified_leads_count`.
  - **ROAS (`roas`)**: `total_conversion_value / total_spend` (dari nilai purchase CAPI / deal CRM).
  - **Skor Kesehatan Funnel (`funnel_health`)**: nilai komposit 0–100 berdasarkan konversi funnel & kecepatan respons.
- [ ] Kalkulasi Delta Persentase (% vs Periode Sebelumnya):
  - Hitung rentang periode sebelumnya yang berdurasi sama persis (`previous_since` s/d `previous_until`).
  - Rumus delta: `((current - previous) / previous) * 100`.
- [ ] Sparkline Data:
  - Array 7 titik nilai agregat per sub-interval periode untuk render sparkline mini di kartu KPI.

### 2. Panel Tren Time-Series
- [ ] Agregasi time-series harian:
  - Seri `spend` harian (periode berjalan vs periode sebelumnya).
  - Seri `leads` harian (periode berjalan vs periode sebelumnya).
  - Penyesuaian timezone akun iklan (`timezone_name`).

### 3. Panel Kesehatan Bisnis & Unreplied Hot Leads
- [ ] Response status kesehatan:
  - Skor kesehatan bisnis (0–100) dan badge ("Baik", "Perlu perhatian", "Kritis").
  - 3 ringkasan baris status:
    1. Jumlah kebocoran yang perlu ditangani.
    2. Jumlah hot lead yang menunggu balasan.
    3. Jumlah materi iklan/kreatif berkinerja unggul.
- [ ] Hot Leads Panel:
  - Top 3–5 lead berstatus `temperature = 'HOT'` yang belum dibalas (`first_replied_at IS NULL`).
  - Kembalikan: nama lead, nomor telepon tersensor (`phone_masked`), skor (0–100), durasi menunggu dalam menit.

### 4. Tabel Performa Campaign
- [ ] Kembalikan daftar campaign aktif pada rentang tanggal:
  - `campaign_id`, `name`, `status` / `effective_status`.
  - `spend` per campaign.
  - `leads` per campaign.
  - `cost_per_lead = spend / leads`.
  - `hot_lead_rate = hot_leads / leads * 100`.
  - `roas = purchase_value / spend`.
