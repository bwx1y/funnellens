# TODO: Detail Lead, Kontrak Daftar Lead, Pipeline Lane, dan Global Search

## Gambaran Fitur
`GET /leads` ada tetapi kontraknya berbeda dari checklist (tanpa `page_size` 5/10/15, tanpa `dir`, tanpa count per level). Detail lead per id belum ada sama sekali, pipeline belum berkelompok lane, dan `GET /search` belum ada. Task ini menutup F-13.1–F-13.3 dan F-19.1–F-19.2.

## Daftar Pekerjaan

### 1. Kontrak `GET /leads` (F-13.1)
- [ ] Ganti `limit` menjadi `pageSize` dengan nilai hanya `5 | 10 | 15` (`t.Union([t.Literal("5"), t.Literal("10"), t.Literal("15")])`, default `"10"`). Nilai lain → HTTP **422** `code: "INVALID_PAGE_SIZE"`. Petakan di handler `LeadController` sebelum memanggil service.
- [ ] Pertahankan `limit` sebagai alias yang dipetakan ke `pageSize` hanya bila `pageSize` tidak dikirim (jangan hapus kontrak lama di rilis yang sama).
- [ ] Tambah `dir: "asc" | "desc"` (default `desc`).
- [ ] Tambah `sortBy` baru: `name | response | temperature | analysis | campaign` selain `createdAt | firstSeenAt`. Pemetaan kolom:
  - `name` → `leads.name`, `response` → `leads.first_replied_at`, `temperature` → urutan enum `COLD < WARM < HOT`, `analysis` → `lead_assessments.event_at` terbaru, `campaign` → `campaigns.name`.
  - Nilai `null` selalu di akhir, apa pun `dir`-nya (`nulls last`).
- [ ] Tambah `counts: {cold: number; warm: number; hot: number; total: number}` pada `LeadListResponse`, dihitung dari **scope periode + campaign**, bukan dari hasil pencarian. Artinya query count terpisah tanpa filter `search`/`temperature`/`page`.
- [ ] Respons paginasi menjadi `{data, page, pageSize, total, pages, counts}`; `page` di-clamp ke `pages` (bukan `400`) dan `pages = max(1, ceil(total / pageSize))`.

### 2. `GET /leads/{id}` (F-13.2)
- [ ] Tambah route `GET /api/leads/:id` pada `LeadController` (`src/modules/audience/index.ts`) dengan `AudienceSchema.leadParams` yang sudah ada.
- [ ] Tambah `getLeadDetail(tenantId, leadId)` di `AudienceService`:
  ```ts
  {
    id, name, phoneMasked, emailMasked, campaignName, adName, creativeName,
    temperature, stage, sentiment, dealValueMinor, currency,
    attribution: {method: string | null, note: string | null, confidence: string | null},
    metrics: {waitingMinutes: number | null, firstReplySeconds: number | null,
              messagesInbound: number, messagesOutbound: number, daysInPipeline: number | null},
    movement: [{level: "COLD"|"WARM"|"HOT", at: string, reason: string | null,
                confidence: string, applied: boolean}],
    trail: [{at: string, direction: "INBOUND"|"OUTBOUND", body: string | null,
             responseType: string | null, gapSeconds: number | null, isQuote: boolean}],
    explanation: ExplanationRef | null
  }
  ```
  - `movement` dari `lead_assessments` + `lead_milestones` terurut `at` ascending.
  - `trail` dari `conversation_messages` terurut `sent_at` ascending, maksimal 50 pesan terakhir; `isQuote` = `true` untuk pesan `INBOUND` yang `context_wamid` terisi.
  - Lead milik tenant lain → `NotFoundError` (bukan `403`), konsisten dengan `getByIdForTenant`.
- [ ] Tambah `context: "lead_detail"` ke `ExplanationContext` bila belum ada, dan panggil `ExplanationService.ensure` dengan fakta level/temperature/jeda balas.

### 3. Pipeline lane (F-13.3)
- [ ] Ubah `GET /analytics/audience/pipeline` agar menerima `q` (case-insensitive pada `name`, `phone_masked`, `reason`) dan mengembalikan:
  ```ts
  {period, lanes: [{level: "COLD"|"WARM"|"HOT", count: number,
                    rows: PipelineRow[]}], sample, note?}
  ```
  - `rows` per lane terurut `firstSeenAt` descending.
  - `count` per lane dihitung dari scope periode, bukan hasil `q`.
  - Pertahankan `rows` datar di level atas selama satu rilis (deprecated), agar konsumen lama tidak rusak.

### 4. Global search (F-19.1, F-19.2)
- [ ] Buat `src/modules/search/{index.ts,service.ts,schema.ts}` dan daftarkan `SearchController` di `src/routes.ts`.
- [ ] `GET /api/search?q=` dengan `q` minimal 2 karakter:
  ```ts
  {pages: [{label, route, keywords: string[]}], leads: [{id, alias, topic, phoneMasked}], meta: {q, truncated: boolean}}
  ```
- [ ] `pages` dari registry statis di `src/modules/search/service.ts` — daftar rute aplikasi (`/app/overview`, `/app/funnel`, `/app/audience`, `/app/campaigns`, `/app/creative`, `/app/insights`, `/app/tracking`, `/app/integrations`) dengan `keywords` id-ID. Maksimum **8** hasil, urut skor kecocokan label dulu.
- [ ] `leads` dari `leadRepo.getLeadList` dengan `search: q`, dibatasi **8**, hanya untuk `accountId` yang lolos `requireAccountScope` (tidak ada kebocoran lintas akun).
- [ ] `q` kosong atau < 2 karakter → `{pages: <8 halaman pertama>, leads: [], meta: {q, truncated: false}}`; **tidak** memanggil query lead.
- [ ] `truncated: true` bila salah satu kategori mencapai batas 8.
- [ ] Tambah index pencarian: `create index idx_leads_name_trgm on leads using gin (name gin_trgm_ops)` lewat migrasi Drizzle, dan aktifkan `pg_trgm` (`create extension if not exists pg_trgm`).

## File yang Disentuh
- `src/modules/audience/schema.ts`, `src/modules/audience/service.ts`, `src/modules/audience/index.ts`
- `src/infra/database/repositories/lead.repository.ts`
- `src/modules/search/{index,service,schema}.ts` (baru), `src/routes.ts`
- `src/infra/database/migration/` (migrasi `pg_trgm` + index)
- `src/modules/explanations/contexts.ts` (`lead_detail`)

## Uji Selesai
- `GET /api/leads?accountId=…&pageSize=15` → `pages` benar, `page` melebihi `pages` di-clamp ke halaman terakhir.
- `GET /api/leads?accountId=…&pageSize=7` → HTTP 422 `code: "INVALID_PAGE_SIZE"`.
- `counts.cold + counts.warm + counts.hot === counts.total`; mengirim `search` tidak mengubah `counts`.
- `sortBy=temperature&dir=asc` → `COLD` lebih dulu, lead `temperature = null` di akhir.
- `GET /api/leads/{id}` lead milik tenant lain → 404; lead valid → `movement.length >= 1` dan `trail` terurut naik.
- `GET /api/analytics/audience/pipeline?q=rani` → hanya lane berisi hasil; `lanes[].count` tidak berubah oleh `q`.
- `GET /api/search?q=` → `leads.length === 0`; `GET /api/search?q=ra` → `pages.length <= 8` dan `leads.length <= 8`; hasil tidak memuat lead dari `accountId` lain.
