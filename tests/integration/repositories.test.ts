import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {AdInsightBreakdownRepository} from "@db/repositories/ad-insight-breakdown.repository";
import {LeadRepository} from "@db/repositories/lead.repository";
import {TrackingHealthRepository} from "@db/repositories/tracking-health.repository";
import {InsightAlertRepository} from "@db/repositories/insight-alert.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {AdInsightDailyEntity} from "@db/schema/ads/ad-insight-daily.entity";
import {AdInsightActionEntity} from "@db/schema/ads/ad-insight-action.entity";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {eq, sql} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

const DAY_ONE = new Date("2026-01-01T00:00:00.000Z");
const DAY_TWO = new Date("2026-01-02T00:00:00.000Z");

describe("Database repositories", () => {
    const cleanupRepo = new TestCleanupRepository();
    const insightDailyRepo = new AdInsightDailyRepository();
    const breakdownRepo = new AdInsightBreakdownRepository();
    const leadRepo = new LeadRepository();
    const trackingHealthRepo = new TrackingHealthRepository();
    const alertRepo = new InsightAlertRepository();
    const syncRunRepo = new SyncRunRepository();
    const creativeRepo = new AdCreativeRepository();

    const u = Date.now().toString();
    const accountId = `act_repos_${u}`;
    const campaignId = `camp_${u}`;
    const adsetId = `adset_${u}`;
    const creativeId = `cr_${u}`;
    const adId = `ad_${u}`;
    const secondAdId = `ad2_${u}`;

    let tenantId: string;

    beforeAll(async () => {
        const [tenant] = await db.insert(TenantEntity).values({name: `repos-test-${u}`}).returning();
        tenantId = tenant.id;

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Repos Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
        await db.insert(CampaignEntity).values({
            id: campaignId,
            accountId,
            name: `Campaign ${u}`,
            status: "ACTIVE",
        });
        await db.insert(AdSetEntity).values({
            id: adsetId,
            accountId,
            campaignId,
            name: `AdSet ${u}`,
        });
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: `Creative ${u}`});
        await db.insert(AdEntity).values([
            {id: adId, accountId, campaignId, adsetId, creativeId, name: `Ad ${u}`},
            {id: secondAdId, accountId, campaignId, adsetId, creativeId, name: `Ad2 ${u}`},
        ]);
    });

    afterAll(async () => {
        if (tenantId !== undefined) {
            await cleanupRepo.cleanup(tenantId);
        }
    });

    it("AdInsightDailyRepository.upsertBatch is idempotent and does not duplicate actions", async () => {
        const dayOneInsight = {
            accountId,
            level: "ad" as const,
            entityId: adId,
            campaignId,
            adsetId,
            adId,
            date: "2026-01-01",
            attributionWindow: "7d_click",
            currency: "IDR",
            currencyOffset: 100,
            spendMinor: 100000,
            impressions: 1000,
            clicks: 50,
            inlineLinkClicks: 40,
            actions: [
                {actionType: "onsite_conversion.messaging_conversation_started_7d", count: "5", valueMinor: null, costPerActionMinor: null},
                {actionType: "lead", count: "7", valueMinor: null, costPerActionMinor: null},
            ],
        };
        const dayOneSecondAd = {
            accountId,
            level: "ad" as const,
            entityId: secondAdId,
            campaignId,
            adsetId,
            adId: secondAdId,
            date: "2026-01-01",
            attributionWindow: "7d_click",
            currency: "IDR",
            currencyOffset: 100,
            spendMinor: 50000,
            impressions: 0,
            clicks: 0,
            inlineLinkClicks: 0,
            actions: [
                {actionType: "purchase", count: "1", valueMinor: 300000, costPerActionMinor: null},
            ],
        };
        // No attributionWindow: the repository normalizes it to the default window.
        const dayTwoInsight = {
            accountId,
            level: "ad" as const,
            entityId: adId,
            campaignId,
            adsetId,
            adId,
            date: "2026-01-02",
            currency: "IDR",
            currencyOffset: 100,
            spendMinor: 200000,
            impressions: 2000,
            clicks: 100,
            inlineLinkClicks: 0,
            actions: [{actionType: "lead", count: "3", valueMinor: null, costPerActionMinor: null}],
        };

        await insightDailyRepo.upsertBatch([dayOneInsight, dayOneSecondAd, dayTwoInsight]);
        await insightDailyRepo.upsertBatch([
            {...dayOneInsight, spendMinor: 120000},
            dayOneSecondAd,
            dayTwoInsight,
        ]);

        const dailyRows = await db.select()
            .from(AdInsightDailyEntity)
            .where(eq(AdInsightDailyEntity.accountId, accountId));
        expect(dailyRows.length).toBe(3);
        expect(dailyRows.find((row) => row.entityId === adId && row.date === "2026-01-01")?.spendMinor).toBe(120000);

        const [actionCount] = await db.select({total: sql<string>`count(*)`})
            .from(AdInsightActionEntity)
            .where(
                sql`${AdInsightActionEntity.insightDailyId} in (
                    select id from ad_insights_daily where account_id = ${accountId}
                )`
            );
        expect(Number(actionCount.total)).toBe(4);
    });

    it("getAggregatedKPIs uses action precedence instead of summing aliases", async () => {
        const kpis = await insightDailyRepo.getAggregatedKPIs(accountId, DAY_ONE, DAY_TWO);
        expect(kpis).toEqual({
            spendMinor: 370000,
            impressions: 3000,
            clicks: 150,
            inlineLinkClicks: 40,
            leads: 8,
            purchaseValueMinor: 300000,
        });
    });

    it("getDailyTrend aggregates per day", async () => {
        const trend = await insightDailyRepo.getDailyTrend(accountId, DAY_ONE, DAY_TWO);
        expect(trend).toEqual([
            {date: "2026-01-01", spendMinor: 170000, leads: 5, linkClicks: 40, purchaseValueMinor: 300000},
            {date: "2026-01-02", spendMinor: 200000, leads: 3, linkClicks: 0, purchaseValueMinor: 0},
        ]);
    });

    it("getCampaignPerformance computes cost per lead and ROAS", async () => {
        const performance = await insightDailyRepo.getCampaignPerformance(accountId, DAY_ONE, DAY_TWO);
        expect(performance).toEqual([
            {
                campaignId,
                campaignName: `Campaign ${u}`,
                spendMinor: 370000,
                leads: 8,
                purchaseValueMinor: 300000,
                costPerLeadMinor: 46250,
                roas: 0.8108,
            },
        ]);
    });

    it("AdInsightBreakdownRepository upserts placements and devices", async () => {
        const rows = [
            {
                accountId,
                level: "ad" as const,
                entityId: adId,
                campaignId,
                adsetId,
                adId,
                date: "2026-01-01",
                attributionWindow: "7d_click",
                publisherPlatform: "instagram",
                platformPosition: "story",
                impressionDevice: "iphone",
                breakdownHash: "hash-instagram-story",
                spendMinor: 60000,
                impressions: 600,
                clicks: 30,
                inlineLinkClicks: 20,
            },
            {
                accountId,
                level: "ad" as const,
                entityId: adId,
                campaignId,
                adsetId,
                adId,
                date: "2026-01-01",
                attributionWindow: "7d_click",
                publisherPlatform: "facebook",
                platformPosition: "feed",
                impressionDevice: "android",
                breakdownHash: "hash-facebook-feed",
                spendMinor: 40000,
                impressions: 400,
                clicks: 20,
                inlineLinkClicks: 10,
            },
        ];

        await breakdownRepo.upsertBatch(rows);
        await breakdownRepo.upsertBatch(rows);

        const placements = await breakdownRepo.getPlacementMetrics(accountId, DAY_ONE, DAY_ONE);
        expect(placements.length).toBe(2);
        expect(placements.reduce((sum, row) => sum + row.spendMinor, 0)).toBe(100000);
        expect(placements[0]).toEqual({
            publisherPlatform: "instagram",
            platformPosition: "story",
            spendMinor: 60000,
            impressions: 600,
            clicks: 30,
            inlineLinkClicks: 20,
        });

        const devices = await breakdownRepo.getDeviceMetrics(accountId, DAY_ONE, DAY_ONE);
        expect(devices).toEqual([
            {impressionDevice: "iphone", spendMinor: 60000, impressions: 600, clicks: 30, inlineLinkClicks: 20},
            {impressionDevice: "android", spendMinor: 40000, impressions: 400, clicks: 20, inlineLinkClicks: 10},
        ]);
    });

    it("LeadRepository upserts, filters, and computes speed metrics", async () => {
        const now = Date.now();
        const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
        const thirtyHoursAgo = new Date(now - 30 * 60 * 60 * 1000);
        const oneHourAgo = new Date(now - 60 * 60 * 1000);

        const l1 = await leadRepo.upsert({
            accountId,
            externalId: "l1",
            name: "Lead One",
            phoneMasked: "+6281111****",
            temperature: "HOT",
            firstSeenAt: twoHoursAgo,
        });
        await leadRepo.upsert({
            accountId,
            externalId: "l1",
            name: "Lead One",
            phoneMasked: "+6281111****",
            temperature: "HOT",
            firstSeenAt: twoHoursAgo,
        });

        const l2 = await leadRepo.upsert({
            accountId,
            externalId: "l2",
            name: "Lead Two",
            phoneMasked: "+6282222****",
            temperature: "HOT",
            firstSeenAt: thirtyHoursAgo,
        });
        const l3 = await leadRepo.upsert({
            accountId,
            externalId: "l3",
            name: "Lead Three",
            phoneMasked: "+6283333****",
            temperature: "WARM",
            firstSeenAt: oneHourAgo,
            firstRepliedAt: new Date(oneHourAgo.getTime() + 30 * 60 * 1000),
        });

        const [leadCount] = await db.select({total: sql<string>`count(*)`})
            .from(LeadEntity)
            .where(eq(LeadEntity.accountId, accountId));
        expect(Number(leadCount.total)).toBe(3);

        const counts = await leadRepo.countByTemperature(
            accountId,
            new Date(now - 40 * 60 * 60 * 1000),
            new Date(now)
        );
        expect(counts).toEqual({hot: 2, warm: 1, cold: 0});

        const unreplied = await leadRepo.getUnrepliedHotLeads(accountId);
        expect(unreplied.map((lead) => lead.id)).toEqual([l2.id, l1.id]);

        const speed = await leadRepo.getSpeedMetrics(
            accountId,
            new Date(now - 40 * 60 * 60 * 1000),
            new Date(now)
        );
        expect(speed).toEqual({avgFirstReplySeconds: 1800, stuckLeads: 1, longestWaitMinutes: 30});

        const page = await leadRepo.getLeadList(accountId, {temperature: "HOT", page: 1, limit: 1});
        expect(page.total).toBe(2);
        expect(page.leads.length).toBe(1);

        const searched = await leadRepo.getLeadList(accountId, {search: l1.phoneMasked ?? ""});
        expect(searched.total).toBe(1);
        expect(searched.leads[0].id).toBe(l1.id);

        expect(l3.firstRepliedAt).not.toBeNull();
    });

    it("TrackingHealthRepository keeps one row per event and summarizes the latest date", async () => {
        const base = {
            accountId,
            date: "2026-01-05",
            eventName: "Lead",
            browserCount: 100,
            serverCount: 90,
            dedupRate: "0.800000",
            matchQuality: "5.50",
            status: "Perlu optimalisasi",
        };

        await trackingHealthRepo.upsertDaily(base);
        await trackingHealthRepo.upsertDaily({...base, dedupRate: "0.850000", status: "Bermasalah"});
        await trackingHealthRepo.upsertDaily({
            accountId,
            date: "2026-01-05",
            eventName: "PageView",
            browserCount: 200,
            serverCount: 180,
            dedupRate: "0.980000",
            matchQuality: "7.50",
            status: "Sehat",
        });

        const summary = await trackingHealthRepo.getLatestStatus(accountId);
        expect(summary.date).toBe("2026-01-05");
        expect(summary.events.length).toBe(2);
        expect(summary.browserCount).toBe(300);
        expect(summary.serverCount).toBe(270);
        expect(summary.dedupRate).toBe(0.915);
        expect(summary.matchQuality).toBe(6.5);
        expect(summary.status).toBe("Bermasalah");
    });

    it("InsightAlertRepository filters active alerts and maps status updates", async () => {
        const [alert] = await db.insert(InsightAlertEntity)
            .values({
                accountId,
                ruleKey: "cpl_spike",
                level: "WARNING",
                title: "CPL spike",
                status: "ACTIVE",
            })
            .returning();

        expect((await alertRepo.findActiveByAccountId(accountId)).length).toBe(1);

        await alertRepo.snooze(alert.id, new Date(Date.now() + 24 * 60 * 60 * 1000));

        expect((await alertRepo.findActiveByAccountId(accountId)).length).toBe(0);
        const [stored] = await db.select()
            .from(InsightAlertEntity)
            .where(eq(InsightAlertEntity.id, alert.id));
        expect(stored.status).toBe("SNOOZED");
    });

    it("InsightAlertRepository.resolveByRuleKey keeps the rows the caller still reports", async () => {
        await db.insert(InsightAlertEntity).values([
            {accountId, ruleKey: "creative_fatigue", level: "WARNING", title: "Jenuh", entityType: "creative", entityId: "cr_keep"},
            {accountId, ruleKey: "creative_fatigue", level: "WARNING", title: "Jenuh", entityType: "creative", entityId: "cr_stale"},
        ]);

        expect(await alertRepo.resolveByRuleKey(accountId, "creative_fatigue", ["cr_keep"])).toBe(1);

        const rows = await db.select()
            .from(InsightAlertEntity)
            .where(eq(InsightAlertEntity.accountId, accountId));
        const byEntity = new Map(rows.map((row) => [row.entityId, row]));
        expect(byEntity.get("cr_keep")?.status).toBe("ACTIVE");
        expect(byEntity.get("cr_stale")?.status).toBe("DONE");
        expect(byEntity.get("cr_stale")?.resolvedAt).not.toBeNull();
    });

    it("SyncRunRepository creates a running run and completes it", async () => {
        const run = await syncRunRepo.create({accountId, resource: "insights"});
        expect(run.status).toBe("RUNNING");

        await syncRunRepo.complete(run.id, 42);

        const latest = await syncRunRepo.getLatestByAccountId(accountId, "insights");
        expect(latest?.status).toBe("SUCCESS");
        expect(latest?.rowsUpserted).toBe(42);
    });

    it("AdCreativeRepository.upsertTags keeps one tag per identity", async () => {
        const tag = {tagType: "hook", tagValue: "question", source: "AI"};

        await creativeRepo.upsertTags(creativeId, [{...tag, confidence: "0.9000"}]);
        await creativeRepo.upsertTags(creativeId, [{...tag, confidence: "0.9500"}]);

        const creatives = await creativeRepo.findWithTags(accountId);
        const creative = creatives.find((row) => row.id === creativeId);
        expect(creative?.tags.length).toBe(1);
        expect(creative?.tags[0].confidence).toBe("0.9500");
    });
});
