import {describe, expect, it, mock} from "bun:test";
import {MetaService} from "@/modules/meta/service";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {CampaignRepository} from "@db/repositories/campaign.repository";
import {AdSetRepository} from "@db/repositories/ad-set.repository";
import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {AdRepository} from "@db/repositories/ad.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {AdInsightRepository, type UpsertInsightDailyParams} from "@db/repositories/ad-insight.repository";
import type {IMetaAdsAdapter} from "@infra/meta/base.meta";
import type {MetaConnectionEntity} from "@db/schema/ads/meta-connection.entity";
import type {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import type {SyncRunEntity} from "@db/schema/ads/sync-run.entity";
import type {AdInsightBreakdownDailyEntity} from "@db/schema/ads/ad-insight-breakdown-daily.entity";

type MetaConnectionSelect = typeof MetaConnectionEntity.$inferSelect;
type AdAccountSelect = typeof AdAccountEntity.$inferSelect;
type SyncRunSelect = typeof SyncRunEntity.$inferSelect;
type BreakdownInsert = typeof AdInsightBreakdownDailyEntity.$inferInsert;

describe("Meta Ads Insights Sync", () => {
    it("syncInsights pulls daily insights, actions, and breakdowns via SDK adapter", async () => {
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

        let syncRunStarted = false;
        let syncRunFinished = false;
        let totalRowsRecorded = 0;

        const mockSyncRunRepo = {
            start: mock(async (accountId: string, resource: string): Promise<SyncRunSelect> => {
                syncRunStarted = true;
                return {
                    id: 99,
                    accountId,
                    resource,
                    startedAt: new Date(),
                    finishedAt: null,
                    status: "RUNNING",
                    rowsUpserted: null,
                    error: null,
                };
            }),
            finish: mock(async (_id: number, rows: number): Promise<void> => {
                syncRunFinished = true;
                totalRowsRecorded = rows;
            }),
            fail: mock(async (): Promise<void> => {}),
        } as unknown as SyncRunRepository;

        let capturedInsights: UpsertInsightDailyParams[] = [];
        let capturedBreakdowns: BreakdownInsert[] = [];

        const mockAdInsightRepo = {
            upsertDailyInsights: mock(async (items: UpsertInsightDailyParams[]): Promise<number> => {
                capturedInsights = items;
                return items.length;
            }),
            upsertBreakdowns: mock(async (items: BreakdownInsert[]): Promise<number> => {
                capturedBreakdowns = items;
                return items.length;
            }),
        } as unknown as AdInsightRepository;

        const mockAdapter: IMetaAdsAdapter = {
            getAdAccounts: mock(async () => []),
            getCampaigns: mock(async () => []),
            getAdSets: mock(async () => []),
            getAdCreatives: mock(async () => []),
            getAds: mock(async () => []),
            getVideoDetails: mock(async () => null),
            getDailyAdInsights: mock(async (_token, _acc, options) => [
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
            mockAdInsightRepo
        );

        const result = await metaService.syncInsights(
            {iss: "user-1", tenantId: "tenant-1"},
            {since: "2026-11-01", until: "2026-11-20", includeBreakdowns: true}
        );

        expect(syncRunStarted).toBe(true);
        expect(syncRunFinished).toBe(true);
        expect(result.accountId).toBe("act_test_insights");
        expect(result.counts.dailyInsights).toBe(1);
        expect(result.counts.breakdowns).toBe(1);
        expect(result.counts.total).toBe(2);
        expect(totalRowsRecorded).toBe(2);

        expect(capturedInsights.length).toBe(1);
        expect(capturedInsights[0].insight.spendMinor).toBe(15000000);
        expect(capturedInsights[0].insight.videoThruplayWatchedActions).toBe(8500);
        expect(capturedInsights[0].actions[0].actionType).toBe("onsite_conversion.messaging_conversation_started_7d");
        expect(capturedInsights[0].actions[0].count).toBe("35");

        expect(capturedBreakdowns.length).toBe(1);
        expect(capturedBreakdowns[0].publisherPlatform).toBe("instagram");
        expect(capturedBreakdowns[0].breakdownHash).toBe("hash123");
    });
});
