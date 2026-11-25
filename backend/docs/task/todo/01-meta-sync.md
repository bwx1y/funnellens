# TODO: Meta Integration & Sync Engine

## Gambaran Fitur
Integrasi ke Meta Marketing API (`facebook-nodejs-business-sdk`) untuk sinkronisasi metadata akun, struktur kampanye iklan, dan data harian performa (insights, actions, breakdowns).

## Daftar Pekerjaan

### 1. Ad Account Management
- [x] Buat service untuk mengambil daftar Ad Accounts yang dapat diakses oleh access token user (`GET /me/adaccounts`).
- [x] Simpan metadata Ad Account ke database (`AdAccountEntity`): `id`, `name`, `currency`, `currency_offset`, `timezone_name`, `account_status`, `business_id`, `is_selected`.
- [x] Buat endpoint untuk memilih / mengaktifkan akun iklan aktif per tenant:
  - `GET /api/meta/accounts`: list akun iklan yang terhubung & sinkronkan ke DB.
  - `GET /api/meta/accounts/selected`: akun iklan yang sedang aktif.
  - `POST /api/meta/accounts/select`: memilih akun aktif yang akan disinkronkan.

### 2. Master Metadata Sync (`fetchAll`)
- [x] Implementasikan helper pagination cursor `fetchAll` untuk edge Marketing API dengan `limit: 500`.
- [x] Sync master **Campaigns**:
  - Fields: `id`, `name`, `objective`, `status`, `effective_status`, `buying_type`, `daily_budget`, `lifetime_budget`, `budget_remaining`, `start_time`, `stop_time`, `created_time`, `updated_time`.
  - Konversi budget dari minor unit (`bigint`).
  - Simpan payload `raw` (jsonb).
- [x] Sync master **AdSets**:
  - Fields: `id`, `name`, `campaign_id`, `status`, `effective_status`, `optimization_goal`, `billing_event`, `bid_strategy`, `bid_amount`, `daily_budget`, `lifetime_budget`, `targeting`, `start_time`, `end_time`.
- [x] Sync master **Ads**:
  - Fields: `id`, `name`, `campaign_id`, `adset_id`, `status`, `effective_status`, `creative`, `created_time`, `updated_time`.
- [x] Sync master **AdCreatives & Videos**:
  - Fields: `id`, `name`, `object_type`, `status`, `video_id`, `image_url`, `thumbnail_url`, `body`, `title`, `call_to_action_type`, `url_tags`.
  - Fetch video duration (`length_seconds`) dan permalink dari endpoint Video Meta.

### 3. Ads Insights Sync Engine
- [x] Sync daily insights level `ad` dengan parameter:
  - `level: 'ad'`, `time_increment: 1`.
  - `action_attribution_windows: ['7d_click']`.
  - Fields: `spend`, `impressions`, `reach`, `frequency`, `clicks`, `inline_link_clicks`, `ctr`, `cpc`, `cpm`, `actions`, `action_values`, `cost_per_action_type`, metrik video (`video_play_actions`, `video_thruplay_watched_actions`, persentase durasi `video_p25` s/d `video_p100`).
- [x] Ekstraksi dan mapping array `actions` & `action_values`:
  - `onsite_conversion.messaging_conversation_started_7d` (WhatsApp chat).
  - `lead`, `onsite_conversion.lead_grouped`, `offsite_conversion.fb_pixel_lead`.
  - `purchase`, `offsite_conversion.fb_pixel_purchase`.
  - `landing_page_view`, `link_click`.
  - Simpan ke relasi `ad_insight_actions`.
- [x] Sync placement & device breakdown harian:
  - Breakdowns: `publisher_platform`, `platform_position`, `impression_device`.
  - Simpan ke `ad_insight_breakdowns_daily`.

### 4. Custom Period Non-Additive Metrics
- [x] Buat resolver khusus untuk `reach` dan `frequency`:
  - Request langsung ke Graph API per periode `time_range: { since, until }` di level `account` dan `campaign` (karena reach harian tidak bisa di-SUM).

### 5. Background Queue & Scheduler (BullMQ)
- [x] Buat queue `meta-sync` dan worker `MetaSyncWorker`:
  - Job `sync-daily`: sync harian untuk rentang aktif.
  - Job `re-sync-trailing`: re-sync 28 hari ke belakang untuk mengakomodasi update attribution window Meta.
- [x] Pencatatan observabilitas ke `sync_runs`:
  - Rekam `account_id`, `status` (`running`, `success`, `failed`), `started_at`, `finished_at`, `rows_synced`, `error_message`.
- [x] Rate-limit handling & backoff:
  - Baca header `X-Business-Use-Case-Usage` dan `X-Ad-Account-Usage`.
  - Terapkan exponential backoff pada error 429 / transient rate-limit.

### 6. Kelengkapan F1
- [x] `action_report_time` masuk daftar `fields` insight dan disimpan sebagai `ad_insights_daily.action_report_time` (default `"impression"`).
- [x] `graphVersion` (`Config.meta.apiVersion`) disimpan di setiap baris insight.
- [x] `objectiveGroup` (`wa`/`web`) dihitung saat sync master ad set: `destination_type ∈ {WHATSAPP, MESSENGER}` atau `optimization_goal = "CONVERSATIONS"` → `wa`; selain itu `web`.
- [x] Insight ditulis ke `insight_sync_staging` lalu diterbitkan atomik lewat `publishCompleteSlice` (hapus slice lama → insert → hapus staging → `sync_runs` SUCCESS dengan `range_since`/`range_until`).
- [x] Job `sync-hourly-breakdowns` (rentang default 7 hari terakhir) memakai breakdown `hourly_stats_aggregated_by_advertiser_time_zone` sebagai panggilan terpisah; `hourOfDay` masuk `breakdownHash` (`pub|pos|device|hour`).
- [x] `video_3_sec_watched_actions` disimpan ke `ad_insights_daily.video_3_sec_watched_actions`.
