# DONE: Ad Account Management

## Status: Selesai ✅
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/infra/database/schema/ads/ad-account.entity.ts`
  - `src/infra/database/repositories/ad-account.repository.ts`
  - `src/modules/meta/service.ts`
  - `src/modules/meta/index.ts`
  - `src/modules/meta/schema.ts`
  - `tests/unit/ad-account.test.ts`

## Rincian Implementasi
1. **Schema & Kolom**:
   - Menambahkan kolom `is_selected: boolean("is_selected").notNull().default(false)` pada tabel `ad_accounts`.
2. **Repository**:
   - `AdAccountRepository` mengimplementasikan method `findByTenantId`, `findById`, `findSelectedByTenantId`, `upsert`, `upsertBatch`, dan transaksi atomic `selectAccount`.
3. **Service & Endpoints**:
   - `GET /api/meta/accounts`: Mengambil daftar akun dari Meta Graph API (`/me/adaccounts`), normalisasi ID dengan format `act_<id>`, melakukan batch upsert ke PostgreSQL, dan mengembalikan seluruh akun untuk tenant tersebut.
   - `GET /api/meta/accounts/selected`: Mengembalikan akun iklan yang sedang aktif/dipilih.
   - `POST /api/meta/accounts/select`: Memilih akun aktif untuk tenant dengan validasi kepemilikan akun.
4. **Testing**:
   - 5 unit test mencakup kasus tanpa koneksi token, token expired, normalisasi ID, dan pemilihan akun aktif.
