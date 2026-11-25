# TODO: WhatsApp Cloud API Ingestion

## Gambaran Fitur
Menerima pesan WhatsApp lewat Cloud API resmi, memverifikasi tanda tangan HMAC, dan menulis lead + pesan ke database sehingga satu chat dapat ditelusuri `wamid → lead → ad → campaign → creative`. Jalur OpenWA yang ada di-cutover ke service yang sama agar hanya ada satu penulis `leads` dan `conversation_messages`.

## Daftar Pekerjaan

### 1. Konfigurasi
- [x] `Config.whatsapp.verifyToken` dari `WA_VERIFY_TOKEN`; app secret memakai `Config.meta.appSecret` (tidak diduplikasi).
- [x] `.env.example`: tambah `WA_VERIFY_TOKEN=`.
- [x] Bila `Config.meta.appSecret` kosong atau masih bernilai `"APP_SECRET"`, `POST /webhook` menolak semua permintaan dengan `UnauthorizedError("Webhook signature tidak dapat diverifikasi")`.

### 2. Webhook Controller (`src/modules/wa/cloud/index.ts`, prefix `/wa/cloud`)
- [x] `GET /webhook`: `hub.mode === "subscribe"` dan `hub.verify_token === Config.whatsapp.verifyToken` → balas `hub.challenge` sebagai teks; selain itu `UnauthorizedError`.
- [x] `POST /webhook`:
  - Baca `raw = await request.text()`.
  - Hitung `createHmac("sha256", Config.meta.appSecret).update(raw).digest("hex")`.
  - Bandingkan dengan `X-Hub-Signature-256` (buang prefiks `sha256=`) memakai `timingSafeEqual` setelah cek panjang.
  - Tidak cocok → `UnauthorizedError`, tidak ada baris tersimpan.
  - Cocok → `cloudQueue.add("ingest", {raw, receivedAt}, {jobId: sha256(raw).slice(0,32)})` lalu balas `{status: true}` **sebelum** pemrosesan.

### 3. Worker `ingest`
- [x] `binding = waPhoneRepo.findByPhoneNumberId(entry.metadata.phone_number_id)`; tidak ada → `logger.warn` dan return tanpa retry.
- [x] Iterasi **setiap** `entry[].changes[].value.messages[]`.
- [x] Atribusi: `msg.referral?.source_type === "ad"` → `adRepository.findAtTime(binding.accountId, referral.source_id, eventAt)` (join `ad_creatives`, `created_time <= at` dan `updated_time is null or updated_time >= at`); bila tidak ada kecocokan waktu, pakai baris `ads` terbaru dan set `leads.attribution_note = "attribution_after_change"`.
- [x] Identitas lead: `phoneE164 = normalizePhone(msg.from)`, `phoneHash = sha256(phoneE164 + Config.application.secret)`, `phoneMasked = phoneE164[0..4] + "****" + phoneE164[-4..]`, `externalId = phoneHash` (nomor mentah tidak pernah disimpan).
- [x] Satu transaksi:
  - `leads.insertIfAbsent(...)` dengan `onConflictDoNothing` pada `(account_id, external_id)`. Atribusi (`campaignId`, `adsetId`, `adId`, `creativeId`) ditulis hanya saat baris lahir (first touch); pesan berikutnya tidak boleh menimpa menjadi `NULL`.
  - `conversation_messages.insertOnce(...)` dengan `onConflictDoNothing` pada `(lead_id, wamid)`. Tidak ada baris kembali → **tidak** enqueue assessment.
  - Baris baru → `assessmentQueue.add("assess", {leadId, messageId}, {jobId: "assess:" + msg.id})`.
- [x] Pesan keluar: proses `value.message_echoes[]` (Cloud) dan `message.fromMe === true` (OpenWA) sebagai `direction: "OUTBOUND"`, `senderRole: "CS"`, body termasking, `onConflictDoNothing` pada `(lead_id, wamid)`; tidak enqueue assessment. Isi `leads.firstRepliedAt` bila masih `NULL`.
- [x] `maskText`: ganti setiap deret 6+ digit dengan `"####"`; pesan asli tidak pernah disimpan.

### 4. Cutover jalur OpenWA (`src/modules/wa/webhook/worker.ts`)
- [x] Hapus penulisan `wa_phone.status` dan `wa_message`, blok buffer Redis 10 detik, prompt TOON (`SYSTEM_PROMPT`, `TOON_SCHEMA`, `TOON_FEW_SHOT`, `parseToonSafely`), panggilan Gemini di worker ini, dan import `@toon-format/toon`.
- [x] Ganti dengan `cloudService.ingestOpenWa({sessionId, message})` per pesan sehingga pesan tersimpan segera tanpa jendela buffer.
- [x] `wa_message`/`WaMessageEntity` tetap ada (dipakai sesi) tetapi tidak lagi ditulis dari webhook.
- [x] Hapus `tests/integration/toon-worker.test.ts`.

## Uji Selesai
- POST webhook yang sama dua kali (tanda tangan valid) → `conversation_messages` berisi 1 baris untuk `wamid` tersebut dan hanya satu job `assess:*`.
- Chat tanpa `referral` tetap tersimpan dengan `ad_id` NULL.
- Tanda tangan salah → 401 dan tidak ada baris baru.
- Echo pesan CS → satu baris `OUTBOUND`/`CS`, `leads.firstRepliedAt` terisi, `GET /api/analytics/audience/conversations` mengembalikan `timed.measuredLeads ≥ 1` (route `funnel/velocity` tidak ada di codebase; `measuredLeads` dihitung dari `conversation_messages.response_seconds`).
