# TODO: Database Repositories Layer

## Gambaran Fitur
Repository class di `src/infra/database/repositories/` yang mewarisi `DatabaseRepository` (`base.repository.ts`) untuk operasi CRUD, UPSERT idempotent, serta query agregasi analitik langsung di level SQL PostgreSQL.

## Daftar Pekerjaan

### 1. Master Repositories
- [x] **AdAccountRepository** (`ad-account.repository.ts`):
  - `upsert(data: InsertAdAccount): Promise<AdAccount>`
  - `findByTenantId(tenantId: string): Promise<AdAccount[]>`
  - `findById(id: string): Promise<AdAccount | null>`
- [x] **CampaignRepository** (`campaign.repository.ts`):
  - `upsertBatch(campaigns: InsertCampaign[]): Promise<void>`
  - `findByAccountId(accountId: string, status?: string): Promise<Campaign[]>`
- [x] **AdSetRepository** (`ad-set.repository.ts`):
  - `upsertBatch(adSets: InsertAdSet[]): Promise<void>`
  - `findByCampaignId(campaignId: string): Promise<AdSet[]>`
- [x] **AdRepository** (`ad.repository.ts`):
  - `upsertBatch(ads: InsertAd[]): Promise<void>`
  - `findByAdSetId(adsetId: string): Promise<Ad[]>`
- [x] **AdCreativeRepository** (`ad-creative.repository.ts`):
  - `upsertBatch(creatives: InsertAdCreative[]): Promise<void>`
  - `findWithTags(accountId: string): Promise<AdCreativeWithTags[]>`
  - `upsertTags(creativeId: string, tags: InsertCreativeTag[]): Promise<void>`

### 2. Time-Series Fact Repositories
- [x] **AdInsightDailyRepository** (`ad-insight-daily.repository.ts`):
  - `upsertBatch(insights: InsertAdInsightDaily[]): Promise<void>`: `onConflictDoUpdate` pada unique constraint `(account_id, level, entity_id, date, attribution_window)`.
  - `getAggregatedKPIs(accountId: string, since: Date, until: Date, campaignId?: string)`:
    - Agregasi `SUM(spend)`, `SUM(impressions)`, `SUM(clicks)`, `SUM(inline_link_clicks)`.
    - Join `ad_insight_actions` untuk filter `primary_action`.
  - `getDailyTrend(accountId: string, since: Date, until: Date, campaignId?: string)`:
    - Agregasi harian `date`, `spend`, `leads`.
  - `getCampaignPerformance(accountId: string, since: Date, until: Date)`:
    - Group by campaign: spend, leads, cost per lead, ROAS.
- [x] **AdInsightBreakdownRepository** (`ad-insight-breakdown.repository.ts`):
  - `upsertBatch(breakdowns: InsertAdInsightBreakdownDaily[]): Promise<void>`
  - `getPlacementMetrics(accountId: string, since: Date, until: Date)`:
    - Group by `publisher_platform`, `platform_position`.
  - `getDeviceMetrics(accountId: string, since: Date, until: Date)`:
    - Group by `impression_device`.

### 3. Lead & CRM Repositories
- [x] **LeadRepository** (`lead.repository.ts`):
  - `upsert(lead: InsertLead): Promise<Lead>`
  - `countByTemperature(accountId: string, since: Date, until: Date): Promise<{ hot: number, warm: number, cold: number }>`
  - `getUnrepliedHotLeads(accountId: string, limit?: number): Promise<Lead[]>`
  - `getSpeedMetrics(accountId: string, since: Date, until: Date)`
  - `getLeadList(accountId: string, filter: LeadFilterParams): Promise<{ leads: Lead[], total: number }>`
  - Filter `sortBy` hanya `createdAt` dan `firstSeenAt`; tidak ada `score` (kolom `leads.score` dihapus).

### 4. Operational Repositories
- [x] **SyncRunRepository** (`sync-run.repository.ts`):
  - `create(run: InsertSyncRun): Promise<SyncRun>`
  - `complete(id: number, rowsSynced: number): Promise<void>`
  - `fail(id: number, error: string): Promise<void>`
  - `getLatestByAccountId(accountId: string): Promise<SyncRun | null>`
- [x] **TrackingHealthRepository** (`tracking-health.repository.ts`):
  - `upsertDaily(health: InsertTrackingHealthDaily): Promise<void>`
  - `getLatestStatus(accountId: string): Promise<TrackingHealthSummary>`
- [x] **InsightAlertRepository** (`insight-alert.repository.ts`):
  - `findActiveByAccountId(accountId: string): Promise<InsightAlert[]>`
  - `updateStatus(id: number, patch: { status: "SNOOZED" | "DONE"; snoozedUntil?: Date; resolvedAt?: Date; resolvedBy?: string }): Promise<void>`

### 5. Repository analitik & ingest (baru)
- [x] **AnalyticsRepository** (`analytics.repository.ts`) — satu-satunya tempat query analitik lintas tabel:
  - `getFunnelCounts(accountId, since, until, campaignId?, objectiveGroup?)` → `impressions`, `link_clicks`, `lpv`, `view_content`, `add_to_cart`, `purchase`, `messaging_started`, `purchase_value_minor`.
  - `getLeadStageCounts(accountId, since, until, campaignId?)` → `observed`, `replied`, `qualified`, `closed`, `first_hot`.
  - `getLeadReplyPairs(accountId, since, until)` → `leadId`, `replySeconds | null`, `eventAt`.
  - `getCreativeAggregates(accountId, since, until, campaignId?)` → per `creativeId` + `objectiveGroup`: spend, impressions, link_clicks, results, purchase_value, frequency, first_seen.
  - `getCreativeDaily(accountId, since, until, creativeId)` → `date`, `ctr`, `cpm`, `cpr`, `frequency`.
  - `getCreativeLeadQuality(accountId, since, until)` → belanja/hasil per kreatif (subquery) + hot/mature counts.
  - `getPatternGroups(accountId, since, until, tagType)` → per `tagValue`: `creativeIds`, `ctr[]`, `cpr[]`.
  - `getTrackingSummary(accountId)` → sync sukses terakhir, overdue, pixel sources.
  - `getLatestSnapshotId(accountId)` → `max(sync_runs.id)` berstatus SUCCESS dengan `resource='insights'`.
- [x] **InsightStagingRepository** (`insight-staging.repository.ts`): `write(runId, kind, rows)`, `publishCompleteSlice({runId, accountId, since, until})`, `cleanup(runId)`.
- [x] **LeadAssessmentRepository** (`lead-assessment.repository.ts`): `appendIfCurrent`, `latestByLead`, `history`.
- [x] **LeadMilestoneRepository** (`lead-milestone.repository.ts`): `recordFirst`.
- [x] **PixelSourceRepository** (`pixel-source.repository.ts`): `upsert`, `findByAccountId`.
- [x] **ExplanationRepository** (`explanation.repository.ts`): `insertPending`, `findByKey`, `findById`, `markReady`, `markFallback`, `markUnavailable`.
- [x] Metode tambahan pada repository yang ada: `WaPhoneRepository.findByPhoneNumberId`, `AdRepository.findAtTime`, `AdCreativeRepository.deleteTag`, `AdCreativeRepository.eligibleByIds`.
