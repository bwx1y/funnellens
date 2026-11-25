# Selesai: Detail Lead, Kontrak Daftar Lead, Pipeline Lane, dan Global Search

Dokumentasi implementasi penutup F-13.1–F-13.3 dan F-19.1–F-19.2.

## Ringkasan Fitur

- **Kontrak `GET /api/leads` (F-13.1)**: `pageSize ∈ {5, 10, 15}` (default 10) dengan 422 `code: "INVALID_PAGE_SIZE"` untuk nilai lain, `limit` dipertahankan sebagai alias deprecated, `dir` (`asc`/`desc`, default `desc`), dan `sortBy` baru (`name`, `response`, `temperature`, `analysis`, `campaign` di samping `createdAt`/`firstSeenAt`). Semua kolom sort memakai `nulls last`; `temperature` mengikuti urutan enum COLD < WARM < HOT, `analysis` memakai `max(lead_assessments.event_at)` untuk baris `applied`, `campaign` memakai nama campaign. Respons menjadi `{data, page, pageSize, total, pages, counts}`, `page` di-clamp ke halaman terakhir, dan `counts` dihitung dari scope periode + campaign (bukan dari `search`/`temperature`/`page`), dengan `counts.total = cold + warm + hot`.
- **`GET /api/leads/{id}` (F-13.2)**: detail lead berisi nama campaign/ad/creative, atribusi (`sourcePlatform`, `attributionNote`, confidence assessment terakhir), metrik (waiting minutes, first reply seconds, jumlah pesan masuk/keluar, days in pipeline), `movement` gabungan `lead_assessments` + `lead_milestones` terurut naik, `trail` 50 pesan terakhir terurut naik dengan `isQuote` untuk pesan masuk ber-`context_wamid`, dan `explanation` (`context: "lead_detail"`). Lead milik tenant lain → 404.
- **Pipeline lane (F-13.3)**: `GET /api/analytics/audience/pipeline` menerima `q` (case-insensitive pada `name`, `phoneMasked`, `reason`) dan mengembalikan `lanes[]` (`level`, `count`, `rows`) dengan `count` dari scope periode dan `rows` terurut `firstSeenAt` menurun. Lane tanpa hasil `q` dihilangkan; `rows` datar tetap ada sebagai kontrak deprecated satu rilis.
- **Global search (F-19.1, F-19.2)**: modul baru `src/modules/search` dengan `GET /api/search?q=&accountId=`. `pages` dari registry statis 8 rute `/app/*` (skor label > keyword, prefix > substring), `leads` dibatasi 8 dan hanya untuk account milik tenant (`requireAccountScope`), `meta.truncated` menandai kategori yang menyentuh batas. `q` < 2 karakter mengembalikan 8 halaman pertama tanpa menyentuh tabel lead.
- **Index pencarian**: migrasi `0018_daily_avengers.sql` mengaktifkan `pg_trgm` dan membuat `idx_leads_name_trgm` (GIN, `name gin_trgm_ops`) yang dideklarasikan di `LeadEntity`.

## Perubahan File

- `src/shared/errors.ts`: `UnprocessableEntityError` (422).
- `src/infra/database/repositories/lead.repository.ts`: `LeadSortBy`, `LeadPage`, `SORT_EXPRESSIONS`, `getLeadList` (clamp + nulls-last + subquery sort), `getDetailExtras`, `countByTemperature(..., campaignId)`.
- `src/infra/database/repositories/lead-assessment.repository.ts`: `getMovement` (assessments ∪ milestones, naik).
- `src/infra/database/repositories/conversation-message.repository.ts`: `findLatest`, `getLatestTopics`.
- `src/modules/audience/service.ts`: `LEAD_PAGE_SIZES`, `resolveLeadPageSize`, `listLeads` baru, `getLeadDetail`, `getPipeline` ber-lane, tipe respons terkait.
- `src/modules/audience/schema.ts`, `src/modules/audience/index.ts`: `pageSize`/`dir`/`sortBy`/`campaignId`/periode pada `leadList`, `q` pada `pipeline`, route `GET /leads/:id`, validasi page size di handler.
- `src/modules/search/{service,schema,index}.ts`: registry halaman, ranking, pencarian lead, controller.
- `src/routes.ts`: registrasi `SearchController`.
- `src/infra/database/schema/wa/lead.entity.ts`: index `idx_leads_name_trgm`.
- `src/infra/database/migration/0018_daily_avengers.sql` (+ snapshot/journal): `pg_trgm` + index trigram.
- `tests/integration/analytics-audience.test.ts`: paginasi/clamp/`counts`/alias `limit`, sort temperature nulls-last, 422 page size, lane pipeline dengan `q`, route list + pipeline.
- `tests/integration/lead-detail-search.test.ts` (baru): detail lead (movement, trail, atribusi, metrik, explanation), batas 50 pesan, 404 lintas tenant, registry halaman, cap 8 + `truncated`, topik lead, route search.

## Hasil Pengujian

- `bun test` penuh: **292 test di 40 file lulus** tanpa regresi.
- `bunx tsc --noEmit` bersih.
- Migrasi `0018` diterapkan ke database dev: `idx_leads_name_trgm` ada dan dipakai (`Bitmap Index Scan` pada `name ilike '%…%'` saat seq scan dimatikan).
- Kunci perilaku: `pageSize=5&page=9` → `page: 2`; `pageSize=7` → 422 `INVALID_PAGE_SIZE`; `counts` tetap 7 meski `search` menyempit ke 1 baris; `sortBy=temperature&dir=asc` menaruh COLD lebih dulu dan lead tanpa level di akhir; `q=lead 1` hanya menyisakan lane HOT dengan `count` utuh; `GET /api/search?q=` → `leads: []`; `q=rani` → 8 lead, `truncated: true`, tanpa lead akun tenant lain.
