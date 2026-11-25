# Database Documentation

Dokumentasi skema database PostgreSQL menggunakan Drizzle ORM untuk FunnelLens.

---

## 1. Arsitektur & Prinsip Desain

1. **Multi-Tenancy**: Seluruh akun (`ad_accounts`, `users`, `wa_session`, `meta_connection`) berinduk pada `tenants.id` (UUID).
2. **Meta Ads Master ID**: Disimpan sebagai `text` (misal `act_<id>`, ID campaign/adset/ad dari Graph API) karena ID Meta dapat melampaui kapasitas integer.
3. **Monetary Values**: Uang disimpan dalam **minor unit** (`bigint`) + `currency` (char 3) + `currency_offset` (default 100) untuk mencegah floating-point rounding error.
4. **Idempotent UPSERT**: Tabel fact memakai composite unique index (`account_id`, `level`, `entity_id`, `date`, `attribution_window`).
5. **Raw Audit Payload**: Kolom `raw` (`jsonb`) hanya disimpan pada tabel **master Meta Ads** (`campaigns`, `ad_sets`, `ads`, `ad_creatives`) dan **diagnostic monitoring** (`tracking_health_daily`) untuk audit/reprocessing. Kolom `raw` sengaja ditiadakan dari tabel fact timeseries harian dan percakapan chat bervolume tinggi guna efisiensi storage.

---

## 2. Diagram Relasi Entitas (High-Level)

```
[tenants]
   │──< [users] ──< [user_tokens]
   │──< [meta_connection]
   │──< [wa_session] ──< [wa_phone]
   │                         │
   │                         │ (1:N optional)
   │                         ▼
   └──< [ad_accounts] ──< [leads] ──< [conversation_messages]
           │                  ▲
           │                  │ (attributed)
           │──< [campaigns] ──┤
           │       └──< [ad_sets] ──┤
           │               └──< [ads] ──┤
           │                       │    │
           │                       ▼    │
           │                 [ad_creatives] ──< [creative_tags]
           │
           │──< [ad_insights_daily] ──< [ad_insight_actions]
           │──< [ad_insights_breakdown_daily]
           │──< [tracking_health_daily]
           │──< [insight_alerts]
           └──< [sync_runs]
```

---

## 2.5 Daftar PostgreSQL Enum (`src/database/entity/enums.ts`)

| Nama Enum di Database | Nilai / Anggota (Values) | Keterangan & Penggunaan |
|---|---|---|
| `user_role` | `'ADMIN'`, `'MANAGER'` | Hak akses akun pengguna internal |
| `user_token_type` | `'EMAIL_VERIFICATION'`, `'PASSWORD_RESET'` | Jenis token OTP/verifikasi |
| `wa_session_status` | `'created'`, `'initializing'`, `'qr_ready'`, `'authenticating'`, `'ready'`, `'disconnected'`, `'action_required'`, `'failed'` | Status sesi WhatsApp gateway (lowercase serasi dengan event `@rmyndharis/openwa`) |
| `lead_temperature` | `'COLD'`, `'WARM'`, `'HOT'` | Klasifikasi suhu prospek / lead |
| `lead_stage` | `'CHAT_STARTED'`, `'REPLIED'`, `'QUALIFIED'`, `'CLOSED'` | Tahapan funnel CRM lead |
| `message_direction` | `'INBOUND'`, `'OUTBOUND'` | Arah aliran pesan chat |
| `insight_level` | `'account'`, `'campaign'`, `'adset'`, `'ad'` | Level agregasi analitik (lowercase serasi dengan parameter Meta Ads SDK) |
| `alert_level` | `'INFO'`, `'WARNING'`, `'CRITICAL'` | Tingkat urgensi anomali / peringatan sistem |
| `alert_status` | `'ACTIVE'`, `'DONE'`, `'SNOOZED'` | Status tindak lanjut anomali |
| `sync_run_status` | `'RUNNING'`, `'SUCCESS'`, `'FAILED'` | Status proses sinkronisasi background worker |

