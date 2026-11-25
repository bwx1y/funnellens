# TODO: Seed Parity Dataset Demo

## Gambaran Fitur
Repo tidak punya seed data apa pun, sehingga `Accept:` di F-01 checklist tidak bisa dibuktikan: `GET /summary` tidak pernah menghasilkan angka yang sama dua kali. Task ini menambah satu skrip seed deterministik yang membangun dataset parity (3 campaign, 11 kreatif, 8 lead, 63 hari metrik) di tenant demo terpisah, plus golden test yang mengunci angkanya.

Skrip **tidak** menyentuh tenant/akun milik user: seluruh baris ditulis ke `account_id = 'act_demo_funnellens'` yang hanya dimiliki tenant `demo`. Task ini menutup F-01.4.

## Daftar Pekerjaan

### 1. Skrip seed (`scripts/seed-demo.ts`)
- [x] Buat `scripts/seed-demo.ts` mengikuti gaya `scripts/db-drop.ts`: `postgres({...Config.database})`, `process.exit(1)` saat gagal, `await sql.end()` di `finally`.
- [x] Tambah script `"db:seed": "bun run scripts/seed-demo.ts"` di `package.json`.
- [x] Buat tenant `demo` (uuid tetap `00000000-0000-4000-8000-000000000001`) dan user `demo@funnellens.test` dengan role `ADMIN` bila belum ada; password di-hash `PasswordUtil.hash("demo123456")`. Idempotent lewat `on conflict (email) do nothing`.
- [x] Buat `ad_accounts` id `act_demo_funnellens`, `currency = 'IDR'`, `currency_offset = 100`, `timezone_name = 'Asia/Jakarta'`, `is_selected = true`.
- [x] Hapus lebih dulu seluruh baris milik `act_demo_funnellens` dengan urutan FK: `ad_insight_actions` → `ad_insights_breakdown_daily` → `ad_insights_daily` → `conversation_messages` → `lead_milestones` → `lead_assessments` → `leads` → `tracking_health_daily` → `pixel_sources` → `insight_alerts` → `explanations` → `ads` → `ad_sets` → `campaigns` → `ad_creatives`. Skrip harus bisa dijalankan berulang tanpa duplikat.

### 2. Isi dataset (angka wajib)
- [x] **3 campaign**: `Prospecting` (`OUTCOME_LEADS`, ad set `objective_group = 'wa'`), `Retargeting` (`OUTCOME_LEADS`, `wa`), `Website Checkout` (`OUTCOME_SALES`, `web`).
- [x] **11 kreatif** di `ad_creatives` (nama bebas, `object_type` campuran `VIDEO`/`IMAGE`, `video_length_seconds` hanya untuk video) dan **11 ad** satu-satu di `ads`.
- [x] **63 hari** `ad_insights_daily` berakhir `2026-11-25`, `level = 'ad'`, `attribution_window = '7d_click'`, satu baris per `(ad, date)` → **693 baris**. Pakai `generate_series` atau loop `addDays` dari `@shared/dates`; jangan tulis 693 baris literal.
- [x] Setiap baris insight punya `ad_insight_actions` sesuai objective group: `wa` → `onsite_conversion.messaging_conversation_started_7d`; `web` → `landing_page_view`, `view_content`, `add_to_cart`, `purchase` (+ `value_minor`).
- [x] Satu kreatif (`cr_price_c` atau nama setara) diberi penurunan CTR bertahap sepanjang 63 hari agar rule `creative_fatigue` punya sinyal; kreatif lain datar.
- [x] **8 lead** di `leads`: 3 `HOT`, 3 `WARM`, 2 `COLD`, dengan `first_seen_at`/`first_replied_at` yang menghasilkan median jeda balas **24 menit** (1440 detik) untuk pasangan yang terukur; 4 lead tanpa balasan.
- [x] `lead_assessments` satu baris `applied = true` per lead (`rule_version = 'seed-v1'`), `lead_milestones` untuk `WARM` dan `HOT`.
- [x] `conversation_messages` pasangan `INBOUND`+`OUTBOUND` per lead dengan `response_type` dari `REPLY_TYPES` (`src/shared/audience.ts`) — ketujuh nilai harus terwakili minimal sekali agar breakdown F-14 tidak kosong.
- [x] `ad_insights_breakdown_daily` 14 hari terakhir untuk 3 kombinasi `publisher_platform`/`platform_position`/`impression_device` agar `/analytics/audience/segments` terisi.
- [x] `pixel_sources` satu baris + `tracking_health_daily` 4 event (`PageView`, `ViewContent`, `AddToCart`, `Purchase`) pada `2026-11-25`.
- [x] `insight_alerts` 5 baris: 3 `ACTIVE` (satu `CRITICAL`), 1 `DONE` (`resolved_at` terisi), 1 `SNOOZED` (`snoozed_until` terisi) agar ketiga tab F-18 punya isi.

### 3. Golden test
- [x] Buat `tests/integration/seed-parity.test.ts`. Jalankan seed di `beforeAll`, lalu kunci angka:
  - `GET /api/analytics/summary?accountId=act_demo_funnellens&since=2026-10-27&until=2026-11-25` → `cards.leads.value` = jumlah `messaging_started` seed, `campaigns.length === 3`.
  - `GET /api/analytics/funnel?...&objectiveGroup=wa` → `stages.length === 7`, `stages[0].key === 'impressions'`.
  - `GET /api/analytics/creatives?...` → `creatives.length === 11`.
  - `GET /api/analytics/audience?...` → `total === 8`, `distribution` = 3/3/2.
  - `GET /api/analytics/audience/conversations?...` → `counts.length === 7`, `timed.medianSeconds === 1440`.
  - `GET /api/alerts?...&status=active` → `alerts.length === 3`, `/alerts/badge` → `count === 3`.
- [x] Test di-skip otomatis bila `DATABASE_HOST` tidak terjangkau, mengikuti pola test integrasi lain di repo.

### 4. Dokumentasi
- [x] Tambah baris `bun run db:seed` di `README.md` bagian "Setup database", dengan catatan bahwa skrip ini membuat tenant `demo` terpisah.

## File yang Disentuh
- `scripts/seed-demo.ts` (baru)
- `package.json` (`db:seed`)
- `tests/integration/seed-parity.test.ts` (baru)
- `README.md`

## Uji Selesai
- `bun run db:seed` dua kali berturut-turut → hitungan baris identik (tidak menduplikasi).
- `bun test tests/integration/seed-parity.test.ts` lulus dengan angka di atas.
- Akun `act_1838599814186291` dan akun `act_smoke_*` tidak berubah setelah seed dijalankan.
