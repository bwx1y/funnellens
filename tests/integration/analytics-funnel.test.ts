import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {AnalyticsService} from "@/modules/analytics/service";
import {LeadRepository} from "@db/repositories/lead.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {JwtUtil} from "@shared/jwt";
import {eq} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

const RATIO_NOTE = "Rasio tidak tersedia karena salah satu periode tidak memiliki angka pada tahap sebelumnya.";
const TRACKING_NOTE = "Status tracking belum terkini sehingga seluruh transisi ditandai belum layak dibandingkan.";
const COVERAGE_NOTE = "Cakupan belum cukup untuk membandingkan konversi.";

// Current period 2026-03-01..2026-03-02 (2 days) makes the previous one 2026-02-27..2026-02-28.
const SINCE = "2026-03-01";
const UNTIL = "2026-03-02";

describe("Analytics funnel", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const insightDailyRepo = new AdInsightDailyRepository();
    const leadRepo = new LeadRepository();
    const syncRunRepo = new SyncRunRepository();
    const service = new AnalyticsService();

    const u = Date.now().toString();
    const accountId = `act_funnel_${u}`;
    const emptyAccountId = `act_funnel_empty_${u}`;
    const otherAccountId = `act_funnel_other_${u}`;
    const campaignId = `camp_funnel_${u}`;
    const adsetId = `adset_funnel_${u}`;
    const creativeId = `cr_funnel_${u}`;
    const adId = `ad_funnel_${u}`;

    let tenantId: string;
    let otherTenantId: string;

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `funnel-test-${u}`});
        tenantId = tenant.id;
        const otherTenant = await tenantRepo.create({name: `funnel-other-${u}`});
        otherTenantId = otherTenant.id;

        await db.insert(AdAccountEntity).values([
            {
                id: accountId,
                tenantId,
                name: `Funnel Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: emptyAccountId,
                tenantId,
                name: `Funnel Empty Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: otherAccountId,
                tenantId: otherTenantId,
                name: `Funnel Other Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
        ]);
        await db.insert(CampaignEntity).values({
            id: campaignId,
            accountId,
            name: `Funnel Campaign ${u}`,
            status: "ACTIVE",
        });
        await db.insert(AdSetEntity).values({
            id: adsetId,
            accountId,
            campaignId,
            name: `Funnel AdSet ${u}`,
            objectiveGroup: "wa",
        });
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: `Funnel Creative ${u}`});
        await db.insert(AdEntity).values({
            id: adId,
            accountId,
            campaignId,
            adsetId,
            creativeId,
            name: `Funnel Ad ${u}`,
        });

        await insightDailyRepo.upsertBatch([
            {
                accountId,
                level: "ad",
                entityId: adId,
                campaignId,
                adsetId,
                adId,
                date: "2026-02-27",
                currency: "IDR",
                currencyOffset: 100,
                spendMinor: 120000,
                impressions: 12000,
                clicks: 1100,
                inlineLinkClicks: 1000,
                actions: [{actionType: "lead", count: "250", valueMinor: null, costPerActionMinor: null}],
            },
            {
                accountId,
                level: "ad",
                entityId: adId,
                campaignId,
                adsetId,
                adId,
                date: "2026-03-01",
                currency: "IDR",
                currencyOffset: 100,
                spendMinor: 100000,
                impressions: 10000,
                clicks: 1000,
                inlineLinkClicks: 900,
                actions: [{actionType: "lead", count: "180", valueMinor: null, costPerActionMinor: null}],
            },
        ]);

        await leadRepo.upsert({
            accountId,
            externalId: "unreplied",
            campaignId,
            name: "Unreplied Lead",
            temperature: "HOT",
            stage: "CHAT_STARTED",
            firstSeenAt: new Date("2026-03-01T01:00:00.000Z"),
            firstRepliedAt: null,
        });
        await leadRepo.upsert({
            accountId,
            externalId: "qualified",
            campaignId,
            temperature: "WARM",
            stage: "QUALIFIED",
            firstSeenAt: new Date("2026-03-01T02:00:00.000Z"),
            firstRepliedAt: new Date("2026-03-01T02:05:00.000Z"),
        });
        await leadRepo.upsert({
            accountId,
            externalId: "closed",
            campaignId,
            temperature: "WARM",
            stage: "CLOSED",
            firstSeenAt: new Date("2026-03-01T03:00:00.000Z"),
            firstRepliedAt: new Date("2026-03-01T04:00:00.000Z"),
        });

        const run = await syncRunRepo.create({accountId, resource: "insights"});
        await syncRunRepo.complete(run.id, 1);
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
        if (otherTenantId !== undefined) await cleanupRepo.cleanup(otherTenantId);
    });

    it("builds the WhatsApp funnel with period-over-period pairs", async () => {
        const result = await service.getFunnel(tenantId, {accountId, since: SINCE, until: UNTIL});

        expect(result.objectiveGroup).toBe("wa");
        expect(result.stages.map((stage) => stage.key)).toEqual([
            "impressions",
            "link_clicks",
            "messaging_started",
            "observed",
            "replied",
            "qualified",
            "closed",
        ]);
        expect(result.stages.map((stage) => stage.value)).toEqual([10000, 900, 180, 3, 2, 1, 1]);
        expect(result.stages[3].estimated).toBe(true);
        expect(result.stages[0].estimated).toBeUndefined();
        expect(result.stages[2].rateFromFirst).toBe(0.018);
        expect(result.stages[0].rateFromFirst).toBe(1);

        expect(result.pairs[0]).toMatchObject({
            from: "impressions",
            to: "link_clicks",
            rate: 0.09,
            baseline: 0.0833,
            deltaPp: 0.67,
            estimatedGap: 0,
            status: "normal",
            eligible: true,
        });
        expect(result.pairs[1]).toMatchObject({
            from: "link_clicks",
            to: "messaging_started",
            rate: 0.2,
            baseline: 0.25,
            deltaPp: -5,
            estimatedGap: 45,
            status: "perlu_perhatian",
            eligible: true,
        });
        expect(result.pairs[2]).toMatchObject({
            from: "messaging_started",
            to: "observed",
            rate: 0.0167,
            baseline: 0,
            deltaPp: 1.67,
            estimatedGap: 0,
            status: "normal",
            eligible: true,
        });
        expect(result.pairs[3]).toMatchObject({
            from: "observed",
            to: "replied",
            rate: 0.6667,
            baseline: null,
            deltaPp: null,
            status: null,
            eligible: false,
            note: RATIO_NOTE,
        });

        expect(result.sample).toEqual({n: 10000, denominator: 100, eligible: true, gate: "≥ 100 tayangan"});
        expect(result.period).toEqual({since: SINCE, until: UNTIL, days: 2});
        expect(result.previousPeriod).toEqual({since: "2026-02-27", until: "2026-02-28"});
        expect(result.note).toBeUndefined();
    });

    it("reports the weakest eligible transition as a chat loss, not money", async () => {
        const result = await service.getLeakage(tenantId, {accountId, since: SINCE, until: UNTIL});

        expect(result).toEqual({
            transition: "link_clicks→messaging_started",
            rate: 0.2,
            baseline: 0.25,
            deltaPp: -5,
            estimatedGap: 45,
            severity: "WARNING",
            trackingState: "up_to_date",
            impactMinor: null,
            impactCaption: "≈45 chat hilang",
            note: null,
            explanation: {
                id: expect.any(String),
                context: "funnel_leak",
                state: "PENDING",
                source: null,
                text: null,
                evidenceIds: [],
                snapshotId: `${SINCE}..${UNTIL}`,
            },
        });
    });

    it("returns the daily trend and comparison table of one stage", async () => {
        const result = await service.getStageDetail(tenantId, {
            accountId,
            stageKey: "messaging_started",
            since: SINCE,
            until: UNTIL,
        });

        expect(result.stageKey).toBe("messaging_started");
        expect(result.label).toBe("Chat dimulai");
        expect(result.objectiveGroup).toBe("wa");
        expect(result.daily).toEqual([
            {date: "2026-03-01", value: 180},
            {date: "2026-03-02", value: 0},
        ]);

        expect(result.comparisonTable.length).toBe(7);
        expect(result.comparisonTable[0]).toEqual({
            stageKey: "impressions",
            label: "Tayangan",
            current: 10000,
            previous: 12000,
            changePct: -16.67,
            conversionRate: null,
            status: "normal",
        });
        expect(result.comparisonTable[2]).toEqual({
            stageKey: "messaging_started",
            label: "Chat dimulai",
            current: 180,
            previous: 250,
            changePct: -28,
            conversionRate: 0.2,
            status: "perlu_perhatian",
        });
        expect(result.note).toBeUndefined();
    });

    it("reads the daily trend of a cross stage from the leads table", async () => {
        const result = await service.getStageDetail(tenantId, {
            accountId,
            stageKey: "closed",
            since: SINCE,
            until: UNTIL,
        });

        expect(result.daily).toEqual([
            {date: "2026-03-01", value: 1},
            {date: "2026-03-02", value: 0},
        ]);
    });

    it("marks every transition ineligible for an account that never synced", async () => {
        const funnel = await service.getFunnel(tenantId, {accountId: emptyAccountId, since: SINCE, until: UNTIL});

        expect(funnel.stages.every((stage) => stage.value === 0)).toBe(true);
        expect(funnel.stages.every((stage) => stage.rateFromFirst === null)).toBe(true);
        expect(funnel.pairs.every((pair) => pair.rate === null && !pair.eligible)).toBe(true);
        expect(funnel.note).toBe(TRACKING_NOTE);

        const leakage = await service.getLeakage(tenantId, {accountId: emptyAccountId, since: SINCE, until: UNTIL});
        expect(leakage.transition).toBeNull();
        expect(leakage.severity).toBeNull();
        expect(leakage.impactCaption).toBeNull();
        expect(leakage.trackingState).toBe("unknown");
        expect(leakage.note).toBe(COVERAGE_NOTE);
    });

    it("serves the funnel route for the authenticated tenant", async () => {
        const token = await new JwtUtil().register({id: "user-funnel", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/funnel?accountId=${accountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const body = await response.json() as {pairs: unknown[]; objectiveGroup: string};
        expect(body.objectiveGroup).toBe("wa");
        expect(body.pairs.length).toBe(6);
    });

    it("serves the leakage route with the chat-loss caption", async () => {
        const token = await new JwtUtil().register({id: "user-funnel", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/leakage?accountId=${accountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const body = await response.json() as {impactCaption: string};
        expect(body.impactCaption).toBe("≈45 chat hilang");
    });

    it("serves the stage-detail route", async () => {
        const token = await new JwtUtil().register({id: "user-funnel", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/funnel/stage-detail?accountId=${accountId}&stageKey=messaging_started&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const body = await response.json() as {comparisonTable: unknown[]};
        expect(body.comparisonTable.length).toBe(7);
    });

    it("rejects an unknown stage key with 400", async () => {
        const token = await new JwtUtil().register({id: "user-funnel", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/funnel/stage-detail?accountId=${accountId}&stageKey=bogus`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({status: false, message: "Tahap funnel tidak dikenal"});
    });

    it("hides accounts owned by another tenant", async () => {
        const token = await new JwtUtil().register({id: "user-funnel", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/funnel?accountId=${otherAccountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({status: false, message: "Akun iklan tidak ditemukan"});
    });
});
