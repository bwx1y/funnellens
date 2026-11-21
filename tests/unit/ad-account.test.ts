import {describe, expect, it, mock} from "bun:test";
import {MetaService, type MetaRequester} from "@/modules/meta/service";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {CampaignRepository} from "@db/repositories/campaign.repository";
import {AdSetRepository} from "@db/repositories/ad-set.repository";
import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {AdRepository} from "@db/repositories/ad.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {NotFoundError, UnauthorizedError} from "@shared/errors";
import type {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import type {MetaConnectionEntity} from "@db/schema/ads/meta-connection.entity";

type AdAccountSelect = typeof AdAccountEntity.$inferSelect;
type AdAccountInsert = typeof AdAccountEntity.$inferInsert;
type MetaConnectionSelect = typeof MetaConnectionEntity.$inferSelect;

describe("Ad Account Management", () => {
    it("authorizationUrl generates valid OAuth URL without business_management", async () => {
        const metaService = new MetaService();
        const result = await metaService.authorizationUrl({iss: "user-1", tenantId: "tenant-1"});

        expect(result.url).toContain("dialog/oauth");
        expect(result.url).toContain("client_id=");
        expect(result.url).toContain("scope=ads_read");
        expect(result.url).not.toContain("business_management");
    });

    it("listAccounts throws UnauthorizedError if Meta connection does not exist", async () => {
        const mockConnRepo = {
            findByUserId: mock(async (): Promise<MetaConnectionSelect | null> => null),
        } as unknown as MetaConnectionRepository;

        const metaService = new MetaService(mockConnRepo);

        expect(
            metaService.listAccounts({iss: "user-1", tenantId: "tenant-1"})
        ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("listAccounts throws UnauthorizedError if Meta token is expired", async () => {
        const expiredConnection: MetaConnectionSelect = {
            id: "conn-1",
            userId: "user-1",
            tenantId: "tenant-1",
            metaUserId: "meta-123",
            metaUserName: "Meta User",
            accessToken: "expired-token",
            scopes: ["ads_read"],
            expiresAt: new Date(Date.now() - 10000),
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const mockConnRepo = {
            findByUserId: mock(async (): Promise<MetaConnectionSelect | null> => expiredConnection),
        } as unknown as MetaConnectionRepository;

        const metaService = new MetaService(mockConnRepo);

        expect(
            metaService.listAccounts({iss: "user-1", tenantId: "tenant-1"})
        ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("listAccounts fetches from Meta Graph API and upserts into database", async () => {
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

        let upsertedRows: AdAccountInsert[] = [];
        const mockAdAccountRepo = {
            upsertBatch: mock(async (rows: AdAccountInsert[]): Promise<AdAccountSelect[]> => {
                upsertedRows = rows;
                return rows.map((r) => ({
                    id: r.id,
                    tenantId: r.tenantId,
                    name: r.name,
                    currency: r.currency,
                    currencyOffset: r.currencyOffset ?? 100,
                    timezoneName: r.timezoneName,
                    accountStatus: r.accountStatus ?? null,
                    businessId: r.businessId ?? null,
                    isSelected: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }));
            }),
            findByTenantId: mock(async (): Promise<AdAccountSelect[]> => {
                return upsertedRows.map((r) => ({
                    id: r.id,
                    tenantId: r.tenantId,
                    name: r.name,
                    currency: r.currency,
                    currencyOffset: r.currencyOffset ?? 100,
                    timezoneName: r.timezoneName,
                    accountStatus: r.accountStatus ?? null,
                    businessId: r.businessId ?? null,
                    isSelected: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }));
            }),
        } as unknown as AdAccountRepository;

        const mockRequester: MetaRequester = async <T>(): Promise<T> => {
            return {
                data: [
                    {
                        id: "act_101",
                        name: "Primary Ad Account",
                        currency: "IDR",
                        timezone_name: "Asia/Jakarta",
                        account_status: 1,
                        business: {id: "biz_1", name: "My Business"},
                        currency_offset: 100,
                    },
                    {
                        id: "202",
                        name: "Secondary Ad Account",
                        currency: "USD",
                        timezone_name: "America/New_York",
                        account_status: 1,
                        currency_offset: 100,
                    },
                ],
            } as T;
        };

        const metaService = new MetaService(
            mockConnRepo,
            mockAdAccountRepo,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            mockRequester
        );

        const result = await metaService.listAccounts({iss: "user-1", tenantId: "tenant-1"});

        expect(result.length).toBe(2);
        expect(upsertedRows.length).toBe(2);
        expect(upsertedRows[0].id).toBe("act_101");
        expect(upsertedRows[0].tenantId).toBe("tenant-1");
        expect(upsertedRows[0].name).toBe("Primary Ad Account");
        expect(upsertedRows[1].id).toBe("act_202");
    });

    it("listAccounts falls back without business field if Meta rejects business_management permission", async () => {
        const connectionWithBusinessScope: MetaConnectionSelect = {
            id: "conn-1",
            userId: "user-1",
            tenantId: "tenant-1",
            metaUserId: "meta-123",
            metaUserName: "Meta User",
            accessToken: "valid-token",
            scopes: ["ads_read", "business_management"],
            expiresAt: new Date(Date.now() + 100000),
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const mockConnRepo = {
            findByUserId: mock(async (): Promise<MetaConnectionSelect | null> => connectionWithBusinessScope),
        } as unknown as MetaConnectionRepository;

        const mockAdAccountRepo = {
            upsertBatch: mock(async (rows: AdAccountInsert[]): Promise<AdAccountSelect[]> => {
                return rows.map((r) => ({
                    id: r.id,
                    tenantId: r.tenantId,
                    name: r.name,
                    currency: r.currency,
                    currencyOffset: r.currencyOffset ?? 100,
                    timezoneName: r.timezoneName,
                    accountStatus: r.accountStatus ?? null,
                    businessId: null,
                    isSelected: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }));
            }),
            findByTenantId: mock(async (): Promise<AdAccountSelect[]> => [
                {
                    id: "act_101",
                    tenantId: "tenant-1",
                    name: "Fallback Account",
                    currency: "IDR",
                    currencyOffset: 100,
                    timezoneName: "Asia/Jakarta",
                    accountStatus: 1,
                    businessId: null,
                    isSelected: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]),
        } as unknown as AdAccountRepository;

        let requestedFields: string[] = [];
        const mockRequester: MetaRequester = async <T>(_path: string, params: Record<string, string | undefined>): Promise<T> => {
            const fields = params.fields ?? "";
            requestedFields.push(fields);

            if (fields.includes("business")) {
                throw new Error("Meta API error: (#100) Requires business_management permission to access the field.");
            }

            return {
                data: [
                    {
                        id: "act_101",
                        name: "Fallback Account",
                        currency: "IDR",
                        timezone_name: "Asia/Jakarta",
                        account_status: 1,
                        currency_offset: 100,
                    },
                ],
            } as T;
        };

        const metaService = new MetaService(
            mockConnRepo,
            mockAdAccountRepo,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            mockRequester
        );

        const result = await metaService.listAccounts({iss: "user-1", tenantId: "tenant-1"});

        expect(result.length).toBe(1);
        expect(result[0].name).toBe("Fallback Account");
        expect(requestedFields.length).toBe(2);
        expect(requestedFields[0]).toContain("business");
        expect(requestedFields[1]).not.toContain("business");
    });

    it("selectAccount throws NotFoundError if account does not exist in workspace", async () => {
        const mockAdAccountRepo = {
            findById: mock(async (): Promise<AdAccountSelect | null> => null),
        } as unknown as AdAccountRepository;

        const metaService = new MetaService(
            undefined,
            mockAdAccountRepo
        );

        expect(
            metaService.selectAccount({iss: "user-1", tenantId: "tenant-1"}, {accountId: "act_nonexistent"})
        ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("selectAccount successfully selects account and normalizes ID", async () => {
        const existingAccount: AdAccountSelect = {
            id: "act_101",
            tenantId: "tenant-1",
            name: "Primary Ad Account",
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
            accountStatus: 1,
            businessId: "biz_1",
            isSelected: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const mockAdAccountRepo = {
            findById: mock(async (id: string, tenantId?: string): Promise<AdAccountSelect | null> => {
                if (id === "act_101" && tenantId === "tenant-1") {
                    return existingAccount;
                }
                return null;
            }),
            selectAccount: mock(async (tenantId: string, accountId: string): Promise<AdAccountSelect | null> => {
                return {
                    ...existingAccount,
                    id: accountId,
                    tenantId,
                    isSelected: true,
                };
            }),
        } as unknown as AdAccountRepository;

        const metaService = new MetaService(
            undefined,
            mockAdAccountRepo
        );

        const result = await metaService.selectAccount(
            {iss: "user-1", tenantId: "tenant-1"},
            {accountId: "101"}
        );

        expect(result.message).toBe("Ad account selected successfully");
        expect(result.account?.id).toBe("act_101");
        expect(result.account?.isSelected).toBe(true);
    });
});
