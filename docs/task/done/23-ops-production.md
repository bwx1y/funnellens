# Selesai: Operasional Produksi — Cache, Health Probe, DLQ, Rate Limit, Metrik, Retensi

Dokumentasi implementasi penutup F-21.1–F-21.6.

## Ringkasan Fitur

- **Cache agregasi (F-21.2)**: `AggregationCache` (`src/infra/cache/index.ts`) di atas `redisConnection`. `getSummary`, `getFunnel`, `getLeakage` dibungkus read-through dengan TTL 300 detik; `getStageDetail` sengaja tidak di-cache. Setiap kegagalan Redis hanya `warn` dan request lanjut ke database. Invalidasi setelah sync sukses memakai `SCAN … MATCH agg:v1:{accountId}:* COUNT 500` + `DEL` bertahap, bukan `KEYS`.
- **Health probe (F-21.5)**: `GET /api/healthz` selalu `200 {status: true}` tanpa menyentuh DB/Redis. `GET /api/readyz` memeriksa database (`select 1`), Redis (`PING`), dan kesegaran sync dalam batas 2 detik per probe; gagal → `503` dengan `checks` + `message`, tidak pernah melempar exception.
- **Dead-letter queue (F-21.1)**: queue `meta-sync-dlq` menyimpan `{jobName, data, error, failedAt, attemptsMade}`. `WorkerManager` mendapat hook `onExhausted` yang hanya menyala setelah attempt terakhir. Job yang mati memunculkan satu alert `sync_failed` (level CRITICAL, `evidence` berisi `jobName`/`attemptsMade`/`error`) dan alert itu tertutup otomatis saat sync akun tersebut sukses. `GET /api/meta/queue/dlq` (admin) mengembalikan 50 entri terbaru, `DELETE /api/meta/queue/dlq/{id}` membuang entri yang sudah ditangani.
- **Rate limit (F-21.3)**: fixed window per user, `INCR rl:{userId}:{menit}` + `EXPIRE 60`, batas 120/menit, `429` + `retry-after`. Dikecualikan: `/api/healthz`, `/api/readyz`, `/api/wa/cloud/webhook`, `/api/wa/webhook`. Redis mati → fail open (cache outage tidak boleh jadi API outage).
- **Idempotency (F-21.3)**: `POST`/`PATCH` dengan header `Idempotency-Key` menyimpan `{bodyHash, status, body}` di Redis 24 jam (`idem:{userId}:{key}`). Key sama + body sama → respons tersimpan dikembalikan tanpa menulis ulang; key sama + body berbeda → `409 IDEMPOTENCY_CONFLICT`. Respons 5xx tidak disimpan agar percobaan berikutnya boleh bekerja ulang.
- **Request id + metrik (F-21.4)**: `x-request-id` dari header atau `crypto.randomUUID()`, disimpan di `WeakMap`, muncul di setiap baris log request/response/error, dan di-set sebagai header respons. `Counter`/`Histogram` in-memory menghasilkan `http_requests_total{route,method,status}` dan `http_request_duration_seconds{route}` (bucket 5–2500 ms, plus p50/p95/p99) lewat `GET /api/metrics` (admin, teks Prometheus). Label `route` memakai pola route, bukan path aktual.
- **Backup, retensi, runbook (F-21.6)**: `bun run db:backup` menulis `backup/funnellens-{YYYYMMDD-HHmm}.dump` (`pg_dump --format=custom --no-owner`), menghapus dump > 14 hari, dan gagal bila hasilnya 0 byte. Job retensi harian `0 3 * * *` menghapus insight/breakdown/actions > `RETENTION_INSIGHT_DAYS` (400), meng-`NULL`-kan `conversation_messages.body` > `RETENTION_MESSAGE_BODY_DAYS` (180) tanpa menghapus barisnya, menghapus `sync_runs` > `RETENTION_SYNC_RUN_DAYS` (90), dan menulis satu baris `sync_runs` `resource = 'retention'` per akun. `docs/runbook-rekonsiliasi.md` memuat langkah rekonsiliasi Meta ↔ WhatsApp.

## Keputusan yang Perlu Dicatat

- **Kunci cache menyimpang dari spesifikasi, dengan alasan.** Format spesifikasi (`agg:v1:{accountId}:{campaignId|all}:{since}:{until}:{objectiveGroup|all}`) tidak memuat tenant maupun endpoint. Karena lookup cache terjadi **sebelum** `requireAccountScope` (syarat "panggilan kedua tidak menyentuh Postgres"), kunci tanpa `tenantId` akan membocorkan laporan antar-workspace, dan kunci tanpa `endpoint` membuat `summary` dan `funnel` dengan jendela identik saling menimpa. Format final: `agg:v1:{accountId}:{endpoint}:{tenantId}:{campaignId|all}:{since}:{until}:{objectiveGroup|all}`; `accountId` tetap segmen pertama sehingga pola invalidasi `agg:v1:{accountId}:*` dari spesifikasi tetap berlaku.
- **`days` di-expand ke tanggal di kunci.** Tanpa itu `days=7` dan `days=30` akan berbagi entri. Jendela yang dibiarkan terbuka bergantung pada "hari ini" di zona akun yang tidak diketahui lapisan cache, jadi kunci memakai tanggal UTC dan entri kedaluwarsa bersama TTL.
- **Alert `sync_failed` tidak masuk `EVALUATED_RULES`.** Kalau ikut, evaluator per jam akan menutupnya setiap jam karena ia tidak pernah menghasilkannya. Yang menutup adalah `refreshAfterSync` saat sync akun itu sukses.
- **Retensi menulis `sync_runs` per akun**, bukan satu baris global: `sync_runs.account_id` adalah FK `NOT NULL` ke `ad_accounts`, jadi satu baris tanpa akun tidak bisa ditulis. Baris audit retensi sendiri dikecualikan dari pemangkasan `sync_runs`.
- **`conversation_messages.body` di-`NULL`-kan lewat `UPDATE … FROM leads`** sehingga hanya pesan milik akun yang diproses, dan `response_seconds`/`sentiment`/`topic` tetap utuh untuk statistik.
- **`MetaSyncWorkerProcessor.refreshAfterSync` dibuat publik** agar perilaku "cache dibersihkan + alert ditutup setelah sync" bisa diuji tanpa memanggil Graph API.

