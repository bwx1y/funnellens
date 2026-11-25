# TODO: Status Review Insight per User (`read`/`done`/`active`)

## Gambaran Fitur
Alert sudah punya `ACTIVE`/`DONE`/`SNOOZED` plus `resolve`/`snooze`, tetapi checklist menuntut status review **per user** dengan tiga nilai `read`/`done`/`active`, endpoint `tab=active|done`, `unread-count`, audit, dan idempotency. Saat ini status alert bersifat global per akun, sehingga satu user menandai selesai menghilangkan item untuk semua user. Task ini menutup F-18.3 dan F-18.4.

## Daftar Pekerjaan

### 1. Tabel review per user
- [ ] Tambah tabel `insight_reviews` (`src/infra/database/schema/ads/insight-review.entity.ts`):
  `id bigserial pk`, `tenant_id uuid not null`, `user_id uuid not null references users(id) on delete cascade`, `alert_id bigint not null references insight_alerts(id) on delete cascade`, `status text not null check (status in ('read','done','active')) default 'active'`, `reason text`, `updated_at timestamptz not null default now()`, unik `(user_id, alert_id)`.
- [ ] Tambah tabel `insight_review_history` (`id`, `insight_review_id` → cascade, `from_status`, `to_status`, `reason`, `changed_by uuid`, `changed_at timestamptz default now()`).
- [ ] Generate migrasi lewat `bun run db:generate`.

### 2. Key stabil
- [ ] Tambah `export function insightKey(alert: {ruleKey: string; entityId: string}): string` di `src/shared/alerts.ts` → `` `${ruleKey}:${entityId}` ``.
- [ ] Tambah `key: string` pada `AlertRow` (`src/modules/alerts/service.ts`), diisi `insightKey(alert)`; key wajib stabil lintas request dan tidak mengandung id auto-increment.

### 3. Endpoint tab + unread
- [ ] Buat `InsightController` (`src/modules/insights/index.ts`, prefix `/insights`) atau perluas `AlertsController`; pilih **satu** dan hapus yang lain agar tidak ada dua jalur.
- [ ] `GET /api/insights?tab=active|done` (`accountId` wajib):
  - `active` = alert `ACTIVE`/`SNOOZED` **dan** review user bukan `done`.
  - `done` = review user `done`, atau alert `DONE` yang belum pernah direview user (tetap tampil supaya riwayat tidak hilang).
  - Respons: `{tab, items: AlertRow[] & {review: {status, reason, updatedAt}}, explanation}`.
- [ ] `GET /api/insights/unread-count` → `{count: number}` = jumlah alert di tab `active` yang `review.status !== 'read'` **dan** `!== 'done'`.
- [ ] `PATCH /api/insights/{key}/review` body `{status: "read"|"done"|"active", reason?: string}`:
  - `key` di-resolve ke `alert_id` dengan mencocokkan `insightKey`; tidak ketemu → `404`.
  - `read` → badge hilang, item **tetap** di tab `active`.
  - `done` → item pindah ke tab `done`.
  - `active` → mengembalikan item ke tab `active` dengan badge aktif.
  - Upsert `insight_reviews` + tulis satu baris `insight_review_history`.
  - Respons: `{key, status, updatedAt, unreadCount}`.

### 4. Idempotency + audit
- [ ] Wajib header `Idempotency-Key` untuk `PATCH /insights/{key}/review` (plugin dari `23-ops-production.md`); tanpa header → `400` `code: "IDEMPOTENCY_KEY_REQUIRED"`.
- [ ] Permintaan ulang dengan key sama dan body sama → respons tersimpan, **tidak** ada baris `insight_review_history` baru.
- [ ] `GET /api/insights/{key}/history` → riwayat review user yang sedang login (maks 50), `{fromStatus, toStatus, reason, changedAt}`.

### 5. Hubungan dengan status sistem
- [ ] Status sistem (`ACTIVE`/`DONE`/`SNOOZED` di `insight_alerts`) **tidak** berubah karena review user. `resolveByRuleKey` tetap satu-satunya yang menandai `DONE` secara otomatis.
- [ ] `GET /api/alerts` (lama) tetap ada; tambahkan `review` pada setiap baris agar konsumen lama tidak kehilangan konteks.

## File yang Disentuh
- `src/infra/database/schema/ads/insight-review.entity.ts` (baru), `schema/index.ts`, migrasi
- `src/infra/database/repositories/insight-review.repository.ts` (baru)
- `src/shared/alerts.ts` (`insightKey`)
- `src/modules/insights/{index,service,schema}.ts` (baru) atau `src/modules/alerts/*`
- `src/routes.ts`, `src/modules/alerts/service.ts`

## Uji Selesai
- Dua user pada tenant sama: user A menandai `done` → item hilang dari tab `active` user A, **tetap** ada di tab `active` user B.
- `PATCH` dengan `status: "read"` → `unread-count` turun 1, tetapi `GET /insights?tab=active` masih memuat item itu.
- `PATCH` dengan `status: "done"` → item pindah ke `tab=done`, `unread-count` turun.
- `PATCH` dengan `status: "active"` setelah `done` → item kembali ke tab `active`.
- Dua `PATCH` dengan `Idempotency-Key` sama → `insight_review_history` hanya bertambah 1 baris.
- `PATCH` tanpa `Idempotency-Key` → `400` `code: "IDEMPOTENCY_KEY_REQUIRED"`.
- `key` pada dua filter berbeda menghasilkan nilai berbeda; memanggil dua kali untuk alert yang sama menghasilkan `key` identik.
- Alert yang di-resolve otomatis (`resolveByRuleKey`) muncul di tab `done` meski belum pernah direview.
