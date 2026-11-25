# TODO: Penyelarasan Kontrak API — Envelope, Paginasi, Role

## Gambaran Fitur
Backend memakai envelope sendiri (`{status:false,message,code}` untuk error, objek datar untuk sukses), paginasi `{data,page,limit,total}`, dan role `ADMIN`/`MANAGER`. Checklist menuntut `{data, meta}`, `{error:{code,message,details}}`, paginasi `{page,page_size,total,pages}`, dan role `viewer`/`admin` dengan 401/403 konsisten. Task ini menutup F-01.2 dan F-01.3.

## Daftar Pekerjaan

### 1. Envelope respons (`src/plugins/envelope.plugin.ts`)
- [ ] Buat plugin `envelope` dan pasang **setelah** `routes` di `src/index.ts`.
- [ ] `onAfterHandle` (`as: 'global'`) membungkus payload JSON menjadi `{data: <payload>, meta: {requestId, cached?: boolean}}`.
- [ ] Plugin **melewati** (tidak membungkus) bila salah satu benar:
  - path diawali `/api/wa/cloud/webhook` atau `/api/wa/webhook` (Meta/OpenWA mengharapkan `{status:true}`),
  - path diawali `/api/health`,
  - nilai `response` adalah instance `Response` (CSV, teks `hub.challenge`),
  - respons sudah punya kunci `data` **dan** `meta` (idempoten).
- [ ] Ubah `onError` di `src/index.ts` agar mengembalikan:
  ```ts
  {error: {code: string, message: string, details: {path: string; message: string}[] | null}}
  ```
  - `code` dari `AppError.code`; bila kosong, turunkan dari status: `VALIDATION_ERROR`, `PARSE_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INTERNAL_ERROR`.
  - `details` diisi `error.all.map(...)` hanya untuk `code === "VALIDATION"`, selain itu `null`.
  - Status HTTP tetap seperti sekarang (400/401/403/404/409/500).

### 2. Paginasi seragam
- [ ] Tambah `src/shared/pagination.ts`:
  ```ts
  export interface PageMeta {page: number; page_size: number; total: number; pages: number}
  export function pageMeta(page: number, pageSize: number, total: number): PageMeta
  export function resolvePage(page: unknown, pageSize: unknown, total: number): {page: number; pageSize: number; pages: number}
  ```
  `resolvePage` meng-clamp `page` ke `[1, pages]` dan memvalidasi `page_size ∈ {5,10,15,20,50,100}` → `BadRequestError("page_size tidak valid", "INVALID_PAGE_SIZE")`.
- [ ] Terapkan pada `GET /api/leads` (`src/modules/audience/service.ts`), `GET /api/alerts`, dan `GET /api/reports/exports`: payload menjadi `{items: T[], meta: PageMeta}` di dalam `data`.
- [ ] Pertahankan `data`, `page`, `limit`, `total` lama sebagai field tambahan selama satu rilis agar konsumen lama tidak rusak.

### 3. Role `viewer` / `admin` (F-01.2)
- [ ] Migrasi enum: `ALTER TYPE role ADD VALUE IF NOT EXISTS 'VIEWER';` lalu `UPDATE users SET role = 'ADMIN' WHERE role = 'MANAGER';` dan hapus `MANAGER` dari `userRoleEnum` (`src/infra/database/schema/enums.ts`).
- [ ] Tambah `src/shared/guards.ts`:
  ```ts
  export const requireAdmin = new Elysia({name: "require-admin"}).derive(...)
  ```
  → `throw new ForbiddenError("Butuh role ADMIN", "FORBIDDEN")` bila `user.role !== "ADMIN"`.
- [ ] Pasang `requireAdmin` pada: `POST /meta/oauth/*`, `DELETE /meta/connection`, `POST /meta/accounts/select`, seluruh `POST /meta/sync/*` dan `/meta/queue/*`, `POST`/`PUT`/`DELETE /wa/session*`, `POST /users`, `GET /metrics`, `GET /meta/queue/dlq`, `DELETE /leads/{id}`, `POST /reports/recorded-orders`.
- [ ] `VIEWER` tetap boleh: seluruh `GET` analytics/leads/alerts/tracking/settings/sources, `PATCH /leads/{id}`, `PATCH /alerts/{id}/resolve|snooze`, `PATCH /insights/{key}/review`.
- [ ] `POST /api/auth/register` membuat user pertama tenant sebagai `ADMIN`; user berikutnya default `VIEWER` (bukan `ADMIN` seperti sekarang).
- [ ] Tambah 403 konsisten: setiap penolakan role mengembalikan `{error:{code:"FORBIDDEN"}}` dengan status `403`.

## File yang Disentuh
- `src/plugins/envelope.plugin.ts` (baru), `src/index.ts`
- `src/shared/{pagination,guards}.ts` (baru)
- `src/infra/database/schema/enums.ts`, `src/infra/database/schema/core/user.entity.ts`, migrasi
- `src/modules/audience/{index,service}.ts`, `src/modules/alerts/{index,service}.ts`
- `src/modules/meta/index.ts`, `src/modules/wa/session/index.ts`, `src/modules/user/index.ts`
- Seluruh test integrasi (assertion envelope)

## Uji Selesai
- `GET /api/analytics/summary?...` → `{data:{...}, meta:{requestId}}`; `data.cards.spend.value` tetap terbaca.
- Request dengan query tidak valid → `400` dan body `{error:{code:"VALIDATION_ERROR", message, details:[{path,message}]}}`.
- `GET /api/leads?accountId=…&page_size=10` → `data.meta.pages === ceil(total/10)`; `page_size=7` → `400` `code: "INVALID_PAGE_SIZE"`.
- `GET /api/wa/cloud/webhook?hub.mode=subscribe…` → tetap mengembalikan `hub.challenge` sebagai teks polos, **tidak** dibungkus.
- `GET /api/reports/campaigns.csv?...` → tetap CSV mentah, `content-type: text/csv`.
- User `VIEWER` memanggil `POST /api/meta/sync/master` → `403` `code: "FORBIDDEN"`; memanggil `PATCH /api/alerts/1/resolve` → `200`.
- User `ADMIN` memanggil keduanya → `200`.
- Registrasi kedua di tenant yang sama menghasilkan `role === "VIEWER"`.