> **Catatan Fleksibilitas Meta API**: Field status/objective/action yang berasal langsung dari respons Meta Graph API (seperti `campaigns.status`, `effective_status`, `objective`, `action_type`, `publisher_platform`, dll.) sengaja **TETAP bertipe `text`** (bukan PostgreSQL Enum) agar proses sinkronisasi background worker tidak mengalami error/crash apabila Meta merilis nilai enum baru di kemudian hari.

---

## 3. Kelompok Core & Authentication

### `tenants`
Entity: `src/database/entity/tenant.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `name` | `varchar(200)` | No | - | Nama tenant/perusahaan |
| `address` | `text` | Yes | - | Alamat tenant |

### `users`
Entity: `src/database/entity/user.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `full_name` | `varchar(150)` | No | - | Nama lengkap |
| `email` | `varchar(200)` | No | - | Email pengguna (Unique) |
| `hash_password` | `varchar` | No | - | Hash password bcrypt |
| `role` | `enum('ADMIN', 'MANAGER')` | No | `'ADMIN'` | Hak akses |
| `verified_at` | `timestamp with time zone` | Yes | - | Waktu verifikasi email |
| `tenant_id` | `uuid` | No | - | FK -> `tenants.id` |

### `user_tokens`
Entity: `src/database/entity/user-token.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `code` | `varchar(6)` | No | - | Kode OTP 6 digit |
| `type` | `enum('EMAIL_VERIFICATION', 'PASSWORD_RESET')` | No | `'EMAIL_VERIFICATION'` | Jenis token |
| `expires_at` | `timestamp with time zone` | No | - | Waktu kedaluwarsa |
| `created_at` | `timestamp with time zone` | No | `now()` | Waktu dibuat |
| `used_at` | `timestamp with time zone` | Yes | - | Waktu dipakai (`used_at IS NOT NULL` menandakan sudah terpakai) |
| `user_id` | `uuid` | No | - | FK -> `users.id` (ON DELETE CASCADE) |

### `meta_connection`
Entity: `src/database/entity/meta-connection.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `user_id` | `uuid` | No | - | FK -> `users.id` (User penghubung, ON DELETE CASCADE) |
| `tenant_id` | `uuid` | No | - | FK -> `tenants.id` (ON DELETE CASCADE) |
| `meta_user_id` | `varchar(64)` | No | - | ID user Meta Graph |
| `meta_user_name` | `varchar(200)` | Yes | - | Nama profil Meta |
| `access_token` | `text` | No | - | User Access Token Meta |
| `scopes` | `text[]` | No | - | Array permissions |
| `expires_at` | `timestamp with time zone` | Yes | - | Waktu kedaluwarsa token |
| `created_at` | `timestamp with time zone` | No | `now()` | Waktu dibuat |
| `updated_at` | `timestamp with time zone` | No | `now()` | Waktu diupdate |

> Constraint: `UNIQUE (tenant_id, meta_user_id)`

---

## 4. Kelompok WhatsApp Integration

### `wa_session`
Entity: `src/database/entity/wa-session.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | No | - | Primary Key (Session ID Baileys) |
| `tenant_id` | `uuid` | No | - | FK -> `tenants.id` (ON DELETE CASCADE) |
| `name` | `varchar(150)` | No | - | Nama sesi WhatsApp |
| `phone_number` | `varchar` | Yes | - | Nomor WhatsApp terhubung |
| `phone_name` | `varchar` | Yes | - | Nama profil nomor |
| `status` | `enum('created', 'initializing', 'qr_ready', 'authenticating', 'ready', 'disconnected', 'action_required', 'failed')` | No | `'created'` | Status koneksi sesi |

### `wa_phone`
Entity: `src/database/entity/wa-phone.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `session_id` | `uuid` | No | - | FK -> `wa_session.id` (ON DELETE CASCADE) |
| `phone` | `varchar` | No | - | Nomor target kontak |
| `phone_name` | `varchar` | Yes | - | Nama kontak |

