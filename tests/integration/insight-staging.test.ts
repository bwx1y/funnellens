import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {AdInsightBreakdownRepository} from "@db/repositories/ad-insight-breakdown.repository";
import {InsightStagingRepository} from "@db/repositories/insight-staging.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {AdInsightDailyEntity} from "@db/schema/ads/ad-insight-daily.entity";
import {AdInsightActionEntity} from "@db/schema/ads/ad-insight-action.entity";
import {AdInsightBreakdownDailyEntity} from "@db/schema/ads/ad-insight-breakdown-daily.entity";
import {InsightSyncStagingEntity} from "@db/schema/ads/insight-sync-staging.entity";
import {SyncRunEntity} from "@db/schema/ads/sync-run.entity";
import {and, eq} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

describe("Insight staging atomic publish", () => {
    const cleanupRepo = new TestCleanupRepository();
    const stagingRepo = new InsightStagingRepository();
    const insightDailyRepo = new AdInsightDailyRepository();
    const breakdownRepo = new AdInsightBreakdownRepository();
    const syncRunRepo = new SyncRunRepository();

    const u = Date.now().toString();
    const accountId = `act_staging_${u}`;
    const campaignId = `camp_${u}`;
    const adsetId = `adset_${u}`;
    const creativeId = `cr_${u}`;
    const adId = `ad_${u}`;
    const secondAdId = `ad2_${u}`;
    const since = "2026-02-01";
    const until = "2026-02-02";

    let tenantId: string;

    function dailyRow(entityId: string, date: string, spendMinor: number, actions: {
        actionType: string;
        count: string;
    }[] = []) {
        return {
            accountId,
            level: "ad" as const,
            entityId,
            campaignId,
            adsetId,
            adId: entityId,
            date,
            attributionWindow: "7d_click",
            currency: "IDR",
            currencyOffset: 100,
            spendMinor,
            impressions: 1000,
            clicks: 10,
            inlineLinkClicks: 5,
            graphVersion: "v21.0",
            actionReportTime: "conversion",
            video3SecWatchedActions: 77,
            actions: actions.map((a) => ({
                actionType: a.actionType,
                count: a.count,
                valueMinor: null,
                costPerActionMinor: null,
            })),
        };
    }

    function breakdownRow(hourOfDay: number | null, hash: string, spendMinor: number) {
        return {
            accountId,
            level: "ad" as const,
            entityId: adId,
            campaignId,
            adsetId,
            adId,
            date: since,
            attributionWindow: "7d_click",
            publisherPlatform: hourOfDay == null ? "instagram" : null,
            platformPosition: hourOfDay == null ? "story" : null,
            impressionDevice: hourOfDay == null ? "smartphone" : null,
            hourOfDay,
            breakdownHash: hash,
            spendMinor,
            impressions: 500,
            clicks: 5,
            inlineLinkClicks: 3,
        };
    }

    async function countDailyRows(): Promise<number> {
        const rows = await db.select({id: AdInsightDailyEntity.id})
            .from(AdInsightDailyEntity)
            .where(and(
                eq(AdInsightDailyEntity.accountId, accountId),
                eq(AdInsightDailyEntity.date, since)
            ));
        return rows.length;
    }

    async function countStagingRows(runId: number): Promise<number> {
        const rows = await db.select({id: InsightSyncStagingEntity.id})
            .from(InsightSyncStagingEntity)
            .where(eq(InsightSyncStagingEntity.runId, runId));
        return rows.length;
    }

    async function loadRun(runId: number) {
        const [row] = await db.select()
            .from(SyncRunEntity)
            .where(eq(SyncRunEntity.id, runId));
        return row;
    }

    beforeAll(async () => {
        const [tenant] = await db.insert(TenantEntity).values({name: `staging-test-${u}`}).returning();
        tenantId = tenant.id;

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Staging Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
        await db.insert(CampaignEntity).values({
            id: campaignId,
            accountId,
            name: `Staging Campaign ${u}`,
            status: "ACTIVE",
        });
        await db.insert(AdSetEntity).values({
            id: adsetId,
            accountId,
            campaignId,
            name: `Staging AdSet ${u}`,
        });
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: `Staging Creative ${u}`});
        await db.insert(AdEntity).values([
            {id: adId, accountId, campaignId, adsetId, creativeId, name: `Staging Ad ${u}`},
            {id: secondAdId, accountId, campaignId, adsetId, creativeId, name: `Staging Ad2 ${u}`},
        ]);
    });

    afterAll(async () => {
        if (tenantId !== undefined) {
            await cleanupRepo.cleanup(tenantId);
        }
    });

    it("publishes a complete slice and records the sync run range", async () => {
        const run = await syncRunRepo.create({
            accountId,
            resource: "insights",
            rangeSince: since,
            rangeUntil: until,
        });

        await stagingRepo.write(run.id, "insight_daily", [
            dailyRow(adId, since, 100000, [{actionType: "lead", count: "4"}]),
            dailyRow(secondAdId, since, 200000),
        ]);
        await stagingRepo.write(run.id, "insight_breakdown", [breakdownRow(null, "dailyhash", 300000)]);

        const published = await stagingRepo.publishCompleteSlice({
            runId: run.id,
            accountId,
            since,
            until,
            kinds: ["insight_daily", "insight_breakdown"],
        });

        expect(published).toEqual({dailyInsights: 2, breakdowns: 1, total: 3});
        expect(await countDailyRows()).toBe(2);

        const stored = await db.select()
            .from(AdInsightDailyEntity)
            .where(eq(AdInsightDailyEntity.accountId, accountId));
        const first = stored.find((row) => row.entityId === adId);
        expect(first?.graphVersion).toBe("v21.0");
        expect(first?.actionReportTime).toBe("conversion");
        expect(first?.video3SecWatchedActions).toBe(77);

        const actions = await db.select()
            .from(AdInsightActionEntity)
            .where(eq(AdInsightActionEntity.insightDailyId, first!.id));
        expect(actions.length).toBe(1);
        expect(actions[0].actionType).toBe("lead");
        expect(Number(actions[0].count)).toBe(4);

        const breakdowns = await db.select()
            .from(AdInsightBreakdownDailyEntity)
            .where(eq(AdInsightBreakdownDailyEntity.accountId, accountId));
        expect(breakdowns.length).toBe(1);
        expect(breakdowns[0].hourOfDay).toBeNull();

        const runAfter = await loadRun(run.id);
        expect(runAfter.status).toBe("SUCCESS");
        expect(runAfter.rowsUpserted).toBe(3);
        expect(runAfter.rangeSince).toBe(since);
        expect(runAfter.rangeUntil).toBe(until);

        expect(await countStagingRows(run.id)).toBe(0);
    });

    it("replaces the slice: rows dropped from the new run disappear with their actions", async () => {
        const run = await syncRunRepo.create({
            accountId,
            resource: "insights",
            rangeSince: since,
            rangeUntil: until,
        });

        await stagingRepo.write(run.id, "insight_daily", [
            dailyRow(adId, since, 555000, [{actionType: "lead", count: "9"}]),
        ]);

        const published = await stagingRepo.publishCompleteSlice({
            runId: run.id,
            accountId,
            since,
            until,
            kinds: ["insight_daily"],
        });

        expect(published).toEqual({dailyInsights: 1, breakdowns: 0, total: 1});

        const stored = await db.select()
            .from(AdInsightDailyEntity)
            .where(eq(AdInsightDailyEntity.accountId, accountId));
        expect(stored.length).toBe(1);
        expect(stored[0].entityId).toBe(adId);
        expect(stored[0].spendMinor).toBe(555000);

        const actions = await db.select()
            .from(AdInsightActionEntity)
            .where(eq(AdInsightActionEntity.insightDailyId, stored[0].id));
        expect(actions.length).toBe(1);
        expect(Number(actions[0].count)).toBe(9);

        // The daily breakdown slice was not part of this publish and must survive.
        const breakdowns = await db.select()
            .from(AdInsightBreakdownDailyEntity)
            .where(eq(AdInsightBreakdownDailyEntity.accountId, accountId));
        expect(breakdowns.length).toBe(1);
        expect(breakdowns[0].breakdownHash).toBe("dailyhash");
    });

    it("keeps hourly rows in their own slice and out of the placement aggregates", async () => {
        const runC = await syncRunRepo.create({
            accountId,
            resource: "insights-hourly",
            rangeSince: since,
            rangeUntil: until,
        });
        await stagingRepo.write(runC.id, "insight_breakdown_hourly", [breakdownRow(10, "hour10", 111000)]);
        const publishedC = await stagingRepo.publishCompleteSlice({
            runId: runC.id,
            accountId,
            since,
            until,
            kinds: ["insight_breakdown_hourly"],
        });
        expect(publishedC).toEqual({dailyInsights: 0, breakdowns: 1, total: 1});

        const runD = await syncRunRepo.create({
            accountId,
            resource: "insights-hourly",
            rangeSince: since,
            rangeUntil: until,
        });
        await stagingRepo.write(runD.id, "insight_breakdown_hourly", [breakdownRow(11, "hour11", 222000)]);
        await stagingRepo.publishCompleteSlice({
            runId: runD.id,
            accountId,
            since,
            until,
            kinds: ["insight_breakdown_hourly"],
        });

        const hourly = await db.select()
            .from(AdInsightBreakdownDailyEntity)
            .where(and(
                eq(AdInsightBreakdownDailyEntity.accountId, accountId),
                eq(AdInsightBreakdownDailyEntity.breakdownHash, "hour11")
            ));
        expect(hourly.length).toBe(1);
        expect(hourly[0].hourOfDay).toBe(11);

        const stale = await db.select()
            .from(AdInsightBreakdownDailyEntity)
            .where(and(
                eq(AdInsightBreakdownDailyEntity.accountId, accountId),
                eq(AdInsightBreakdownDailyEntity.breakdownHash, "hour10")
            ));
        expect(stale.length).toBe(0);

        const daily = await db.select()
            .from(AdInsightBreakdownDailyEntity)
            .where(and(
                eq(AdInsightBreakdownDailyEntity.accountId, accountId),
                eq(AdInsightBreakdownDailyEntity.breakdownHash, "dailyhash")
            ));
        expect(daily.length).toBe(1);

        const placements = await breakdownRepo.getPlacementMetrics(
            accountId,
            new Date(`${since}T00:00:00.000Z`),
            new Date(`${until}T00:00:00.000Z`)
        );
        expect(placements.length).toBe(1);
        expect(placements[0].publisherPlatform).toBe("instagram");
        expect(placements[0].spendMinor).toBe(300000);

        const dailyInsights = await insightDailyRepo.getAggregatedKPIs(
            accountId,
            new Date(`${since}T00:00:00.000Z`),
            new Date(`${until}T00:00:00.000Z`)
        );
        expect(dailyInsights.spendMinor).toBe(555000);
    });
});
