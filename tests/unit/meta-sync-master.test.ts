import {describe, expect, it, mock} from "bun:test";
import {MetaService, type MetaRequester} from "@/modules/meta/service";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {CampaignRepository} from "@db/repositories/campaign.repository";
import {AdSetRepository} from "@db/repositories/ad-set.repository";
import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {AdRepository} from "@db/repositories/ad.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {BadRequestError} from "@shared/errors";
import type {IMetaAdsAdapter} from "@infra/meta/base.meta";
import type {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import type {MetaConnectionEntity} from "@db/schema/ads/meta-connection.entity";
import type {CampaignEntity} from "@db/schema/ads/campaign.entity";
import type {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import type {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import type {AdEntity} from "@db/schema/ads/ad.entity";
import type {SyncRunEntity} from "@db/schema/ads/sync-run.entity";

type AdAccountSelect = typeof AdAccountEntity.$inferSelect;
type MetaConnectionSelect = typeof MetaConnectionEntity.$inferSelect;
type CampaignInsert = typeof CampaignEntity.$inferInsert;
type AdSetInsert = typeof AdSetEntity.$inferInsert;
type AdCreativeInsert = typeof AdCreativeEntity.$inferInsert;
type AdEntityInsert = typeof AdEntity.$inferInsert;
type SyncRunSelect = typeof SyncRunEntity.$inferSelect;

interface PagedItem {
    id: string;
}

describe("Meta Master Metadata Sync (fetchAll)", () => {
    it("fetchAll traverses cursor pagination correctly across multiple pages", async () => {
        let callCount = 0;
        const mockRequester: MetaRequester = async <T>(): Promise<T> => {
            callCount++;
            if (callCount === 1) {
                return {
                    data: [{id: "item_1"}, {id: "item_2"}],
                    paging: {
                        next: "https://graph.facebook.com/v21.0/act_123/campaigns?access_token=token&after=cursor_1",
                    },
                } as T;
            }
            if (callCount === 2) {
                return {
                    data: [{id: "item_3"}],
                    paging: {
                        next: "https://graph.facebook.com/v21.0/act_123/campaigns?access_token=token&after=cursor_2",
                    },
                } as T;
            }
            return {
                data: [{id: "item_4"}],
                paging: {},
            } as T;
        };

        const metaService = new MetaService(
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            mockRequester
        );

        const results = await metaService.fetchAll<PagedItem>("/act_123/campaigns", {}, "token");

        expect(results.length).toBe(4);
        expect(results.map((r) => r.id)).toEqual(["item_1", "item_2", "item_3", "item_4"]);
        expect(callCount).toBe(3);
    });

    it("syncMaster throws BadRequestError when no account in database", async () => {
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

        const mockConnRepo = {
            findByUserId: mock(async (): Promise<MetaConnectionSelect | null> => validConnection),
        } as unknown as MetaConnectionRepository;

        const mockAdAccountRepo = {
            findSelectedByTenantId: mock(async (): Promise<AdAccountSelect | null> => null),
            findByTenantId: mock(async (): Promise<AdAccountSelect[]> => []),
        } as unknown as AdAccountRepository;

        const metaService = new MetaService(
            mockConnRepo,
            mockAdAccountRepo
        );

        expect(
            metaService.syncMaster({iss: "user-1", tenantId: "tenant-1"}, {})
        ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("syncMaster automatically takes selected account from database when no body provided", async () => {
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

        const selectedAccount: AdAccountSelect = {
            id: "act_db_selected",
            tenantId: "tenant-1",
            name: "Selected Account",
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
            findSelectedByTenantId: mock(async (): Promise<AdAccountSelect | null> => selectedAccount),
        } as unknown as AdAccountRepository;

        const mockSyncRunRepo = {
            start: mock(async (accountId: string, resource: string): Promise<SyncRunSelect> => ({
                id: 1,
                accountId,
                resource,
                startedAt: new Date(),
                finishedAt: null,
                status: "RUNNING",
                rowsUpserted: null,
                error: null,
            })),
            finish: mock(async (): Promise<void> => {}),
        } as unknown as SyncRunRepository;

        const mockCampaignRepo = {
            upsertBatch: mock(async (): Promise<void> => {}),
        } as unknown as CampaignRepository;

        const mockAdSetRepo = {
            upsertBatch: mock(async (): Promise<void> => {}),
        } as unknown as AdSetRepository;

        const mockAdCreativeRepo = {
            upsertBatch: mock(async (): Promise<void> => {}),
        } as unknown as AdCreativeRepository;

        const mockAdRepo = {
            upsertBatch: mock(async (): Promise<void> => {}),
        } as unknown as AdRepository;

        const mockRequester: MetaRequester = async <T>(): Promise<T> => {
            return {data: []} as T;
        };

        const metaService = new MetaService(
            mockConnRepo,
            mockAdAccountRepo,
            mockCampaignRepo,
            mockAdSetRepo,
            mockAdCreativeRepo,
            mockAdRepo,
            mockSyncRunRepo,
            mockRequester
        );

        const result = await metaService.syncMaster({iss: "user-1", tenantId: "tenant-1"});

        expect(result.accountId).toBe("act_db_selected");
    });

    it("syncMaster successfully synchronizes campaigns, adsets, creatives, and ads", async () => {
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

        const targetAccount: AdAccountSelect = {
            id: "act_123456",
            tenantId: "tenant-1",
            name: "Target Ad Account",
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
            accountStatus: 1,
            businessId: "biz_1",
            isSelected: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const mockConnRepo = {
            findByUserId: mock(async (): Promise<MetaConnectionSelect | null> => validConnection),
        } as unknown as MetaConnectionRepository;

        const mockAdAccountRepo = {
            findById: mock(async (): Promise<AdAccountSelect | null> => targetAccount),
        } as unknown as AdAccountRepository;

        let syncRunStarted = false;
        let syncRunFinished = false;
        let rowsCount = 0;

        const mockSyncRunRepo = {
            start: mock(async (accountId: string, resource: string): Promise<SyncRunSelect> => {
                syncRunStarted = true;
                return {
                    id: 1,
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
                rowsCount = rows;
            }),
            fail: mock(async (): Promise<void> => {}),
        } as unknown as SyncRunRepository;

        const mockRequester: MetaRequester = async <T>(path: string): Promise<T> => {
            if (path.includes("/campaigns")) {
                return {
                    data: [
                        {
                            id: "camp_1",
                            name: "Summer Sale Campaign",
                            objective: "OUTCOME_SALES",
                            daily_budget: "10000000",
                            status: "ACTIVE",
                            effective_status: "ACTIVE",
                        },
                    ],
                } as T;
            }
            if (path.includes("/adsets")) {
                return {
                    data: [
                        {
                            id: "adset_1",
                            campaign_id: "camp_1",
                            name: "Audience 18-35",
                            daily_budget: "5000000",
                            targeting: {age_min: 18, age_max: 35},
                        },
                    ],
                } as T;
            }
            if (path.includes("/adcreatives")) {
                return {
                    data: [
                        {
                            id: "creative_1",
                            name: "Promo Video 1",
                            video_id: "vid_101",
                            title: "Diskon 50%",
                            call_to_action_type: "SHOP_NOW",
                        },
                    ],
                } as T;
            }
            if (path.includes("/ads")) {
                return {
                    data: [
                        {
                            id: "ad_1",
                            name: "Ad Variant A",
                            campaign_id: "camp_1",
                            adset_id: "adset_1",
                            creative: {id: "creative_1"},
                            status: "ACTIVE",
                        },
                    ],
                } as T;
            }
            if (path.includes("/vid_101")) {
                return {
                    id: "vid_101",
                    length: 30.5,
                    permalink_url: "https://fb.com/video/101",
                } as T;
            }
            return {data: []} as T;
        };

        let savedCampaigns: CampaignInsert[] = [];
        let savedAdSets: AdSetInsert[] = [];
        let savedCreatives: AdCreativeInsert[] = [];
        let savedAds: AdEntityInsert[] = [];

        const mockCampaignRepo = {
            upsertBatch: mock(async (c: CampaignInsert[]): Promise<void> => {
                savedCampaigns = c;
            }),
        } as unknown as CampaignRepository;

        const mockAdSetRepo = {
            upsertBatch: mock(async (s: AdSetInsert[]): Promise<void> => {
                savedAdSets = s;
            }),
        } as unknown as AdSetRepository;

        const mockAdCreativeRepo = {
            upsertBatch: mock(async (cr: AdCreativeInsert[]): Promise<void> => {
                savedCreatives = cr;
            }),
        } as unknown as AdCreativeRepository;

        const mockAdRepo = {
            upsertBatch: mock(async (a: AdEntityInsert[]): Promise<void> => {
                savedAds = a;
            }),
        } as unknown as AdRepository;

        const metaService = new MetaService(
            mockConnRepo,
            mockAdAccountRepo,
            mockCampaignRepo,
            mockAdSetRepo,
            mockAdCreativeRepo,
            mockAdRepo,
            mockSyncRunRepo,
            mockRequester
        );

        const result = await metaService.syncMaster(
            {iss: "user-1", tenantId: "tenant-1"},
            {accountId: "123456"}
        );

        expect(syncRunStarted).toBe(true);
        expect(syncRunFinished).toBe(true);
        expect(rowsCount).toBe(4);
        expect(result.accountId).toBe("act_123456");
        expect(result.counts.campaigns).toBe(1);
        expect(result.counts.adSets).toBe(1);
        expect(result.counts.creatives).toBe(1);
        expect(result.counts.ads).toBe(1);

        expect(savedCampaigns[0].dailyBudgetMinor).toBe(10000000);
        expect(savedCreatives[0].videoLengthSeconds).toBe("30.5");
        expect(savedCreatives[0].videoPermalinkUrl).toBe("https://fb.com/video/101");
        expect(savedAds[0].creativeId).toBe("creative_1");
    });

    it("syncMaster executes successfully using IMetaAdsAdapter directly", async () => {
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

        const existingAccount: AdAccountSelect = {
            id: "act_adapter_test",
            tenantId: "tenant-1",
            name: "Adapter Account",
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
            findById: mock(async (): Promise<AdAccountSelect | null> => existingAccount),
            findSelectedByTenantId: mock(async (): Promise<AdAccountSelect | null> => existingAccount),
        } as unknown as AdAccountRepository;

        let syncRunFinished = false;
        let rowsCount = 0;
        const mockSyncRunRepo = {
            start: mock(async (accountId: string, resource: string): Promise<SyncRunSelect> => ({
                id: 2,
                accountId,
                resource,
                startedAt: new Date(),
                finishedAt: null,
                status: "RUNNING",
                rowsUpserted: null,
                error: null,
            })),
            finish: mock(async (_id: number, rows: number): Promise<void> => {
                syncRunFinished = true;
                rowsCount = rows;
            }),
            fail: mock(async (): Promise<void> => {}),
        } as unknown as SyncRunRepository;

        const mockCampaignRepo = {
            upsertBatch: mock(async (): Promise<void> => {}),
        } as unknown as CampaignRepository;
        const mockAdSetRepo = {
            upsertBatch: mock(async (): Promise<void> => {}),
        } as unknown as AdSetRepository;
        const mockAdCreativeRepo = {
            upsertBatch: mock(async (): Promise<void> => {}),
        } as unknown as AdCreativeRepository;
        const mockAdRepo = {
            upsertBatch: mock(async (): Promise<void> => {}),
        } as unknown as AdRepository;

        const mockAdapter: IMetaAdsAdapter = {
            getAdAccounts: mock(async () => []),
            getCampaigns: mock(async () => [
                {
                    id: "camp_sdk_1",
                    name: "SDK Campaign",
                    objective: "OUTCOME_SALES",
                    status: "ACTIVE",
                    effectiveStatus: "ACTIVE",
                    buyingType: "AUCTION",
                    dailyBudgetMinor: 5000000,
                    lifetimeBudgetMinor: null,
                    budgetRemainingMinor: null,
                    startTime: null,
                    stopTime: null,
                    createdTime: null,
                    updatedTime: null,
                    raw: {},
                },
            ]),
            getAdSets: mock(async () => [
                {
                    id: "adset_sdk_1",
                    name: "SDK AdSet",
                    campaignId: "camp_sdk_1",
                    status: "ACTIVE",
                    effectiveStatus: "ACTIVE",
                    optimizationGoal: "OFFSITE_CONVERSIONS",
                    billingEvent: "IMPRESSIONS",
                    bidStrategy: "LOWEST_COST_WITHOUT_CAP",
                    bidAmountMinor: null,
                    dailyBudgetMinor: 2000000,
                    lifetimeBudgetMinor: null,
                    targeting: {},
                    startTime: null,
                    endTime: null,
                    createdTime: null,
                    updatedTime: null,
                    raw: {},
                },
            ]),
            getAdCreatives: mock(async () => [
                {
                    id: "cr_sdk_1",
                    name: "SDK Creative",
                    objectType: "VIDEO",
                    status: "ACTIVE",
                    videoId: "vid_sdk_1",
                    videoLengthSeconds: null,
                    videoPermalinkUrl: null,
                    imageUrl: null,
                    thumbnailUrl: null,
                    objectStoryId: null,
                    body: "SDK Body",
                    title: "SDK Title",
                    callToActionType: "LEARN_MORE",
                    urlTags: null,
                    createdTime: null,
                    updatedTime: null,
                    raw: {},
                },
            ]),
            getAds: mock(async () => [
                {
                    id: "ad_sdk_1",
                    name: "SDK Ad",
                    campaignId: "camp_sdk_1",
                    adsetId: "adset_sdk_1",
                    creativeId: "cr_sdk_1",
                    status: "ACTIVE",
                    effectiveStatus: "ACTIVE",
                    createdTime: null,
                    updatedTime: null,
                    raw: {},
                },
            ]),
            getVideoDetails: mock(async () => ({
                id: "vid_sdk_1",
                length: 45.2,
                permalinkUrl: "https://fb.com/video/sdk1",
            })),
            getDailyAdInsights: mock(async () => []),
            getDailyAdBreakdowns: mock(async () => []),
            getCustomPeriodMetrics: mock(async () => null),
        };

        const metaService = new MetaService(
            mockConnRepo,
            mockAdAccountRepo,
            mockCampaignRepo,
            mockAdSetRepo,
            mockAdCreativeRepo,
            mockAdRepo,
            mockSyncRunRepo,
            undefined, // no customRequest, invoke metaAdapter
            mockAdapter
        );

        const result = await metaService.syncMaster(
            {iss: "user-1", tenantId: "tenant-1"},
            {accountId: "act_adapter_test"}
        );

        expect(syncRunFinished).toBe(true);
        expect(rowsCount).toBe(4);
        expect(result.counts.campaigns).toBe(1);
        expect(result.counts.adSets).toBe(1);
        expect(result.counts.creatives).toBe(1);
        expect(result.counts.ads).toBe(1);
    });
});