> Constraint: `UNIQUE (session_id, phone)`

---

## 5. Kelompok Meta Ads Master

### `ad_accounts`
Entity: `src/database/entity/ad-account.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `text` | No | - | Primary Key (`act_<id>`) |
| `tenant_id` | `uuid` | No | - | FK -> `tenants.id` (ON DELETE CASCADE) |
| `name` | `text` | No | - | Nama Ad Account |
| `currency` | `varchar(3)` | No | - | Kode mata uang (e.g. IDR, USD) |
| `currency_offset` | `integer` | No | `100` | Pengali minor unit |
| `timezone_name` | `text` | No | - | Zona waktu (e.g. Asia/Jakarta) |
| `account_status` | `integer` | Yes | - | Status akun dari Meta API |
| `business_id` | `text` | Yes | - | ID Meta Business Manager |
| `created_at` | `timestamp with time zone` | No | `now()` | Waktu dibuat |
| `updated_at` | `timestamp with time zone` | No | `now()` | Waktu diperbarui |

> Index: `INDEX (tenant_id)`

### `campaigns`
Entity: `src/database/entity/campaign.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `text` | No | - | Primary Key (Campaign ID) |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `name` | `text` | No | - | Nama Campaign |
| `objective` | `text` | Yes | - | Objective kampanye |
| `status` | `text` | Yes | - | Status yang dikonfigurasi |
| `effective_status` | `text` | Yes | - | Status aktif efektif |
| `buying_type` | `text` | Yes | - | Tipe pembelian (AUCTION, dsb) |
| `daily_budget_minor` | `bigint` | Yes | - | Budget harian (minor unit) |
| `lifetime_budget_minor` | `bigint` | Yes | - | Budget lifetime (minor unit) |
| `budget_remaining_minor` | `bigint` | Yes | - | Sisa budget (minor unit) |
| `start_time` | `timestamp with time zone` | Yes | - | Waktu mulai |
| `stop_time` | `timestamp with time zone` | Yes | - | Waktu berakhir |
| `created_time` | `timestamp with time zone` | Yes | - | Waktu dibuat di Meta |
| `updated_time` | `timestamp with time zone` | Yes | - | Waktu diupdate di Meta |
| `raw` | `jsonb` | Yes | - | Payload asli Meta |

> Index: `INDEX (account_id)`

### `ad_sets`
Entity: `src/database/entity/ad-set.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `text` | No | - | Primary Key (Ad Set ID) |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `campaign_id` | `text` | No | - | FK -> `campaigns.id` (ON DELETE CASCADE) |
| `name` | `text` | No | - | Nama Ad Set |
| `status` | `text` | Yes | - | Status konfigurasi |
| `effective_status` | `text` | Yes | - | Status aktif efektif |
| `optimization_goal` | `text` | Yes | - | Goal optimasi |
| `billing_event` | `text` | Yes | - | Event penagihan |
| `bid_strategy` | `text` | Yes | - | Strategi bid |
| `bid_amount_minor` | `bigint` | Yes | - | Nominal bid (minor unit) |
| `daily_budget_minor` | `bigint` | Yes | - | Budget harian |
| `lifetime_budget_minor` | `bigint` | Yes | - | Budget lifetime |
| `targeting` | `jsonb` | Yes | - | Konfigurasi targeting |
| `start_time` | `timestamp with time zone` | Yes | - | Waktu mulai |
| `end_time` | `timestamp with time zone` | Yes | - | Waktu selesai |
| `created_time` | `timestamp with time zone` | Yes | - | Waktu dibuat di Meta |
| `updated_time` | `timestamp with time zone` | Yes | - | Waktu diupdate di Meta |
| `raw` | `jsonb` | Yes | - | Payload asli Meta |

> Index: `INDEX (account_id)`

### `ads`
Entity: `src/database/entity/ad.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `text` | No | - | Primary Key (Ad ID) |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `campaign_id` | `text` | No | - | FK -> `campaigns.id` (ON DELETE CASCADE) |
| `adset_id` | `text` | No | - | FK -> `ad_sets.id` (ON DELETE CASCADE) |
| `creative_id` | `text` | Yes | - | FK -> `ad_creatives.id` |
| `name` | `text` | No | - | Nama Ad |
| `status` | `text` | Yes | - | Status iklan |
| `effective_status` | `text` | Yes | - | Status efektif |
| `created_time` | `timestamp with time zone` | Yes | - | Waktu dibuat di Meta |
| `updated_time` | `timestamp with time zone` | Yes | - | Waktu diupdate di Meta |
| `raw` | `jsonb` | Yes | - | Payload asli Meta |

