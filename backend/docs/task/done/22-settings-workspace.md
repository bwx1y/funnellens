# Selesai: `GET /api/settings` — Objek Workspace & Status Sumber

Dokumentasi implementasi penutup F-20.2.

## Ringkasan Fitur

- **`GET /api/settings`** (tanpa query, `JwtUtil.isAuthenticated`): satu panggilan yang menjawab "workspace ini apa dan sumber mana yang benar-benar jalan", menggantikan penggabungan manual `/profile` + `/meta/connection` + `/wa/session`.
- **`workspace`**: `id`/`name`/`address` dari tenant user; `timezone`/`currency`/`currencyOffset` dari akun terpilih (`AdAccountRepository.findSelectedByTenantId`). Tenant tanpa akun terpilih mengembalikan `null` untuk ketiganya — bukan `"Asia/Jakarta"` tebakan, karena klien akan memformat angka di zona yang salah.
- **`mode`**: selalu `{readOnly: true, reason: "analytics-only"}`. Backend hanya membaca data Meta/WhatsApp, tidak pernah menulis balik.
- **`sources`** dirakit dari repository yang sudah ada, tidak ada status yang dikarang:
  - `meta`: `MetaConnectionRepository.findByTenantId` → `disconnected` bila tidak ada koneksi, `expired` bila `expiresAt <= now`, selain itu `connected`. `lastSyncAt` = `finished_at` terbaru berstatus `SUCCESS`; `lastError` = `error` dari run `FAILED` terbaru.
  - `whatsapp`: `WaSessionRepository.findAllByTenantId` → `connected` bila ada sesi `ready`, `disconnected` bila tidak ada. `out_of_scope` bila seluruh ad set tenant hanya `web`: sesi `ready` pun tidak berarti ada funnel WhatsApp untuk dilaporkan. `lastSyncAt` = `sent_at` pesan terbaru (ingestion WhatsApp berbasis webhook, tidak menulis `sync_runs`).
  - `detailRoute` menunjuk endpoint yang menangani sumber tersebut (`/api/meta/connection`, `/api/wa/session`).
- **`limits`** memakai konstanta yang sudah ditegakkan di tempat lain, bukan angka salinan: `MIN_COMPARATORS` (5) dari `src/shared/creative.ts`, `MAX_SEARCH_RESULTS` (8) dari modul search, `DEFAULT_PAGE_SIZE` (10) dari `src/shared/audience.ts`, `PERIOD_DAYS` (`[7, 14, 30]`) dari `src/shared/period.ts`.
- **`exportAuditEnabled: true`**: audit ekspor sudah ada sejak task 21.

## Keputusan yang Perlu Dicatat

- **`lastError` yang sudah teratasi tidak ditampilkan.** Bila run `FAILED` terbaru selesai sebelum run `SUCCESS` terbaru, `lastError` bernilai `null`: pesan galat lama di samping sumber berstatus `connected` akan menyesatkan. Galat tetap dilaporkan selama belum ada sukses setelahnya (atau belum pernah ada sukses sama sekali).
- **`SettingsSchema = {}` tidak diekspor.** Checklist meminta objek kosong itu demi konsistensi `UnwrapSchema`, tetapi tidak ada pemanggil yang memakainya — ekspor kosong hanya jadi dead code. `schema.ts` tetap ada dan berisi kontrak respons (`SettingsResponse`, `SettingsSource`, `SettingsSourceStatus`) yang dipakai controller dan service.
- **`DEFAULT_PAGE_SIZE` dan `LEAD_PAGE_SIZES` pindah ke `src/shared/audience.ts`** agar modul settings dan audience membaca satu sumber; `src/modules/audience/service.ts` mengimpornya dari sana (tidak ada duplikasi nilai).
- **`MAX_SEARCH_RESULTS` diekspor** dari `src/modules/search/service.ts` (sebelumnya `RESULT_LIMIT` privat).

## Perubahan File

- `src/modules/settings/index.ts` (baru): `SettingsController` (prefix `/settings`).
- `src/modules/settings/service.ts` (baru): `SettingsService.get`, `metaSource`, `whatsappSource`.
- `src/modules/settings/schema.ts` (baru): `SettingsResponse`, `SettingsSource`, `SettingsSourceStatus`.
- `src/routes.ts`: registrasi `SettingsController`.
- `src/infra/database/repositories/sync-run.repository.ts`: `SyncRunFailure`, `findLatestSuccessAt`, `findLatestFailure`.
- `src/infra/database/repositories/ad-set.repository.ts`: `hasObjectiveGroup` (gerbang scope channel).
- `src/infra/database/repositories/conversation-message.repository.ts`: `getLatestSentAt`.
- `src/shared/audience.ts`: `LEAD_PAGE_SIZES`, `DEFAULT_PAGE_SIZE` (dipindah dari service audience).
- `src/modules/audience/service.ts`: impor konstanta dari `@shared/audience`.
- `src/modules/search/service.ts`: `RESULT_LIMIT` → `MAX_SEARCH_RESULTS` (diekspor).
- `tests/integration/settings-workspace.test.ts` (baru): 6 test.

## Hasil Pengujian

- `bun test` penuh: **308 test di 42 file lulus** tanpa regresi.
- `bunx tsc --noEmit` bersih.
- Kunci perilaku yang diuji lewat `app.handle` (permukaan HTTP sebenarnya):
  - Tenant dengan koneksi Meta valid + sesi WA `ready` → `meta.status === "connected"`, `whatsapp.status === "connected"`, keduanya berisi `lastSyncAt` (dari run sukses dan dari pesan terbaru).
  - `workspace` = tenant + akun terpilih (`Asia/Jakarta`, `IDR`, offset `100`), `mode.readOnly === true`, `exportAuditEnabled === true`.
  - `limits` = `{5, 8, 10, [7, 14, 30]}`.
  - Tenant tanpa akun → `timezone`/`currency`/`currencyOffset` `null`, `meta.status === "disconnected"`, `lastError === null`, HTTP `200`.
  - Tenant yang seluruh ad set-nya `web` → `whatsapp.status === "out_of_scope"` meski ada sesi `ready`.
  - Koneksi kedaluwarsa + run gagal setelah sukses terakhir → `meta.status === "expired"` dan `lastError === "Token tidak valid"`; run gagal yang sudah dilewati sukses berikutnya → `lastError === null`.
