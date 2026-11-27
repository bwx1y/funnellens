# Selesai: Pengerasan Ingestion — Token, Status Sumber, Cursor, Null Semantik, Rekonsiliasi, PII

Dokumentasi implementasi penutup F-02.1, F-02.3, F-02.4, F-03.6, F-04.2, F-04.3, F-05.2, F-05.3, F-05.5.

## Ringkasan Fitur

- **Token Meta terenkripsi (F-02.1)**: `src/shared/crypto.ts` (AES-256-GCM, kunci `sha256(secret)`, format `v1:iv:tag:cipher`). `MetaConnectionRepository` adalah satu-satunya penulis/pembaca kolom token: menulis `encrypt`, membaca `decrypt`, jadi pemanggil selalu memegang plaintext dan tabel tidak pernah menyimpan token terbaca. `meta_connection` mendapat `refresh_token` + `token_refreshed_at`.
- **Refresh token**: job `refresh-meta-tokens` (queue `meta-sync`, `0 2 * * *`) menukar token yang kedaluwarsa < 7 hari lewat `oauth/access_token` (`grant_type=fb_exchange_token`) dan menyimpan hasil + `token_refreshed_at`. Kegagalan satu koneksi dicatat dan tidak menghentikan koneksi lain.
- **Revoke saat disconnect**: `DELETE /api/meta/connection` memanggil `DELETE /{meta_user_id}/permissions` sebelum menghapus baris; kegagalan revoke hanya `warn` dan baris tetap dihapus.
- **Status sumber terpadu (F-02.3, F-02.4)**: `src/shared/sources.ts` dengan `SourceStatus` + `sourceStatusOf`. `GET /api/sources` mengembalikan `{sources: [{key, label, status, lastSyncAt, lastError, detailRoute, scopes?, expiresAt?}]}`; `SettingsService` memakai `SourcesService` yang sama (tidak ada implementasi kedua). `ad_accounts.last_sync_at`/`last_sync_error` diisi worker setiap sync sukses/gagal. `simulation` = koneksi ada tetapi belum pernah sync.
- **Cursor incremental (F-03.6)**: tabel `sync_cursors` (unik `(account_id, resource)`). `fetchAll` menyimpan posisi `paging.next` + jumlah halaman setelah setiap halaman, melanjutkan dari posisi itu saat job dijalankan ulang, dan menghapus cursor saat walk selesai (tanpa cursor = backfill penuh). `sync_runs.rows_skipped` mencatat halaman yang dilewati.
- **Null semantik event web (F-04.2)**: view `ad_insight_metrics` mengembalikan `NULL` untuk `lpv`, `view_content`, `add_to_cart`, `purchases` bila tidak ada baris aksi untuk event itu. `FunnelCountsLike`/`StageDefinition.read` menjadi `number | null`; `getFunnel` mengembalikan `value/share/rateFromFirst = null` + `note: "Event <key> tidak tersedia pada periode ini."`; pair yang menyentuh tahap kosong tidak eligible dan membawa note yang sama; `getSummary` mengosongkan `roas` + note bila `purchase` tidak tersedia.
- **Rekonsiliasi pembelian (F-04.3)**: tabel `recorded_orders` (diisi `POST /api/reports/recorded-orders`) dan `purchase_reconciliation`. Job `reconcile-purchases` (`0 4 * * *`) menulis `difference = recorded − meta` dan `reason: "selisih atribusi"` bila tidak nol. `TrackingHealthResponse.reconciliation` memuat 7 hari terakhir.
- **Atribusi CTWA (F-05.2)**: `leads` mendapat `ctwa_clid`, `attribution_method` (`ctwa_referral|form|manual|unknown`, CHECK), `attribution_confidence` (`rendah|sedang|tinggi`, CHECK). Referral dengan ad yang dikenal → `ctwa_referral` + confidence `tinggi`/`sedang`; referral ke ad tak dikenal → `unknown`/`rendah` dengan `ctwa_clid` tetap disimpan sebagai bukti; tanpa referral → `unknown`/`rendah`, tanpa campaign tebakan.
- **Percakapan + PII (F-05.3)**: `conversation_messages` mendapat `conversation_id` (id Cloud API bila ada, selain itu UUID turunan hash `lead_id:hari` sehingga stabil per 24 jam) + index `(lead_id, conversation_id, sent_at)`. Body ditulis ke `body_encrypted`, `body` dikosongkan; pembaca trail melakukan `decrypt` dan menampilkan `null` + `warn` bila satu baris korup, bukan menggagalkan seluruh trail. `LeadListRow`/`PipelineRow` menyertakan `attribution: {method, confidence}`.
- **Hapus data (F-05.5)**: `DELETE /api/leads/{id}` (ADMIN, `?reason=`) menghapus `conversation_messages` + `lead_assessments` + `lead_milestones` + `leads` dalam satu transaksi dan menulis `deletion_audit`; lead tenant lain → `404`, role lain → `403`. Retensi pesan tetap milik job retensi task 23 (tidak diduplikasi).

## Keputusan yang Perlu Dicatat

