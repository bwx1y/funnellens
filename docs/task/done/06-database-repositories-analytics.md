# DONE: Repository Analitik & Ingest (Bagian 5 `02-database-repositories.md`)

## Status
- Selesai & Terverifikasi (77 test passing / 15 file, `bunx tsc --noEmit` 0 error).
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/infra/database/repositories/analytics.repository.ts` (baru)
  - `src/infra/database/repositories/lead-assessment.repository.ts` (baru)
  - `src/infra/database/repositories/lead-milestone.repository.ts` (baru)
  - `src/infra/database/repositories/pixel-source.repository.ts` (baru)
  - `src/infra/database/repositories/explanation.repository.ts` (baru)
  - `src/infra/database/repositories/{ad,ad-creative,ad-insight-daily,insight-staging,lead,wa-phone}.repository.ts`
  - `src/infra/database/schema/{ads,wa,enums,index}.ts`
  - `src/infra/database/migration/0016_schema_sync_analytics.sql`
  - `tests/integration/analytics-repositories.test.ts` (baru)

## Ruang Lingkup
Repository mengembalikan angka/baris mentah saja. Gate (`≥ 100`, `≥ 30`), `sample`, `note`, badge, dan kalimat `null` adalah milik service pada dokumen 03–11. Tidak ada satu pun method di sini yang menghitung skor atau narasi.

## Implementasi

### 1. `AnalyticsRepository` — satu-satunya tempat query analitik lintas tabel
Sembilan method, semuanya `raw SQL` via `this.database.execute(sql\`...\`)`:

| Method | Hasil |
|---|---|
| `getFunnelCounts(accountId, since, until, campaignId?, objectiveGroup?)` | `impressions`, `linkClicks`, `lpv`, `viewContent`, `addToCart`, `purchase`, `messagingStarted`, `purchaseValueMinor` |
| `getLeadStageCounts(accountId, since, until, campaignId?)` | `observed`, `replied`, `qualified`, `closed`, `firstHot` |
| `getLeadReplyPairs(accountId, since, until)` | `leadId`, `replySeconds \| null`, `eventAt` (satu baris per lead teramati) |
| `getCreativeAggregates(accountId, since, until, campaignId?)` | per `creativeId` + `objectiveGroup`: spend, impressions, linkClicks, results, purchaseValue, frequency, firstSeen |
| `getCreativeDaily(accountId, since, until, creativeId)` | per tanggal: `ctr`, `cpmMinor`, `cprMinor`, `frequency` |
| `getCreativeLeadQuality(accountId, since, until)` | spend/hasil per kreatif + `hotLeads`, `assessedMatureLeads` |
| `getPatternGroups(accountId, since, until, tagType)` | per `tagValue`: `creativeIds[]`, `ctr[]`, `cpr[]` |
| `getTrackingSummary(accountId)` | sync sukses terakhir, `overdueHours`, `overdue`, `pixelSources` |
| `getLatestSnapshotId(accountId)` | `max(sync_runs.id)` berstatus SUCCESS dengan `resource='insights'` |

Aturan yang dijaga:
- **Satu representasi per aksi**: `LEAD_COUNT_SQL`, `PURCHASE_COUNT_SQL`, `PURCHASE_VALUE_SQL` diekspor dari `ad-insight-daily.repository.ts` lalu dipakai ulang lewat subquery `ANALYTICS_ACTIONS_SQL` (satu baris per `insight_daily_id`), sehingga alias Meta yang sama tidak pernah dijumlah dua kali.
- **Scope insight seragam**: `i.account_id`, `i.level = 'ad'`, `i.attribution_window = ATTRIBUTION_WINDOW`, rentang `i.date`; filter `objectiveGroup` memakai `coalesce(s.objective_group, 'web')`.
- **`results` sadar objektif**: `wa` menghitung percakapan (`per.leads`), `web` menghitung pembelian (`per.purchases`).
- **`firstHot` dibatasi kohort teramati**: pembilang dan penyebut mendeskripsikan himpunan lead yang sama.
- **Spend tidak pernah terduplikasi**: `getCreativeLeadQuality` mengagregasi `perf` per kreatif sebelum `left join` ke `lead_stats`.
- **Rasio kosong = `null`**, bukan `0` (helper `ratio`), termasuk `frequency` saat `reach = 0`.

### 2. Repository ingest
- **`LeadAssessmentRepository`**: `appendIfCurrent` (menandai `applied` hanya bila `event_at` ≥ event terbaru; replay `(leadId, eventAt, ruleVersion)` mengembalikan baris tersimpan tanpa duplikat), `latestByLead`, `history` (limit dijepit 1..200).
- **`LeadMilestoneRepository`**: `recordFirst` — observasi pertama per level menang, panggilan berikutnya no-op (`onConflictDoNothing` pada `(leadId, level)`).
- **`PixelSourceRepository`**: `upsert` idempotent pada `(accountId, pixelId)` dengan set `excluded.*` (referensi kolom akan jadi no-op saat konflik), `findByAccountId` terurut `pixelId`.
- **`ExplanationRepository`**: `insertPending` (idempotent pada 10 kolom kunci natural, mengembalikan baris lama bila sudah ada sehingga `ensure` melihat `PENDING` dan mengantrekan tepat satu job), `findByKey`, `findById` (ber-scope tenant), `markReady`, `markFallback`, `markUnavailable`.

### 3. Metode tambahan pada repository yang ada
- `WaPhoneRepository.findByPhoneNumberId` — binding webhook Cloud API (`entry.metadata.phone_number_id`).
- `AdRepository.findAtTime` — `{ad, timeMatched}`: `timeMatched` bernilai `false` bila creative belum/tidak lagi aktif pada `at`, tanpa query kedua.
- `AdCreativeRepository.deleteTag` — ter-scope `creativeId`, mengembalikan `boolean`.
- `AdCreativeRepository.eligibleByIds` — hanya kreatif yang punya baris insight, urutan mengikuti input.

### 4. Perbaikan yang dibutuhkan `tsc` dan data lama
- `LeadRepository`: `score` dihapus dari `sortBy`, `SORT_COLUMNS`, dan blok `onConflictDoUpdate`; `attributionNote` ikut di-upsert agar bertahan saat upsert.
- `WaPhoneRepository.upsert`: `tenantId` diisi dari sesi (`select tenant_id from wa_session where id = $sessionId`); sesi tidak ada kini gagal di NOT NULL, bukan menyisipkan baris yatim.
- `InsightStagingRepository.publishCompleteSlice`: `kinds` menjadi opsional dan default ke kind yang benar-benar di-stage, sehingga slice yang tidak di-stage tidak pernah diganti dengan kosong.

### 5. Schema & migrasi
- Lima tabel baru: `lead_assessments`, `lead_milestones`, `pixel_sources`, `explanations`, `insight_sync_staging`.
- Kolom baru: `sync_runs.range_since/range_until`, `ad_insights_daily.{graph_version, action_report_time, video_3_sec_watched_actions}`, `ad_insights_breakdown_daily.hour_of_day`, `ad_sets.objective_group`, `insight_alerts.{evidence, snoozed_until, resolved_at, resolved_by}`, `conversation_messages.{wamid, context_wamid, sender_role, pair_method, response_type, ad_id, creative_id}`, `leads.attribution_note`, `wa_phone.{tenant_id, account_id, channel, waba_id, phone_number_id}`.
- Migrasi `0016_schema_sync_analytics.sql` di-generate karena `0015_snapshot.json` belum memuat tabel/kolom tersebut; satu statement diperbaiki tangan agar aman pada DB berisi data:
  ```sql
  ALTER TABLE "wa_phone" ADD COLUMN "tenant_id" uuid;
  UPDATE "wa_phone" SET "tenant_id" = "wa_session"."tenant_id" FROM "wa_session"
   WHERE "wa_phone"."session_id" = "wa_session"."id" AND "wa_phone"."tenant_id" IS NULL;
  ALTER TABLE "wa_phone" ALTER COLUMN "tenant_id" SET NOT NULL;
  ```

## Testing
`tests/integration/analytics-repositories.test.ts` — 16 test terhadap DB nyata (fixture tenant/akun/kampanye/adset/creative/ad, cleanup `TestCleanupRepository` di `afterAll`, suffix `Date.now()`):
- `getFunnelCounts` (angka dasar, filter `objectiveGroup` `wa`/`web`, kampanye kosong), `getLeadStageCounts`, `getLeadReplyPairs`.
- `getCreativeAggregates`, `getCreativeDaily` (`ctr 0.05`, `cpm 100000`, `cpr 20000`, `frequency 2`), `getCreativeLeadQuality`, `getPatternGroups`.
- `getTrackingSummary`, `getLatestSnapshotId`.
- `appendIfCurrent` (event lebih lama `applied: false`, replay id sama), `recordFirst` idempoten.
- `PixelSourceRepository.upsert` (1 baris, nama ter-update), `ExplanationRepository` (idempoten per kunci, transisi state, `findById` tenant lain `null`).
- `WaPhoneRepository.findByPhoneNumberId`, `AdRepository.findAtTime` (`timeMatched` true/false/`null`), `deleteTag`, `eligibleByIds`.
- `publishCompleteSlice` tanpa `kinds`: slice `insight_daily` diganti, slice breakdown tidak tersentuh.

Hasil: `bunx tsc --noEmit` 0 error; `bun test` 77 pass / 0 fail / 15 file.

## Catatan Teknis
- **Parameter `Date` pada raw SQL** di-bind sebagai `${date.toISOString()}::timestamptz`. Serializer postgres.js tidak punya entri `Date` di luar query builder, sehingga `db.execute(sql\`... ${date}\`)` melempar `TypeError: Received an instance of Date`.
- **Rentang waktu adalah instant**: pemanggil yang mengirim `until` harus memakai akhir hari (atau `since + 1 hari`), bukan tengah malam; `getLeadStageCounts(account, DAY, DAY)` yang sah mengembalikan `observed: 0`.
- **Rantai migrasi lama belum sehat** (di luar lingkup pekerjaan ini): `drizzle-kit migrate` dari DB kosong berhenti di `0003_brown_iceman.sql` karena `ALTER TABLE "users" ... SET DATA TYPE datetime` (tipe MySQL). Entrypoint Docker memakai `drizzle-kit push`, bukan `migrate`.