> Index: `INDEX (account_id)`

### `ad_creatives`
Entity: `src/database/entity/ad-creative.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `text` | No | - | Primary Key (Creative ID) |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `name` | `text` | Yes | - | Nama materi kreatif |
| `object_type` | `text` | Yes | - | Tipe objek kreatif |
| `status` | `text` | Yes | - | Status materi |
| `video_id` | `text` | Yes | - | ID Video Meta |
| `video_length_seconds` | `numeric(10,2)` | Yes | - | Durasi video (detik) |
| `video_permalink_url` | `text` | Yes | - | URL permanen video |
| `image_url` | `text` | Yes | - | URL Gambar |
| `thumbnail_url` | `text` | Yes | - | URL Thumbnail |
| `object_story_id` | `text` | Yes | - | ID Post organik Meta |
| `body` | `text` | Yes | - | Copywriting/teks iklan |
| `title` | `text` | Yes | - | Headline iklan |
| `call_to_action_type` | `text` | Yes | - | Tipe CTA (e.g. WHATSAPP_MESSAGE) |
| `url_tags` | `text` | Yes | - | Parameter UTM / tracking tags |
| `created_time` | `timestamp with time zone` | Yes | - | Waktu dibuat di Meta |
| `updated_time` | `timestamp with time zone` | Yes | - | Waktu diupdate di Meta |
| `raw` | `jsonb` | Yes | - | Payload asli Meta |

> Index: `INDEX (account_id)`

### `creative_tags`
Entity: `src/database/entity/creative-tag.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `bigserial` | No | autoincrement | Primary Key |
| `creative_id` | `text` | No | - | FK -> `ad_creatives.id` (ON DELETE CASCADE) |
| `tag_type` | `text` | No | - | Tipe tag (format, opening, tone, theme) |
| `tag_value` | `text` | No | - | Nilai tag |
| `source` | `text` | No | - | Sumber (manual, ai, rule) |
| `confidence` | `numeric(5,4)` | Yes | - | Skor confidence (jika dari AI) |
| `created_at` | `timestamp with time zone` | No | `now()` | Waktu dibuat |

> Constraint: `UNIQUE (creative_id, tag_type, tag_value, source)`

---

## 6. Kelompok Timeseries & Fact Tables

