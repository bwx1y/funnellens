# Selesai: Penyelarasan Kontrak API — Envelope, Paginasi, Role

Dokumentasi implementasi penutup F-01.2 dan F-01.3.

## Ringkasan Fitur

- **Envelope sukses (F-01.2)**: `src/plugins/envelope.plugin.ts` memasang `onAfterHandle({as:'global'})` yang membungkus payload JSON menjadi `{data, meta:{requestId, cached?}}`. `requestId` dibaca dari `requestIdOf(request)` milik `http-logger` (atau UUID baru bila logger tidak berjalan). `cached: true` hanya muncul saat agregasi dilayani cache (`src/shared/request-context.ts`, `markCacheHit`), jadi klien bisa membedakan hit dari hitung ulang.
- **Envelope error (F-01.3)**: `onError` di `src/index.ts` kini mengembalikan `{error:{code, message, details}}`. `code` = `AppError.code` bila ada, selain itu `codeForStatus()` (`src/shared/errors.ts`): 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 422 `UNPROCESSABLE_ENTITY`, 429 `RATE_LIMITED`, 500 `INTERNAL_ERROR`. `details` berisi `error.all.map({path, message})` hanya untuk `code === "VALIDATION"`, selain itu `null`. Status HTTP tidak berubah.
- **Paginasi seragam**: `src/shared/pagination.ts` (`PAGE_SIZES`, `pageMeta`, `resolvePage`, `resolvePageSize`) dipakai `GET /api/leads`, `GET /api/alerts`, dan `GET /api/reports/exports`. Ukuran sah `5, 10, 15, 20, 50, 100`; nilai lain → `400 INVALID_PAGE_SIZE` "page_size tidak valid". `page` di-clamp ke `[1, pages]`, `pages = max(1, ceil(total/page_size))`.
- **Role `ADMIN`/`VIEWER`**: `userRoleEnum` menjadi `["ADMIN", "VIEWER"]`, default kolom `VIEWER`, migrasi `0021` menambahkan `VIEWER` lalu memindahkan setiap `MANAGER` ke `ADMIN` sebelum tipe lama dihapus. `src/shared/guards.ts` menyediakan `requireAdmin` yang menolak non-ADMIN dengan `403 {code:"FORBIDDEN", message:"Butuh role ADMIN"}`.
- **Registrasi**: user pertama sebuah tenant (satu-satunya jalur `register`, yang selalu membuat tenant baru) eksplisit `ADMIN`; `POST /api/users` tanpa `role` menghasilkan `VIEWER`.
- **Batas ADMIN**: `POST/DELETE` Meta (oauth select, disconnect, seluruh `sync/*` dan `queue/*`, `queue/dlq`), tulis `wa/session`, seluruh `users`, `metrics`, `DELETE /leads/{id}`, `POST /reports/recorded-orders`. VIEWER mempertahankan seluruh GET analitik/leads/alerts/tracking/settings/sources, `PATCH /leads/{id}`, `PATCH /alerts/{id}/resolve|snooze`.

## Keputusan yang Perlu Dicatat

