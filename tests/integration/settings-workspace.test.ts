import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {UserRepository} from "@db/repositories/user.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {MetaConnectionEntity} from "@db/schema/ads/meta-connection.entity";
import {SyncRunEntity} from "@db/schema/ads/sync-run.entity";
import {WaSessionEntity} from "@db/schema/wa/wa-session.entity";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";
import {JwtUtil} from "@shared/jwt";
import {eq} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

interface SettingsBody {
    workspace: {
        id: string;
        name: string;
        address: string | null;
        timezone: string | null;
        currency: string | null;
        currencyOffset: number | null;
    };
    mode: {readOnly: boolean; reason: string};
    sources: {
        key: string;
        label: string;
        status: string;
        lastSyncAt: string | null;
        lastError: string | null;
        detailRoute: string;
    }[];
    limits: {
        maxComparisonCreatives: number;
        maxSearchResults: number;
        defaultPageSize: number;
        periodDays: number[];
    };
    exportAuditEnabled: boolean;
}

interface Workspace {
    tenantId: string;
    userId: string;
    token: {key: string};
}

describe("Settings workspace", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();

    const u = Date.now().toString();
    const tenantIds: string[] = [];

    const call = async (token: {key: string}): Promise<SettingsBody> => {
        const response = await app.handle(new Request("http://localhost/api/settings", {
            headers: {authorization: `Bearer ${token.key}`},
        }));
        expect(response.status).toBe(200);
        return await response.json() as SettingsBody;
    };

    const source = (body: SettingsBody, key: "meta" | "whatsapp") => {
        const found = body.sources.find((entry) => entry.key === key);
        if (found === undefined) throw new Error(`${key} source missing`);
        return found;
    };

    /** Tenant + ADMIN user + bearer token, the three rows every settings call needs. */
    const createWorkspace = async (suffix: string, address: string | null = null): Promise<Workspace> => {
        const tenant = await tenantRepo.create({name: `settings-${suffix}-${u}`, address});
        tenantIds.push(tenant.id);
        const user = await userRepo.create({
            fullName: `Owner ${suffix}`,
            email: `settings-${suffix}-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId: tenant.id,
        });
        const token = await new JwtUtil().register({id: user.id, tenant: tenant.id, role: "ADMIN"});

        return {tenantId: tenant.id, userId: user.id, token};
    };

    const createAccount = async (tenantId: string, id: string, objectiveGroup: "wa" | "web") => {
        await db.insert(AdAccountEntity).values({
            id,
            tenantId,
            name: `Settings Account ${id}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
            isSelected: true,
        });
        await db.insert(CampaignEntity).values({id: `camp_${id}`, accountId: id, name: `Campaign ${id}`});
        await db.insert(AdSetEntity).values({
            id: `adset_${id}`,
            accountId: id,
            campaignId: `camp_${id}`,
            name: `AdSet ${id}`,
            objectiveGroup,
        });
    };

    let healthy: Workspace;
    let bare: Workspace;
    let webOnly: Workspace;
    let broken: Workspace;

    const healthyAccountId = `act_settings_${u}`;

    beforeAll(async () => {
        healthy = await createWorkspace("healthy", "Jl. Sudirman 1");
        await createAccount(healthy.tenantId, healthyAccountId, "wa");
        await db.insert(MetaConnectionEntity).values({
            userId: healthy.userId,
            tenantId: healthy.tenantId,
            metaUserId: `meta_${u}`,
            accessToken: "token",
            scopes: ["ads_read"],
            expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        });
        await db.insert(SyncRunEntity).values([
            {
                accountId: healthyAccountId,
                resource: "insights",
                status: "SUCCESS",
                startedAt: new Date("2026-11-19T01:00:00.000Z"),
                finishedAt: new Date("2026-11-19T01:05:00.000Z"),
            },
            // Older than the success above: history, not a current error.
            {
                accountId: healthyAccountId,
                resource: "insights",
                status: "FAILED",
                startedAt: new Date("2026-11-18T01:00:00.000Z"),
                finishedAt: new Date("2026-11-18T01:05:00.000Z"),
                error: "Rate limit",
            },
        ]);
        await db.insert(WaSessionEntity).values({
            id: crypto.randomUUID(),
            tenantId: healthy.tenantId,
            name: `Session ${u}`,
            status: "ready",
        });
        const [lead] = await db.insert(LeadEntity).values({
            accountId: healthyAccountId,
            name: "Lead Settings",
            stage: "CHAT_STARTED",
        }).returning();
        await db.insert(ConversationMessageEntity).values({
            leadId: lead.id,
            direction: "INBOUND",
            sentAt: new Date("2026-11-19T02:00:00.000Z"),
        });

        bare = await createWorkspace("bare");

        webOnly = await createWorkspace("web");
        const webAccountId = `act_settings_web_${u}`;
        await createAccount(webOnly.tenantId, webAccountId, "web");
        await db.insert(WaSessionEntity).values({
            id: crypto.randomUUID(),
            tenantId: webOnly.tenantId,
            name: `Web Session ${u}`,
            status: "ready",
        });

        broken = await createWorkspace("broken");
        const brokenAccountId = `act_settings_broken_${u}`;
        await createAccount(broken.tenantId, brokenAccountId, "wa");
        await db.insert(MetaConnectionEntity).values({
            userId: broken.userId,
            tenantId: broken.tenantId,
            metaUserId: `meta_broken_${u}`,
            accessToken: "token",
            scopes: ["ads_read"],
            expiresAt: new Date("2026-01-01T00:00:00.000Z"),
        });
        await db.insert(SyncRunEntity).values([
            {
                accountId: brokenAccountId,
                resource: "insights",
                status: "SUCCESS",
                startedAt: new Date("2026-11-19T01:00:00.000Z"),
                finishedAt: new Date("2026-11-19T01:05:00.000Z"),
            },
            // Newer than the success: this is the failure the client must surface.
            {
                accountId: brokenAccountId,
                resource: "insights",
                status: "FAILED",
                startedAt: new Date("2026-11-20T01:00:00.000Z"),
                finishedAt: new Date("2026-11-20T01:05:00.000Z"),
                error: "Token tidak valid",
            },
        ]);
    });

    afterAll(async () => {
        for (const tenantId of tenantIds) await cleanupRepo.cleanup(tenantId);
    });

    it("reports both sources connected with the newest stored evidence of a run", async () => {
        const body = await call(healthy.token);

        const meta = source(body, "meta");
        expect(meta.status).toBe("connected");
        expect(meta.lastSyncAt).toBe("2026-11-19T01:05:00.000Z");
        // The failure finished before the success, so it no longer describes the source.
        expect(meta.lastError).toBeNull();
        expect(meta.detailRoute).toBe("/api/meta/connection");

        const whatsapp = source(body, "whatsapp");
        expect(whatsapp.status).toBe("connected");
        expect(whatsapp.lastSyncAt).toBe("2026-11-19T02:00:00.000Z");
        expect(whatsapp.lastError).toBeNull();
        expect(whatsapp.detailRoute).toBe("/api/wa/session");
    });

    it("describes the workspace from the tenant and its selected account", async () => {
        const body = await call(healthy.token);

        expect(body.workspace).toEqual({
            id: healthy.tenantId,
            name: `settings-healthy-${u}`,
            address: "Jl. Sudirman 1",
            timezone: "Asia/Jakarta",
            currency: "IDR",
            currencyOffset: 100,
        });
        expect(body.mode).toEqual({readOnly: true, reason: "analytics-only"});
        expect(body.exportAuditEnabled).toBe(true);
    });

    it("publishes the limits the rest of the API enforces", async () => {
        const body = await call(healthy.token);

        expect(body.limits).toEqual({
            maxComparisonCreatives: 5,
            maxSearchResults: 8,
            defaultPageSize: 10,
            periodDays: [7, 14, 30],
        });
    });

    it("returns a disconnected Meta source and null timezone for a workspace with nothing set up", async () => {
        const body = await call(bare.token);

        expect(body.workspace.id).toBe(bare.tenantId);
        // No selected account: null, not a guessed default timezone.
        expect(body.workspace.timezone).toBeNull();
        expect(body.workspace.currency).toBeNull();
        expect(body.workspace.currencyOffset).toBeNull();

        const meta = source(body, "meta");
        expect(meta.status).toBe("disconnected");
        expect(meta.lastSyncAt).toBeNull();
        expect(meta.lastError).toBeNull();

        expect(source(body, "whatsapp").status).toBe("disconnected");
    });

    it("marks WhatsApp out of scope when every ad set targets the website", async () => {
        const body = await call(webOnly.token);

        // A ready session is not enough: the tenant has no WhatsApp funnel to report on.
        expect(source(body, "whatsapp").status).toBe("out_of_scope");
        expect(body.workspace.timezone).toBe("Asia/Jakarta");
    });

    it("reports an expired token and the failure that a later success never cleared", async () => {
        const body = await call(broken.token);

        const meta = source(body, "meta");
        expect(meta.status).toBe("expired");
        expect(meta.lastSyncAt).toBe("2026-11-19T01:05:00.000Z");
        expect(meta.lastError).toBe("Token tidak valid");
    });
});
