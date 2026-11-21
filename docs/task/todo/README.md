# FunnelLens Backend Implementation Roadmap (TODO)

Direktori ini berisi rincian TODO implementasi backend FunnelLens per fitur. Aturan angka yang mengikat seluruh fitur:

- Uang selalu `*_minor` bigint dengan mata uang akun. Tidak ada nilai uang turunan; dampak ditulis sebagai jumlah chat (`impactCaption`), `impactMinor` dibiarkan `null`.
- Angka yang tidak terukur dikembalikan `null` beserta `note`, tidak pernah `0` sebagai pengganti.
- Tidak ada skor komposit (lead maupun kreatif). Skor kesehatan hanya `funnelHealth()` dengan 3 komponen berbobot 40/30/30.
- Tidak ada klaim penyebab. Narasi hanya menyebut pemeriksaan berikutnya (`nextCheck`).
- Setiap blok mengembalikan `sample: {n, denominator, eligible, gate}`.

## Daftar File TODO Per Fitur

1. **[01-meta-sync.md](./01-meta-sync.md)**
   *Meta Integration & Sync Engine*: Paginasi Marketing API SDK, penarikan master data (campaign, adset, ad, creative, video), daily ad insights, array actions/values, breakdown placement/device, background worker BullMQ, serta kelengkapan F1 (staging atomik, `objectiveGroup`, breakdown per jam).

2. **[02-database-repositories.md](./02-database-repositories.md)**
   *Database Repositories Layer*: repository Drizzle ORM (`AdAccountRepository`, `CampaignRepository`, `AdInsightDailyRepository`, `LeadRepository`, `TrackingHealthRepository`, dll.) untuk CRUD, UPSERT idempotent, dan agregasi SQL analitik.

3. **[03-overview-summary.md](./03-overview-summary.md)**
   *Overview & Summary Analytics*: Endpoint `GET /api/analytics/summary` untuk kartu KPI (Spend, Leads, CPL Qualified, ROAS, Funnel Health), mini sparklines, perbandingan periode sebelumnya, time-series grafik, panel kesehatan, dan tabel campaign.

4. **[04-funnel-intelligence.md](./04-funnel-intelligence.md)**
   *Funnel Intelligence & Leakage Detection*: Endpoint `GET /api/analytics/funnel`, `/funnel/stage-detail`, dan `/leakage` untuk pemetaan tahap konversi per kanal, pasangan tahap, `deltaPp`, serta `estimatedGap` berupa jumlah chat (bukan uang).

5. **[05-audience-intelligence.md](./05-audience-intelligence.md)**
   *Audience Intelligence & Leads Management*: Endpoint `GET /api/analytics/audience`, `/audience/speed`, `/audience/segments`, `/audience/pipeline`, `/audience/conversations`, manajemen leads, dan temperatur dari assessment LLM beralasan (`lead_assessments`) beserta tonggak.

6. **[06-creative-intelligence.md](./06-creative-intelligence.md)**
   *Creative Intelligence & Fatigue Detection*: Endpoint `GET /api/analytics/creatives`, empat dimensi bergerbang + status; Hook/Hold/retensi hanya metrik tampilan, rule kejenuhan dengan faktor pengganggu, pola kreatif, kualitas lead, perbandingan, eksperimen, dan tagging kreatif.

7. **[07-tracking-health.md](./07-tracking-health.md)**
   *Tracking Health & CAPI Monitoring*: Endpoint `GET /api/tracking-health`, pemantauan status Meta Pixel dan CAPI, skor Event Match Quality (EMQ), rasio deduplikasi, dan rincian tabel event (Browser vs Server).

8. **[08-alerts-health-scoring.md](./08-alerts-health-scoring.md)**
   *Alerts & Health Scoring Engine*: Formula `funnelHealth()` (3 komponen), rule generator alert otomatis (`insight_alerts`), serta endpoint manajemen alert (`snooze` dan `resolve`).

9. **[09-wa-cloud-ingestion.md](./09-wa-cloud-ingestion.md)**
   *WhatsApp Cloud API Ingestion*: Webhook `GET`/`POST /api/wa/cloud/webhook`, verifikasi HMAC `X-Hub-Signature-256`, antrean `wa-cloud` idempoten, binding `wa_phone.phoneNumberId`, atribusi `ad_id` lewat `findAtTime`, penulisan `leads` insert-only + `conversation_messages`, pesan keluar CS, dan cutover worker OpenWA.

10. **[10-lead-assessment.md](./10-lead-assessment.md)**
    *Lead Assessment & Response Types*: Tabel `lead_assessments` + `lead_milestones`, pipeline dua tingkat (sinyal lalu keputusan), `appendIfCurrent`, `reassess`, pasangan jawaban CS (`pairReply`), pipeline board, dan insight percakapan.

11. **[11-ai-explanations.md](./11-ai-explanations.md)**
    *AI Explanations per Blok*: Tabel `explanations`, `ensure` + worker `explain`, validasi narasi berbasis placeholder, fallback deterministik, 13 konteks blok, dan `GET /api/insights/explanations/:id`.
