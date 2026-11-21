# DONE: WhatsApp Cloud API Ingestion

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 214 pass / 0 fail / 33 file).
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/shared/phone.ts` (baru) — `normalizePhone`, `phoneHash`, `maskPhone`, `maskText`
  - `src/infra/database/repositories/conversation-ingest.repository.ts` (baru)
  - `src/infra/database/repositories/wa-phone.repository.ts` — `findBySessionId`
  - `src/modules/wa/cloud/types.ts`, `queue.ts`, `service.ts`, `index.ts`, `worker.ts` (baru)
  - `src/modules/audience/queue.ts` (baru) — kontrak `lead-assessment`
  - `src/modules/wa/webhook/worker.ts` (ditulis ulang), `schema.ts`
  - `src/routes.ts`
  - `tests/unit/wa-cloud-helpers.test.ts` (baru), `tests/integration/wa-cloud-ingestion.test.ts` (baru)
  - Dihapus: `src/modules/wa/webhook/prompts/` (3 JSON), `src/infra/database/repositories/wa-message.repository.ts`, `tests/integration/toon-worker.test.ts`, `LeadAiResponse`

## Ruang Lingkup
Satu jalur ingest untuk WhatsApp: `POST /api/wa/cloud/webhook` memverifikasi HMAC-SHA256 lalu meng-enqueue body mentah, worker menulis `leads` + `conversation_messages`. Jalur OpenWA di-cutover ke penulis yang sama sehingga hanya ada satu kode yang membuat lead dan pesan. Satu `wamid` → maksimal satu baris pesan; atribusi mengalir `wamid → lead → ad → campaign → creative`; echo CS menandai lead sudah dibalas.

## Implementasi

### 1. Helper (`src/shared/phone.ts`)
| Fungsi | Perilaku |
|---|---|
| `normalizePhone(raw)` | trim, potong di `@` pertama, sisakan digit; `0…` → `62…`, `8…` → `62…`; kosong → `""`; hasil `"+" + digit` |
| `phoneHash(phone)` | `sha256(phone + Config.application.secret)` hex — nomor mentah tidak pernah disimpan |
| `maskPhone(phone)` | `len ≤ 8` → `"****"`; selain itu `4 awal + "****" + 4 akhir` |
| `maskText(body)` | setiap deret ≥ 6 digit → `"####"` |

### 2. Repository transaksional (`conversation-ingest.repository.ts`)
Satu-satunya penulis `leads` + `conversation_messages`; transaksi tetap di dalam `src/infra/database/`.

| Method | Isi |
|---|---|
| `ingestInbound` | insert lead `onConflictDoNothing (account_id, external_id)` (atribusi hanya ditulis saat baris lahir) → bila tidak ada baris, `select` id → insert pesan `onConflictDoNothing (lead_id, wamid)` |
| `ingestOutbound` | insert lead yang sama dengan `firstMessage`/`firstSeenAt` NULL → insert pesan `OUTBOUND`/`CS`; bila baris pesan tidak lahir, berhenti (tanpa pairing) |
| pairing echo | `update … set replied_at, pair_method='sequence', response_seconds = csAt − sent_at` untuk pesan INBOUND belum terbalas dalam 24 jam terakhir (`order by sent_at desc, id desc limit 1`) |
| `first_replied_at` | `update leads … where first_replied_at is null` — echo berulang tidak menggeser nilai |

`IngestResult.messageId` bernilai `null` ketika `(lead_id, wamid)` sudah ada, sehingga pemanggil tidak meng-enqueue assessment ganda.

### 3. Service (`src/modules/wa/cloud/service.ts`)
Constructor DI (repo, dua queue, `appSecret`) sehingga test menyuntik fake tanpa Redis.

| Method | Isi |
|---|---|
| `signatureConfigured` | `false` bila secret `""` atau `"APP_SECRET"` |
| `isValidSignature` | `false` bila belum terkonfigurasi / header bukan `sha256=`; `createHmac("sha256", secret)` → `timingSafeEqual` **setelah** cek panjang buffer (header hex tidak valid menghasilkan buffer lebih pendek) |
| `enqueue` | `cloudQueue.add("ingest", {raw, receivedAt ISO}, {jobId: sha256(raw).slice(0,32)})` |
| `ingest` | `JSON.parse` di dalam `try` (gagal → `logger.warn` + return, tanpa retry); iterasi setiap `entry[].changes[].value` |
| `ingestOpenWa` | nomor bisnis = `fromMe ? from : to`; `findBySessionId` → `upsert` bila belum ada; akun diselesaikan sama seperti Cloud |
| `writeMessage` | normalisasi nomor, `wamid` wajib, masking body, atribusi, lalu `ingestInbound`/`ingestOutbound`; inbound baru → `assessmentQueue.add("assess", {leadId, messageId}, {jobId: "assess:" + wamid})` |

Waktu event: `Number(timestamp)`; finite dan `> 0` → `> 1e12` dianggap milidetik, selain itu detik; gagal → `receivedAt`. Body: `text.body ?? button.text ?? null`.

### 4. Controller & route (`src/modules/wa/cloud/index.ts`, prefix `/wa/cloud`)
Kedua route publik (Meta yang memanggil): tanpa `JwtUtil.isAuthenticated`, tanpa entri `security`.

| Route | Isi |
|---|---|
| `GET /webhook` | `hub.mode=subscribe` + `hub.verify_token = Config.whatsapp.verifyToken` + `hub.challenge` → `Response` `text/plain` berisi challenge; selain itu `UnauthorizedError("Verifikasi webhook gagal")` |
| `POST /webhook` | `raw = await request.text()` (tanpa body schema) → secret belum terkonfigurasi → `UnauthorizedError("Webhook signature tidak dapat diverifikasi")` → signature salah → `UnauthorizedError("Webhook signature tidak valid")` → `enqueue` → `{status: true}` |

Query dibaca dari `new URL(request.url).searchParams` karena key bertitik (`hub.mode`) rapuh bila lewat TypeBox.

### 5. Queue & worker
| Queue | Job | Opsi |
|---|---|---|
| `wa-cloud` (`WaCloudQueue`) | `ingest` `{raw, receivedAt}` | attempts 3, backoff exponential 5000 ms, `removeOnComplete 100`, `removeOnFail 200` |
| `lead-assessment` (`LeadAssessmentQueue`) | `assess` `{leadId, messageId}` | sama; kontrak disiapkan agar task 10 tinggal menambah worker |

`worker.ts` Cloud ditemukan otomatis oleh glob `./modules/**/worker.ts` di `src/index.ts`. Tanpa `try/catch`: JSON rusak dan nomor tak terikat ditelan di `ingest`, kegagalan DB nyata dilempar agar BullMQ retry.

### 6. Cutover OpenWA (`src/modules/wa/webhook/worker.ts`)
`ProcessMessageJob` dan queue `WaWebhook-Chat` tetap; `@lid` tetap diselesaikan lewat `OpenWAClient.contacts.get`. Setelah itu satu panggilan `cloudService.ingestOpenWa({sessionId, message})`. Buffer Redis 10 detik, prompt TOON, panggilan Gemini, dan penulisan `wa_message`/`wa_phone.status` dihapus, sehingga pesan tersimpan tanpa jendela buffer. `wa_message` tetap ada karena `WaPhoneRepository.findAllByTenantId` masih membacanya untuk UI sesi.

## Pengujian
| Uji | Cakupan |
|---|---|
| `tests/unit/wa-cloud-helpers.test.ts` | `normalizePhone` 4 bentuk + kosong, `maskPhone`, `maskText`; `isValidSignature` cocok/berubah/header hilang/header non-hex; secret `""` dan `"APP_SECRET"` → `false` + `signatureConfigured false` |
| `tests/integration/wa-cloud-ingestion.test.ts` (Postgres nyata, Redis di-stub) | signature salah → 401 + 0 baris; signature valid → 200 + satu job `ingest` dengan `jobId = sha256(raw).slice(0,32)`; ingest dua kali → 1 baris `wamid` + 1 job `assess:<wamid>`; lead tanpa `referral` → `ad_id`/`attribution_note` NULL, `phone_masked`, `external_id = phoneHash`, body termasking; `referral` ad → rantai campaign/adset/ad/creative terisi, creative berubah → `attribution_after_change`; echo → 1 baris `OUTBOUND`/`CS`, `replied_at` + `response_seconds = 120`, `first_replied_at` terisi, `GET /api/analytics/audience/conversations` → `timed.measuredLeads ≥ 1`; `ingestOpenWa` inbound/outbound menulis tabel yang sama |

## Keputusan & Catatan
- **Nomor tak terikat → `continue`, bukan `return`**: satu body webhook dapat membawa beberapa WABA; melewati yang tidak dikenal tidak boleh membuang yang lain, dan keduanya tidak memicu retry.
- **Akun = `wa_phone.account_id ?? findSelectedByTenantId(tenant)`**: tidak ada kode yang menulis `wa_phone.account_id` (termasuk `upsert` di jalur OpenWA), sehingga akun terpilih milik tenant adalah binding. Bila suatu saat kolom itu terisi, fallback menjadi inert.
- **Pairing di sisi echo**: `replied_at` di baris INBOUND diisi waktu kirim CS dan `response_seconds = csAt − sent_at` (waktu tunggu lead), karena penerimaan "CS echo terukur" mengharuskan `measuredLeads ≥ 1` tepat setelah echo. Task 10 harus memperlakukan baris dengan `replied_at IS NOT NULL` sebagai sudah terpasangkan.
- **`message_echoes` bukan bagian Cloud API publik**: diperlakukan sebagai array `CloudMessage` dengan `to` sebagai nomor pelanggan; bila `to` tidak ada, dipakai `from`.
- **`sourcePlatform`/`sourcePosition` dibiarkan NULL**: task tidak menentukan nilainya; mengarang label kanal akan mengubah filter analitik.
- **Route `funnel/velocity` tidak ada** di codebase dan tidak dibuat; bukti "echo terukur" memakai `GET /api/analytics/audience/conversations`.
- **Raw SQL memakai string ISO**: `tx.execute` di-bind oleh postgres.js yang hanya menyerialisasi string, sehingga `sentAt.toISOString()` dipakai dengan cast `::timestamptz` eksplisit.
