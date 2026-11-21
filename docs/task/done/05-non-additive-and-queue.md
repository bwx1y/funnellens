# DONE: Custom Period Non-Additive Metrics & Meta Background Queue

## Status
- Selesai & Terverifikasi (24 unit tests passing, TypeScript 0 error).

## Implementasi
1. **Custom Period Non-Additive Metrics (Fitur 4)**:
   - `MetaCustomPeriodMetricsDto` pada `src/infra/meta/types.ts`.
   - Method `getCustomPeriodMetrics` pada `IMetaAdsAdapter` & `FacebookSdkAdapter`: Query server-side aggregated insights dari Meta untuk rentang periode `time_range: { since, until }` tanpa `time_increment: 1` agar nilai `reach` dan `frequency` terdeduplikasi dengan akurat.
   - Endpoint `GET /api/meta/insights/non-additive`.

2. **Background Queue & Scheduler (Fitur 5)**:
   - `src/modules/meta/queue.ts`: Definisi `MetaSyncQueue` (antrian `meta-sync`), retry backoff eksponensial (10s backoff), dan cron scheduler (`sync-daily` per jam, `re-sync-trailing` 28 hari per malam).
   - `src/modules/meta/worker.ts`: `MetaSyncWorkerProcessor` dan worker listener `metaSyncWorker` untuk mengeksekusi job sinkronisasi harian, trailing 28 hari, dan master sync.
   - Penanganan rate limit Meta (error code 17, 32, 613, atau HTTP 429) dengan integrasi retry backoff BullMQ.
   - Endpoint queue trigger `POST /api/meta/queue/sync-daily` dan `POST /api/meta/queue/re-sync-trailing`.

3. **Testing**:
   - `tests/unit/meta-non-additive-and-queue.test.ts`.
