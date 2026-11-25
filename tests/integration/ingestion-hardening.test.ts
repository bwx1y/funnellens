import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {UserRepository} from "@db/repositories/user.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {SyncCursorRepository} from "@db/repositories/sync-cursor.repository";
import {ConversationMessageRepository} from "@db/repositories/conversation-message.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {SyncRunEntity} from "@db/schema/ads/sync-run.entity";
import {DeletionAuditEntity} from "@db/schema/ads/deletion-audit.entity";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {LeadAssessmentEntity} from "@db/schema/wa/lead-assessment.entity";
import {LeadMilestoneEntity} from "@db/schema/wa/lead-milestone.entity";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";
import {WaSessionEntity} from "@db/schema/wa/wa-session.entity";
import {JwtUtil} from "@shared/jwt";
import {encrypt, decrypt} from "@shared/crypto";
import {sourceStatusOf} from "@shared/sources";
import {AnalyticsService} from "@/modules/analytics/service";
import {MetaService} from "@/modules/meta/service";
import {MetaTokenRefreshService} from "@/modules/meta/token-refresh.service";
import {PurchaseReconciliationService} from "@/modules/reports/reconciliation.service";
import {CloudIngestService} from "@/modules/wa/cloud/service";
import {and, eq, sql} from "drizzle-orm";
import {readData, readError} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(DeletionAuditEntity).where(eq(DeletionAuditEntity.tenantId, tenantId));
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

