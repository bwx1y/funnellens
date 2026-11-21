import {describe, expect, it, mock} from "bun:test";
import {MetaService} from "@/modules/meta/service";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {CampaignRepository} from "@db/repositories/campaign.repository";
import {AdSetRepository} from "@db/repositories/ad-set.repository";
import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {AdRepository} from "@db/repositories/ad.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import type {UpsertInsightDailyParams} from "@db/repositories/ad-insight-daily.repository";
import type {InsertAdInsightBreakdownDaily} from "@db/repositories/ad-insight-breakdown.repository";
import {
    InsightStagingRepository,
    type InsightStagingKind,
    type PublishCompleteSliceParams,
} from "@db/repositories/insight-staging.repository";
import type {IMetaAdsAdapter} from "@infra/meta/base.meta";
import type {MetaConnectionEntity} from "@db/schema/ads/meta-connection.entity";
import type {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import type {SyncRunEntity} from "@db/schema/ads/sync-run.entity";

type MetaConnectionSelect = typeof MetaConnectionEntity.$inferSelect;
type AdAccountSelect = typeof AdAccountEntity.$inferSelect;
type SyncRunSelect = typeof SyncRunEntity.$inferSelect;

describe("Meta Ads Insights Sync", () => {
    it("stages daily insights and breakdowns, then publishes the slice atomically", async () => {
        const validConnection: MetaConnectionSelect = {
            id: "conn-1",
            userId: "user-1",
            tenantId: "tenant-1",
            metaUserId: "meta-123",
            metaUserName: "Meta User",
            accessToken: "valid-token",
            scopes: ["ads_read"],
            expiresAt: new Date(Date.now() + 100000),
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const activeAccount: AdAccountSelect = {
            id: "act_test_insights",
            tenantId: "tenant-1",
            name: "Insights Account",
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
            accountStatus: 1,
            businessId: null,
            isSelected: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const mockConnRepo = {
            findByUserId: mock(async (): Promise<MetaConnectionSelect | null> => validConnection),
        } as unknown as MetaConnectionRepository;

        const mockAdAccountRepo = {
            findById: mock(async (): Promise<AdAccountSelect | null> => activeAccount),
            findSelectedByTenantId: mock(async (): Promise<AdAccountSelect | null> => activeAccount),
        } as unknown as AdAccountRepository;

        const createdRuns: {accountId: string; resource: string}[] = [];

        const mockSyncRunRepo = {
            create: mock(async (run: {
                accountId: string;
                resource: string;
                rangeSince?: string;
                rangeUntil?: string;
            }): Promise<SyncRunSelect> => {
                createdRuns.push({accountId: run.accountId, resource: run.resource});
                return {
                    id: 99,
                    accountId: run.accountId,
                    resource: run.resource,
                    startedAt: new Date(),
                    finishedAt: null,
                    status: "RUNNING",
                    rowsUpserted: null,
                    rangeSince: run.rangeSince ?? null,
                    rangeUntil: run.rangeUntil ?? null,
                    error: null,
                };
            }),
            complete: mock(async (): Promise<void> => {}),
            fail: mock(async (): Promise<void> => {}),
        } as unknown as SyncRunRepository;

        const stagedDaily: UpsertInsightDailyParams[] = [];
        const stagedBreakdowns: InsertAdInsightBreakdownDaily[] = [];
        const publishCalls: PublishCompleteSliceParams[] = [];

        const mockStagingRepo = {
            write: mock(async (runId: number, kind: InsightStagingKind, rows: unknown[]): Promise<void> => {
                expect(runId).toBe(99);
                if (kind === "insight_daily") {
                    stagedDaily.push(...(rows as UpsertInsightDailyParams[]));
                } else if (kind === "insight_breakdown") {
                    stagedBreakdowns.push(...(rows as InsertAdInsightBreakdownDaily[]));
                }
            }),
            publishCompleteSlice: mock(async (params: PublishCompleteSliceParams) => {
                publishCalls.push(params);
                return {dailyInsights: 1, breakdowns: 1, total: 2};
            }),
            cleanup: mock(async (): Promise<void> => {}),
        } as unknown as InsightStagingRepository;

        const mockAdapter: IMetaAdsAdapter = {
            getAdAccounts: mock(async () => []),
            getCampaigns: mock(async () => []),
            getAdSets: mock(async () => []),
            getAdCreatives: mock(async () => []),
            getAds: mock(async () => []),
            getVideoDetails: mock(async () => null),
            getDailyAdInsights: mock(async () => [
                {
                    accountId: "act_test_insights",
                    level: "ad" as const,
                    entityId: "ad_101",
                    campaignId: "camp_1",
                    adsetId: "adset_1",
                    adId: "ad_101",
                    date: "2026-11-20",
                    attributionWindow: "7d_click",
                    currency: "IDR",
                    currencyOffset: 100,
                    spendMinor: 15000000,
                    impressions: 25000,
                    reach: 18000,
                    frequency: "1.388889",
                    clicks: 850,
                    inlineLinkClicks: 600,
                    uniqueClicks: 700,
                    ctr: "0.034000",
                    cpcMinor: 1764,
                    cpmMinor: 60000,
                    actions: [{action_type: "onsite_conversion.messaging_conversation_started_7d", value: "35"}],
                    actionValues: [{action_type: "purchase", value: "500000"}],
                    costPerActionType: [{action_type: "onsite_conversion.messaging_conversation_started_7d", value: "42857"}],
                    videoPlayActions: 12000,
                    video30SecWatchedActions: null,
                    videoThruplayWatchedActions: 8500,
                    videoP25WatchedActions: 10000,
                    videoP50WatchedActions: 7000,
                    videoP75WatchedActions: 5000,
                    videoP100WatchedActions: 3000,
                    videoAvgTimeWatchedSeconds: "12.4500",
                    graphVersion: "v23.0",
                    actionReportTime: "conversion",
                    video3SecWatchedActions: 4321,
                    isFinal: true,
                    extractedActions: [
                        {
                            actionType: "onsite_conversion.messaging_conversation_started_7d",
                            count: "35",
                            valueMinor: null,
                            costPerActionMinor: 4285700,
                        },
                    ],
                },
            ]),
            getDailyAdBreakdowns: mock(async () => [
                {
                    accountId: "act_test_insights",
                    level: "ad" as const,
                    entityId: "ad_101",
                    campaignId: "camp_1",
                    adsetId: "adset_1",
                    adId: "ad_101",
                    date: "2026-11-20",
                    attributionWindow: "7d_click",
                    publisherPlatform: "instagram",
                    platformPosition: "story",
                    impressionDevice: "smartphone",
                    hourOfDay: null,
                    age: null,
                    gender: null,
                    country: null,
                    region: null,
                    breakdownHash: "hash123",
                    spendMinor: 8000000,
                    impressions: 14000,
                    reach: 10000,
                    clicks: 500,
                    inlineLinkClicks: 350,
                    actions: null,
                    actionValues: null,
                },
            ]),
            getHourlyAdBreakdowns: mock(async () => []),
            getCustomPeriodMetrics: mock(async () => null),
        };

        const metaService = new MetaService(
            mockConnRepo,
            mockAdAccountRepo,
            undefined as unknown as CampaignRepository,
            undefined as unknown as AdSetRepository,
            undefined as unknown as AdCreativeRepository,
            undefined as unknown as AdRepository,
            mockSyncRunRepo,
            undefined,
            mockAdapter,
            mockStagingRepo
        );

        const result = await metaService.syncInsights(
            {iss: "user-1", tenantId: "tenant-1"},
            {since: "2026-11-01", until: "2026-11-20", includeBreakdowns: true}
        );

        expect(createdRuns).toEqual([{accountId: "act_test_insights", resource: "insights"}]);
        expect(result.accountId).toBe("act_test_insights");
        expect(result.counts.dailyInsights).toBe(1);
        expect(result.counts.breakdowns).toBe(1);
        expect(result.counts.total).toBe(2);

        expect(publishCalls).toEqual([{
            runId: 99,
            accountId: "act_test_insights",
            since: "2026-11-01",
            until: "2026-11-20",
            kinds: ["insight_daily", "insight_breakdown"],
        }]);
        expect(mockStagingRepo.cleanup).not.toHaveBeenCalled();

        expect(stagedDaily.length).toBe(1);
        expect(stagedDaily[0].spendMinor).toBe(15000000);
        expect(stagedDaily[0].videoThruplayWatchedActions).toBe(8500);
        expect(stagedDaily[0].graphVersion).toBe("v23.0");
        expect(stagedDaily[0].actionReportTime).toBe("conversion");
        expect(stagedDaily[0].video3SecWatchedActions).toBe(4321);
        expect(stagedDaily[0].actions?.[0].actionType).toBe("onsite_conversion.messaging_conversation_started_7d");
        expect(stagedDaily[0].actions?.[0].count).toBe("35");

        expect(stagedBreakdowns.length).toBe(1);
        expect(stagedBreakdowns[0].publisherPlatform).toBe("instagram");
        expect(stagedBreakdowns[0].breakdownHash).toBe("hash123");
        expect(stagedBreakdowns[0].hourOfDay).toBeNull();
    });

    it("cleans the staging table and fails the run when publishing throws", async () => {
        const validConnection: MetaConnectionSelect = {
            id: "conn-1",
            userId: "user-1",
            tenantId: "tenant-1",
            metaUserId: "meta-123",
            metaUserName: "Meta User",
            accessToken: "valid-token",
            scopes: ["ads_read"],
            expiresAt: new Date(Date.now() + 100000),
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const activeAccount: AdAccountSelect = {
            id: "act_test_insights",
            tenantId: "tenant-1",
            name: "Insights Account",
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
            accountStatus: 1,
            businessId: null,
            isSelected: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const mockConnRepo = {
            findByUserId: mock(async (): Promise<MetaConnectionSelect | null> => validConnection),
        } as unknown as MetaConnectionRepository;

        const mockAdAccountRepo = {
            findById: mock(async (): Promise<AdAccountSelect | null> => activeAccount),
            findSelectedByTenantId: mock(async (): Promise<AdAccountSelect | null> => activeAccount),
        } as unknown as AdAccountRepository;

        const mockSyncRunRepo = {
            create: mock(async (run: {accountId: string; resource: string}): Promise<SyncRunSelect> => ({
                id: 42,
                accountId: run.accountId,
                resource: run.resource,
                startedAt: new Date(),
                finishedAt: null,
                status: "RUNNING",
                rowsUpserted: null,
                rangeSince: null,
                rangeUntil: null,
                error: null,
            })),
            complete: mock(async (): Promise<void> => {}),
            fail: mock(async (): Promise<void> => {}),
        } as unknown as SyncRunRepository;

        const mockStagingRepo = {
            write: mock(async (): Promise<void> => {}),
            publishCompleteSlice: mock(async () => {
                throw new Error("publish failed");
            }),
            cleanup: mock(async (): Promise<void> => {}),
        } as unknown as InsightStagingRepository;

        const mockAdapter: IMetaAdsAdapter = {
            getAdAccounts: mock(async () => []),
            getCampaigns: mock(async () => []),
            getAdSets: mock(async () => []),
            getAdCreatives: mock(async () => []),
            getAds: mock(async () => []),
            getVideoDetails: mock(async () => null),
            getDailyAdInsights: mock(async () => []),
            getDailyAdBreakdowns: mock(async () => []),
            getHourlyAdBreakdowns: mock(async () => []),
            getCustomPeriodMetrics: mock(async () => null),
        };

        const metaService = new MetaService(
            mockConnRepo,
            mockAdAccountRepo,
            undefined as unknown as CampaignRepository,
            undefined as unknown as AdSetRepository,
            undefined as unknown as AdCreativeRepository,
            undefined as unknown as AdRepository,
            mockSyncRunRepo,
            undefined,
            mockAdapter,
            mockStagingRepo
        );

        await expect(
            metaService.syncInsights(
                {iss: "user-1", tenantId: "tenant-1"},
                {since: "2026-11-01", until: "2026-11-20", includeBreakdowns: false}
            )
        ).rejects.toThrow("publish failed");

        expect(mockStagingRepo.cleanup).toHaveBeenCalledWith(42);
        expect(mockSyncRunRepo.fail).toHaveBeenCalledWith(42, "publish failed");
        expect(mockSyncRunRepo.complete).not.toHaveBeenCalled();
    });
});
