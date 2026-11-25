# TODO: Operasional Produksi — Cache, Health Probe, DLQ, Rate Limit, Metrik, Retensi

## Gambaran Fitur
Backend belum punya lapisan operasional: tidak ada cache agregasi, tidak ada health probe, tidak ada dead-letter queue, tidak ada rate limit per token, tidak ada request id, dan tidak ada kebijakan retensi/backup. Task ini menutup F-21.1–F-21.6.

## Daftar Pekerjaan

### 1. Cache agregasi (F-21.2)
- [x] Buat `src/infra/cache/index.ts` dengan `AggregationCache` berbasis `redisConnection` (`src/infra/redis`):
  - `key(scope: {endpoint, tenantId, accountId, campaignId?, since, until, objectiveGroup?})` → `agg:v1:{accountId}:{endpoint}:{tenantId}:{campaignId|all}:{since}:{until}:{objectiveGroup|all}`. Dua tambahan dari spesifikasi: `tenantId` (lookup terjadi sebelum `requireAccountScope`, jadi tanpa tenant satu workspace bisa membaca laporan workspace lain) dan `endpoint` (tanpa itu `summary` dan `funnel` dengan jendela sama akan bertabrakan). `accountId` tetap segmen pertama agar pola invalidasi `agg:v1:{accountId}:*` berlaku.
  - `get<T>(key): Promise<T | null>` dan `set(key, value, ttlSeconds = 300)`; kegagalan Redis hanya di-`warn`, request tetap jalan tanpa cache.
- [x] Bungkus `AnalyticsService.getSummary`, `getFunnel`, `getLeakage` dengan cache di atas; `getStageDetail` tidak di-cache (kardinalitas `stageKey` tinggi).
- [x] Invalidate setelah sync sukses: di `src/modules/meta/worker.ts` setelah `syncInsights` selesai, jalankan `SCAN 0 MATCH agg:v1:{accountId}:* COUNT 500` + `DEL` bertahap (jangan `KEYS`).
- [x] Respons cache hit harus byte-identik dengan miss (test membandingkan dua pemanggilan berurutan).

### 2. Health probe (F-21.5)
- [x] Tambah `src/modules/health/{index.ts,service.ts}` dan daftarkan di `src/routes.ts` **tanpa** `JwtUtil.isAuthenticated`, prefix `/health`.
- [x] `GET /api/healthz` → selalu `{status: true}` dengan `200` selama proses hidup; tidak menyentuh DB/Redis.
- [x] `GET /api/readyz` → `200` hanya bila ketiga syarat terpenuhi, selain itu `503` dengan `{status: false, checks: {...}}`:
  - `database: true` bila `select 1` berhasil dalam 2 detik.
  - `redis: true` bila `PING` berhasil dalam 2 detik.
  - `sync: {lastSuccessAt: string | null, overdue: boolean}` — `overdue = true` bila `lastSuccessAt` lebih tua dari 36 jam atau `null`.
- [x] `readyz` **tidak** boleh melempar exception; setiap kegagalan menjadi field `false` + `message`.

### 3. Dead-letter queue (F-21.1)
- [x] Tambah queue `meta-sync-dlq` di `src/modules/meta/queue.ts` dengan payload `{jobName, data, error, failedAt, attemptsMade}`.
- [x] Di `WorkerManager` (`src/infra/queue/index.ts`), daftarkan handler `failed` untuk queue `meta-sync` yang meneruskan job ke DLQ setelah `attempts` habis.
- [x] Tambah `GET /api/meta/queue/dlq` (admin-only) mengembalikan 50 entri DLQ terakhir, dan `DELETE /api/meta/queue/dlq/{id}` untuk membuang entri setelah ditangani.
- [x] Alert kegagalan sync: buat alert `sync_failed` (rule baru) berisi `jobName`, `attemptsMade`, `error` saat job masuk DLQ.

### 4. Rate limit per token + idempotency PATCH (F-21.3)
- [x] Buat plugin `src/plugins/rate-limit.plugin.ts`: Redis `INCR rl:{userId}:{menit}` dengan `EXPIRE 60`; batas `120` request/menit per user, `429` + `retry-after` bila lewat.
- [x] Terapkan plugin secara global kecuali `/api/healthz`, `/api/readyz`, `/api/wa/cloud/webhook`, `/api/wa/webhook` (webhook Meta/OpenWA tidak boleh diblokir).
- [x] Buat plugin `src/plugins/idempotency.plugin.ts` untuk `PATCH` dan `POST` non-webhook: header `Idempotency-Key` opsional; simpan `{status, body}` di Redis selama 24 jam dengan key `idem:{userId}:{key}`; permintaan ulang dengan key sama mengembalikan respons tersimpan tanpa menulis ulang.
- [x] Key sama dengan body berbeda → `409 ConflictError("Idempotency-Key dipakai dengan body berbeda", "IDEMPOTENCY_CONFLICT")`.