### `ad_insights_daily`
Entity: `src/database/entity/ad-insight-daily.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `bigserial` | No | autoincrement | Primary Key |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `level` | `enum('account', 'campaign', 'adset', 'ad')` | No | - | Level data agregasi |
| `entity_id` | `text` | No | - | ID entitas target |
| `campaign_id` | `text` | Yes | - | FK -> `campaigns.id` |
| `adset_id` | `text` | Yes | - | FK -> `ad_sets.id` |
| `ad_id` | `text` | Yes | - | FK -> `ads.id` |
| `date` | `date` | No | - | Tanggal agregasi insight |
| `attribution_window` | `text` | No | `'7d_click'` | Jendela atribusi |
| `currency` | `varchar(3)` | No | - | Mata uang |
| `currency_offset` | `integer` | No | `100` | Pengali minor unit |
| `spend_minor` | `bigint` | No | `0` | Belanja iklan (minor unit) |
| `impressions` | `bigint` | No | `0` | Jumlah impresi |
| `reach` | `bigint` | Yes | - | Jangkauan unik |
| `frequency` | `numeric(14,6)` | Yes | - | Rata-rata frekuensi tayang |
| `clicks` | `bigint` | No | `0` | Total klik |
| `inline_link_clicks` | `bigint` | Yes | - | Klik tautan langsung |
| `unique_clicks` | `bigint` | Yes | - | Klik unik |
| `ctr` | `numeric(14,8)` | Yes | - | Click-through rate |
| `cpc_minor` | `bigint` | Yes | - | Cost per click (minor unit) |
| `cpm_minor` | `bigint` | Yes | - | Cost per mille (minor unit) |
| `actions` | `jsonb` | Yes | - | Raw action breakdown |
| `action_values` | `jsonb` | Yes | - | Nilai konversi/belanja |
| `cost_per_action_type` | `jsonb` | Yes | - | Biaya per jenis aksi |
| `video_play_actions` | `bigint` | Yes | - | Tayangan video |
| `video_30_sec_watched_actions`| `bigint` | Yes | - | Ditonton >= 30 detik |
| `video_thruplay_watched_actions`| `bigint` | Yes | - | ThruPlay actions |
| `video_p25_watched_actions` | `bigint` | Yes | - | Ditonton 25% |
| `video_p50_watched_actions` | `bigint` | Yes | - | Ditonton 50% |
| `video_p75_watched_actions` | `bigint` | Yes | - | Ditonton 75% |
| `video_p100_watched_actions`| `bigint` | Yes | - | Ditonton 100% |
| `video_avg_time_watched_seconds`| `numeric(14,4)` | Yes | - | Rata-rata durasi tonton |
| `fetched_at` | `timestamp with time zone` | No | `now()` | Waktu sinkronisasi |
| `is_final` | `boolean` | No | `false` | True jika lewat batas atribusi (28 hari) |

> Indexes:
> - `UNIQUE (account_id, level, entity_id, date, attribution_window)`
> - `INDEX (account_id, date)`
> - `INDEX (campaign_id, date)`
> - `INDEX (ad_id, date)`

### `ad_insights_breakdown_daily`
Entity: `src/database/entity/ad-insight-breakdown-daily.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `bigserial` | No | autoincrement | Primary Key |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `level` | `enum('account', 'campaign', 'adset', 'ad')` | No | - | Level data agregasi |
| `entity_id` | `text` | No | - | ID entitas |
| `campaign_id` | `text` | Yes | - | FK -> `campaigns.id` |
| `adset_id` | `text` | Yes | - | FK -> `ad_sets.id` |
| `ad_id` | `text` | Yes | - | FK -> `ads.id` |
| `date` | `date` | No | - | Tanggal data |
| `attribution_window` | `text` | No | - | Window atribusi |
| `publisher_platform` | `text` | Yes | - | e.g. facebook, instagram |
| `platform_position` | `text` | Yes | - | e.g. feed, story, reels |
| `impression_device` | `text` | Yes | - | e.g. mobile, desktop |
| `age` | `text` | Yes | - | Rentang umur |
| `gender` | `text` | Yes | - | Jenis kelamin |
| `country` | `text` | Yes | - | Negara |
| `region` | `text` | Yes | - | Wilayah/provinsi |
| `breakdown_hash` | `text` | No | - | Hash pembeda kombinasi breakdown |
| `spend_minor` | `bigint` | No | `0` | Belanja minor |
| `impressions` | `bigint` | No | `0` | Impresi |
| `reach` | `bigint` | Yes | - | Reach |
| `clicks` | `bigint` | No | `0` | Clicks |
| `inline_link_clicks` | `bigint` | Yes | - | Link clicks |
| `actions` | `jsonb` | Yes | - | Breakdown aksi |
| `action_values` | `jsonb` | Yes | - | Nilai konversi |

> Constraint: `UNIQUE (account_id, level, entity_id, date, attribution_window, breakdown_hash)`

