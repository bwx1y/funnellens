# DONE: Alerts & Health Scoring Engine

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 204 pass / 0 fail / 32 file).
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/shared/alerts.ts` (baru)
  - `src/shared/health.ts`
  - `src/infra/database/repositories/insight-alert.repository.ts`, `ad-account.repository.ts`
  - `src/modules/alerts/evaluate.service.ts` (baru), `service.ts` (baru), `schema.ts` (baru), `index.ts` (baru), `queue.ts` (baru), `worker.ts` (baru)
  - `src/routes.ts`, `src/index.ts`
  - `tests/unit/alerts-helpers.test.ts` (baru), `tests/unit/alerts-evaluate.test.ts` (baru)
  - `tests/integration/alerts.test.ts` (baru), `tests/integration/repositories.test.ts`

## Ruang Lingkup
Tiga bagian: `funnelHealth()` (3 komponen 40/30/30, tanpa skor gabungan lain), generator alert `insight_alerts` yang idempoten, dan API manajemen alert (`GET /api/alerts`, `PATCH /api/alerts/:id/snooze`, `PATCH /api/alerts/:id/resolve`, `GET /api/alerts/badge`). Dampak selalu jumlah chat (`impactCaption`), `impactMinor` selalu `null`.

## Implementasi

### 1. Skor kesehatan (`src/shared/health.ts`)
`funnelHealth({conversion, baseline, onTimeReplyShare, emq, dedup})` → `{score, badge, components, note?}`.

| Komponen | Bobot | Skor |
|---|---|---|
| `conversion` — rasio konversi funnel kini vs baseline | 40 | `100 × conversion / baseline`, clamp 0–100; `null` bila salah satu sisi `null` atau `baseline ≤ 0` |
| `reply` — porsi chat dibalas ≤ 15 menit | 30 | `onTimeReplyShare × 100`, clamp 0–100 |
| `tracking` — EMQ dan dedup CAPI | 30 | rata-rata `emq × 10` dan `dedup × 100`; hanya salah satu tersedia → pakai yang ada; keduanya `null` → `null` |

- Komponen `null` dikeluarkan, bobot dinormalkan ulang (`Σ weight × score / Σ weight`), skor dibulatkan ke integer.
- Komponen terukur `< 2` → `score: null`, `badge: null`, `note: "Komponen pengukuran belum cukup"` (bukan `0`).
- Badge: `≥ 80 "Prima"`, `60–79 "Perlu perhatian"`, `< 60 "Kritis"`.

### 2. Kosakata aturan (`src/shared/alerts.ts`)
`LEAK_RULES` (tiga transisi WA: `link_clicks→messaging_started`, `observed→replied`, `qualified→closed`), `LEAK_WARNING_PP -5`, `LEAK_CRITICAL_PP -15`, `leakLevel` (aturan pertama menang), `HOT_LEAD_WAIT_MINUTES 30`, `HOT_LEAD_SCAN_LIMIT 50`, `SNOOZE_HOURS [24, 168]`, `snoozedUntil(hours, now)`. Predikat `active` hanya hidup di SQL repository — satu definisi, tidak ada duplikat TS.

### 3. Generator alert (`src/modules/alerts/evaluate.service.ts`)
`evaluate(accountId, period)` mengembalikan `InsightAlertUpsert[]` tanpa menyentuh tabel. Semua sumber dibaca paralel: funnel Meta (kini + sebelumnya, `objectiveGroup "wa"`), `LeadStageCounts` (kini + sebelumnya), `getTrackingSummary`, `getLatestStatus`, `findByAccountId` pixel, `getUnrepliedHotLeads`.

| Rule | Pemicu | Level | Entity | Caption |
|---|---|---|---|---|
| `leak_click_to_landing`, `leak_chat_to_reply`, `leak_qualified_to_closed` | `eligible` dan `deltaPp ≤ −5` / `≤ −15` dari `buildFunnelPairs` | `WARNING` / `CRITICAL` | `account`, `""` | `≈{estimatedGap} chat hilang` |
| `unreplied_hot_lead` | lead HOT tanpa `firstRepliedAt`, menunggu `> 30` menit | `CRITICAL` | `lead`, `leadId`, `route "/leads/{id}"` | — |
| `creative_fatigue` | `CreativeService.getFatigue` → `status === "Jenuh"` | `WARNING` | `creative`, `creativeId` | — |
| `tracking_emq` | `emqAvg < 6` atau `dedupRate < 0.85` (`trackingAlertNeeded`, input sama dengan job `sync-pixel-stats`) | `WARNING` | `account`, `""` | — |

Setiap baris membawa `evidence` (angka pemicu + `since`/`until`/`trackingState`) dan `confidence` (`tinggi` untuk kebocoran & HOT, `sedang` untuk kejenuhan & tracking), `impactMinor: null`, `sampleSize` dari `pair.sample.n`.

`run(tenantId, accountId, period?)` = `evaluate` → `upsert` per baris → `resolveByRuleKey` untuk keenam rule dengan `keepEntityIds` dari hasil evaluasi, sehingga alert yang kondisinya hilang ditutup dan alert yang muncul lagi terbuka kembali.

### 4. Repository (`insight-alert.repository.ts`)
| Method | Isi |
|---|---|
| `findByAccountIdAndStatus(accountId, filter)` | `active` = `ACTIVE` + `snoozed_until` kosong/lewat; `snoozed` = `SNOOZED` + `snoozed_until > now()`; `resolved` = `DONE`; urut `detected_at desc` |
| `countActive(accountId)` | `count(*)` dengan predikat `active` yang sama (badge) |
| `findByIdForTenant(id, tenantId)` | join `ad_accounts`, alert tenant lain → `null` → 404 |
| `snooze(id, until)` | `SNOOZED` + `snoozed_until` |
| `resolve(id, resolvedBy)` | `DONE` + `resolved_at` + `resolved_by`, `snoozed_until` dikosongkan |
| `upsert` | idempoten pada `(account_id, rule_key, entity_id)`; `entity_id` level akun = `""`, bukan `NULL` |
| `resolveByRuleKey(accountId, ruleKey, keepEntityIds)` | menutup rule yang tidak lagi memicu, melindungi `entity_id` yang masih ada |

`AdAccountRepository.findSelected()` (baru) memberi daftar akun `is_selected` lintas tenant untuk job.

### 5. API (`src/modules/alerts/`)
`AlertsController` (`prefix /alerts`) memakai `JwtUtil.isAuthenticated`; setiap method service memanggil `requireAccountScope` atau `findByIdForTenant` lebih dulu.

| Route | Isi |
|---|---|
| `GET /api/alerts?accountId=&status=` | `status` default `active`; respons `{status, alerts[]}` dengan `snoozedUntil`/`resolvedAt`/`detectedAt` ISO |
| `GET /api/alerts/badge?accountId=` | `{count}` alert `ACTIVE` yang belum di-snooze |
| `PATCH /api/alerts/:id/snooze` | body `{hours: 24 | 168}` → `SNOOZED`, `snoozedUntil = now() + hours` |
| `PATCH /api/alerts/:id/resolve` | `DONE`, `resolvedAt = now()`, `resolvedBy = user.iss` |

### 6. Queue & worker
- `alerts-evaluate` (`AlertsQueue`) dengan scheduler `0 * * * *`; dipanggil dari `src/index.ts` saat startup (mode non-test), sejajar dengan sync sesi OpenWA.
- `AlertsWorkerProcessor`: `data.accountId` → satu akun (`findById(accountId, tenantId)`, akun hilang = warning bukan retry); tanpa `accountId` → `findSelected()` dan `run` per akun.

## Pengujian
| Uji | Cakupan |
|---|---|
| `tests/unit/funnel-health.test.ts` | bobot 40/30/30, normalisasi ulang, `< 2` komponen → `score null` + `note`, tracking satu-sisi, clamp 100 |
| `tests/unit/alerts-helpers.test.ts` | ambang `−5`/`−15`, tabel `LEAK_RULES`, `snoozedUntil` 24/168 jam |
| `tests/unit/alerts-evaluate.test.ts` | `evaluate` dengan repository double: `deltaPp −10` → `WARNING` + `≈100 chat hilang`, HOT 31 menit → `CRITICAL` + `entityId`/`route`, HOT 10 menit tidak memicu, `tracking_emq` di ambang 6 / 0.85; worker lintas akun dan akun hilang |
| `tests/integration/alerts.test.ts` | route nyata: snooze 24 jam (hilang dari `active`, muncul di `snoozed` dengan `snoozedUntil` ≈ +24 jam, badge 1 → 0), resolve (`resolvedAt` + `resolved_by = user.iss`, pindah ke `resolved`), akun/alert tenant lain → 404 dan baris tidak berubah |
| `tests/integration/repositories.test.ts` | `findActiveByAccountId` + `snooze`; `resolveByRuleKey` dengan `keepEntityIds` menutup baris `cr_stale` dan membiarkan `cr_keep` `ACTIVE` |

## Keputusan & Catatan
- **`active` = `ACTIVE` saja**: snooze yang kedaluwarsa tidak otomatis muncul di `active`; evaluasi per jam berikutnya membuka kembali (`upsert` → `ACTIVE`) atau menutupnya (`resolveByRuleKey`), sesuai definisi `active`/`snoozed`/`resolved` di TODO.
- **Satu definisi predikat**: SQL repository adalah satu-satunya tempat aturan `active` hidup; helper TS duplikat dihapus agar tidak bisa menyimpang.
- **Tidak ada route evaluasi manual**: pemicu satu-satunya adalah scheduler per jam (dan worker), sesuai daftar pekerjaan.
