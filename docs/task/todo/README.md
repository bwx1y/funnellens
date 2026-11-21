# FunnelLens Backend Implementation Roadmap (TODO)

Direktori ini berisi rincian TODO implementasi backend FunnelLens per fitur berdasarkan dokumen arsitektur dan analisis gap di `/home/bwx1y/Downloads/Funnellens_reconstruct/doc`.

## Daftar File TODO Per Fitur

1. **[01-meta-sync.md](./01-meta-sync.md)**  
   *Meta Integration & Sync Engine*: Paginasi Marketing API SDK, penarikan master data (campaign, adset, ad, creative, video), daily ad insights, array actions/values, breakdown placement/device, dan background worker BullMQ.

2. **[02-database-repositories.md](./02-database-repositories.md)**  
   *Database Repositories Layer*: Pembuatan repository Drizzle ORM (`AdAccountRepository`, `CampaignRepository`, `AdInsightDailyRepository`, `LeadRepository`, `TrackingHealthRepository`, dll.) untuk operasi CRUD, UPSERT idempotent, dan agregasi query SQL.

3. **[03-overview-summary.md](./03-overview-summary.md)**  
   *Overview & Summary Analytics*: Endpoint `GET /api/analytics/summary` untuk kartu KPI (Spend, Leads, CPL Qualified, ROAS, Skor Funnel), mini sparklines, perbandingan periode sebelumnya, time-series grafik, panel kesehatan bisnis, dan tabel campaign.

4. **[04-funnel-intelligence.md](./04-funnel-intelligence.md)**  
   *Funnel Intelligence & Leakage Detection*: Endpoint `GET /api/analytics/funnel` dan `GET /api/analytics/leakage` untuk pemetaan 6 tahapan konversi, rule deteksi kebocoran, estimasi kerugian nominal Rupiah, serta detail tahapan funnel.

5. **[05-audience-intelligence.md](./05-audience-intelligence.md)**  
   *Audience Intelligence & Leads Management*: Endpoint `GET /api/analytics/audience`, klasifikasi temperatur lead (Hot/Warm/Cold), analisis waktu respons pesan (speed KPI & lead macet >24h), segmentasi placement/device, dan webhook scoring lead.

6. **[06-creative-intelligence.md](./06-creative-intelligence.md)**  
   *Creative Intelligence & Fatigue Detection*: Endpoint `GET /api/analytics/creatives`, perhitungan ranking performa iklan, metrik video kritis (Hook Rate & Hold Rate), rule engine kejenuhan iklan (Ad Fatigue), dan sistem tagging kreatif.

7. **[07-tracking-health.md](./07-tracking-health.md)**  
   *Tracking Health & CAPI Monitoring*: Endpoint `GET /api/tracking-health`, pemantauan status koneksi Meta Pixel dan CAPI, skor Event Match Quality (EMQ), rasio deduplikasi, dan rincian tabel event (Browser vs Server).

8. **[08-alerts-health-scoring.md](./08-alerts-health-scoring.md)**  
   *Alerts & Health Scoring Engine*: Formula komputasi dinamis skor kesehatan funnel/bisnis, rule generator alert otomatis (`insight_alerts`), serta endpoint manajemen alert (`snooze` dan `resolve`).
