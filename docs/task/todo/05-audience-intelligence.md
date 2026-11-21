# TODO: Audience Intelligence & Leads Management

## Gambaran Fitur
Endpoint dan service untuk distribusi temperatur audiens, kecepatan respons CS, segmentasi placement/device/jam, pipeline lead, insight percakapan, serta manajemen lead. Temperatur berasal dari assessment LLM beralasan (`lead_assessments`), bukan skor numerik.

## Daftar Pekerjaan

### 1. Ikhtisar Temperatur Audiens
- [ ] Endpoint `GET /api/analytics/audience` (`accountId`, `since`, `until`, `campaignId`).
- [ ] Distribusi memakai `leads.temperature` (ditulis pipeline A2) untuk lead dengan `first_seen_at` dalam periode: jumlah dan persentase `hot`, `warm`, `cold`.
- [ ] Delta per temperatur dibanding periode sebelumnya (rentang sama panjang, berakhir `since − 1 hari`).
- [ ] Setiap baris lead membawa `confidence` dari assessment terakhir (`rendah`/`sedang`/`tinggi`); tidak ada `score`.
- [ ] Sankey cohort flow dari pasangan assessment berurutan per lead (level lama → level baru).
- [ ] Ranking campaign berdasarkan `hotLeadRate` = lead dengan tonggak HOT / total lead teratribusi pada periode; `null` + `note` bila penyebut nol.

### 2. Kecepatan Respons & Lead Macet
- [ ] Endpoint `GET /api/analytics/audience/speed` (`accountId`, `since`, `until`).
- [ ] KPI: `avgFirstReplySeconds` (dari `leads.first_replied_at - first_seen_at`), `longestWaitMinutes`, `stuckLeads` (`first_replied_at IS NULL AND now() - first_seen_at > 24 jam`).
- [ ] `buckets` dari `conversation_messages.response_seconds`: `< 15 menit`, `15–60 menit`, `1–4 jam`, `> 4 jam`.
- [ ] `cohortHeatmap` hanya bila setiap bucket berisi ≥ 10 lead; selain itu `null` + `note`.

### 3. Segmentasi Placement, Device, dan Jam
- [ ] Endpoint `GET /api/analytics/audience/segments` (`accountId`, `since`, `until`).
- [ ] Per placement (`publisher_platform`, `platform_position`): spend, leads, `hotRate`, `costPerHotLead`.
- [ ] Per device (`impression_device`): spend, leads.
- [ ] Per jam: `hours: [{hour, spendMinor, leads}]` dari `ad_insights_breakdown_daily.hour_of_day`.
- [ ] `hotRate` per placement hanya bila semua baris breakdown ad terkait pada periode itu punya satu placement; selain itu `null` + `note: "atribusi placement tidak tunggal"`.

### 4. Pipeline Lead
- [ ] Endpoint `GET /api/analytics/audience/pipeline`: assessment efektif terbaru per lead → `{leadId, name, phoneMasked, level, confidence, reason, evidenceWamid, stage, adId, creativeId, firstSeenAt, firstRepliedAt, milestoneAt:{warm, hot}}`.
- [ ] Pipeline membaca satu sumber (`lead_assessments` + `lead_milestones`); tidak membaca `wa_phone.status`.

### 5. Insight Percakapan
- [ ] Endpoint `GET /api/analytics/audience/conversations`:
  - `counts` tujuh jenis respons dari jawaban terklasifikasi **terakhir** per lead dalam periode.
  - `classifiedLeads` dan `sample.gate` = 30 chat.
  - `timed: {medianSeconds, measuredLeads, observedLeads}` — median hanya dari `response_seconds` non-null dan ≥ 0.
  - `sentiment` distribusi (`positif`/`netral`/`negatif`).
- [ ] Pasangan jawaban mengikuti A3: `context.id` bila ada, jika tidak pesan `OUTBOUND` terakhir dalam 24 jam dengan `pairMethod="sequence"`.

### 6. Manajemen Lead
- [ ] `GET /api/leads`: filter `accountId`, `temperature`, `stage`, `search`, `page`, `limit`, `sortBy`; setiap baris `{id, name, phoneMasked, temperature, stage, campaignName, waitingMinutes, createdAt}`.
- [ ] `PATCH /api/leads/:id`: ubah `stage`, `temperature`, `dealValueMinor`; hanya lead milik akun tenant (`NotFoundError` bila bukan).
- [ ] Perubahan `temperature` manual menulis baris `lead_assessments` (`confidence: "tinggi"`, `reason: "Diubah manual oleh pengguna"`, `eventAt: now()`, `applied: true`, `ruleVersion: "manual-r1"`) dalam transaksi yang sama.

## Uji Selesai
- Distribusi mengikuti `leads.temperature` hasil assessment; tidak ada perhitungan skor di service mana pun.
- `PATCH /api/leads/:id` dengan `temperature: "WARM"` menggeser hitungan warm dan menambah satu baris assessment `manual-r1`.
- Empat lead dengan jeda 10 menit, 30 menit, dua tanpa pasangan → `medianSeconds 1200`, `measuredLeads 2`, `observedLeads 4`.
- Satu lead yang awalnya bertanya lalu terakhir menolak menambah satu ke `Menolak`.
