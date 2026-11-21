import {describe, expect, it, mock} from "bun:test";
import {MetaService} from "@/modules/meta/service";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {MetaSyncWorkerProcessor} from "@/modules/meta/worker";
import type {IMetaAdsAdapter} from "@infra/meta/base.meta";
import type {MetaConnectionEntity} from "@db/schema/ads/meta-connection.entity";
import type {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import type {Job} from "@infra/queue";
import type {MetaSyncJobData, MetaSyncJobName} from "@/modules/meta/queue";

type MetaConnectionSelect = typeof MetaConnectionEntity.$inferSelect;
type AdAccountSelect = typeof AdAccountEntity.$inferSelect;

describe("Custom Period Non-Additive Metrics", () => {
    it("getNonAdditiveMetrics fetches reach and frequency from Meta adapter", async () => {
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
            id: "act_na_test",
            tenantId: "tenant-1",
            name: "Non Additive Account",
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
            getCustomPeriodMetrics: mock(async () => ({
                accountId: "act_na_test",
                level: "account" as const,
                entityId: "act_na_test",
                since: "2026-11-01",
                until: "2026-11-20",
                reach: 45000,
                frequency: "1.85",
                impressions: 83250,
                spendMinor: 50000000,
                clicks: 2100,
                raw: {},
            })),
        };

        const metaService = new MetaService(
            mockConnRepo,
            mockAdAccountRepo,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            mockAdapter
        );

        const result = await metaService.getNonAdditiveMetrics(
            {iss: "user-1", tenantId: "tenant-1"},
            {since: "2026-11-01", until: "2026-11-20", level: "account"}
        );

        expect(result.accountId).toBe("act_na_test");
        expect(result.reach).toBe(45000);
        expect(result.frequency).toBe("1.85");
        expect(result.spendMinor).toBe(50000000);
    });
});

describe("MetaSyncWorkerProcessor", () => {
    it("processes sync-daily job across active accounts", async () => {
        let syncedCalled = false;
        const mockMetaService = {
            syncInsights: mock(async () => {
                syncedCalled = true;
                return {};
            }),
        } as unknown as MetaService;

        const mockConnRepo = {
            findActiveConnections: mock(async () => [
                {
                    id: "conn-1",
                    userId: "user-1",
                    tenantId: "tenant-1",
                },
            ]),
        } as unknown as MetaConnectionRepository;

        const mockAdAccountRepo = {
            findSelectedByTenantId: mock(async () => ({
                id: "act_worker_test",
                tenantId: "tenant-1",
            })),
        } as unknown as AdAccountRepository;

        const processor = new MetaSyncWorkerProcessor(
            mockMetaService,
            mockConnRepo,
            mockAdAccountRepo
        );

        const mockJob = {
            id: "job-1",
            name: "sync-daily",
            data: {},
        } as unknown as Job<MetaSyncJobData, void, MetaSyncJobName>;

        await processor.process(mockJob);
        expect(syncedCalled).toBe(true);
    });

    it("processes sync-hourly-breakdowns job across active accounts", async () => {
        const calls: {userId: string; tenantId: string; accountId?: string; since?: string; until?: string}[] = [];
        const mockMetaService = {
            syncHourlyBreakdowns: mock(async (
                user: {iss: string; tenantId: string},
                body: {accountId?: string; since?: string; until?: string}
            ) => {
                calls.push({
                    userId: user.iss,
                    tenantId: user.tenantId,
                    accountId: body.accountId,
                    since: body.since,
                    until: body.until,
                });
                return {};
            }),
        } as unknown as MetaService;

        const mockConnRepo = {
            findActiveConnections: mock(async () => [
                {id: "conn-1", userId: "user-1", tenantId: "tenant-1"},
                {id: "conn-2", userId: "user-2", tenantId: "tenant-2"},
            ]),
        } as unknown as MetaConnectionRepository;

        const mockAdAccountRepo = {
            findSelectedByTenantId: mock(async (tenantId: string) => ({
                id: `act_${tenantId}`,
                tenantId,
            })),
        } as unknown as AdAccountRepository;

        const processor = new MetaSyncWorkerProcessor(
            mockMetaService,
            mockConnRepo,
            mockAdAccountRepo
        );

        const mockJob = {
            id: "job-2",
            name: "sync-hourly-breakdowns",
            data: {},
        } as unknown as Job<MetaSyncJobData, void, MetaSyncJobName>;

        await processor.process(mockJob);

        expect(calls.length).toBe(2);
        expect(calls[0].userId).toBe("user-1");
        expect(calls[0].accountId).toBe("act_tenant-1");
        expect(calls[1].userId).toBe("user-2");
        expect(calls[1].accountId).toBe("act_tenant-2");
        for (const call of calls) {
            expect(call.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(call.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });
});