describe("Ingestion hardening", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();
    const insightRepo = new AdInsightDailyRepository();
    const connectionRepo = new MetaConnectionRepository();
    const cursorRepo = new SyncCursorRepository();

    const u = Date.now().toString();
    const accountId = `act_hard_${u}`;

    let tenantId: string;
    let userId: string;
    let token: {key: string};

    const request = (path: string, init: RequestInit = {}, bearer: {key: string} = token) => app.handle(new Request(
        `http://localhost${path}`,
        {
            ...init,
            headers: {
                ...(init.headers as Record<string, string> | undefined),
                authorization: `Bearer ${bearer.key}`,
            },
        }
    ));

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `hardening-${u}`});
        tenantId = tenant.id;
        const user = await userRepo.create({
            fullName: "Hardening Admin",
            email: `hardening-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });
        userId = user.id;
        token = await new JwtUtil().register({id: userId, tenant: tenantId, role: "ADMIN"});

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Hardening Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
            isSelected: true,
        });
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("encrypts the Meta token at rest and hands back plaintext to the caller", async () => {
        await connectionRepo.upsert({
            userId,
            tenantId,
            metaUserId: `meta_${u}`,
            accessToken: "EAAB-plain-token",
            scopes: ["ads_read"],
            expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        });

        const [stored] = await db.execute(sql`
            select access_token from meta_connection where tenant_id = ${tenantId}::uuid
        `) as unknown as {access_token: string}[];

        expect(stored.access_token.startsWith("v1:")).toBe(true);
        expect(stored.access_token).not.toContain("EAAB-plain-token");

        const read = await connectionRepo.findByTenantId(tenantId);
        expect(read?.accessToken).toBe("EAAB-plain-token");

        // The API surface never returns the token at all.
        const response = await request("/api/meta/connection");
        const body = await readData<Record<string, unknown>>(response);
        expect(response.status).toBe(200);
        expect(JSON.stringify(body)).not.toContain("EAAB-plain-token");
        expect(JSON.stringify(body)).not.toContain("v1:");
    });

    it("refreshes a token that expires inside the seven-day window", async () => {
        const expiring = await userRepo.create({
            fullName: "Expiring",
            email: `hardening-expiring-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });
        await connectionRepo.upsert({
            userId: expiring.id,
            tenantId,
            metaUserId: `meta_expiring_${u}`,
            accessToken: "short-lived",
            scopes: ["ads_read"],
            expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        });

        const calls: {path: string; params: Record<string, string | undefined>}[] = [];
        const refresh = new MetaTokenRefreshService(connectionRepo, async (path, params) => {
            calls.push({path, params});
            return {access_token: "long-lived", expires_in: 60 * 24 * 60 * 60} as never;
        });

        const results = await refresh.refreshExpiring();
        const own = results.find((row) => row.tenantId === tenantId);

        expect(calls[0].path).toBe("/oauth/access_token");
        expect(calls[0].params.grant_type).toBe("fb_exchange_token");
        expect(calls[0].params.fb_exchange_token).toBe("short-lived");
        expect(own?.refreshed).toBe(true);

        const connection = await connectionRepo.findByUserId(expiring.id);
        expect(connection?.accessToken).toBe("long-lived");
        expect(connection?.tokenRefreshedAt).not.toBeNull();
        expect(connection?.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 50 * 24 * 60 * 60 * 1000);

        // The renewed token is stored encrypted too.
        const [stored] = await db.execute(sql`
            select access_token from meta_connection where meta_user_id = ${`meta_expiring_${u}`}
        `) as unknown as {access_token: string}[];
        expect(stored.access_token.startsWith("v1:")).toBe(true);
    });

    it("revokes the token at Meta before dropping the connection row", async () => {
        const revoker = await userRepo.create({
            fullName: "Revoker",
            email: `hardening-revoker-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });
        await connectionRepo.upsert({
            userId: revoker.id,
            tenantId,
            metaUserId: `meta_revoke_${u}`,
            accessToken: "to-revoke",
            scopes: ["ads_read"],
            expiresAt: null,
        });

        const calls: {path: string; init?: RequestInit}[] = [];
        const service = new MetaService(
            undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            async (path, _params, init) => {
                calls.push({path, init});
                return {} as never;
            }
        );

        const result = await service.disconnect(revoker.id);

        expect(result).toEqual({message: "Meta connection disconnected"});
        expect(calls[0].path).toBe(`/meta_revoke_${u}/permissions`);
        expect(calls[0].init?.method).toBe("DELETE");
        expect(await connectionRepo.findByUserId(revoker.id)).toBeNull();
    });

    it("round-trips the cipher and rejects a tampered payload", () => {
        const payload = encrypt("rahasia");

        expect(payload.startsWith("v1:")).toBe(true);
        expect(decrypt(payload)).toBe("rahasia");
        const [version, iv, tag, cipher] = payload.split(":");
        const flipped = Buffer.from(cipher, "base64");
        flipped[0] ^= 0xff;
        expect(() => decrypt([version, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
        expect(() => decrypt("bukan-cipher")).toThrow();
    });

    it("resumes an interrupted fetchAll from the stored cursor instead of page one", async () => {
        const seen: string[] = [];
        const pages: Record<string, unknown> = {
            "/first": {data: [{id: "1"}], paging: {next: "https://graph.facebook.com/v21.0/second?after=a"}},
            "/second": {data: [{id: "2"}], paging: {next: "https://graph.facebook.com/v21.0/third?after=b"}},
            "/third": {data: [{id: "3"}]},
        };

        const service = new MetaService(
            undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            async (path) => {
                seen.push(path);
                return pages[path] as never;
            }
        );

        // First walk dies after page two: the cursor holds the position for page three.
        await cursorRepo.save(accountId, "master-campaigns", JSON.stringify({
            next: "https://graph.facebook.com/v21.0/third?after=b",
            pages: 2,
        }));

        let skipped = 0;
        const rows = await service.fetchAll<{id: string}>("/first", {}, "token", {
            accountId,
            resource: "master-campaigns",
            onSkipped: (count) => {
                skipped = count;
            },
        });

        expect(seen).toEqual(["/third"]);
        expect(rows).toEqual([{id: "3"}]);
        expect(skipped).toBe(2);
        // A completed walk clears its cursor, so the next run is a full backfill again.
        expect(await cursorRepo.find(accountId, "master-campaigns")).toBeNull();
    });

    it("reports a connected-but-never-synced source as simulation, then connected", async () => {
        const before = await request("/api/sources");
        const beforeBody = await readData<{sources: {key: string; status: string; lastSyncAt: string | null}[]}>(before);
        const metaBefore = beforeBody.sources.find((source) => source.key === "meta");

        expect(before.status).toBe(200);
        expect(metaBefore?.status).toBe("simulation");
        expect(metaBefore?.lastSyncAt).toBeNull();

        await db.insert(SyncRunEntity).values({
            accountId,
            resource: "insights",
            status: "SUCCESS",
            startedAt: new Date(),
            finishedAt: new Date(),
        });

        const after = await request("/api/sources");
        const afterBody = await readData<{sources: {key: string; status: string; lastSyncAt: string | null}[]}>(after);
        const metaAfter = afterBody.sources.find((source) => source.key === "meta");

        expect(metaAfter?.status).toBe("connected");
        expect(metaAfter?.lastSyncAt).not.toBeNull();
    });

    it("uses one status vocabulary for sources and settings", async () => {
        expect(sourceStatusOf({configured: false})).toBe("disconnected");
        expect(sourceStatusOf({configured: true})).toBe("simulation");
        expect(sourceStatusOf({configured: true, synced: true})).toBe("connected");
        expect(sourceStatusOf({configured: true, expired: true, synced: true})).toBe("expired");
        expect(sourceStatusOf({configured: true, inScope: false})).toBe("out_of_scope");

        const settings = await request("/api/settings");
        const body = await readData<{sources: {key: string; status: string}[]}>(settings);
        const sources = await request("/api/sources");
        const sourcesBody = await readData<{sources: {key: string; status: string}[]}>(sources);

        expect(body.sources.map((source) => [source.key, source.status]))
            .toEqual(sourcesBody.sources.map((source) => [source.key, source.status]));
    });

    it("returns null for a web event Meta never reported", async () => {
        const [campaign] = await db.insert(CampaignEntity).values({
            id: `camp_web_${u}`,
            accountId,
            name: `Web Campaign ${u}`,
        }).returning();
        const [adset] = await db.insert(AdSetEntity).values({
            id: `adset_web_${u}`,
            accountId,
            campaignId: campaign.id,
            name: `Web AdSet ${u}`,
            objectiveGroup: "web",
        }).returning();
        const [creative] = await db.insert(AdCreativeEntity).values({
            id: `cr_web_${u}`,
            accountId,
            name: `Web Creative ${u}`,
        }).returning();
        const [ad] = await db.insert(AdEntity).values({
            id: `ad_web_${u}`,
            accountId,
            campaignId: campaign.id,
            adsetId: adset.id,
            creativeId: creative.id,
            name: `Web Ad ${u}`,
        }).returning();

        // `view_content` is reported, `add_to_cart` is not: exactly one stage must come back null.
        await insightRepo.upsertBatch([{
            accountId,
            level: "ad",
            entityId: ad.id,
            campaignId: campaign.id,
            adsetId: adset.id,
            adId: ad.id,
            date: "2026-11-15",
            currency: "IDR",
            currencyOffset: 100,
            spendMinor: 100000,
            impressions: 5000,
            clicks: 120,
            inlineLinkClicks: 100,
            actions: [{actionType: "view_content", count: "400", valueMinor: null, costPerActionMinor: null}],
        }]);

        const service = new AnalyticsService();
        const funnel = await service.getFunnel(tenantId, {
            accountId,
            objectiveGroup: "web",
            since: "2026-11-15",
            until: "2026-11-15",
        });

        const addToCart = funnel.stages.find((stage) => stage.key === "add_to_cart");
        expect(addToCart?.value).toBeNull();
        expect(addToCart?.share).toBeNull();
        expect(addToCart?.rateFromFirst).toBeNull();
        expect(addToCart?.note).toBe("Event add_to_cart tidak tersedia pada periode ini.");

        const pair = funnel.pairs.find((entry) => entry.to === "add_to_cart");
        expect(pair?.sample.eligible).toBe(false);
        expect(pair?.note).toBe("Event add_to_cart tidak tersedia pada periode ini.");

        // The reported stages are untouched.
        expect(funnel.stages.find((stage) => stage.key === "impressions")?.value).toBe(5000);

        const summary = await service.getSummary(tenantId, {
            accountId,
            since: "2026-11-15",
            until: "2026-11-15",
        });
        expect(summary.cards.roas.value).toBeNull();
        expect(summary.cards.roas.note).toBe("Event purchase tidak tersedia pada periode ini.");
    });

    it("reconciles recorded orders against Meta purchases and surfaces the gap", async () => {
        const service = new PurchaseReconciliationService();

        const recorded = await request(`/api/reports/recorded-orders?accountId=${accountId}`, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({date: "2026-11-15", orders: 100, revenueMinor: 5_000_000}),
        });
        expect(recorded.status).toBe(200);
        expect(await readData(recorded)).toEqual({date: "2026-11-15", orders: 100, revenueMinor: 5_000_000});

        // Meta attributed 92 purchases on that day: the gap is 8.
        const [ad] = await db.select().from(AdEntity).where(eq(AdEntity.id, `ad_web_${u}`));
        await insightRepo.upsertBatch([{
            accountId,
            level: "ad",
            entityId: ad.id,
            campaignId: ad.campaignId,
            adsetId: ad.adsetId,
            adId: ad.id,
            date: "2026-11-15",
            currency: "IDR",
            currencyOffset: 100,
            spendMinor: 100000,
            impressions: 5000,
            clicks: 120,
            inlineLinkClicks: 100,
            actions: [{actionType: "purchase", count: "92", valueMinor: 4_600_000, costPerActionMinor: null}],
        }]);

        await service.reconcileAll(new Date("2026-11-15T12:00:00.000Z"));

        const rows = await service.recent(accountId);
        const day = rows.find((row) => row.date === "2026-11-15");
        expect(day).toEqual({
            date: "2026-11-15",
            metaPurchases: 92,
            recordedOrders: 100,
            difference: 8,
            reason: "selisih atribusi",
        });

        const health = await request(`/api/tracking-health?accountId=${accountId}`);
        const body = await readData<{reconciliation: {date: string; difference: number}[]}>(health);
        expect(health.status).toBe(200);
        expect(body.reconciliation.find((row) => row.date === "2026-11-15")?.difference).toBe(8);
    });

    it("stores a webhook without referral as unknown attribution instead of guessing a campaign", async () => {
        const sessionId = crypto.randomUUID();
        await db.insert(WaSessionEntity).values({id: sessionId, tenantId, name: `hardening-${u}`});
        await db.insert(LeadEntity).values({
            accountId,
            externalId: `seed-${u}`,
            name: "Seed Lead",
            stage: "CHAT_STARTED",
        });

        const ingest = new CloudIngestService();
        await ingest.ingestOpenWa({
            sessionId,
            message: {
                id: `wamid_plain_${u}`,
                from: `62811${u.slice(-6)}`,
                to: "628999000111",
                body: "halo tanpa referral",
                timestamp: String(Math.floor(Date.now() / 1000)),
                fromMe: false,
            } as never,
        });

        const [lead] = await db.select().from(LeadEntity)
            .where(eq(LeadEntity.accountId, accountId))
            .orderBy(sql`id desc`)
            .limit(1);

        expect(lead.attributionMethod).toBe("unknown");
        expect(lead.attributionConfidence).toBe("rendah");
        expect(lead.campaignId).toBeNull();
        expect(lead.ctwaClid).toBeNull();

        // The message is grouped into a conversation even without a Cloud API conversation id.
        const [message] = await db.select().from(ConversationMessageEntity)
            .where(eq(ConversationMessageEntity.leadId, lead.id));
        expect(message.conversationId).not.toBeNull();

        const list = await request(`/api/leads?accountId=${accountId}`);
        const listBody = await readData<{items: {attribution: {method: string; confidence: string}}[]}>(list);
        expect(listBody.items.some((row) => row.attribution.method === "unknown")).toBe(true);
    });

    it("deletes a lead with its history and records the erasure", async () => {
        const [lead] = await db.insert(LeadEntity).values({
            accountId,
            externalId: `delete-${u}`,
            name: "Lead Hapus",
            stage: "CHAT_STARTED",
        }).returning();
        await db.insert(ConversationMessageEntity).values({
            leadId: lead.id,
            wamid: `w-del-${u}`,
            direction: "INBOUND",
            sentAt: new Date(),
        });
        await db.insert(LeadAssessmentEntity).values({
            leadId: lead.id,
            level: "HOT",
            confidence: "tinggi",
            applied: true,
            eventAt: new Date(),
            evidence: {},
            ruleVersion: `hardening-${u}`,
        });
        await db.insert(LeadMilestoneEntity).values({leadId: lead.id, level: "HOT", firstAt: new Date()});

        const response = await request(`/api/leads/${lead.id}?reason=permintaan%20pelanggan`, {method: "DELETE"});

        expect(response.status).toBe(200);
        expect(await readData(response)).toEqual({deleted: true, leadId: lead.id});

        expect(await db.select().from(LeadEntity).where(eq(LeadEntity.id, lead.id))).toHaveLength(0);
        expect(await db.select().from(ConversationMessageEntity).where(eq(ConversationMessageEntity.leadId, lead.id)))
            .toHaveLength(0);
        expect(await db.select().from(LeadAssessmentEntity).where(eq(LeadAssessmentEntity.leadId, lead.id)))
            .toHaveLength(0);
        expect(await db.select().from(LeadMilestoneEntity).where(eq(LeadMilestoneEntity.leadId, lead.id)))
            .toHaveLength(0);

        const [audit] = await db.select().from(DeletionAuditEntity)
            .where(and(eq(DeletionAuditEntity.tenantId, tenantId), eq(DeletionAuditEntity.leadId, lead.id)));
        expect(audit.userId).toBe(userId);
        expect(audit.reason).toBe("permintaan pelanggan");

        const again = await request(`/api/leads/${lead.id}`, {method: "DELETE"});
        expect(again.status).toBe(404);
    });

    it("refuses a lead deletion for a VIEWER", async () => {
        const viewer = await userRepo.create({
            fullName: "Viewer",
            email: `hardening-viewer-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "VIEWER",
            tenantId,
        });
        const viewerToken = await new JwtUtil().register({id: viewer.id, tenant: tenantId, role: "VIEWER"});
        const [lead] = await db.insert(LeadEntity).values({
            accountId,
            externalId: `manager-${u}`,
            name: "Lead Manager",
            stage: "CHAT_STARTED",
        }).returning();

        const response = await request(`/api/leads/${lead.id}`, {method: "DELETE"}, viewerToken);

        expect(response.status).toBe(403);
        expect(await readError(response)).toEqual({
            code: "FORBIDDEN",
            message: "Butuh role ADMIN",
            details: null,
        });
        expect(await db.select().from(LeadEntity).where(eq(LeadEntity.id, lead.id))).toHaveLength(1);
    });

    it("groups a conversation trail by conversation id and decrypts its bodies", async () => {
        const [lead] = await db.insert(LeadEntity).values({
            accountId,
            externalId: `conv-${u}`,
            name: "Lead Conversation",
            stage: "CHAT_STARTED",
        }).returning();

        const conversationId = crypto.randomUUID();
        await db.insert(ConversationMessageEntity).values([
            {
                leadId: lead.id,
                wamid: `w-conv-1-${u}`,
                direction: "INBOUND",
                body: null,
                bodyEncrypted: encrypt("pesan pertama"),
                conversationId,
                sentAt: new Date("2026-11-15T01:00:00.000Z"),
            },
            {
                leadId: lead.id,
                wamid: `w-conv-2-${u}`,
                direction: "INBOUND",
                body: null,
                bodyEncrypted: encrypt("pesan kedua"),
                conversationId,
                sentAt: new Date("2026-11-15T02:00:00.000Z"),
            },
        ]);

        const trail = await new ConversationMessageRepository().findLatest(lead.id, 10);
        expect(trail.map((row) => row.body)).toEqual(["pesan pertama", "pesan kedua"]);
        expect(trail.every((row) => row.conversationId === conversationId)).toBe(true);

        const [raw] = await db.select().from(ConversationMessageEntity)
            .where(eq(ConversationMessageEntity.wamid, `w-conv-1-${u}`));
        expect(raw.body).toBeNull();
        expect(raw.bodyEncrypted?.startsWith("v1:")).toBe(true);
    });
});
