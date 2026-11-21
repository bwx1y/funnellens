import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {AnalyticsService, type SummaryResponse} from "@/modules/analytics/service";
import {LeadRepository} from "@db/repositories/lead.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {LeadMilestoneRepository} from "@db/repositories/lead-milestone.repository";
import {TrackingHealthRepository} from "@db/repositories/tracking-health.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {JwtUtil} from "@shared/jwt";
import {eq} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

// Current period 2026-02-21..2026-03-02 (10 days) keeps 2026-02-20 inside the previous period.
const SINCE = "2026-02-21";
const UNTIL = "2026-03-02";

describe("Analytics summary", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const insightDailyRepo = new AdInsightDailyRepository();
    const leadRepo = new LeadRepository();
    const assessmentRepo = new LeadAssessmentRepository();
    const milestoneRepo = new LeadMilestoneRepository();
    const trackingRepo = new TrackingHealthRepository();
    const service = new AnalyticsService();

    const u = Date.now().toString();
    const accountId = `act_summary_${u}`;
    const emptyAccountId = `act_summary_empty_${u}`;
    const otherAccountId = `act_summary_other_${u}`;
    const campaignId = `camp_${u}`;
    const adsetId = `adset_${u}`;
    const creativeId = `cr_${u}`;
    const ad1 = `ad1_${u}`;
    const ad2 = `ad2_${u}`;

    let tenantId: string;
    let otherTenantId: string;

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `summary-test-${u}`});
        tenantId = tenant.id;
        const otherTenant = await tenantRepo.create({name: `summary-other-${u}`});
        otherTenantId = otherTenant.id;

        await db.insert(AdAccountEntity).values([
            {
                id: accountId,
                tenantId,
                name: `Summary Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: emptyAccountId,
                tenantId,
                name: `Summary Empty Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: otherAccountId,
                tenantId: otherTenantId,
                name: `Summary Other Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
        ]);
        await db.insert(CampaignEntity).values({
            id: campaignId,
            accountId,
            name: `Summary Campaign ${u}`,
            status: "ACTIVE",
        });
        await db.insert(AdSetEntity).values({
            id: adsetId,
            accountId,
            campaignId,
            name: `Summary AdSet ${u}`,
            objectiveGroup: "wa",
        });
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: `Summary Creative ${u}`});
        await db.insert(AdEntity).values([
            {id: ad1, accountId, campaignId, adsetId, creativeId, name: `Summary Ad 1 ${u}`},
            {id: ad2, accountId, campaignId, adsetId, creativeId, name: `Summary Ad 2 ${u}`},
        ]);

        await insightDailyRepo.upsertBatch([
            {
                accountId,
                level: "ad",
                entityId: ad1,
                campaignId,
                adsetId,
                adId: ad1,
                date: "2026-03-01",
                currency: "IDR",
                currencyOffset: 100,
                spendMinor: 100000,
                impressions: 1000,
                clicks: 50,
                inlineLinkClicks: 40,
                actions: [
                    {actionType: "lead", count: "5", valueMinor: null, costPerActionMinor: null},
                    {actionType: "purchase", count: "1", valueMinor: 300000, costPerActionMinor: null},
                ],
            },
            {
                accountId,
                level: "ad",
                entityId: ad2,
                campaignId,
                adsetId,
                adId: ad2,
                date: "2026-03-02",
                currency: "IDR",
                currencyOffset: 100,
                spendMinor: 50000,
                impressions: 500,
                clicks: 10,
                inlineLinkClicks: 0,
                actions: [{actionType: "lead", count: "2", valueMinor: null, costPerActionMinor: null}],
            },
            {
                accountId,
                level: "ad",
                entityId: ad1,
                campaignId,
                adsetId,
                adId: ad1,
                date: "2026-02-20",
                currency: "IDR",
                currencyOffset: 100,
                spendMinor: 80000,
                impressions: 500,
                clicks: 25,
                inlineLinkClicks: 20,
                actions: [{actionType: "lead", count: "4", valueMinor: null, costPerActionMinor: null}],
            },
        ]);

        const hotLead = await leadRepo.upsert({
            accountId,
            externalId: "hot",
            campaignId,
            name: "Hot Lead",
            phoneMasked: "+62812****111",
            temperature: "HOT",
            stage: "CHAT_STARTED",
            firstSeenAt: new Date("2026-03-01T01:00:00.000Z"),
            firstRepliedAt: null,
        });
        const qualifiedLead = await leadRepo.upsert({
            accountId,
            externalId: "qualified",
            campaignId,
            temperature: "WARM",
            stage: "QUALIFIED",
            firstSeenAt: new Date("2026-03-01T02:00:00.000Z"),
            firstRepliedAt: new Date("2026-03-01T02:05:00.000Z"),
        });
        const closedLead = await leadRepo.upsert({
            accountId,
            externalId: "closed",
            campaignId,
            temperature: "WARM",
            stage: "CLOSED",
            firstSeenAt: new Date("2026-03-01T03:00:00.000Z"),
            firstRepliedAt: new Date("2026-03-01T04:00:00.000Z"),
        });
        expect(qualifiedLead.id).toBeGreaterThan(0);
        expect(closedLead.id).toBeGreaterThan(0);

        await milestoneRepo.recordFirst(hotLead.id, "HOT", new Date("2026-03-01T01:00:00.000Z"));
        await assessmentRepo.appendIfCurrent({
            leadId: hotLead.id,
            level: "HOT",
            confidence: "0.9000",
            eventAt: new Date("2026-03-01T01:05:00.000Z"),
            ruleVersion: "a2-v1",
        });

        await trackingRepo.upsertDaily({
            accountId,
            date: "2026-03-01",
            eventName: "Purchase",
            browserCount: 100,
            serverCount: 90,
            dedupRate: "0.900000",
            matchQuality: "8.00",
            status: "Sehat",
        });

        await db.insert(InsightAlertEntity).values([
            {
                accountId,
                ruleKey: "leak_chat_to_reply",
                level: "WARNING",
                title: "Lead chat belum dibalas",
                entityId: "",
            },
            {
                accountId,
                ruleKey: "tracking_emq",
                level: "INFO",
                title: "Kualitas pencocokan event rendah",
                entityId: "",
            },
        ]);
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
        if (otherTenantId !== undefined) await cleanupRepo.cleanup(otherTenantId);
    });

    it("builds the KPI cards, health score, trend, and campaign table", async () => {
        const result = await service.getSummary(tenantId, {accountId, since: SINCE, until: UNTIL});

        expect(Object.keys(result.cards).sort()).toEqual(
            ["cplQualified", "funnelHealth", "leads", "roas", "spend"]
        );
        expect(result.cards.spend.value).toBe(150000);
        expect(result.cards.spend.deltaPct).toBe(87.5);
        expect(result.cards.leads.value).toBe(7);
        expect(result.cards.leads.deltaPct).toBe(75);
        expect(result.cards.cplQualified.value).toBe(150000);
        expect(result.cards.roas.value).toBe(2);
        expect(result.cards.funnelHealth.value).toBe(70);
        expect(result.cards.funnelHealth.badge).toBe("Perlu perhatian");

        for (const card of Object.values(result.cards)) {
            if (card.value === null) {
                expect(card.note).toBeTruthy();
            }
            if (card.deltaPct === null && card.value !== null) {
                expect(card.note).toBeTruthy();
            }
        }

        expect(result.health.components.length).toBe(3);
        expect(result.health.components.map((component) => component.score)).toEqual([87.5, 33.33, 85]);
        expect(result.health.score).toBe(70);
        expect(result.cards.funnelHealth.deltaPct).toBeNull();
        expect(result.cards.funnelHealth.sparkline).toBeNull();
        expect(result.cards.funnelHealth.note).toBe(
            "Delta skor tidak dihitung karena baseline historis belum tersedia."
        );

        expect(result.cards.spend.sparkline?.length).toBe(7);
        const sparklineSum = (result.cards.spend.sparkline ?? [])
            .reduce<number>((sum, value) => sum + (value ?? 0), 0);
        expect(sparklineSum).toBe(150000);
        expect(result.cards.cplQualified.sparkline).toContain(null);

        expect(result.series.current).toEqual([
            {date: "2026-03-01", spendMinor: 100000, leads: 5},
            {date: "2026-03-02", spendMinor: 50000, leads: 2},
        ]);
        expect(result.series.previous).toEqual([
            {date: "2026-02-20", spendMinor: 80000, leads: 4},
        ]);

        expect(result.unrepliedHotLeads.length).toBe(1);
        expect(result.unrepliedHotLeads[0].confidence).toBe("0.9000");
        expect(result.unrepliedHotLeads[0].waitingMinutes).toBeGreaterThanOrEqual(0);

        expect(result.summary.leakageNeedingAttention).toBe(1);
        expect(result.summary.unrepliedHotLeads).toBe(1);
        expect(result.summary.winnerCreatives).toBeNull();
        expect(result.summary.winnerCreativesNote).toBe("Status kreatif belum tersedia");

        expect(result.campaigns[0].hotLeadRate).toBe(0.3333);
        expect(result.campaigns[0].status).toBe("ACTIVE");
        expect(result.campaigns[0].leads).toBe(7);
        expect(result.campaigns[0].costPerLeadMinor).toBe(21429);
        expect(result.campaigns[0].roas).toBe(2);

        expect(result.period).toEqual({since: SINCE, until: UNTIL, days: 10});
        expect(result.previousPeriod).toEqual({since: "2026-02-11", until: "2026-02-20"});
        expect(result.currency).toBe("IDR");
        expect(result.timezone).toBe("Asia/Jakarta");
        expect(result.sample).toEqual({n: 1500, denominator: 100, eligible: true, gate: "≥ 100 tayangan"});
    });

    it("returns zero cards with notes and a null health score for an account without data", async () => {
        const result: SummaryResponse = await service.getSummary(
            tenantId,
            {accountId: emptyAccountId, since: SINCE, until: UNTIL}
        );

        expect(result.cards.spend.value).toBe(0);
        expect(result.cards.spend.deltaPct).toBeNull();
        expect(result.cards.spend.note).toBeTruthy();
        expect(result.cards.funnelHealth.value).toBeNull();
        expect(result.cards.funnelHealth.note).toBe("Komponen pengukuran belum cukup");
        expect(result.health.score).toBeNull();
        expect(result.health.note).toBe("Komponen pengukuran belum cukup");
        expect(result.campaigns).toEqual([]);
        expect(result.sample.eligible).toBe(false);
    });

    it("serves the summary route for the authenticated tenant", async () => {
        const token = await new JwtUtil().register({id: "user-analytics", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/summary?accountId=${accountId}&since=2026-03-01&until=2026-03-02`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const body = await response.json() as {cards: {spend: {value: number}}};
        expect(body.cards.spend).toBeDefined();
        expect(body.cards.spend.value).toBe(150000);
    });

    it("hides accounts owned by another tenant", async () => {
        const token = await new JwtUtil().register({id: "user-analytics", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/summary?accountId=${otherAccountId}&since=2026-03-01&until=2026-03-02`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({status: false, message: "Akun iklan tidak ditemukan"});
    });
});
