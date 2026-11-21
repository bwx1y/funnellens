import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {AdRepository} from "@db/repositories/ad.repository";
import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {AnalyticsRepository} from "@db/repositories/analytics.repository";
import {ExplanationRepository} from "@db/repositories/explanation.repository";
import {InsightStagingRepository} from "@db/repositories/insight-staging.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {LeadMilestoneRepository} from "@db/repositories/lead-milestone.repository";
import {LeadRepository} from "@db/repositories/lead.repository";
import {PixelSourceRepository} from "@db/repositories/pixel-source.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {WaPhoneRepository} from "@db/repositories/wa-phone.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {AdInsightDailyEntity} from "@db/schema/ads/ad-insight-daily.entity";
import {AdInsightBreakdownDailyEntity} from "@db/schema/ads/ad-insight-breakdown-daily.entity";
import {CreativeTagEntity} from "@db/schema/ads/creative-tag.entity";
import {LeadMilestoneEntity} from "@db/schema/wa/lead-milestone.entity";
import {WaPhoneEntity} from "@db/schema/wa/wa-phone.entity";
import {WaSessionEntity} from "@db/schema/wa/wa-session.entity";
import {and, eq, sql} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

const DAY = new Date("2026-03-01T00:00:00.000Z");
const DATE = "2026-03-01";
// Lead/message timestamps are instants: `until` must cover the whole day, not its midnight.
const DAY_END = new Date("2026-03-01T23:59:59.999Z");

