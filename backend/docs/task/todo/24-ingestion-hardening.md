# TODO: Pengerasan Ingestion — Token, Status Sumber, Cursor, Null Semantik, Rekonsiliasi, PII

## Gambaran Fitur
Ingestion sudah berjalan, tetapi beberapa syarat checklist belum dipenuhi: token Meta tersimpan plaintext tanpa refresh, status sumber tidak terpadu, tidak ada endpoint `/sources`, tidak ada cursor incremental, view mengubah event hilang menjadi `0`, tidak ada rekonsiliasi pembelian, atribusi CTWA tidak menyimpan bukti, dan tidak ada retensi/hapus data. Task ini menutup F-02.1, F-02.3, F-02.4, F-03.6, F-04.2, F-04.3, F-05.2, F-05.3, F-05.5.

## Daftar Pekerjaan

### 1. Token Meta terenkripsi + refresh (F-02.1)
- [x] Buat `src/shared/crypto.ts`: `encrypt(plain: string): string` dan `decrypt(payload: string): string` memakai AES-256-GCM, kunci = `sha256(Config.application.secret)`, format `v1:{iv_b64}:{tag_b64}:{cipher_b64}`.
- [x] Migrasi `meta_connection`: tambah `refresh_token text`, `token_refreshed_at timestamptz`, dan ubah `access_token` agar menyimpan hasil `encrypt()`.
- [x] Migrasi data: baca semua `access_token` yang belum berawalan `v1:`, enkripsi, tulis ulang dalam satu transaksi.
- [x] `MetaConnectionRepository` melakukan `encrypt` saat menulis dan `decrypt` saat membaca; tidak ada pemanggil lain yang menyentuh kolom itu langsung.
- [x] Tambah job `refresh-meta-tokens` (queue `meta-sync`, harian `0 2 * * *`): untuk koneksi dengan `expires_at` < 7 hari, tukar token lewat endpoint `oauth/access_token` (`grant_type=fb_exchange_token`), simpan hasil + `token_refreshed_at`.
- [x] `DELETE /api/meta/connection` memanggil `DELETE /{meta_user_id}/permissions` di Graph API sebelum menghapus baris; kegagalan revoke di-`warn` dan baris tetap dihapus.

### 2. Status sumber terpadu + `GET /sources` (F-02.3, F-02.4)
- [x] Tambah `export type SourceStatus = "connected" | "simulation" | "disconnected" | "out_of_scope";` di `src/shared/sources.ts` (baru) beserta `sourceStatusOf(input): SourceStatus`.
- [x] Tambah kolom `ad_accounts.last_sync_at timestamptz` dan `ad_accounts.last_sync_error text`, diperbarui di `src/modules/meta/worker.ts` setelah setiap sync sukses/gagal.
- [x] Buat `src/modules/sources/{index.ts,service.ts}` + `GET /api/sources`:
  ```ts
  {sources: [{key: "meta" | "whatsapp", status: SourceStatus, lastSyncAt, lastError, scopes?, expiresAt?}]}
  ```
  `simulation` dipakai bila `meta_connection` ada tetapi akun belum pernah sync.
- [x] `SettingsService` (task `22-settings-workspace.md`) memakai `sourceStatusOf` yang sama; jangan dua implementasi.

### 3. Cursor incremental (F-03.6)
- [x] Tambah tabel `sync_cursors` (`account_id`, `resource`, `cursor text`, `updated_at`), unik pada `(account_id, resource)`.
- [x] `fetchAll` (`src/modules/meta/service.ts`) menyimpan `paging.next` terakhir ke `sync_cursors` setiap halaman selesai, sehingga job yang terputus melanjutkan dari halaman terakhir, bukan dari awal.
- [x] Cursor dihapus (`DELETE`) saat job selesai penuh; job yang dimulai tanpa cursor berarti backfill penuh.
- [x] Tambah `sync_runs.rows_skipped bigint` untuk mencatat halaman yang dilewati karena cursor.

### 4. Null semantik event web (F-04.2)
- [x] Migrasi ulang view `ad_insight_metrics`: kolom `lpv`, `view_content`, `add_to_cart`, `purchases` mengembalikan `NULL` bila tidak ada baris `ad_insight_actions` untuk tipe event itu (hapus `COALESCE(..., 0)` pada empat kolom tersebut).
- [x] Pertahankan `COALESCE(..., 0)` pada `results` agar rasio tetap terdefinisi (`results` tetap `leads` untuk `wa` dan `purchases` untuk `web`), dan pada `leads`/`purchase_value_minor`: keduanya dipakai sebagai penyebut biaya per hasil di banyak query yang tidak punya jalur `null`, sedangkan empat kolom event di atas punya. Empat kolom event itulah yang menjadi `NULL`.
- [x] Ubah `FunnelCountsLike` (`src/shared/funnel.ts`) agar `lpv`, `viewContent`, `addToCart`, `purchase` bertipe `number | null`; `StageDefinition.read` mengembalikan `number | null`.
- [x] `AnalyticsService.getFunnel`: tahap dengan `value === null` mengembalikan `value: null`, `share: null`, `rateFromFirst: null`, dan `sample.eligible = false` dengan `note: "Event <key> tidak tersedia pada periode ini."`.
- [x] `getSummary`: KPI `roas` dan `cards` lain yang bergantung pada `purchase` menjadi `null` + `note` bila `purchase` tidak tersedia.
- [x] Perbarui test `tests/integration/analytics-funnel.test.ts` dan `tests/unit/funnel-pairs.test.ts` untuk `null` baru.