- **`SourceStatus` mendapat nilai kelima `expired`.** Checklist menyebut empat nilai, tetapi task 22 sudah mengirim `expired` ke halaman settings dan `sourceStatusOf` dipakai bersama; melipat token kedaluwarsa ke `disconnected` akan menghilangkan satu-satunya sinyal yang membedakan "sambungkan ulang" dari "sambungkan pertama kali".
- **Backfill data dijalankan sebagai skrip, bukan SQL.** AES-256-GCM butuh kunci aplikasi, yang tidak pernah dipegang database. `bun run db:migrate-secrets` idempoten (melewati nilai yang sudah `v1:`), memindahkan token, body, `conversation_id`, dan atribusi default. Migrasi skema tetap `0020`.
- **`COALESCE(..., 0)` dipertahankan pada `leads` dan `purchase_value_minor`**, bukan hanya `results`. Keduanya dipakai sebagai penyebut biaya per hasil di query yang tidak punya jalur `null`; yang diminta menjadi null adalah empat kolom event, dan keempatnya sudah.
- **Cursor menyimpan JSON `{next, pages}`**, bukan URL mentah: jumlah halaman yang dilewati tidak bisa dihitung ulang tanpa menyimpannya, dan itulah nilai `rows_skipped`. Parser tetap menerima cursor URL lama.
- **`difference = recorded − meta`** agar sesuai kriteria uji (100 pesanan vs 92 pembelian Meta → `8`). Tanda positif berarti permintaan yang tidak teratribusi; negatif berarti Meta menghitung pembelian yang tidak pernah dibukukan.
- **Token revoke memakai `meta_user_id`**, bukan `/me/permissions`: baris yang dihapus bisa saja bukan milik token yang sedang dipakai, dan revoke harus menyasar identitas yang tersimpan.

## Perubahan File

- `src/shared/{crypto,sources}.ts` (baru), `src/shared/funnel.ts` (nullable stages + `missingEventNote`).
- `src/infra/database/schema/ads/{meta-connection,ad-account,sync-run,deletion-audit,purchase-reconciliation,recorded-orders,sync-cursors}.entity.ts`, `schema/wa/{lead,conversation-message}.entity.ts`, `schema/ads/ad-insight-metrics.view.ts`, `schema/index.ts`.
- `src/infra/database/migration/0020_strong_omega_red.sql` (+ snapshot/journal).
- `src/infra/database/repositories/{meta-connection,sync-run,ad-account,analytics,lead,lead-assessment,conversation-ingest,conversation-message}.repository.ts`, `{sync-cursor,purchase-reconciliation}.repository.ts` (baru).
- `src/modules/meta/{service,worker,queue}.ts`, `{token-refresh,dead-letter}.service.ts`/`.ts`, `src/modules/reports/{index,schema}.ts`, `reconciliation.service.ts` (baru).
- `src/modules/sources/{index,service}.ts` (baru), `src/modules/settings/service.ts` (delegasi), `src/modules/analytics/service.ts`, `src/modules/audience/{service,index,schema}.ts`, `src/modules/tracking-health/service.ts`, `src/modules/wa/cloud/service.ts`, `src/routes.ts`.
- `scripts/migrate-secrets.ts` (baru), `package.json` (`db:migrate-secrets`).
- `tests/integration/ingestion-hardening.test.ts` (baru), `tests/integration/{wa-cloud-ingestion,analytics-audience,settings-workspace}.test.ts`, `tests/unit/{ad-account,meta-non-additive-and-queue,meta-sync-insights,meta-sync-master}.test.ts`.

## Hasil Pengujian

- `bun test` penuh: **337 test di 44 file lulus** tanpa regresi.
- `bunx tsc --noEmit` bersih.
- Migrasi `0020` diterapkan ke database dev; `bun run db:migrate-secrets` melaporkan 1 token, 24 body, 2 `conversation_id`, 18 atribusi. Diperiksa langsung: `meta_connection.access_token` berawalan `v1:`, dan `conversation_messages` memiliki `0` body plaintext / `24` terenkripsi.
- Kunci perilaku yang diuji lewat permukaan sebenarnya:
  - Token tersimpan `v1:` di DB, `GET /api/meta/connection` tidak memuat token maupun ciphertext, dan pembacaan repository mengembalikan plaintext.
  - Cipher round-trip; payload yang diubah 1 byte dan string non-cipher sama-sama melempar.
  - Token kedaluwarsa 3 hari → job refresh memanggil `fb_exchange_token`, menyimpan token baru terenkripsi, `expires_at` mundur > 50 hari.
  - `disconnect` memanggil `DELETE /{meta_user_id}/permissions` lalu menghapus baris.
  - `GET /api/sources`: koneksi tanpa sync → `simulation` + `lastSyncAt: null`; setelah run sukses → `connected` + `lastSyncAt` terisi; status identik dengan `/api/settings`.
  - `fetchAll` dengan cursor tersimpan hanya memanggil halaman ketiga, melaporkan `onSkipped(2)`, dan menghapus cursor setelah selesai.
  - Akun tanpa baris `add_to_cart` → tahap `add_to_cart` `value: null`, `share: null`, `rateFromFirst: null`, `note` sesuai, pair `eligible: false`; `roas` `null` + note; tahap `impressions` tetap `5000`.
  - `POST /api/reports/recorded-orders` 100 pesanan vs 92 pembelian Meta → `difference: 8`, `reason: "selisih atribusi"`, dan muncul di `/tracking-health`.
  - Webhook tanpa referral → lead `attribution_method: "unknown"`, `attribution_confidence: "rendah"`, `campaignId: null`, `ctwaClid: null`, pesan tetap punya `conversation_id`.
  - `DELETE /api/leads/{id}` menghapus 4 tabel, menulis `deletion_audit` (user + alasan), lead hilang, penghapusan kedua → `404`; role MANAGER → `403`.
  - Trail membaca body terenkripsi sebagai plaintext dan baris mentah menyimpan `v1:` dengan `body` `null`.
