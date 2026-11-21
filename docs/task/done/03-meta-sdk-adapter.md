# DONE: Meta SDK Adapter Layer

## Status
- Selesai & Terverifikasi (21 unit tests passing, TypeScript 0 error).

## Implementasi
1. **Types & Interfaces (`src/infra/meta/`)**:
   - `types.ts`: DTO ketat tanpa `any` untuk `MetaAdAccountDto`, `MetaCampaignDto`, `MetaAdSetDto`, `MetaAdCreativeDto`, `MetaAdDto`, `MetaVideoDto`.
   - `base.meta.ts`: Interface contract `IMetaAdsAdapter`.

2. **Facebook SDK Adapter (`src/infra/meta/adapters/facebook-sdk.adapter.ts`)**:
   - Memanfaatkan `facebook-nodejs-business-sdk` (`FacebookAdsApi.init`, `User('me')`, `AdAccount(id)`, `AdVideo(id)`).
   - Helper pagination cursor SDK `fetchAllSdk` (`hasNext()`, `next()`, `limit: 500`).
   - Graceful fallback jika permission `business_management` ditolak Meta pada pemanggilan ad accounts.
   - Pengecekan detail video durasi (`length`) dan `permalink_url` melalui `AdVideo.read()`.

3. **Injeksi ke `MetaService` (`src/modules/meta/service.ts`)**:
   - Injeksi `metaAdapter: IMetaAdsAdapter = new FacebookSdkAdapter()` pada konstruktor.
   - Pemanggilan `listAccounts` dan `syncMaster` didelegasikan ke `metaAdapter`.
   - Mendukung custom mock requester untuk pengujian unit testing.

4. **Testing**:
   - `tests/unit/facebook-sdk-adapter.test.ts`: verifikasi instansiasi dan error handling adapter.
   - `tests/unit/meta-sync-master.test.ts`: verifikasi eksekusi `syncMaster` melalui interface `IMetaAdsAdapter`.
