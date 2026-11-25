# Selesai: Status Review Insight per User (`read`/`done`/`active`)

Dokumentasi implementasi fitur F-18.3 dan F-18.4.

## Ringkasan Fitur

- **Tabel review per user**: Tabel `insight_reviews` (`id bigserial pk`, `tenant_id uuid not null`, `user_id uuid not null`, `alert_id bigint not null`, `status text not null check (status in ('read','done','active')) default 'active'`, `reason text`, `updated_at timestamptz not null default now()`, unik `(user_id, alert_id)`) dan `insight_review_history` (`id`, `insight_review_id`, `from_status`, `to_status`, `reason`, `changed_by uuid`, `changed_at timestamptz default now()`).
- **Key stabil lintas request**: `insightKey(alert)` (`${ruleKey}:${entityId}`) di `@shared/alerts` dan diekspos sebagai `key` pada `AlertRow`.
- **Endpoint tab & unread count**:
  - `GET /api/insights?tab=active|done` (`accountId` wajib):
    - `active` memuat alert `ACTIVE`/`SNOOZED` dengan status review user bukan `done`.
    - `done` memuat review user `done` atau alert sistem `DONE` yang belum direview.
  - `GET /api/insights/unread-count`: Menghitung alert tab `active` yang `review.status !== 'read'` dan `!== 'done'`.
  - `PATCH /api/insights/:key/review`: Mengubah status review menjadi `read`, `done`, atau `active` beserta riwayat transisi.
- **Idempotensi & audit**:
  - `PATCH /api/insights/:key/review` mewajibkan header `Idempotency-Key` (400 `IDEMPOTENCY_KEY_REQUIRED` bila kosong).
  - Panggilan idempoten mengembalikan respons tersimpan tanpa menambah baris `insight_review_history`.
  - `GET /api/insights/:key/history`: Menampilkan riwayat transisi review untuk user yang sedang aktif.
- **Pemisahan status sistem vs review**:
  - Review user tidak mengubah kolom status di `insight_alerts`.
  - `GET /api/alerts` lama tetap dipertahankan dan menyertakan field `review`.

## Hasil Pengujian

- `bun test tests/integration/insight-review.test.ts`: 9 test lulus.
- Verifikasi isolasi antar user: User A menandai selesai tidak mempengaruhi tab user B.
- Verifikasi idempotensi dan audit history.
