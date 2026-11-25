# TODO: `GET /api/settings` — Objek Workspace & Status Sumber

## Gambaran Fitur
Tidak ada endpoint settings. Data workspace tersebar di `/profile`, `/meta/connection`, dan `/wa/session`, sehingga klien harus menggabungkan tiga panggilan untuk mengetahui mode read-only dan kesehatan sumber. Task ini menutup F-20.2.

## Daftar Pekerjaan

### 1. Endpoint
- [ ] Buat `src/modules/settings/{index.ts,service.ts}` dan daftarkan `SettingsController` di `src/routes.ts` dengan prefix `/settings`, `JwtUtil.isAuthenticated`.
- [ ] `GET /api/settings` (tanpa query) mengembalikan:
  ```ts
  {
    workspace: {id, name, address, timezone, currency, currencyOffset},
    mode: {readOnly: true, reason: "analytics-only"},
    sources: [{
      key: "meta" | "whatsapp",
      label: string,
      status: "connected" | "disconnected" | "expired" | "out_of_scope",
      lastSyncAt: string | null,
      lastError: string | null,
      detailRoute: string
    }],
    limits: {maxComparisonCreatives: 5, maxSearchResults: 8, defaultPageSize: 10, periodDays: [7, 14, 30]},
    exportAuditEnabled: boolean
  }
  ```
- [ ] `workspace` dari tenant user (`user.tenantId`) + akun terpilih (`adAccountRepository.findSelectedByTenantId`); `timezone`/`currency`/`currencyOffset` dari akun, `null` bila belum ada akun.
- [ ] `mode.readOnly` selalu `true` — backend ini memang analytics-only (lihat §0 checklist). `reason` menjelaskan kenapa.
- [ ] `sources` dirakit `SettingsService` dari tiga repository yang sudah ada:
  - `meta` → `MetaConnectionRepository.findByTenantId`; `status = "expired"` bila `expiresAt <= now`, `"disconnected"` bila tidak ada koneksi.
  - `whatsapp` → `WaSessionRepository.findAllByTenantId`; `status = "connected"` bila ada sesi berstatus `ready`, `"disconnected"` bila tidak ada, `"out_of_scope"` bila tenant hanya punya akun `web`.
  - `lastSyncAt` dari `SyncRunRepository` (baris `finished_at` terbaru berstatus sukses), `lastError` dari baris `error` terbaru.
- [ ] `limits` memakai konstanta yang sudah ada: `MIN_COMPARATORS`/`maxComparisonCreatives = 5` (`src/shared/creative.ts`), `MAX_SEARCH_RESULTS = 8` (modul search), `DEFAULT_PAGE_SIZE = 10`, `PERIOD_DAYS` (`src/shared/period.ts`).
- [ ] `exportAuditEnabled` = `true` setelah task `21-report-export.md` selesai; sebelum itu `false`.

### 2. Schema
- [ ] Buat `src/modules/settings/schema.ts` dengan `SettingsSchema = {}` (tanpa query) agar konsisten dengan modul lain yang memakai `UnwrapSchema`.

## File yang Disentuh
- `src/modules/settings/{index,service,schema}.ts` (baru)
- `src/routes.ts`
- `src/infra/database/repositories/{meta-connection,sync-run,wa-session}.repository.ts` (pakai ulang, jangan duplikasi query)

## Uji Selesai
- Tenant dengan koneksi Meta aktif + sesi WA `ready` → `sources` berisi `meta.status === "connected"` dan `whatsapp.status === "connected"`, keduanya punya `lastSyncAt`.
- Tenant tanpa koneksi → `meta.status === "disconnected"`, `lastError === null`, tidak ada `500`.
- `mode.readOnly === true` dan `workspace.id === user.tenantId`.
- `limits.periodDays` = `[7, 14, 30]`; `limits.maxComparisonCreatives === 5`.
- Tenant tanpa akun terpilih → `workspace.timezone === null` (bukan `"Asia/Jakarta"` tebakan), endpoint tetap `200`.
