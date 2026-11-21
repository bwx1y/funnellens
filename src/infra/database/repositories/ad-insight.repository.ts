import {DatabaseRepository} from "./base.repository";
import {AdInsightDailyEntity} from "@db/schema/ads/ad-insight-daily.entity";
import {AdInsightActionEntity} from "@db/schema/ads/ad-insight-action.entity";
import {AdInsightBreakdownDailyEntity} from "@db/schema/ads/ad-insight-breakdown-daily.entity";
import {and, eq, gte, lte, sql} from "drizzle-orm";

export interface UpsertInsightDailyParams {
    insight: typeof AdInsightDailyEntity.$inferInsert;
    actions: {
        actionType: string;
        count: string;
        valueMinor: number | null;
        costPerActionMinor: number | null;
    }[];
}

export class AdInsightRepository extends DatabaseRepository {
    async upsertDailyInsights(items: UpsertInsightDailyParams[]): Promise<number> {
        if (items.length === 0) return 0;

        let totalUpserted = 0;

        // Upsert daily insights one by one or chunked to capture generated ID for actions
        for (const item of items) {
            const rows = await this.database.insert(AdInsightDailyEntity)
                .values(item.insight)
                .onConflictDoUpdate({
                    target: [
                        AdInsightDailyEntity.accountId,
                        AdInsightDailyEntity.level,
                        AdInsightDailyEntity.entityId,
                        AdInsightDailyEntity.date,
                        AdInsightDailyEntity.attributionWindow,
                    ],
                    set: {
                        spendMinor: item.insight.spendMinor,
                        impressions: item.insight.impressions,
                        reach: item.insight.reach,
                        frequency: item.insight.frequency,
                        clicks: item.insight.clicks,
                        inlineLinkClicks: item.insight.inlineLinkClicks,
                        uniqueClicks: item.insight.uniqueClicks,
                        ctr: item.insight.ctr,
                        cpcMinor: item.insight.cpcMinor,
                        cpmMinor: item.insight.cpmMinor,
                        actions: item.insight.actions,
                        actionValues: item.insight.actionValues,
                        costPerActionType: item.insight.costPerActionType,
                        videoPlayActions: item.insight.videoPlayActions,
                        videoThruplayWatchedActions: item.insight.videoThruplayWatchedActions,
                        videoP25WatchedActions: item.insight.videoP25WatchedActions,
                        videoP50WatchedActions: item.insight.videoP50WatchedActions,
                        videoP75WatchedActions: item.insight.videoP75WatchedActions,
                        videoP100WatchedActions: item.insight.videoP100WatchedActions,
                        videoAvgTimeWatchedSeconds: item.insight.videoAvgTimeWatchedSeconds,
                        isFinal: item.insight.isFinal,
                        fetchedAt: sql`now()`,
                    },
                })
                .returning({id: AdInsightDailyEntity.id});

            const insertedId = rows[0]?.id;
            if (insertedId && item.actions.length > 0) {
                const actionRows = item.actions.map((act) => ({
                    insightDailyId: insertedId,
                    actionType: act.actionType,
                    count: act.count,
                    valueMinor: act.valueMinor,
                    costPerActionMinor: act.costPerActionMinor,
                }));

                await this.database.insert(AdInsightActionEntity)
                    .values(actionRows)
                    .onConflictDoUpdate({
                        target: [AdInsightActionEntity.insightDailyId, AdInsightActionEntity.actionType],
                        set: {
                            count: sql`EXCLUDED.count`,
                            valueMinor: sql`EXCLUDED.value_minor`,
                            costPerActionMinor: sql`EXCLUDED.cost_per_action_minor`,
                        },
                    });
            }

            totalUpserted++;
        }

        return totalUpserted;
    }

    async upsertBreakdowns(breakdowns: (typeof AdInsightBreakdownDailyEntity.$inferInsert)[]): Promise<number> {
        if (breakdowns.length === 0) return 0;

        await this.database.insert(AdInsightBreakdownDailyEntity)
            .values(breakdowns)
            .onConflictDoUpdate({
                target: [
                    AdInsightBreakdownDailyEntity.accountId,
                    AdInsightBreakdownDailyEntity.level,
                    AdInsightBreakdownDailyEntity.entityId,
                    AdInsightBreakdownDailyEntity.date,
                    AdInsightBreakdownDailyEntity.attributionWindow,
                    AdInsightBreakdownDailyEntity.breakdownHash,
                ],
                set: {
                    spendMinor: sql`EXCLUDED.spend_minor`,
                    impressions: sql`EXCLUDED.impressions`,
                    reach: sql`EXCLUDED.reach`,
                    clicks: sql`EXCLUDED.clicks`,
                    inlineLinkClicks: sql`EXCLUDED.inline_link_clicks`,
                    actions: sql`EXCLUDED.actions`,
                    actionValues: sql`EXCLUDED.action_values`,
                },
            });

        return breakdowns.length;
    }

    async findDailyByAccountAndRange(
        accountId: string,
        since: string,
        until: string
    ): Promise<(typeof AdInsightDailyEntity.$inferSelect)[]> {
        return this.database.select()
            .from(AdInsightDailyEntity)
            .where(
                and(
                    eq(AdInsightDailyEntity.accountId, accountId),
                    gte(AdInsightDailyEntity.date, since),
                    lte(AdInsightDailyEntity.date, until)
                )
            )
            .orderBy(AdInsightDailyEntity.date);
    }
}
