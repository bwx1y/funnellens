# DONE: Lead Assessment & Response Types

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 233 pass / 0 fail / 35 file).
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/modules/audience/constants.ts` (baru) — `ASSESS_PROMPT_VERSION`, `SIGNAL_SCHEMA`, `DECISION_SCHEMA`, rubric, instruksi dua tingkat
  - `src/modules/audience/assess.service.ts` (baru) — `validateEvidence`, `pairReply`, `LeadAssessmentService`
  - `src/modules/audience/worker.ts` (baru) — worker `assess` + `reassess`
  - `src/modules/audience/queue.ts` — `LeadAssessmentJobData`, `assessJobId`, `reassessJobId`
  - `src/infra/database/repositories/lead-assessment.repository.ts` — `applyAssessment`, `appendUnavailable`, `tx` opsional, filter `applied`
  - `src/infra/database/repositories/lead-milestone.repository.ts` — `tx` opsional
  - `src/infra/database/repositories/conversation-message.repository.ts` — `findById`, `findWindow`, `findInboundFrom`, `findReplyCandidates`, `applyClassification`
  - `src/infra/database/repositories/lead.repository.ts` — `findById`
  - `src/shared/audience.ts` — `TEMPERATURE_LEVELS`
  - `src/modules/wa/cloud/service.ts` — memakai `assessJobId`
  - `tests/unit/lead-assessment.test.ts` (baru), `tests/integration/lead-assessment.test.ts` (baru)

## Ruang Lingkup
Pipeline dua tingkat: level 1 mengekstrak sinyal per pesan, level 2 memutuskan level + jenis jawaban. Keputusan ditulis sekali dalam satu transaksi bersama tonggak WARM/HOT dan `leads.temperature`; keputusan yang lebih lama dari yang tersimpan tetap dicatat tetapi tidak diterapkan, lalu lead di-replay dari titik itu. Jawaban CS dipasangkan ke pesan lead sehingga jeda balas terukur, dan jawaban lead diklasifikasi ke tujuh jenis respons.

## Implementasi

### 1. Skema & prompt (`src/modules/audience/constants.ts`)
| Ekspor | Isi |
|---|---|
| `ASSESS_PROMPT_VERSION` | `"a2-v1"` — bagian dari kunci dedupe `(lead_id, event_at, rule_version)` |
| `UNAVAILABLE_RULE_VERSION` | `"a2-v1-unavailable"` — penanda assessment tak tersedia |
| `ASSESS_MESSAGE_LIMIT` / `ASSESS_RETRIES` | 30 pesan konteks; 2 retry setelah percobaan pertama |
| `SIGNAL_SCHEMA` | `{signals: [{wamid, intent, product, budget, urgency, objection, sentiment}]}` |
| `DECISION_SCHEMA` | `{level, confidence, reason, evidenceWamid, responseType, sentiment}` |
| `rubricFor(tenant)` | konteks penawaran tenant (`name`, `address`) + rubrik default HOT/WARM/COLD, tabel tujuh jenis jawaban, dan rubrik sentimen/keyakinan |
| `SIGNAL_INSTRUCTION` / `DECISION_INSTRUCTION` | instruksi tiap tingkat; `evidenceWamid` wajib salah satu wamid input |

`REPLY_TYPES`, `SENTIMENTS`, `CONFIDENCE_LEVELS`, `TEMPERATURE_LEVELS` tetap satu sumber di `@shared/audience`; skema dibangun dari konstanta itu sehingga tidak bisa menyimpang.

### 2. Service (`src/modules/audience/assess.service.ts`)
`LeadAssessmentService` dengan DI (repo, queue, `{model, apiKeys}`).

| Method | Isi |
|---|---|
| `assess({leadId, messageId})` | lead/pesan harus ada dan pesan ber-`direction INBOUND`; selain itu warning tanpa retry |
| `reassess({leadId, from})` | replay setiap pesan INBOUND dari `from` (kronologis), membaca ulang `leads.temperature` tiap langkah; **tidak pernah** meng-enqueue `reassess` lagi |
| `decide(lead, window, tenant)` | `apiKeys` kosong → langsung gagal tanpa panggilan model; level 1 lalu level 2 (`temperature: 0`), `validateEvidence` per percobaan, maksimal 3 percobaan |
| `evaluate(...)` | keputusan → `applyAssessment` → `pairReply` + `applyClassification` → enqueue `reassess` bila `applied=false` |

`validateEvidence(decision, messages)` mengembalikan alasan kegagalan atau `null`: `evidenceWamid` tidak kosong dan ada di input, `level`/`confidence`/`responseType`/`sentiment` ∈ enum, `reason` tidak kosong.

`pairReply({sentAt, contextReply, sequenceReply})` → `{pairMethod, csAt, responseSeconds}` atau `null`:
- `contextReply` (OUTBOUND dengan `context_wamid` = wamid pesan) → `"reply"`;
- selain itu `sequenceReply` (OUTBOUND pertama dalam 24 jam setelah pesan) → `"sequence"`;
- tidak ada keduanya, atau balasan lebih awal dari pesan → `null`.

### 3. Penulisan (`lead-assessment.repository.ts`)
`applyAssessment(assessment)` — satu transaksi:
1. `appendIfCurrent` (dengan `tx`): hitung `max(event_at)` lead, `applied = event_at >= max`, insert `onConflictDoNothing` pada `(lead_id, event_at, rule_version)`; konflik → baris tersimpan dikembalikan.
2. `applied` dan level WARM/HOT → `leadMilestones.recordFirst(leadId, level, eventAt, tx)` (`onConflictDoNothing`).
3. `applied` → `update leads set temperature = level`.

`appendUnavailable(...)` — baris penanda `applied = false`, `rule_version = a2-v1-unavailable`, `confidence "tidak tersedia"`, `evidence {status: "UNAVAILABLE", error}`, `level` = level lead saat itu (`COLD` bila belum ada). Karena `rule_version` berbeda, percobaan sukses berikutnya pada `event_at` yang sama tetap bisa masuk.

`latestByLead` dan `getLevelTransitions` kini hanya membaca baris `applied = true`, sehingga penanda maupun baris replay tidak pernah muncul sebagai level/transisi.

### 4. Klasifikasi & pasangan (`conversation-message.repository.ts`)
| Method | Isi |
|---|---|
| `findWindow(leadId, until, limit)` | 30 pesan terakhir sampai `until`, urut naik |
| `findInboundFrom(leadId, from)` | rentang replay `reassess` |
| `findReplyCandidates(leadId, wamid, sentAt)` | balasan ber-`context_wamid` + balasan pertama dalam 24 jam |
| `applyClassification(...)` | set `response_type`, `sentiment`, `sender_role = 'LEAD'`; `replied_at`/`pair_method`/`response_seconds` memakai `coalesce` sehingga pasangan yang sudah ada (jalur echo task 09) tidak pernah ditimpa |

### 5. Queue & worker
- `lead-assessment` dengan dua job: `assess {leadId, messageId}` dan `reassess {leadId, from}`.
- `assessJobId(wamid)` = `assess-<wamid>`, `reassessJobId(leadId, from)` = `reassess-<leadId>-<epochMs>`: BullMQ menolak custom id yang mengandung `:`, jadi id task 09 (`assess:<wamid>`) diperbaiki di sini dan diverifikasi terhadap Redis nyata (job duplikat tetap ter-dedupe).
- Worker `src/modules/audience/worker.ts` ditemukan otomatis oleh glob `./modules/**/worker.ts`; tanpa `try/catch` karena assessment tak tersedia sudah ditangani di service, sehingga hanya kegagalan tak terduga yang memicu retry BullMQ.

### 6. Endpoint
`GET /api/analytics/audience/pipeline` dan `GET /api/analytics/audience/conversations` sudah ada sejak task 05 (`docs/task/done/10-audience-intelligence.md`) dengan bentuk respons yang diminta; task ini membuktikan keduanya menerima baris hasil pipeline (lihat pengujian).

## Pengujian
| Uji | Cakupan |
|---|---|
| `tests/unit/lead-assessment.test.ts` | skema memuat tepat `TEMPERATURE_LEVELS`/`CONFIDENCE_LEVELS`/`REPLY_TYPES`/`SENTIMENTS` dan tidak memakai `anyOf`/`const` (ditolak Gemini); `rubricFor` dengan/tanpa konteks tenant; `validateEvidence` (bukti di luar input, kosong, enum asing, alasan kosong); `pairReply` (context → `reply` 120 dtk, sequence → `sequence` 300 dtk, tanpa pasangan, balasan lebih awal → `null`) |
| `tests/integration/lead-assessment.test.ts` (Postgres nyata, model di-inject) | "Saya ambil 500 lusin, bisa kirim invoice?" → `HOT` + `evidenceWamid` fixture + 1 baris `lead_milestones` HOT + `leads.temperature` HOT + `conversation_messages` terklasifikasi; replay pesan lebih lama → `applied=false`, level & tonggak tetap, satu job `reassess` (`from`, `jobId`); `reassess` kronologis tanpa tonggak/job baru; bukti invalid 3 percobaan → penanda `UNAVAILABLE` (6 panggilan model), level tetap `null`; tanpa API key → penanda tanpa panggilan model; pasangan `reply`/`sequence`/`null` beserta `response_seconds`; lead bertanya lalu menolak → `Menolak 1`, `Tanya lanjut 0`; 4 lead (600 dtk, 1800 dtk, dua tanpa pasangan) → `medianSeconds 1200`, `measuredLeads 2`, `observedLeads 4` lewat route `conversations` |

Verifikasi tambahan di luar suite: satu panggilan Gemini nyata (`.env`) memastikan kedua `responseSchema` diterima dan mengembalikan `{level: "HOT", responseType: "Komitmen", evidenceWamid: <pesan lead>}`; pipeline dijalankan penuh terhadap Postgres + Gemini nyata (assessment HOT, milestone HOT, `pair_method "reply"`, `response_seconds 180`).

## Keputusan & Catatan
- **`UNAVAILABLE` disimpan sebagai baris penanda**, bukan kolom baru: `lead_assessments` tidak punya kolom status dan task tidak meminta migrasi. Baris memakai `rule_version` sendiri, `applied = false`, dan `confidence "tidak tersedia"`; karena `latestByLead` hanya membaca baris `applied`, nilai itu tidak pernah muncul di API.
- **Arah pasangan mengikuti pembaca yang sudah ada**: `replied_at` = waktu kirim CS, `response_seconds` = `csAt − sent_at` (jeda tunggu CS) pada baris INBOUND, sesuai `getTimedInsights`/`getLeadFirstResponses` dan jalur echo task 09. Rumus literal TODO (`sentAt − csAt` dengan `csAt <= sentAt`) adalah arah sebaliknya dan akan membuat `getSpeed`/`avgFirstReplySeconds` menghitung kecepatan lead, bukan CS.
- **`coalesce` saat klasifikasi**: pasangan yang sudah ditulis jalur echo tidak ditimpa, sehingga satu balasan CS tidak pernah terhitung dua kali.
- **Penanda `UNAVAILABLE` tidak memblokir percobaan berikutnya** karena memakai `rule_version` berbeda; replays (`a2-v1`) tetap idempoten pada `(lead_id, event_at, rule_version)`.
- **`reassess` tidak pernah meng-enqueue dirinya sendiri**: hanya `assess` yang meng-enqueue replay, sehingga tidak ada loop ketika replay tetap menghasilkan `applied=false` (pesan lama).
- **Skema Gemini memakai `enum`, bukan `anyOf`/`const`**: TypeBox literal union ditolak API (`Unknown name "const"`); `t.Unsafe<Literal>({type: "string", enum: [...]})` memberi JSON Schema yang diterima sekaligus tipe literal di TypeScript.
- **`sourcePlatform`/`sourcePosition`, `signals` di `leads`** tidak diisi: `signals` level 1 disimpan di `lead_assessments.evidence` agar audit tetap satu tempat.
