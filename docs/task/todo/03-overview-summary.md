# TODO: Overview & Summary Analytics

## Gambaran Fitur
Endpoint dan service untuk halaman utama/ikhtisar, mencakup kartu KPI, sparkline tren mini, perbandingan periode sebelumnya, time-series grafik, panel kesehatan, dan tabel performa campaign.

## Daftar Pekerjaan

### 1. KPI Summary Service & Endpoint
- [x] Modul `src/modules/analytics/` dengan `GET /api/analytics/summary`:
  - Query parameters: `accountId` (required), `since` (YYYY-MM-DD), `until` (YYYY-MM-DD), `campaignId` (opsional).
  - Setiap route memakai `JwtUtil.isAuthenticated` dan `requireAccountScope(tenantId, accountId)`; akun milik tenant lain → `NotFoundError("Akun iklan tidak ditemukan")`.
- [x] Kartu KPI (`cards`), masing-masing `{value, deltaPct, sparkline[7], note?}`:
  - **Belanja Iklan (`spend`)**: `SUM(spend_minor)` dalam mata uang akun.
  - **Lead Masuk (`leads`)**: action primer (WhatsApp chat / Lead form) sesuai `LEAD_ACTION_PRECEDENCE`.
  - **Biaya / Lead Qualified (`cplQualified`)**: `spend / qualified_leads`; `qualified` = `stage IN ('QUALIFIED','CLOSING')`.
  - **ROAS (`roas`)**: `purchase_value_minor / spend_minor`.
  - **Funnel Health (`funnelHealth`)**: hasil `funnelHealth()` (lihat bagian 2).
- [x] Delta persentase: rentang periode sebelumnya sama panjang, berakhir `since − 1 hari`; `((current - previous) / previous) * 100`; `null` bila `previous` nol.
- [x] Sparkline: 7 titik agregat per sub-interval periode berjalan.
- [x] Setiap `null` wajib disertai `note` berbahasa Indonesia.

### 2. Panel Kesehatan (`funnelHealth()`)
- [x] Tiga komponen berbobot 40/30/30:
  - Konversi funnel saat ini vs baseline historis (bobot 40).
  - Porsi chat yang dibalas ≤ 15 menit (bobot 30).
  - Kualitas tracking: EMQ dan dedup CAPI (bobot 30).
- [x] Komponen `null` dikeluarkan dan bobot dinormalkan ulang; bila komponen tersisa `< 2` → `score: null`, `badge: null`, `note: "Komponen pengukuran belum cukup"`.
- [x] Badge: `≥ 80 "Prima"`, `60–79 "Perlu perhatian"`, `< 60 "Kritis"`.
- [x] Tidak ada skor gabungan bisnis (ROAS/CPA/pertumbuhan); nilai tersebut tampil sebagai kartu masing-masing, bukan skor.

### 3. Panel Tren Time-Series
- [x] Seri `spend` dan `leads` harian (periode berjalan vs periode sebelumnya) dari `getDailyTrend`.
- [x] Tanggal mengikuti zona waktu akun (`ad_accounts.timezone_name`); tanggal insight tidak digeser lagi.

### 4. Unreplied Hot Leads & Ringkasan Status
- [x] Top 5 lead `temperature = 'HOT'` dengan `first_replied_at IS NULL`, urut tunggu terlama: `{leadId, name, phoneMasked, confidence, waitingMinutes}`.
- [x] `confidence` diambil dari assessment terakhir (`lead_assessments`); tidak ada skor numerik lead.
- [x] Tiga baris ringkasan: jumlah kebocoran yang perlu ditangani, jumlah hot lead menunggu balasan, jumlah kreatif berstatus `Winner`.

### 5. Tabel Performa Campaign
- [x] Kolom: `campaignId`, `name`, `status`, `spendMinor`, `leads`, `costPerLeadMinor`, `hotLeadRate`, `roas`.
- [x] `hotLeadRate` = lead dengan tonggak HOT pada periode / total lead teratribusi pada periode; `null` + `note` bila tidak ada lead teratribusi.

## Uji Selesai
- `GET /api/analytics/summary` untuk tenant dengan akun terpilih mengembalikan 5 kartu; setiap `value` yang `null` disertai `note`.
- Akun tanpa data tracking → `health.score` `null` dengan `note: "Komponen pengukuran belum cukup"`, bukan `0`.
- `campaigns[].hotLeadRate` sama dengan hasil hitung manual tonggak HOT dibagi lead teratribusi.
