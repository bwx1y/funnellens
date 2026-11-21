# DONE: Audience Intelligence & Leads Management

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 129 pass / 0 fail / 21 file).
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/shared/numbers.ts` (baru), `src/shared/period.ts` (baru), `src/shared/audience.ts` (baru)
  - `src/shared/dates.ts`, `src/shared/funnel.ts`
  - `src/infra/database/repositories/lead.repository.ts`
  - `src/infra/database/repositories/lead-assessment.repository.ts`
  - `src/infra/database/repositories/ad-insight-breakdown.repository.ts`
  - `src/infra/database/repositories/conversation-message.repository.ts` (baru)
  - `src/modules/analytics/service.ts`
  - `src/modules/audience/schema.ts` (baru), `src/modules/audience/service.ts` (baru), `src/modules/audience/index.ts` (baru)
  - `src/routes.ts`
  - `tests/unit/audience-helpers.test.ts` (baru), `tests/integration/analytics-audience.test.ts` (baru)
  - `tests/integration/repositories.test.ts`

## Ruang Lingkup
Tujuh endpoint: distribusi temperatur audiens + cohort flow + ranking campaign (`GET /api/analytics/audience`), kecepatan respons CS (`/speed`), segmentasi placement/device/jam (`/segments`), pipeline lead (`/pipeline`), insight percakapan (`/conversations`), daftar lead (`GET /api/leads`), dan ubah lead (`PATCH /api/leads/:id`).

Tidak ada skor komposit di mana pun: temperatur berasal dari `leads.temperature` hasil assessment, `confidence` dibaca dari baris `lead_assessments` terbaru, uang selalu `*_minor`, dan angka tak terukur dikembalikan `null` + `note`. Tugas 09/10 (ingest WhatsApp, writer assessment) belum ada; endpoint di sini hanya membaca tabel yang skemanya sudah tersedia.

## Implementasi

### 1. Helper bersama
| File | Isi |
|---|---|
| `src/shared/numbers.ts` | `round2`, `round4` (dipindah dari `funnel.ts` + `analytics/service.ts`, tidak ada duplikat ketiga), `median` (rata-rata dua nilai tengah, `null` untuk input kosong, tidak dibulatkan) |
| `src/shared/period.ts` | `DEFAULT_PERIOD_DAYS = 30`, `resolvePeriod(account, query)` — pindahan persis method privat `AnalyticsService.resolvePeriod` (default `until` hari ini di zona akun, `since = until − 29`, `since > until` → `BadRequestError("Rentang tanggal tidak valid")`, `days`, periode sebelumnya sama panjang, empat `Date`) |
| `src/shared/audience.ts` | `REPLY_TYPES` (7 jenis, urutan tetap), `SENTIMENTS`, `CONFIDENCE_LEVELS`, `RESPONSE_BUCKETS`, `HEATMAP_MIN_LEADS_PER_BUCKET = 10`, `responseBucket`, `heatmapEligible`, `buildSankey` |
| `src/shared/dates.ts` | `safeTimeZone(name)` → nama IANA bila `Intl` menerima, selain itu `"UTC"` |

`buildSankey` membuang pasangan `from === to` (level sama bukan aliran), mengurutkan `links` per `from` lalu `to`, dan selalu mengembalikan `nodes: ["COLD","WARM","HOT"]`.

### 2. Repository

| Method | Isi |
|---|---|
| `LeadRepository.getTemperatureDistribution(accountId, since, until, campaignId?)` | `count(*) filter` untuk HOT/WARM/COLD + `unassessed` (`temperature is null`) atas lead periode; filter campaign opsional |
| `LeadRepository.getLeadCountsByAd` | lead + hot lead per `ad_id` (hot = tonggak HOT, sama dengan `getCampaignLeadMetrics`); baris tanpa `ad_id` tidak dikembalikan |
| `LeadRepository.getLeadCountsByHour(…, timeZone)` | `extract(hour from first_seen_at at time zone $tz)`; `timeZone` sudah divalidasi `safeTimeZone` |
| `LeadRepository.getByIdForTenant(tenantId, id)` | join `ad_accounts` → lead tenant lain tidak bisa dibedakan dari lead yang tidak ada |
| `LeadRepository.updateManual(leadId, changes)` | satu transaksi: update `leads`, lalu sisipkan `lead_assessments` (`confidence "tinggi"`, `reason "Diubah manual oleh pengguna"`, `eventAt now()`, `applied true`, `ruleVersion "manual-r1"`, `evidence null`) hanya bila `temperature` benar-benar berubah |
| `LeadRepository.getSpeedMetrics` | diperluas `longestWaitMinutes` = `round(max(first_replied_at − first_seen_at)/60)`, `null` bila tidak ada lead yang dibalas |
| `LeadAssessmentRepository.getLevelTransitions` | `lag(level)` per lead dalam cohort periode, pasangan `from → to` dengan jumlah lead; pasangan level sama dibuang |
| `LeadAssessmentRepository.getEffectivePipeline` | satu baris per lead dengan assessment `applied = true` (baris applied terbaru), join `lead_milestones` WARM/HOT; cohort = periode, tanpa pagination |
| `AdInsightBreakdownRepository.getHourlyMetrics` | slice per jam (`hour_of_day is not null`) — `scopeFilter` privat sengaja mengecualikan baris per jam |
| `AdInsightBreakdownRepository.getAdAttributionMap` | satu baris per ad: `placementCount`/`deviceCount` plus `placementKeys`/`deviceKeys` (dibutuhkan untuk mengenali atribusi tidak tunggal) |
| `ConversationMessageRepository.getLastClassifiedCounts` | jawaban terklasifikasi **terakhir** per lead di periode, diagregasi per `(response_type, sentiment)` |
| `ConversationMessageRepository.getTimedInsights` | median respons terukur pertama per lead + `measuredLeads` + `observedLeads` (lead yang punya pesan apa pun) |
| `ConversationMessageRepository.getLeadFirstResponses` | respons terukur pertama per lead + temperatur saat ini (dasar bucket dan heatmap) |

`LeadFilterParams.stage` diperluas ke `CLOSING` (enum DB sudah punya nilainya).

### 3. Service (`src/modules/audience/service.ts`)
Semua method memanggil `requireAccountScope(tenantId, accountId)` lebih dulu (`NotFoundError("Akun iklan tidak ditemukan")`) lalu `resolvePeriod`.

- **`getAudience`** — `share = round4(count/total)` (`null` bila `total 0`), `delta` jumlah vs periode sebelumnya, `deltaPp = round2(100 × (share − prevShare))` (`null` bila salah satu `null`); `sankey` dari transisi assessment; ranking campaign `hotLeadRate = hotLeads/leads` (null di akhir, lalu `leads` menurun) dengan `note` bila penyebut nol; `sample` gerbang `≥ 30 lead`; `note` prioritas `total === 0` → `"Belum ada lead pada periode ini."`, lalu `unassessed > 0`.
- **`getSpeed`** — KPI dari `getSpeedMetrics`; `buckets` dari respons terukur **pertama** per lead (lead dengan beberapa balasan dihitung sekali, sama dengan dasar heatmap); `cohortHeatmap` 12 sel hanya bila keempat bucket ≥ 10 lead, selain itu `null` + `heatmapNote` menyebut bucket terkecil; `sample.n = min(leadsPerBucket)`.
- **`getSegments`** — lead sebuah ad hanya diatribusikan ke baris placement/device bila ad itu punya tepat satu placement/device; ad ambigu membuat `hotLeads`/`hotRate`/`costPerHotLeadMinor` `null` + `note "atribusi placement tidak tunggal"` (untuk device catatan hanya muncul bila ad ambigu itu punya lead, `leads` tetap angka); `hours` 24 entri zero-fill; `unattributedLeads = total lead periode − Σ lead ber-ad`; `sample` gerbang `≥ 100 tayangan`.
- **`getPipeline`** — memetakan assessment efektif ke ISO string + `milestoneAt {warm, hot}`; `note` bila kosong.
- **`getConversations`** — `counts` mengikuti urutan `REPLY_TYPES` (tipe di luar daftar diabaikan), `sentiment` tiga nilai, `timed.medianSeconds` dibulatkan, `sample` gerbang `≥ 30 chat`, `note` bila belum ada pesan atau sampel belum mencapai gerbang.
- **`listLeads`** — `page`/`limit` dari string query (`limit` dibatasi 1..100), `campaignName` dari `CampaignRepository.findByAccountId`, `confidence` dari `latestByLead` (`null` bila belum ada assessment), `waitingMinutes` hanya untuk lead yang belum dibalas.
- **`updateLead`** — lead dicari dengan scope tenant (`NotFoundError("Lead tidak ditemukan")`), lalu `updateManual`; `manualAssessmentId` `null` bila temperatur tidak berubah.

### 4. Endpoint
`AudienceController` (`prefix /analytics/audience`) dan `LeadController` (`prefix /leads`) di `src/modules/audience/index.ts`, keduanya `JwtUtil.isAuthenticated` + `decorate("audienceService")`, dipasang di `src/routes.ts` setelah `AnalyticsController`. Query `page`/`limit` bertipe `t.String` berpola angka (typebox terpasang tidak punya modul `numeric`); `dealValueMinor` ada di body JSON sehingga memakai `t.Integer({minimum: 0})`.

## Testing

`tests/unit/audience-helpers.test.ts` — 8 test murni: `median` (kosong, genap, ganjil), `round2`/`round4`, seluruh batas `responseBucket`, `heatmapEligible`, `buildSankey` (self-loop dibuang), `safeTimeZone` (valid + tidak dikenal).

`tests/integration/analytics-audience.test.ts` — 10 test terhadap DB nyata. Fixture: tenant `Asia/Jakarta`/`IDR`, akun utama + akun median (tenant sama) + akun tenant lain; campaign/adset/creative/4 ad; 7 baris `ad_insights_breakdown_daily` (ad4 punya dua placement, ad1 punya dua baris per jam); 8 lead (`2026-03-01`); 7 `conversation_messages` (L5 punya dua baris: 07:30Z `Tanya lanjut` dan 08:00Z `Menolak`); 5 assessment lewat `appendIfCurrent`; 4 milestone.

| Assertion | Nilai |
|---|---|
| `getAudience` distribution | `hot 3 / 0.4286`, `warm 3 / 0.4286`, `cold 1 / 0.1429`, `delta` 3/3/1, `deltaPp null` (periode lalu kosong) |
| `total` / `unassessed` | `7` / `1` |
| `sankey` | `nodes ["COLD","WARM","HOT"]`, `links [WARM→COLD 1, WARM→HOT 1]` |
| `campaigns[0]` | `leads 6`, `hotLeads 3`, `hotLeadRate 0.5`, tanpa `note` |
| `sample` / `note` | `{7, 30, false, "≥ 30 lead"}` / `"1 lead belum dinilai sehingga tidak masuk distribusi."` |
| `period` / `previousPeriod` | `{2026-03-01, 2026-03-01, 1}` / `{2026-02-28, 2026-02-28}` |
| `getSpeed` KPI | `avgFirstReplySeconds 2475`, `longestWaitMinutes 120`, `stuckLeads 4` |
| `getSpeed` buckets | `< 15 menit 2`, `15–60 menit 1`, `1–4 jam 1`, `> 4 jam 1` |
| `getSpeed` heatmap | `cohortHeatmap null`, `heatmapNote "Setiap bucket butuh ≥ 10 lead; bucket terkecil berisi 1 lead."`, `sample {1, 10, false, "≥ 10 lead per bucket"}` |
| `getSegments` `facebook/feed` | `spend 60000`, `leads 3`, `hotLeads null`, `note "atribusi placement tidak tunggal"` (ad4 punya dua placement) |
| `getSegments` `instagram/reels` | `spend 60000`, `leads 3`, `hotLeads 1`, `hotRate 0.3333`, `costPerHotLeadMinor 60000`, tanpa `note` |
| `getSegments` `messenger/story` | `spend 0`, `leads 0`, `note "atribusi placement tidak tunggal"` |
| `getSegments` devices | `iphone {80000, 5}`, `android {40000, 1}`, tanpa `note` |
| `getSegments` hours | `length 24`, `hours[9] {30000, 2}`, `hours[14] {20000, 1}`, `hours[0] {0, 0}` |
| `getSegments` atribusi | `unattributedLeads 2`, `note "2 lead tanpa atribusi iklan tidak masuk baris placement/device."`, `sample {1200, 100, true, "≥ 100 tayangan"}` |
| `getPipeline` | 3 baris; L1 `level HOT`, `confidence tinggi`, `reason "Siap order"`, `evidenceWamid "w2"`, `milestoneAt.warm/.hot` terisi; L2 `milestoneAt.warm null`; L7 tidak ada; `sample {3, 30, false}` |
| `getConversations` akun utama | `counts` 7 entri (`Komitmen 1`, `Tanya lanjut 2`, `Menunda 1`, `Menolak 1`, sisanya 0), `classifiedLeads 5`, `sentiment {1, 3, 1}`, `timed {medianSeconds 1800, measuredLeads 5, observedLeads 6}`, `note "Sampel terklasifikasi belum mencapai 30 chat."` |
| `getConversations` akun median | `timed {1200, 2, 4}` |
| `listLeads ?temperature=HOT` | `total 3`, semua `campaignName` terisi, ada `confidence "tinggi"`, semua `waitingMinutes null` |
| `listLeads` semua | `total 8`; L3 `waitingMinutes > 0`; L8 `temperature/confidence/campaignName null` |
| `updateLead` `{temperature: "HOT"}` | `manualAssessmentId` tidak null, `?temperature=HOT` jadi `4`, baris `manual-r1` berjumlah 1 (`confidence tinggi`, `reason "Diubah manual oleh pengguna"`, `applied true`) |
| `updateLead` `{stage: "CLOSED"}` | `stage "CLOSED"`, `manualAssessmentId null` |
| route smoke | `audience`, `audience/speed`, `audience/segments`, `audience/pipeline`, `audience/conversations`, `GET /api/leads`, `PATCH /api/leads/:id` semuanya `200` |
| isolasi tenant | `GET /api/analytics/audience?accountId=<akun tenant lain>` → `404 "Akun iklan tidak ditemukan"`; `PATCH /api/leads/<lead tenant lain>` → `404 "Lead tidak ditemukan"` |

Hasil verifikasi:

| Perintah | Hasil |
|---|---|
| `bunx tsc --noEmit` | 0 error |
| `bun test tests/unit/audience-helpers.test.ts` | 8 pass |
| `bun test tests/integration/analytics-audience.test.ts` | 10 pass |
| `bun test tests/integration/repositories.test.ts tests/integration/analytics-summary.test.ts tests/integration/analytics-funnel.test.ts` | 24 pass (`longestWaitMinutes: 30`; refaktor `resolvePeriod`/`round4` tidak mengubah perilaku) |
| `bun test` | 129 pass / 0 fail / 21 file |

## Catatan Teknis
- **Tidak ada skor.** Distribusi memakai `leads.temperature`, `confidence` hanya dari `lead_assessments` terbaru; tidak ada field `score` di service mana pun.
- **Periode lalu kosong → `deltaPp null`.** `delta` tetap berupa selisih jumlah (boleh negatif) supaya pergerakan absolut tetap terbaca.
- **Satu definisi "respons terukur".** Bucket dan median memakai respons **pertama** per lead (`response_seconds` non-null dan ≥ 0); lead dengan beberapa balasan tidak dihitung dua kali, dan bucket selalu konsisten dengan heatmap serta `sample`.
- **Atribusi placement/device butuh kunci per ad.** `getAdAttributionMap` mengembalikan `placementKeys`/`deviceKeys` (bukan hanya pasangan `min()`), karena ad dengan dua placement harus membuat baris placement mana pun yang disentuhnya ambigu — kalau tidak, `messenger/story` akan lolos tanpa catatan.
- **`PATCH` memakai lookup ber-scope tenant** (`getByIdForTenant`) sehingga lead milik tenant lain menghasilkan `404 "Lead tidak ditemukan"`, bukan bocor sebagai "akun tidak ditemukan".
- **Baris `manual-r1` hanya ditulis saat temperatur berubah**, agar hitungan assessment tidak terisi baris palsu; `evidence` baris manual `null`, sedangkan kontrak `evidence` pipeline adalah `{"wamid": …}`.
- **`confidence` di daftar lead `null` bila belum ada assessment** — bukan `"rendah"`, karena tingkat keyakinan yang tidak terukur tidak boleh dikarang.
- **Sankey membuang `HOT→HOT`**: pasangan level sama bukan aliran; ubah filter di `buildSankey` bila produk menghendaki self-loop.
- **`stuckLeads` tetap account-wide** (belum dibalas > 24 jam) dan tidak mengikuti periode, sama seperti definisi di `getSpeedMetrics` sebelumnya; `longestWaitMinutes` hanya dari lead yang sudah dibalas pada periode.