- **Plugin envelope dipasang *sebelum* `routes`, bukan sesudahnya.** Elysia hanya menerapkan hook `as:'global'` pada route yang dimount setelah hook itu; memasangnya sesudah `use(routes)` membuat semua respons tetap polos (diverifikasi dengan probe minimal: `use(routes).use(wrap)` → `{"a":1}`, `use(wrap).use(routes)` → `{"data":{"a":1},...}`). Kontrak yang dilihat klien identik dengan yang diminta checklist.
- **Skip envelope bersifat path + bentuk.** `/api/wa/cloud/webhook*`, `/api/wa/webhook*`, `/api/healthz`, `/api/readyz` tidak dibungkus, begitu pula nilai `Response` (CSV, teks `hub.challenge`) dan respons ber-`content-type` non-JSON (metrik Prometheus). Deteksi idempoten memakai `meta.requestId`, bukan sekadar "punya `data` dan `meta`": payload paginasi sendiri sudah membawa `meta:{page,...}`, dan bentuk longgar akan membuatnya lolos tanpa dibungkus.
- **Skip hanya untuk sukses.** Error dari jalur webhook tetap keluar sebagai envelope (Meta/OpenWA memperlakukan status non-2xx sebagai kegagalan apa pun bodynya), sehingga satu bentuk error berlaku di seluruh API.
- **`meta.cached` disalurkan lewat `Request`, bukan header.** `AggregationCache` tidak menyentuh context Elysia; `markCacheHit(request)` di WeakSet per-request lebih murah dan tidak bisa bocor antar request atau antar permintaan paralel, dibanding menyetel header lalu menghapusnya.
- **Ukuran halaman naik dari `{5,10,15}` + 422 menjadi `{5,10,15,20,50,100}` + 400.** Checklist menang; `pageSize` dan `limit` tetap diterima sebagai alias (satu rilis), jadi klien lama tidak pecah. `GET /api/leads` mengurutkan prioritas `page_size` → `pageSize` → `limit`.
- **Alias lama dipertahankan, kecuali `data`.** `page`, `pageSize`, `limit`, `total`, `pages` masih dikirim di level atas payload. `data` array milik daftar lead dibuang karena bertabrakan dengan `data` milik envelope — mempertahankannya akan membuat `data.data`. Daftar alert mempertahankan `alerts` (tanpa paginasi) sebagai jalur lama selama satu rilis.
- **Urutan registrasi route menentukan cakupan guard.** `requireAdmin` adalah hook `scoped`, jadi route yang ditulis sesudah `.use(requireAdmin)` ikut terjaga dan route sebelumnya tidak. Konsekuensinya `PATCH /leads/{id}` dan `GET /reports/exports` dipindah ke atas guard, dan route dlq tidak lagi memeriksa role sendiri (tidak ada dua sumber kebenaran).
- **`GET /api/meta/insights/non-additive` tetap terbuka untuk VIEWER**: ia GET baca-saja, sedangkan daftar admin pada checklist hanya menyebut tulis/sync/queue.

## Perubahan File

- `src/plugins/envelope.plugin.ts` (baru), `src/index.ts`, `src/shared/{pagination,guards,request-context}.ts` (baru), `src/shared/errors.ts` (`codeForStatus`).
- `src/infra/database/schema/enums.ts`, `schema/core/user.entity.ts`, `migration/0021_goofy_jackal.sql` (+ snapshot/journal).
- `src/infra/database/repositories/lead.repository.ts` (konstanta halaman pindah ke `@shared/pagination`).
- `src/modules/audience/{index,schema,service}.ts`, `alerts/{schema,service}.ts`, `reports/{index,schema,service}.ts`, `analytics/{index,service}.ts`, `meta/index.ts`, `wa/session/index.ts`, `user/{index,schema,service}.ts`, `metrics/index.ts`, `auth/service.ts`, `settings/service.ts`, `src/shared/audience.ts`.
- `tests/helpers.ts` (baru: `readData`/`readEnvelope`/`readError`), `tests/integration/api-contract.test.ts` (baru), seluruh suite integrasi lain disesuaikan assert-nya.

## Hasil Pengujian

- `bun test` penuh: **348 test di 45 file lulus** (1637 assertion), tanpa regresi.
- `bunx tsc --noEmit` bersih.
- Migrasi `0021` diterapkan ke database dev (`drizzle-kit push`); `pg_enum` untuk `role` berisi `ADMIN`, `VIEWER` dan tidak ada baris `MANAGER` tersisa.
- Kunci perilaku yang diuji lewat permukaan sebenarnya (`tests/integration/api-contract.test.ts`):
  - `GET /api/analytics/summary` → `{data:{...,cards.spend.value}, meta:{requestId}}`; panggilan kedua menandai `meta.cached === true` dengan data identik.
  - Query tidak valid (`page=0`) → `400 {code:"VALIDATION_ERROR", details:[{path:"/page", message}]}`; route tak dikenal → `404 NOT_FOUND`; body JSON rusak → `400 PARSE_ERROR`.
  - `GET /api/wa/cloud/webhook?hub.mode=subscribe&hub.challenge=…` dengan verify token benar → teks polos `challenge`, `content-type` `text/plain` (tidak dibungkus); token salah → `401 UNAUTHORIZED`.
  - `GET /api/leads?...&page_size=20` → `data.meta.page_size === 20`, `pages === ceil(total/20)`; `page_size=7` → `400 INVALID_PAGE_SIZE`.
  - VIEWER: `POST /api/meta/sync/master` → `403 FORBIDDEN` "Butuh role ADMIN"; `PATCH /api/alerts/{id}/resolve` dan `GET /api/leads` → `200`. ADMIN pada kedua route → bukan 403 / 200.
  - `POST /api/auth/register` → `role === "ADMIN"`; `POST /api/users` tanpa `role` → `role === "VIEWER"`.