describe("Analytics and ingest repositories", () => {
    const cleanupRepo = new TestCleanupRepository();
    const analyticsRepo = new AnalyticsRepository();
    const insightDailyRepo = new AdInsightDailyRepository();
    const stagingRepo = new InsightStagingRepository();
    const adRepo = new AdRepository();
    const creativeRepo = new AdCreativeRepository();
    const leadRepo = new LeadRepository();
    const assessmentRepo = new LeadAssessmentRepository();
    const milestoneRepo = new LeadMilestoneRepository();
    const pixelRepo = new PixelSourceRepository();
    const explanationRepo = new ExplanationRepository();
    const syncRunRepo = new SyncRunRepository();
    const waPhoneRepo = new WaPhoneRepository();

    const u = Date.now().toString();
    const accountId = `act_analytics_${u}`;
    const campaignId = `camp_${u}`;
    const emptyCampaignId = `camp2_${u}`;
    const adsetId = `adset_${u}`;
    const cr1 = `cr1_${u}`;
    const cr2 = `cr2_${u}`;
    const ad1 = `ad1_${u}`;
    const ad2 = `ad2_${u}`;

    let tenantId: string;
    let leadIds: number[] = [];
    let syncRunId = 0;

    beforeAll(async () => {
        const [tenant] = await db.insert(TenantEntity).values({name: `analytics-test-${u}`}).returning();
        tenantId = tenant.id;

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Analytics Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
        await db.insert(CampaignEntity).values([
            {id: campaignId, accountId, name: `Campaign ${u}`, status: "ACTIVE"},
            {id: emptyCampaignId, accountId, name: `Empty Campaign ${u}`, status: "ACTIVE"},
        ]);
        await db.insert(AdSetEntity).values({
            id: adsetId,
            accountId,
            campaignId,
            name: `AdSet ${u}`,
            objectiveGroup: "wa",
        });
        await db.insert(AdCreativeEntity).values([
            {id: cr1, accountId, name: `Creative 1 ${u}`, createdTime: new Date("2026-03-01T00:00:00.000Z")},
            {id: cr2, accountId, name: `Creative 2 ${u}`},
        ]);
        await db.insert(AdEntity).values([
            {id: ad1, accountId, campaignId, adsetId, creativeId: cr1, name: `Ad 1 ${u}`},
            {id: ad2, accountId, campaignId, adsetId, creativeId: cr2, name: `Ad 2 ${u}`},
        ]);

        await insightDailyRepo.upsertBatch([
            {
                accountId,
                level: "ad",
                entityId: ad1,
                campaignId,
                adsetId,
                adId: ad1,
                date: DATE,
                currency: "IDR",
                currencyOffset: 100,
                spendMinor: 100000,
                impressions: 1000,
                clicks: 50,
                inlineLinkClicks: 40,
                reach: 500,
                actions: [
                    {actionType: "lead", count: "5", valueMinor: null, costPerActionMinor: null},
                    {actionType: "purchase", count: "1", valueMinor: 300000, costPerActionMinor: null},
                    {actionType: "landing_page_view", count: "30", valueMinor: null, costPerActionMinor: null},
                    {actionType: "view_content", count: "20", valueMinor: null, costPerActionMinor: null},
                    {actionType: "add_to_cart", count: "10", valueMinor: null, costPerActionMinor: null},
                ],
            },
            {
                accountId,
                level: "ad",
                entityId: ad2,
                campaignId,
                adsetId,
                adId: ad2,
                date: DATE,
                currency: "IDR",
                currencyOffset: 100,
                spendMinor: 50000,
                impressions: 500,
                clicks: 10,
                inlineLinkClicks: 5,
                reach: 250,
                actions: [{actionType: "lead", count: "2", valueMinor: null, costPerActionMinor: null}],
            },
        ]);

        const l1 = await leadRepo.upsert({
            accountId,
            externalId: "l1",
            creativeId: cr1,
            temperature: "HOT",
            stage: "REPLIED",
            firstSeenAt: DAY,
            firstRepliedAt: new Date(DAY.getTime() + 600 * 1000),
        });
        const l2 = await leadRepo.upsert({
            accountId,
            externalId: "l2",
            creativeId: cr1,
            temperature: "WARM",
            stage: "QUALIFIED",
            firstSeenAt: new Date(DAY.getTime() + 60 * 1000),
        });
        const l3 = await leadRepo.upsert({
            accountId,
            externalId: "l3",
            creativeId: cr1,
            temperature: "WARM",
            stage: "CLOSED",
            firstSeenAt: new Date(DAY.getTime() + 120 * 1000),
        });
        const l4 = await leadRepo.upsert({
            accountId,
            externalId: "l4",
            creativeId: cr2,
            temperature: "COLD",
            firstSeenAt: new Date(DAY.getTime() + 180 * 1000),
        });
        leadIds = [l1.id, l2.id, l3.id, l4.id];

        await milestoneRepo.recordFirst(l1.id, "HOT", DAY);
        await milestoneRepo.recordFirst(l1.id, "HOT", new Date(DAY.getTime() + 5000));

        for (const leadId of [l1.id, l2.id, l3.id, l4.id]) {
            await assessmentRepo.appendIfCurrent({
                leadId,
                level: "WARM",
                confidence: "0.9000",
                eventAt: DAY,
                ruleVersion: "a2-v1",
            });
        }

        await pixelRepo.upsert({
            id: `px_${u}`,
            accountId,
            pixelId: "px1",
            name: "Pixel",
        });

        const run = await syncRunRepo.create({accountId, resource: "insights"});
        await syncRunRepo.complete(run.id, 1);
        syncRunId = run.id;

        await creativeRepo.upsertTags(cr1, [{tagType: "hook_type", tagValue: "question", source: "manual"}]);
        await creativeRepo.upsertTags(cr2, [{tagType: "hook_type", tagValue: "question", source: "manual"}]);
    });

    afterAll(async () => {
        if (tenantId !== undefined) {
            await cleanupRepo.cleanup(tenantId);
        }
    });

    it("getFunnelCounts aggregates the funnel and honors campaign and objective filters", async () => {
        const expected = {
            impressions: 1500,
            linkClicks: 45,
            lpv: 30,
            viewContent: 20,
            addToCart: 10,
            purchase: 1,
            messagingStarted: 7,
            purchaseValueMinor: 300000,
        };

        expect(await analyticsRepo.getFunnelCounts(accountId, DAY, DAY_END)).toEqual(expected);
        expect(await analyticsRepo.getFunnelCounts(accountId, DAY, DAY_END, undefined, "wa")).toEqual(expected);

        const webOnly = await analyticsRepo.getFunnelCounts(accountId, DAY, DAY_END, undefined, "web");
        expect(webOnly.impressions).toBe(0);
        expect(webOnly.messagingStarted).toBe(0);

        const emptyCampaign = await analyticsRepo.getFunnelCounts(accountId, DAY, DAY_END, emptyCampaignId);
        expect(emptyCampaign.impressions).toBe(0);
        expect(emptyCampaign.purchaseValueMinor).toBe(0);
    });

    it("getLeadStageCounts counts the observed cohort", async () => {
        expect(await analyticsRepo.getLeadStageCounts(accountId, DAY, DAY_END)).toEqual({
            observed: 4,
            replied: 1,
            qualified: 1,
            closed: 1,
            firstHot: 1,
        });
    });

    it("getLeadReplyPairs returns one row per lead ordered by event time", async () => {
        const pairs = await analyticsRepo.getLeadReplyPairs(accountId, DAY, DAY_END);

        expect(pairs.length).toBe(4);
        expect(pairs.map((pair) => pair.leadId)).toEqual(leadIds);
        expect(pairs[0].replySeconds).toBe(600);
        expect(pairs.slice(1).every((pair) => pair.replySeconds === null)).toBe(true);
    });

    it("getCreativeAggregates groups per creative with objective-aware results", async () => {
        const aggregates = await analyticsRepo.getCreativeAggregates(accountId, DAY, DAY_END);

        expect(aggregates.length).toBe(2);
        expect(aggregates[0]).toEqual({
            creativeId: cr1,
            objectiveGroup: "wa",
            spendMinor: 100000,
            impressions: 1000,
            linkClicks: 40,
            results: 5,
            purchaseValueMinor: 300000,
            frequency: 2,
            firstSeen: DATE,
        });
        expect(aggregates[1].creativeId).toBe(cr2);
        expect(aggregates[1].results).toBe(2);
    });

    it("getCreativeDaily derives ctr, cpm, cpr, and frequency", async () => {
        const points = await analyticsRepo.getCreativeDaily(accountId, DAY, DAY_END, cr1);

        expect(points.length).toBe(1);
        expect(points[0]).toEqual({
            date: DATE,
            spendMinor: 100000,
            impressions: 1000,
            results: 5,
            ctr: 0.05,
            cpmMinor: 100000,
            cprMinor: 20000,
            frequency: 2,
        });
    });

    it("getCreativeLeadQuality joins lead quality without duplicating spend", async () => {
        const quality = await analyticsRepo.getCreativeLeadQuality(accountId, DAY, DAY_END);

        expect(quality).toEqual([
            {creativeId: cr1, spendMinor: 100000, results: 5, hotLeads: 1, assessedMatureLeads: 3},
            {creativeId: cr2, spendMinor: 50000, results: 2, hotLeads: 0, assessedMatureLeads: 1},
        ]);
    });

    it("getPatternGroups buckets per-creative ratios by tag value", async () => {
        const groups = await analyticsRepo.getPatternGroups(accountId, DAY, DAY_END, "hook_type");

        expect(groups.length).toBe(1);
        expect(groups[0].tagValue).toBe("question");
        expect(groups[0].creativeIds).toEqual([cr1, cr2]);
        expect(groups[0].ctr).toEqual([0.05, 0.02]);
        expect(groups[0].cpr).toEqual([20000, 25000]);
    });

    it("getTrackingSummary and getLatestSnapshotId read the sync run state", async () => {
        const summary = await analyticsRepo.getTrackingSummary(accountId);

        expect(summary.pixelSources.length).toBe(1);
        expect(summary.lastSuccessResource).toBe("insights");
        expect(summary.overdue).toBe(false);
        expect(await analyticsRepo.getLatestSnapshotId(accountId)).toBe(syncRunId);
    });

    it("LeadAssessmentRepository keeps the newest assessment applied and deduplicates replays", async () => {
        const [leadId] = leadIds;
        const newer = new Date(DAY.getTime() + 3600 * 1000);

        const first = await assessmentRepo.appendIfCurrent({
            leadId,
            level: "HOT",
            confidence: "0.9500",
            eventAt: newer,
            ruleVersion: "a2-v1",
        });
        expect(first.applied).toBe(true);

        const older = await assessmentRepo.appendIfCurrent({
            leadId,
            level: "COLD",
            confidence: "0.4000",
            eventAt: new Date(DAY.getTime() - 3600 * 1000),
            ruleVersion: "a2-v1",
        });
        expect(older.applied).toBe(false);

        const replay = await assessmentRepo.appendIfCurrent({
            leadId,
            level: "HOT",
            confidence: "0.9500",
            eventAt: newer,
            ruleVersion: "a2-v1",
        });
        expect(replay.assessment.id).toBe(first.assessment.id);

        const latest = await assessmentRepo.latestByLead(leadId);
        expect(latest?.id).toBe(first.assessment.id);

        const history = await assessmentRepo.history(leadId);
        expect(history.length).toBe(3);
    });

    it("LeadMilestoneRepository records only the first observation per level", async () => {
        const [leadId] = leadIds;
        const [counted] = await db.select({total: sql<string>`count(*)`})
            .from(LeadMilestoneEntity)
            .where(and(eq(LeadMilestoneEntity.leadId, leadId), eq(LeadMilestoneEntity.level, "HOT")));

        expect(Number(counted.total)).toBe(1);
    });

    it("PixelSourceRepository upserts on (account, pixel) and updates the existing row", async () => {
        await pixelRepo.upsert({
            id: `px_${u}`,
            accountId,
            pixelId: "px1",
            name: "Pixel Renamed",
        });

        const sources = await pixelRepo.findByAccountId(accountId);
        expect(sources.length).toBe(1);
        expect(sources[0].name).toBe("Pixel Renamed");
    });

    it("ExplanationRepository is idempotent on its natural key and maps states", async () => {
        const key = {
            accountId,
            context: "dashboard_kpi",
            entityType: "account",
            entityId: accountId,
            filterHash: "f1",
            snapshotId: String(syncRunId),
            evidenceHash: "e1",
            ruleVersion: "r1",
            promptVersion: "p1",
            model: "gemini",
        };

        const pending = await explanationRepo.insertPending({...key, tenantId});
        const replay = await explanationRepo.insertPending({...key, tenantId});
        expect(replay.id).toBe(pending.id);

        await explanationRepo.markReady(pending.id, {text: "KPI naik", source: "model", nextCheck: null});
        const ready = await explanationRepo.findById(pending.id, tenantId);
        expect(ready?.state).toBe("READY");
        expect(ready?.source).toBe("model");
        expect(ready?.text).toBe("KPI naik");

        const fallbackRow = await explanationRepo.insertPending({...key, context: "funnel", tenantId});
        await explanationRepo.markFallback(fallbackRow.id, {text: "template", nextCheck: null});
        expect((await explanationRepo.findById(fallbackRow.id, tenantId))?.state).toBe("FALLBACK");

        const unavailableRow = await explanationRepo.insertPending({...key, context: "creative", tenantId});
        await explanationRepo.markUnavailable(unavailableRow.id, "timeout");
        const unavailable = await explanationRepo.findById(unavailableRow.id, tenantId);
        expect(unavailable?.state).toBe("UNAVAILABLE");
        expect(unavailable?.error).toBe("timeout");

        expect(await explanationRepo.findByKey(key)).not.toBeNull();

        const [otherTenant] = await db.insert(TenantEntity).values({name: `analytics-other-${u}`}).returning();
        expect(await explanationRepo.findById(pending.id, otherTenant.id)).toBeNull();
        await cleanupRepo.cleanup(otherTenant.id);
    });

    it("WaPhoneRepository.findByPhoneNumberId resolves the webhook phone", async () => {
        const sessionId = crypto.randomUUID();
        await db.insert(WaSessionEntity).values({id: sessionId, tenantId, name: `session-${u}`});
        await db.insert(WaPhoneEntity).values({
            tenantId,
            sessionId,
            phone: `62812${u}`,
            phoneNumberId: `pnid_${u}`,
        });

        const found = await waPhoneRepo.findByPhoneNumberId(`pnid_${u}`);
        expect(found?.phone).toBe(`62812${u}`);
        expect(await waPhoneRepo.findByPhoneNumberId("pnid_missing")).toBeNull();
    });

    it("AdRepository.findAtTime reports whether the creative was live at the attribution time", async () => {
        const matched = await adRepo.findAtTime(accountId, ad1, new Date("2026-03-02T00:00:00.000Z"));
        expect(matched?.timeMatched).toBe(true);
        expect(matched?.ad.id).toBe(ad1);
        expect(matched?.ad.creativeId).toBe(cr1);

        const before = await adRepo.findAtTime(accountId, ad1, new Date("2026-02-01T00:00:00.000Z"));
        expect(before?.timeMatched).toBe(false);
        expect(before?.ad.id).toBe(ad1);

        expect(await adRepo.findAtTime(accountId, `ad_missing_${u}`, DAY)).toBeNull();
    });

    it("AdCreativeRepository deletes tags by owner and filters creatives with insights", async () => {
        const [tag] = await db.select()
            .from(CreativeTagEntity)
            .where(eq(CreativeTagEntity.creativeId, cr2));

        expect(await creativeRepo.deleteTag(cr2, tag.id)).toBe(true);
        expect(await creativeRepo.deleteTag(cr2, tag.id)).toBe(false);

        const remaining = await db.select()
            .from(CreativeTagEntity)
            .where(eq(CreativeTagEntity.id, tag.id));
        expect(remaining.length).toBe(0);

        expect(await creativeRepo.eligibleByIds(accountId, [cr2, cr1, `cr_missing_${u}`])).toEqual([cr2, cr1]);
        expect(await creativeRepo.eligibleByIds(accountId, [])).toEqual([]);
    });

    it("publishCompleteSlice defaults kinds to the staged slice", async () => {
        const stagingDate = "2026-03-05";

        function dailyRow(spendMinor: number) {
            return {
                accountId,
                level: "ad" as const,
                entityId: ad2,
                campaignId,
                adsetId,
                adId: ad2,
                date: stagingDate,
                currency: "IDR",
                currencyOffset: 100,
                spendMinor,
                impressions: 1,
                clicks: 1,
                inlineLinkClicks: 1,
            };
        }

        const firstRun = await syncRunRepo.create({accountId, resource: "insights"});
        await stagingRepo.write(firstRun.id, "insight_daily", [dailyRow(11111)]);
        await stagingRepo.write(firstRun.id, "insight_breakdown", [{
            accountId,
            level: "ad",
            entityId: ad2,
            campaignId,
            adsetId,
            adId: ad2,
            date: stagingDate,
            attributionWindow: "7d_click",
            publisherPlatform: "instagram",
            platformPosition: "story",
            impressionDevice: "smartphone",
            hourOfDay: null,
            breakdownHash: `hash_${u}`,
            spendMinor: 7777,
            impressions: 10,
            clicks: 1,
            inlineLinkClicks: 1,
        }]);

        await stagingRepo.publishCompleteSlice({
            runId: firstRun.id,
            accountId,
            since: stagingDate,
            until: stagingDate,
            kinds: ["insight_daily", "insight_breakdown"],
        });

        const secondRun = await syncRunRepo.create({accountId, resource: "insights"});
        await stagingRepo.write(secondRun.id, "insight_daily", [dailyRow(22222)]);

        // No `kinds`: only the staged `insight_daily` slice is published, so the breakdown slice survives.
        await stagingRepo.publishCompleteSlice({
            runId: secondRun.id,
            accountId,
            since: stagingDate,
            until: stagingDate,
        });

        const breakdowns = await db.select()
            .from(AdInsightBreakdownDailyEntity)
            .where(eq(AdInsightBreakdownDailyEntity.accountId, accountId));
        expect(breakdowns.length).toBe(1);
        expect(breakdowns[0].spendMinor).toBe(7777);

        const daily = await db.select()
            .from(AdInsightDailyEntity)
            .where(and(
                eq(AdInsightDailyEntity.accountId, accountId),
                eq(AdInsightDailyEntity.date, stagingDate)
            ));
        expect(daily.length).toBe(1);
        expect(daily[0].spendMinor).toBe(22222);
    });
});