### `ad_insight_actions`
Entity: `src/database/entity/ad-insight-action.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `bigserial` | No | autoincrement | Primary Key |
| `insight_daily_id` | `bigint` | No | - | FK -> `ad_insights_daily.id` (ON DELETE CASCADE) |
| `action_type` | `text` | No | - | Jenis aksi (e.g. `onsite_conversion.messaging_conversation_started_7d`) |
| `count` | `numeric(20,4)` | No | `0` | Jumlah konversi aksi |
| `value_minor` | `bigint` | Yes | - | Nilai transaksi minor |
| `cost_per_action_minor` | `bigint` | Yes | - | Biaya per aksi |

> Constraint: `UNIQUE (insight_daily_id, action_type)`

---

## 7. Kelompok CRM & Leads Funnel

### `leads`
Entity: `src/database/entity/lead.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `bigserial` | No | autoincrement | Primary Key |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `wa_phone_id` | `uuid` | Yes | - | FK -> `wa_phone.id` (Relasi kontak WA) |
| `external_id` | `text` | Yes | - | ID eksternal CRM/WA |
| `name` | `text` | Yes | - | Nama lead |
| `phone_hash` | `text` | Yes | - | SHA-256 hash nomor telepon |
| `phone_masked` | `text` | Yes | - | Masking nomor telepon (e.g. +62812****) |
| `email_hash` | `text` | Yes | - | SHA-256 hash email |
| `campaign_id` | `text` | Yes | - | FK -> `campaigns.id` |
| `adset_id` | `text` | Yes | - | FK -> `ad_sets.id` |
| `ad_id` | `text` | Yes | - | FK -> `ads.id` |
| `creative_id` | `text` | Yes | - | FK -> `ad_creatives.id` |
| `source_platform` | `text` | Yes | - | Instagram, Facebook, Web |
| `source_position` | `text` | Yes | - | Reels, Feed, Stories |
| `score` | `integer` | Yes | - | Skor lead (0-100) |
| `temperature` | `enum('COLD', 'WARM', 'HOT')` | Yes | - | Klasifikasi suhu lead |
| `stage` | `enum('CHAT_STARTED', 'REPLIED', 'QUALIFIED', 'CLOSED')` | No | `'CHAT_STARTED'` | Tahap funnel lead |
| `sentiment` | `text` | Yes | - | Sentimen obrolan |
| `signals` | `jsonb` | Yes | - | Key-value sinyal AI / scoring lead (MVP) |
| `first_message` | `text` | Yes | - | Pesan pertama lead |
| `first_seen_at` | `timestamp with time zone` | Yes | - | Waktu kontak pertama |
| `first_replied_at` | `timestamp with time zone` | Yes | - | Waktu admin membalas |
| `qualified_at` | `timestamp with time zone` | Yes | - | Waktu status qualified |
| `closed_at` | `timestamp with time zone` | Yes | - | Waktu transaksi closing |
| `deal_value_minor` | `bigint` | Yes | - | Nilai transaksi (minor unit) |
| `currency` | `varchar(3)` | Yes | - | Mata uang deal |
| `created_at` | `timestamp with time zone` | No | `now()` | Waktu dibuat |
| `updated_at` | `timestamp with time zone` | No | `now()` | Waktu diupdate |

> Constraint: `UNIQUE (account_id, external_id)`

