# TODO: Database Repositories Layer

## Gambaran Fitur
Membangun repository class di `src/infra/database/repositories/` yang mewarisi `DatabaseRepository` (`base.repository.ts`) untuk menangani operasi CRUD, UPSERT idempotent, serta query agregasi analitik langsung di level SQL PostgreSQL.

## Daftar Pekerjaan

### 1. Master Repositories
- [ ] **AdAccountRepository** (`ad-account.repository.ts`):
  - `upsert(data: InsertAdAccount): Promise<AdAccount>`
  - `findByTenantId(tenantId: string): Promise<AdAccount[]>`
  - `findById(id: string): Promise<AdAccount | null>`
- [ ] **CampaignRepository** (`campaign.repository.ts`):
  - `upsertBatch(campaigns: InsertCampaign[]): Promise<void>`
  - `findByAccountId(accountId: string, status?: string): Promise<Campaign[]>`
- [ ] **AdSetRepository** (`ad-set.repository.ts`):
  - `upsertBatch(adSets: InsertAdSet[]): Promise<void>`
  - `findByCampaignId(campaignId: string): Promise<AdSet[]>`
- [ ] **AdRepository** (`ad.repository.ts`):
  - `upsertBatch(ads: InsertAd[]): Promise<void>`
  - `findByAdSetId(adsetId: string): Promise<Ad[]>`
- [ ] **AdCreativeRepository** (`ad-creative.repository.ts`):
  - `upsertBatch(creatives: InsertAdCreative[]): Promise<void>`
  - `findWithTags(accountId: string): Promise<AdCreativeWithTags[]>`
  - `upsertTags(creativeId: string, tags: InsertCreativeTag[]): Promise<void>`

### 2. Time-Series Fact Repositories
- [ ] **AdInsightDailyRepository** (`ad-insight-daily.repository.ts`):
  - `upsertBatch(insights: InsertAdInsightDaily[]): Promise<void>`: menggunakan `onConflictDoUpdate` pada unique constraint `(ad_id, date)`.
  - `getAggregatedKPIs(accountId: string, since: Date, until: Date, campaignId?: string)`:
    - Agregasi `SUM(spend)`, `SUM(impressions)`, `SUM(clicks)`, `SUM(inline_link_clicks)`.
    - Join `ad_insight_actions` untuk filter `primary_action`.
  - `getDailyTrend(accountId: string, since: Date, until: Date, campaignId?: string)`:
    - Agregasi harian `date`, `spend`, `leads`.
  - `getCampaignPerformance(accountId: string, since: Date, until: Date)`:
    - Group by campaign: spend, leads, cost per lead, ROAS.
- [ ] **AdInsightBreakdownRepository** (`ad-insight-breakdown.repository.ts`):
  - `upsertBatch(breakdowns: InsertAdInsightBreakdownDaily[]): Promise<void>`
  - `getPlacementMetrics(accountId: string, since: Date, until: Date)`:
    - Group by `publisher_platform`, `platform_position`.
  - `getDeviceMetrics(accountId: string, since: Date, until: Date)`:
    - Group by `impression_device`.

### 3. Lead & CRM Repositories
- [ ] **LeadRepository** (`lead.repository.ts`):
  - `upsert(lead: InsertLead): Promise<Lead>`
  - `countByTemperature(accountId: string, since: Date, until: Date): Promise<{ hot: number, warm: number, cold: number }>`
  - `getUnrepliedHotLeads(accountId: string, limit?: number): Promise<Lead[]>`:
    - Filter: `temperature = 'HOT'`, `first_replied_at IS NULL`, urutkan dari waiting time terlama.
  - `getSpeedMetrics(accountId: string, since: Date, until: Date)`:
    - Average `EXTRACT(EPOCH FROM (first_replied_at - first_seen_at))`.
    - Count lead macet: `first_replied_at IS NULL AND NOW() - first_seen_at > INTERVAL '24 hours'`.
  - `getLeadList(accountId: string, filter: LeadFilterParams): Promise<{ leads: Lead[], total: number }>`

### 4. Operational Repositories
- [ ] **SyncRunRepository** (`sync-run.repository.ts`):
  - `create(run: InsertSyncRun): Promise<SyncRun>`
  - `complete(id: number, rowsSynced: number): Promise<void>`
  - `fail(id: number, error: string): Promise<void>`
  - `getLatestByAccountId(accountId: string): Promise<SyncRun | null>`
- [ ] **TrackingHealthRepository** (`tracking-health.repository.ts`):
  - `upsertDaily(health: InsertTrackingHealthDaily): Promise<void>`
  - `getLatestStatus(accountId: string): Promise<TrackingHealthSummary>`
- [ ] **InsightAlertRepository** (`insight-alert.repository.ts`):
  - `findActiveByAccountId(accountId: string): Promise<InsightAlert[]>`
  - `updateStatus(id: number, status: 'snoozed' | 'resolved'): Promise<void>`