## Perubahan File

- `src/infra/cache/index.ts` (baru): `AggregationCache` (`key`, `get`, `set`, `invalidateAccount`).
- `src/infra/metrics/index.ts` (baru): `Counter`, `Histogram`, `renderMetrics`, bucket 5–2500 ms.
- `src/infra/queue/index.ts`: hook `onExhausted` pada `WorkerManager`, hanya setelah attempt terakhir.
- `src/plugins/logger.plugin.ts`: request id + `x-request-id` + pencatatan metrik.
- `src/plugins/rate-limit.plugin.ts` (baru), `src/plugins/idempotency.plugin.ts` (baru), `src/plugins/actor.ts` (baru: narrowing `user` untuk plugin global).
- `src/modules/health/{index,service}.ts` (baru): liveness/readiness dengan timeout 2 detik.
- `src/modules/metrics/index.ts` (baru): `GET /api/metrics` (admin).
- `src/modules/meta/{dlq,dead-letter}.ts` (baru), `src/modules/meta/index.ts` (rute DLQ), `src/modules/meta/schema.ts`, `src/modules/meta/worker.ts` (invalidasi cache + DLQ hook + tutup alert).
- `src/modules/retention/{queue,service,worker}.ts` (baru): cron `0 3 * * *`.
- `src/modules/analytics/service.ts`: `getSummary`/`getFunnel`/`getLeakage` dibungkus `cached`, isi lama menjadi `buildSummary`/`buildFunnel`/`buildLeakage`.
- `src/shared/alerts.ts`: rule key `sync_failed`; `src/shared/errors.ts`: `RateLimitError` (429); `src/shared/jwt.ts`: tipe `AuthenticatedUser`.
- `src/index.ts`: registrasi `rateLimit` + `idempotency`, penjadwalan retensi. `src/routes.ts`: `MetricsController` + `HealthController`.
- `src/config/index.ts`, `.env.example`: `RETENTION_INSIGHT_DAYS`, `RETENTION_MESSAGE_BODY_DAYS`, `RETENTION_SYNC_RUN_DAYS`.
- `scripts/backup.ts` (baru), `package.json` (`db:backup`), `.gitignore` (`/backup/`).
- `docs/runbook-rekonsiliasi.md` (baru).
- `tests/integration/ops-production.test.ts` (baru): 16 test.

## Hasil Pengujian

- `bun test` penuh: **324 test di 43 file lulus** tanpa regresi.
- `bunx tsc --noEmit` bersih.
- Diverifikasi lewat permukaan sebenarnya:
  - Server dev dengan `DATABASE_PORT=1` (Postgres tidak ada): `GET /api/healthz` → `200 {status: true}`; `GET /api/readyz` → `503` dengan `checks.database: false`, `checks.redis: true`, `checks.sync.overdue: true` dan pesan yang menyebut database.
  - Server dev normal: `readyz` → `200` dengan `checks.sync.lastSuccessAt` terisi.
  - Header `x-request-id` muncul di respons (dibuat sendiri maupun di-echo) dan id yang sama ada di baris log `[REQUEST]`/`[RESPONSE]` (diperiksa langsung pada `log/app*.log`).
  - `GET /api/metrics/` memuat `http_requests_total{…route="/api/leads/:id"…}` dan tidak memuat path ber-id; histogram menyertakan `_bucket`, `_count`, `_sum`, dan `quantile="0.95"`.
  - 121 request dengan satu token → request ke-121 `429` + header `retry-after`, dan `/api/healthz` tetap `200` saat kuota habis.
  - Dua `PATCH /api/leads/{id}` dengan `Idempotency-Key` sama → body identik dikembalikan; body berbeda → `409 IDEMPOTENCY_CONFLICT` dan baris lead tidak berubah.
  - `getSummary` kedua membaca Redis (nilai cache yang sengaja diubah terbaca kembali), `invalidateAccount` menghapus semua entri akun, dan `days=7`/`days=30`/`funnel` menghasilkan kunci berbeda.
  - `refreshAfterSync` mengosongkan cache akun dan menutup alert `sync_failed`.
  - Job yang gagal pada attempt terakhir memanggil hook DLQ tepat sekali (`attemptsMade: 1`); `record` menulis entri DLQ + alert `sync_failed` ACTIVE, `GET /api/meta/queue/dlq` menampilkannya, `DELETE` menghapusnya, dan penghapusan kedua → `404`.
  - Retensi menghapus insight + action + breakdown > 400 hari, meng-`NULL`-kan body pesan lama (baris dan `response_seconds` tetap), mempertahankan baris baru, dan menulis `sync_runs` `resource='retention'` berstatus `SUCCESS`.
  - `bun run db:backup` menghasilkan `backup/funnellens-20261125-2240.dump` sebesar 153.695 byte.