### `conversation_messages`
Entity: `src/database/entity/conversation-message.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `bigserial` | No | autoincrement | Primary Key |
| `lead_id` | `bigint` | No | - | FK -> `leads.id` (ON DELETE CASCADE) |
| `direction` | `enum('INBOUND', 'OUTBOUND')` | No | - | Arah aliran pesan chat |
| `body` | `text` | Yes | - | Isi pesan obrolan |
| `sent_at` | `timestamp with time zone` | No | - | Waktu dikirim |
| `replied_at` | `timestamp with time zone` | Yes | - | Waktu dibalas |
| `response_seconds` | `integer` | Yes | - | Kecepatan balas (detik) |
| `topic` | `text` | Yes | - | Topik percakapan |
| `sentiment` | `text` | Yes | - | Sentimen pesan |

---

## 8. Kelompok Monitoring & Health

### `tracking_health_daily`
Entity: `src/database/entity/tracking-health-daily.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `bigserial` | No | autoincrement | Primary Key |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `date` | `date` | No | - | Tanggal audit |
| `event_name` | `text` | No | - | e.g. `Purchase`, `Lead`, `Contact` |
| `browser_count` | `bigint` | Yes | - | Jumlah event dari browser (Pixel) |
| `server_count` | `bigint` | Yes | - | Jumlah event dari server (CAPI) |
| `dedup_rate` | `numeric(14,6)` | Yes | - | Rasio deduplikasi event |
| `match_quality` | `numeric(5,2)` | Yes | - | Event Match Quality score (0-10) |
| `status` | `text` | Yes | - | Status kesehatan |
| `raw` | `jsonb` | Yes | - | Raw diagnostic report |

> Constraint: `UNIQUE (account_id, date, event_name)`

### `insight_alerts`
Entity: `src/database/entity/insight-alert.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `bigserial` | No | autoincrement | Primary Key |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `rule_key` | `text` | No | - | Kode rule pendeteksi alert |
| `level` | `enum('INFO', 'WARNING', 'CRITICAL')` | No | - | Tingkat anomali / peringatan |
| `title` | `text` | No | - | Judul notifikasi |
| `body` | `text` | Yes | - | Deskripsi insight / anomali |
| `metric` | `text` | Yes | - | Metrik yang bermasalah (e.g. `cpc`, `ctr`) |
| `entity_type` | `text` | Yes | - | campaign, adset, ad |
| `entity_id` | `text` | Yes | - | ID objek terkait |
| `impact_minor` | `bigint` | Yes | - | Estimasi dampak finansial |
| `impact_caption` | `text` | Yes | - | Penjelasan dampak |
| `confidence` | `text` | Yes | - | Level keyakinan model |
| `sample_size` | `bigint` | Yes | - | Ukuran sampel |
| `route` | `text` | Yes | - | Direct deep link ke UI |
| `status` | `enum('ACTIVE', 'DONE', 'SNOOZED')` | No | `'ACTIVE'` | Status penanganan alert |
| `detected_at` | `timestamp with time zone` | No | `now()` | Waktu terdeteksi |
| `updated_at` | `timestamp with time zone` | No | `now()` | Waktu update |

### `sync_runs`
Entity: `src/database/entity/sync-run.entity.ts`

| Kolom | Tipe Data | Nullable | Default | Keterangan |
|---|---|---|---|---|
| `id` | `bigserial` | No | autoincrement | Primary Key |
| `account_id` | `text` | No | - | FK -> `ad_accounts.id` (ON DELETE CASCADE) |
| `resource` | `text` | No | - | Objek yang di-sync (`insights`, `campaigns`, dll) |
| `started_at` | `timestamp with time zone` | No | `now()` | Waktu mulai sync |
| `finished_at` | `timestamp with time zone` | Yes | - | Waktu selesai sync |
| `status` | `enum('RUNNING', 'SUCCESS', 'FAILED')` | No | `'RUNNING'` | Status proses sinkronisasi |
| `rows_upserted` | `bigint` | Yes | - | Jumlah data terproses |
| `error` | `text` | Yes | - | Pesan error jika gagal |

---

## 9. Perintah Manajemen Database

- `bun run db:generate` : Buat file migrasi SQL dari Drizzle entities
- `bun run db:push` : Push struktur tabel langsung ke PostgreSQL
- `bun run db:drop` : Drop/hapus seluruh tabel, enum, dan schema di database
- `bun run db:reset` : Hapus seluruh tabel lalu push ulang schema secara bersih
- `bun run db:studio` : Buka Drizzle Studio web GUI