### 5. Rekonsiliasi pembelian (F-04.3)
- [x] Tambah tabel `purchase_reconciliation` (`account_id`, `date`, `meta_purchases bigint`, `recorded_orders bigint`, `difference bigint`, `reason text`, `created_at`), unik pada `(account_id, date)`.
- [x] Tambah sumber pesanan tercatat: tabel `recorded_orders` (`account_id`, `date`, `orders bigint`, `revenue_minor bigint`, unik `(account_id, date)`) yang diisi manual/impor CSV lewat `POST /api/reports/recorded-orders` (body `{date, orders, revenueMinor}`).
- [x] Job harian `reconcile-purchases` (queue `meta-sync`): untuk tiap tanggal dengan pesanan tercatat, bandingkan `meta_purchases` vs `recorded_orders`, tulis `difference` dan `reason` (`"selisih atribusi"` bila `difference !== 0`, `null` bila sama).
- [x] Tambah `reconciliation: {date, metaPurchases, recordedOrders, difference, reason}[]` (7 hari terakhir) ke `TrackingHealthResponse`.

### 6. Atribusi CTWA + percakapan (F-05.2, F-05.3)
- [x] Migrasi `leads`: tambah `ctwa_clid text`, `attribution_method text`, `attribution_confidence text` dengan `check (attribution_method in ('ctwa_referral','form','manual','unknown'))` dan `check (attribution_confidence in ('rendah','sedang','tinggi'))`.
- [x] `CloudIngestService` mengisi `ctwa_clid` dari `referral.ctwa_clid`/`referral.source_id`; tanpa bukti → `attribution_method = 'unknown'`, `attribution_confidence = 'rendah'` (jangan menebak campaign).
- [x] Migrasi `conversation_messages`: tambah `conversation_id uuid` + index `(lead_id, conversation_id, sent_at)`; `conversation_id` = id percakapan Cloud API bila ada, selain itu `lead_id` di-hash stabil per 24 jam.
- [x] Enkripsi `conversation_messages.body` dengan `src/shared/crypto.ts` (kolom `body_encrypted text`), isi `body` lama dihapus setelah migrasi; service melakukan `decrypt` saat membaca trail.
- [x] `LeadListRow`/`PipelineRow` menyertakan `attribution: {method, confidence}`.

### 7. Retensi & hapus data (F-05.5)
- [x] `DELETE /api/leads/{id}` (`LeadController`): hapus baris `conversation_messages` + `lead_assessments` + `lead_milestones` + `leads` dalam satu transaksi, tulis `export_audit`-style log ke tabel `deletion_audit` (`tenant_id`, `user_id`, `lead_id`, `reason`, `created_at`).
- [x] Endpoint hanya untuk role `ADMIN`; `404` bila lead bukan milik tenant.
- [x] Retensi pesan mengikuti job retensi di `23-ops-production.md` (isi pesan `NULL` setelah 180 hari) — jangan duplikasi logika di sini.

## File yang Disentuh
- `src/shared/{crypto,sources}.ts` (baru), `src/shared/funnel.ts`
- `src/infra/database/schema/ads/{meta-connection,ad-account}.entity.ts`, `schema/wa/{lead,conversation-message}.entity.ts`, `schema/ads/{purchase-reconciliation,recorded-orders,sync-cursors}.entity.ts` (baru), migrasi
- `src/modules/meta/{service,worker,queue}.ts`
- `src/modules/wa/cloud/service.ts`
- `src/modules/analytics/service.ts`, `src/modules/tracking-health/service.ts`
- `src/modules/sources/*` (baru), `src/modules/reports/*` (recorded-orders), `src/routes.ts`

## Uji Selesai
- `meta_connection.access_token` di DB berawalan `v1:`; `GET /api/meta/connection` tetap mengembalikan data tanpa token; sync tetap berhasil (decrypt benar).
- Token kedaluwarsa < 7 hari → job refresh memperbarui `expires_at`; revoke memanggil Graph API (dibuktikan lewat stub adapter).
- `GET /api/sources` untuk tenant dengan koneksi yang belum pernah sync → `meta.status === "simulation"`; setelah sync → `"connected"` dengan `lastSyncAt`.
- Job sync diputus di halaman ke-2 → dijalankan ulang melanjutkan dari halaman ke-3, bukan halaman 1.
- Akun tanpa baris `add_to_cart` → `GET /api/analytics/funnel?objectiveGroup=web` mengembalikan `value: null` untuk tahap itu dan `sample.eligible === false`; **tidak** ada `0`.
- `POST /api/reports/recorded-orders` 100 pesanan vs 92 pembelian Meta → `purchase_reconciliation.difference === 8` dengan `reason` terisi, muncul di `/tracking-health`.
- Webhook tanpa `referral` → lead tersimpan dengan `attribution_method = 'unknown'`, bukan campaign tebakan.
- `DELETE /api/leads/{id}` menghapus 4 tabel terkait, menulis `deletion_audit`, dan lead hilang dari `GET /api/leads`.
