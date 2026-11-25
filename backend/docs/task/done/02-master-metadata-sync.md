# DONE: Master Metadata Sync (`fetchAll`)

## Status: Selesai ✅
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/infra/database/repositories/campaign.repository.ts`
  - `src/infra/database/repositories/ad-set.repository.ts`
  - `src/infra/database/repositories/ad-creative.repository.ts`
  - `src/infra/database/repositories/ad.repository.ts`
  - `src/infra/database/repositories/sync-run.repository.ts`
  - `src/modules/meta/service.ts`
  - `src/modules/meta/index.ts`
  - `src/modules/meta/schema.ts`
  - `tests/unit/meta-sync-master.test.ts`

## Rincian Implementasi
1. **Helper Paginasi Cursor Graph API (`fetchAll`)**:
   - Menelusuri seluruh data pada edge Graph API secara rekursif/iteratif melalui parameter cursor `paging.next` dengan ukuran batch `limit: 500`.
2. **Repositories Layer**:
   - `CampaignRepository`: Batch upsert dengan `onConflictDoUpdate` pada primary key `id`.
   - `AdSetRepository`: Batch upsert dengan `onConflictDoUpdate` pada primary key `id`.
   - `AdCreativeRepository`: Batch upsert dengan `onConflictDoUpdate` pada primary key `id`.
   - `AdRepository`: Batch upsert dengan `onConflictDoUpdate` pada primary key `id`.
   - `SyncRunRepository`: Mencatat histori proses sinkronisasi (`RUNNING`, `SUCCESS`, `FAILED`) dan jumlah baris ter-upsert (`rows_upserted`).
3. **Master Sync Service (`syncMaster`)**:
   - `resolveTargetAccountId`: Otomatis mengambil akun aktif (`is_selected = true`) dari database jika body kosong `{}`. Jika belum ada akun yang ditandai terpilih, otomatis memilih akun pertama yang tersedia di database untuk tenant tersebut.
   - Menarik data hierarki periklanan dari Graph API:
     - `/{act_id}/campaigns` beserta budget minor & raw payload.
     - `/{act_id}/adsets` beserta strategi bid & targeting.
     - `/{act_id}/adcreatives` beserta teks materi, thumbnail, dan durasi video dari Graph API Video jika `video_id` ada.
     - `/{act_id}/ads` beserta relasi `adset_id`, `campaign_id`, dan validasi FK `creative_id`.
   - Melakukan batch upsert berurutan sesuai foreign key: `campaigns` ➔ `ad_sets` ➔ `ad_creatives` ➔ `ads`.
4. **Endpoint**:
   - `POST /api/meta/sync/master`: Menjalankan sinkronisasi master metadata untuk akun iklan terpilih.
5. **Testing**:
   - 3 unit test mencakup pengujian traversal paginasi cursor, penanganan validasi akun kosong, mapping konversi unit minor budget, ekstraksi video, dan pencatatan status `sync_runs`.
