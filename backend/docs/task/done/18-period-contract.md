# Task Done: Kontrak Periode (7/14/30 hari, label id-ID, is_partial, arah)

## Gambaran Pekerjaan
Task ini melengkapi kontrak periode analitik sesuai spesifikasi F-07.1–F-07.4:
- Mendukung parameter query `days ∈ {7, 14, 30}` dengan validasi error 400 (`code: "INVALID_DAYS"`).
- Jika `days` dikirimkan, `until` default ke snapshot prototype `"2026-11-19"` dan `days` mengoverride `since`.
- `periodLabel(since, until)` menghasilkan format tanggal id-ID tanpa leading zeros (contoh: `"13–19 Nov 2026"`, `"27 Okt – 25 Nov 2026"`, `"28 Des 2026 – 3 Jan 2027"`).
- `isPartialDay(until, timezoneName)` menandai `true` jika `until === todayInZone(timezoneName)`.
- Mengembalikan field `label` dan `isPartial` pada setiap response blok `period`, serta `label` pada `previousPeriod`.
- `direction(value)` menghasilkan `"up" | "down" | "neutral" | null` dan disematkan pada setiap delta KPI (`KpiCard`), funnel pair (`FunnelPair`), dan perbandingan tahap funnel (`StageComparisonRow`).

## Perubahan File
- `src/shared/period.ts`: implementasi `PERIOD_DAYS`, `DEFAULT_SNAPSHOT_END`, `periodLabel`, `isPartialDay`, `snapshotEnd`, dan `resolvePeriod`.
- `src/shared/numbers.ts`: implementasi `DeltaDirection` dan fungsi `direction`.
- `src/shared/funnel.ts`: penambahan field `direction` pada `FunnelPair`.
- `src/modules/analytics/schema.ts` & `src/modules/analytics/service.ts`: integrasi query param `days`, perpanjangan kontrak response `period`/`previousPeriod`, dan penambahan `direction` pada KPI cards dan tabel perbandingan.
- `src/modules/audience/schema.ts` & `src/modules/audience/service.ts`: penambahan param `days` serta metadata `label` dan `isPartial`.
- `src/modules/creative/schema.ts` & `src/modules/creative/service.ts`: penambahan param `days` serta metadata `label` dan `isPartial`.
- `tests/unit/period.test.ts`: test suite untuk label bahasa Indonesia, `isPartialDay`, boundary checks `resolvePeriod`, dan arah delta `direction`.

## Hasil Pengujian
- Unit tests `tests/unit/period.test.ts` lulus 14/14 test cases.
- Seluruh suite test `bun test` (270 test cases di 39 files) lulus tanpa regresi.
