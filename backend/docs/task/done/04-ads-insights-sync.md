# DONE: Ads Insights Sync Engine

## Status
- Selesai & Terverifikasi (22 unit tests passing, TypeScript 0 error).

## Implementasi
1. **Types & DTOs (`src/infra/meta/types.ts`)**:
   - `MetaAdInsightDailyDto`: Metrik dasar (spend minor, impressions, reach, frequency, clicks, ctr, cpc, cpm), metrik video (`video_play_actions`, `video_thruplay_watched_actions`, `video_p25` s/d `video_p100`), status finalisasi `isFinal`, dan array `extractedActions`.
   - `MetaAdInsightActionDto`: Normalisasi array `actions`, `action_values`, dan `cost_per_action_type` menjadi entitas relasional.
   - `MetaAdInsightBreakdownDailyDto`: Metrik harian breakdown dimensi placement & device (`publisher_platform`, `platform_position`, `impression_device`) dengan `breakdownHash` (SHA-256 slice).

2. **Database Repository (`src/infra/database/repositories/ad-insight.repository.ts`)**:
   - `AdInsightRepository.upsertDailyInsights`: Upsert ke `ad_insights_daily` dan cascading upsert `ad_insight_actions` dengan ID insight harian yang di-generate.
   - `AdInsightRepository.upsertBreakdowns`: Batch upsert ke `ad_insights_breakdown_daily` dengan composite key `(account_id, level, entity_id, date, attribution_window, breakdown_hash)`.

3. **Facebook SDK Adapter (`src/infra/meta/adapters/facebook-sdk.adapter.ts`)**:
   - `getDailyAdInsights`: Query `AdAccount.getInsights` dengan `level: 'ad'`, `time_increment: 1`, `action_attribution_windows: ['7d_click']`, pagination cursor `fetchAllSdk`, dan normalisasi video/actions.
   - `getDailyAdBreakdowns`: Query insights dengan parameter `breakdowns: ['publisher_platform', 'platform_position', 'impression_device']`.

4. **Service & Route (`src/modules/meta/`)**:
   - `MetaService.syncInsights(user, body)`:
     - Resolusi akun target (otomatis dari database jika `accountId` tidak diisi).
     - Logging run ke tabel `sync_runs` dengan `resource: 'insights'`.
     - Sinkronisasi daily insights dan breakdowns untuk rentang tanggal (default 30 hari ke belakang).
   - Route `POST /api/meta/sync/insights` mounted di router Elysia `/meta`.

5. **Testing**:
   - Unit test di `tests/unit/meta-sync-insights.test.ts`.
