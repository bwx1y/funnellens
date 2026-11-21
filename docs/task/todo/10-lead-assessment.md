# TODO: Lead Assessment & Response Types

## Gambaran Fitur
Menentukan temperatur lead (Cold/Warm/Hot) dari penilaian LLM yang beralasan dan dapat diaudit, mencatat kapan tiap level pertama kali tercapai, serta mengelompokkan jawaban lead ke tujuh jenis respons dengan jeda balas CS yang terukur.

## Daftar Pekerjaan

### 1. Skema keputusan
- [ ] `src/modules/audience/constants.ts`: `ASSESS_PROMPT_VERSION = "a2-v1"`, `SIGNAL_SCHEMA` (level 1), `DECISION_SCHEMA` (level 2).
- [ ] `DECISION_SCHEMA` = TypeBox object `{level: enum(leadTemperatureEnum), confidence: enum("rendah","sedang","tinggi"), reason: string, evidenceWamid: string, responseType: enum(REPLY_TYPES), sentiment: enum(SENTIMENTS)}`.
- [ ] `REPLY_TYPES` = `Komitmen`, `Tanya lanjut`, `Keberatan`, `Menunda`, `Menolak`, `Pengakuan netral`, `Di luar topik`.
- [ ] `SENTIMENTS` = `positif`, `netral`, `negatif`.

### 2. Pipeline `assess`
- [ ] Muat 30 pesan terakhir lead (urut `sentAt`).
- [ ] **Level 1** `gemini.generateObject<Signals>` dengan prompt sistem `rubricFor(tenant)` (konteks penawaran tenant; rubric default bila kosong) + pesan termasking; keluaran sinyal per `wamid`.
- [ ] **Level 2** `gemini.generateObject<Decision>` (`temperature: 0`) dengan `previous: lead.temperature`, `signals`, `messages`.
- [ ] `validateEvidence(decision, messages)`: `evidenceWamid` harus ada di input, `responseType` ∈ `REPLY_TYPES`, `confidence` ∈ enum. Gagal → retry maksimal 2 lalu simpan `UNAVAILABLE` tanpa mengubah level lead.
- [ ] Transaksi: `leadAssessments.appendIfCurrent` (insert; bila `eventAt` lebih lama dari `max(eventAt)` lead itu → `applied=false` dan enqueue `reassess` dengan `from: eventAt`), `leadMilestones.recordFirst(leadId, level, eventAt)` untuk WARM/HOT (`onConflictDoNothing`), update `leads.temperature` hanya bila `applied` dan baris itu yang terbaru.
- [ ] Set `conversation_messages.responseType`, `sentiment`, `senderRole="LEAD"`, `repliedAt` (= `csAt`) dan `responseSeconds` bila dipasangkan.
- [ ] Job `reassess`: replay pesan lead kronologis dari `from`, panggil pipeline level 1+2 per pesan masuk, tidak menulis tonggak baru kecuali belum ada.
- [ ] Tanpa `GEMINI_API_KEYS`: assessment `UNAVAILABLE`, level lead tidak berubah, sistem tetap jalan.

### 3. Pasangan jawaban (`pairReply`)
- [ ] `contextWamid` ada → `pairMethod="reply"`, `csAt` = `sentAt` pesan CS ber-wamid tersebut.
- [ ] Tidak ada → cari pesan `OUTBOUND` terakhir sebelum inbound dalam 24 jam → `pairMethod="sequence"`.
- [ ] Tidak ada keduanya → `pairMethod=null`.
- [ ] `responseSeconds = csAt && csAt <= sentAt ? round((sentAt - csAt)/1000) : null`.

### 4. Endpoint
- [ ] `GET /api/analytics/audience/pipeline`: assessment terbaru per lead → `{leadId, name, phoneMasked, level, confidence, reason, evidenceWamid, stage, adId, creativeId, firstSeenAt, firstRepliedAt, milestoneAt:{warm, hot}}`.
- [ ] `GET /api/analytics/audience/conversations`: `counts` tujuh jenis (jawaban terklasifikasi terakhir per lead), `classifiedLeads`, `timed:{medianSeconds, measuredLeads, observedLeads}`, `sentiment` distribusi; `sample.gate` = 30 chat.

## Uji Selesai
- Pesan "Saya ambil 500 lusin, bisa kirim invoice?" → assessment HOT dengan `evidenceWamid` yang ada di fixture dan satu baris `lead_milestones` level HOT.
- Replay pesan yang lebih lama → `applied=false`, `leads.temperature` tidak berubah, tonggak HOT tetap satu baris.
- Satu lead yang awalnya bertanya lalu terakhir menolak menambah satu ke kategori `Menolak` (bukan dua).
- Empat lead dengan jeda 10 menit, 30 menit, dan dua tanpa pasangan → `medianSeconds 1200`, `measuredLeads 2`, `observedLeads 4`.
