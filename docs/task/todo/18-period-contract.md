# TODO: Kontrak Periode (7/14/30 hari, label id-ID, is_partial, arah)

## Gambaran Fitur
`resolvePeriod` (`src/shared/period.ts`) menerima `since`/`until` bebas dan menghitung previous. Checklist menuntut parameter `days ∈ {7,14,30}`, snapshot end tetap `19 Nov 2026`, label periode berbahasa id-ID, penanda hari parsial, dan arah delta eksplisit. Keempatnya belum ada. Task ini menutup F-07.1 (`days`), F-07.2 (`is_partial`), F-07.3 (label id-ID), dan F-07.4 (arah delta).

## Daftar Pekerjaan

### 1. `days` + snapshot end (`src/shared/period.ts`)
- [ ] Tambah `export const PERIOD_DAYS = [7, 14, 30] as const;` dan `export type PeriodDays = typeof PERIOD_DAYS[number];`.
- [ ] Tambah `export const DEFAULT_SNAPSHOT_END = "2026-11-19";` (snapshot prototipe).
- [ ] Ubah `resolvePeriod(account, query)` menerima `{since?, until?, days?}`:
  - `days` terisi → `until = query.until ?? DEFAULT_SNAPSHOT_END`, `since = addDays(until, -(days - 1))`.
  - `days` kosong → perilaku sekarang (default 30 hari mundur dari `todayInZone`).
  - `days` di luar `PERIOD_DAYS` → `throw new BadRequestError("days harus 7, 14, atau 30", "INVALID_DAYS")`.
  - `since`/`until` dan `days` dikirim bersamaan → `days` menang; `since`/`until` diabaikan.
- [ ] Tambah `snapshotEnd: string` pada `ResolvedPeriod` (nilai `until`), supaya narasi bisa menyebut tanggal snapshot.

### 2. Label id-ID + is_partial
- [ ] Tambah `export function periodLabel(since: string, until: string): string` di `src/shared/period.ts` → `"13–19 Nov 2026"` bila bulan/tahun sama, `"27 Okt – 25 Nov 2026"` bila beda bulan, `"28 Des 2026 – 3 Jan 2027"` bila beda tahun. Format hari tanpa leading zero, bulan singkat `Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des`.
- [ ] Tambah `export function isPartialDay(until: string, timezoneName: string, now: Date = new Date()): boolean` → `true` bila `until === todayInZone(timezoneName)` (hari berjalan belum tutup).
- [ ] Tambah blok ke setiap response periode di `analytics/service.ts` (`getSummary`, `getFunnel`, `getStageDetail`), `audience/service.ts`, dan `creative/service.ts`:
  ```ts
  period: {since, until, days, label, isPartial}
  previousPeriod: {since, until, label}
  ```
  Jangan hapus field lama; ini penambahan.

### 3. Arah delta
- [ ] Tambah `export type DeltaDirection = "up" | "down" | "neutral";` dan `export function direction(value: number | null): DeltaDirection | null` di `src/shared/numbers.ts` → `null` bila input `null`, `"neutral"` bila `0`.
- [ ] Tambah `direction: DeltaDirection | null` di samping setiap `deltaPct` pada `KpiCard` (`analytics/service.ts`) dan di samping setiap `deltaPp`/`changePct` pada `FunnelPair` dan `StageComparisonRow`.

### 4. Schema endpoint
- [ ] Tambah `days: t.Optional(t.Union([t.Literal(7), t.Literal(14), t.Literal(30)]))` pada `AnalyticsSchema.summary`, `.funnel`, `.leakage`, `.stageDetail` (`src/modules/analytics/schema.ts`) dan pada `AudienceSchema.audience`, `.speed`, `.segments`, `.pipeline`, `.conversations` (`src/modules/audience/schema.ts`) serta `CreativeSchema.list`, `.range`, `.experiments` (`src/modules/creative/schema.ts`).

## File yang Disentuh
- `src/shared/period.ts`, `src/shared/numbers.ts`
- `src/modules/analytics/schema.ts`, `src/modules/analytics/service.ts`
- `src/modules/audience/schema.ts`, `src/modules/audience/service.ts`
- `src/modules/creative/schema.ts`, `src/modules/creative/service.ts`

## Uji Selesai
- `days=7` dengan `until` default → `period.since === "2026-11-13"`, `period.until === "2026-11-19"`, `previousPeriod.since === "2026-11-06"`.
- `days=7&until=2026-11-19` → label `"13–19 Nov 2026"`; `days=30` → label `"21 Okt – 19 Nov 2026"`.
- `days=9` → HTTP 400 `code: "INVALID_DAYS"`.
- `isPartial` bernilai `true` hanya ketika `until` sama dengan hari ini di zona akun.
- Test baru di `tests/unit/period.test.ts` menutup tiga format label dan batas `days`.