### 5. Request id + metrik (F-21.4)
- [x] `src/plugins/logger.plugin.ts`: ambil `x-request-id` dari header atau buat `crypto.randomUUID()`, simpan di `WeakMap<Request, string>`, sertakan pada setiap `logger.info`/`logger.error`, dan set header `x-request-id` pada respons.
- [x] Buat `src/infra/metrics/index.ts` dengan `Counter` dan `Histogram` in-memory: `http_requests_total{route,method,status}` dan `http_request_duration_seconds{route}` (bucket 5/25/50/100/250/500/1000/2500 ms).
- [x] Tambah `GET /api/metrics` (admin-only) mengembalikan teks Prometheus: counter, `_count`/`_sum`, dan kuantil p50/p95/p99 per route.
- [x] Label `route` memakai **pola** route (`/api/leads/:id`), bukan path aktual, agar kardinalitas tetap kecil.

### 6. Backup, retensi, runbook (F-21.6)
- [x] Buat `scripts/backup.ts`: `pg_dump --format=custom --no-owner` ke `./backup/funnellens-{YYYYMMDD-HHmm}.dump`, hapus dump lebih tua dari 14 hari, verifikasi ukuran > 0 sebelum menutup proses.
- [x] Tambah script `"db:backup": "bun run scripts/backup.ts"` di `package.json`.
- [x] Buat job retensi `src/modules/retention/{queue.ts,worker.ts,service.ts}` dijadwalkan harian `0 3 * * *`:
  - Hapus `ad_insights_daily` + `ad_insights_breakdown_daily` + `ad_insight_actions` lebih tua dari `RETENTION_INSIGHT_DAYS` (default `400`).
  - Hapus `conversation_messages.body` (set `NULL`) lebih tua dari `RETENTION_MESSAGE_BODY_DAYS` (default `180`), **tanpa** menghapus barisnya (statistik tetap utuh).
  - Hapus `sync_runs` lebih tua dari `RETENTION_SYNC_RUN_DAYS` (default `90`).
  - Setiap run menulis satu baris `sync_runs` dengan `resource = 'retention'`.
- [x] Tambah `RETENTION_INSIGHT_DAYS`, `RETENTION_MESSAGE_BODY_DAYS`, `RETENTION_SYNC_RUN_DAYS` ke `src/config/index.ts` dan `.env.example`.
- [x] Buat `docs/runbook-rekonsiliasi.md`: langkah membandingkan percakapan Meta vs chat WhatsApp, membaca `/tracking-health`, memicu `POST /api/meta/queue/re-sync-trailing`, dan memeriksa DLQ.

## File yang Disentuh
- `src/infra/cache/index.ts` (baru), `src/infra/metrics/index.ts` (baru)
- `src/plugins/{rate-limit,idempotency,logger}.plugin.ts`
- `src/modules/health/{index,service}.ts` (baru), `src/modules/retention/*` (baru)
- `src/modules/meta/{queue,worker}.ts`, `src/infra/queue/index.ts`
- `src/modules/analytics/service.ts`, `src/routes.ts`, `src/index.ts`, `src/config/index.ts`
- `scripts/backup.ts` (baru), `docs/runbook-rekonsiliasi.md` (baru), `.env.example`, `package.json`

## Uji Selesai
- `GET /api/healthz` → `200` tanpa menyentuh DB (matikan Postgres, tetap `200`).
- Postgres mati → `GET /api/readyz` → `503` dengan `checks.database === false`; hidup lagi → `200` dengan `checks.sync.lastSuccessAt` terisi.
- `GET /api/analytics/summary` dua kali → respons identik, panggilan kedua tidak menyentuh Postgres (buktikan lewat log query atau stub repository).
- Sync selesai → key cache akun terhapus; panggilan berikutnya membaca DB lagi.
- Job `meta-sync` gagal 5x → satu entri muncul di `GET /api/meta/queue/dlq` dan satu alert `sync_failed` aktif.
- 121 request dalam satu menit → request ke-121 `429` dengan header `retry-after`.
- Dua `PATCH /api/leads/{id}` dengan `Idempotency-Key` sama → hanya satu baris `lead_assessments` baru; body berbeda → `409`.
- Setiap respons memuat header `x-request-id`, dan baris log untuk request itu memuat id yang sama.
- `GET /api/metrics` memuat `http_requests_total` dengan label route berpola (`/api/leads/:id`), bukan id aktual.
- `bun run db:backup` menghasilkan file dump > 0 byte; job retensi menghapus baris lebih tua dari batas dan mempertahankan baris lebih baru.
