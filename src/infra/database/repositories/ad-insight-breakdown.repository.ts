import {DatabaseRepository, type DatabaseTransaction} from "./base.repository";
import {AdInsightBreakdownDailyEntity} from "@db/schema/ads/ad-insight-breakdown-daily.entity";
import {and, eq, gte, isNotNull, isNull, lte, sql} from "drizzle-orm";

export type InsertAdInsightBreakdownDaily = typeof AdInsightBreakdownDailyEntity.$inferInsert;

export interface BreakdownSlice {
    accountId: string;
    since: string; // YYYY-MM-DD
    until: string; // YYYY-MM-DD
    /** Hourly rows (`hour_of_day` not null) live in their own slice so the daily slice never deletes them. */
    hourly: boolean;
}

export interface PlacementMetric {
    publisherPlatform: string | null;
    platformPosition: string | null;
    spendMinor: number;
    impressions: number;
    clicks: number;
    inlineLinkClicks: number;
}

export interface DeviceMetric {
    impressionDevice: string | null;
    spendMinor: number;
    impressions: number;
    clicks: number;
    inlineLinkClicks: number;
}

const CHUNK_SIZE = 500;

type BreakdownKeyFields = Pick<
    InsertAdInsightBreakdownDaily,
    "level" | "entityId" | "date" | "attributionWindow" | "breakdownHash"
>;

function breakdownKey(row: BreakdownKeyFields): string {
    return `${row.level}|${row.entityId}|${row.date}|${row.attributionWindow}|${row.breakdownHash}`;
}

const SUM_SPEND = sql<string>`coalesce(sum(${AdInsightBreakdownDailyEntity.spendMinor}), 0)`;
const SUM_IMPRESSIONS = sql<string>`coalesce(sum(${AdInsightBreakdownDailyEntity.impressions}), 0)`;
const SUM_CLICKS = sql<string>`coalesce(sum(${AdInsightBreakdownDailyEntity.clicks}), 0)`;
const SUM_INLINE_LINK_CLICKS = sql<string>`coalesce(sum(${AdInsightBreakdownDailyEntity.inlineLinkClicks}), 0)`;

export class AdInsightBreakdownRepository extends DatabaseRepository {
    async upsertBatch(breakdowns: InsertAdInsightBreakdownDaily[]): Promise<void> {
        if (breakdowns.length === 0) return;

        // Deduplicate within the batch: a repeated conflict target in one statement is rejected by Postgres.
        const byKey = new Map<string, InsertAdInsightBreakdownDaily>();
        for (const breakdown of breakdowns) {
            byKey.set(breakdownKey(breakdown), breakdown);
        }

        const rows = [...byKey.values()];
        for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
            await this.database.insert(AdInsightBreakdownDailyEntity)
                .values(rows.slice(offset, offset + CHUNK_SIZE))
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
                        hourOfDay: sql`excluded.hour_of_day`,
                        spendMinor: sql`excluded.spend_minor`,
                        impressions: sql`excluded.impressions`,
                        reach: sql`excluded.reach`,
                        clicks: sql`excluded.clicks`,
                        inlineLinkClicks: sql`excluded.inline_link_clicks`,
                        actions: sql`excluded.actions`,
                        actionValues: sql`excluded.action_values`,
                    },
                });
        }
    }

    /**
     * Replaces one account slice (`level = 'ad'`) inside the caller's transaction. Daily and hourly slices are
     * disjoint through `hour_of_day`, so publishing one never destroys the other.
     */
    async replaceSlice(
        tx: DatabaseTransaction,
        slice: BreakdownSlice,
        rows: InsertAdInsightBreakdownDaily[]
    ): Promise<number> {
        const hourCondition = slice.hourly
            ? isNotNull(AdInsightBreakdownDailyEntity.hourOfDay)
            : isNull(AdInsightBreakdownDailyEntity.hourOfDay);

        await tx.delete(AdInsightBreakdownDailyEntity)
            .where(and(
                eq(AdInsightBreakdownDailyEntity.accountId, slice.accountId),
                eq(AdInsightBreakdownDailyEntity.level, "ad"),
                gte(AdInsightBreakdownDailyEntity.date, slice.since),
                lte(AdInsightBreakdownDailyEntity.date, slice.until),
                hourCondition
            ));

        const byKey = new Map<string, InsertAdInsightBreakdownDaily>();
        for (const row of rows) {
            byKey.set(breakdownKey(row), row);
        }

        const deduplicated = [...byKey.values()];
        for (let offset = 0; offset < deduplicated.length; offset += CHUNK_SIZE) {
            await tx.insert(AdInsightBreakdownDailyEntity)
                .values(deduplicated.slice(offset, offset + CHUNK_SIZE))
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
                        hourOfDay: sql`excluded.hour_of_day`,
                        spendMinor: sql`excluded.spend_minor`,
                        impressions: sql`excluded.impressions`,
                        reach: sql`excluded.reach`,
                        clicks: sql`excluded.clicks`,
                        inlineLinkClicks: sql`excluded.inline_link_clicks`,
                        actions: sql`excluded.actions`,
                        actionValues: sql`excluded.action_values`,
                    },
                });
        }

        return deduplicated.length;
    }

    async getPlacementMetrics(accountId: string, since: Date, until: Date): Promise<PlacementMetric[]> {
        const rows = await this.database.select({
            publisherPlatform: AdInsightBreakdownDailyEntity.publisherPlatform,
            platformPosition: AdInsightBreakdownDailyEntity.platformPosition,
            spendMinor: SUM_SPEND,
            impressions: SUM_IMPRESSIONS,
            clicks: SUM_CLICKS,
            inlineLinkClicks: SUM_INLINE_LINK_CLICKS,
        })
            .from(AdInsightBreakdownDailyEntity)
            .where(this.scopeFilter(accountId, since, until))
            .groupBy(
                AdInsightBreakdownDailyEntity.publisherPlatform,
                AdInsightBreakdownDailyEntity.platformPosition
            )
            .orderBy(sql`${SUM_SPEND} desc`);

        return rows.map((row) => ({
            publisherPlatform: row.publisherPlatform,
            platformPosition: row.platformPosition,
            spendMinor: Number(row.spendMinor),
            impressions: Number(row.impressions),
            clicks: Number(row.clicks),
            inlineLinkClicks: Number(row.inlineLinkClicks),
        }));
    }

    async getDeviceMetrics(accountId: string, since: Date, until: Date): Promise<DeviceMetric[]> {
        const rows = await this.database.select({
            impressionDevice: AdInsightBreakdownDailyEntity.impressionDevice,
            spendMinor: SUM_SPEND,
            impressions: SUM_IMPRESSIONS,
            clicks: SUM_CLICKS,
            inlineLinkClicks: SUM_INLINE_LINK_CLICKS,
        })
            .from(AdInsightBreakdownDailyEntity)
            .where(this.scopeFilter(accountId, since, until))
            .groupBy(AdInsightBreakdownDailyEntity.impressionDevice)
            .orderBy(sql`${SUM_SPEND} desc`);

        return rows.map((row) => ({
            impressionDevice: row.impressionDevice,
            spendMinor: Number(row.spendMinor),
            impressions: Number(row.impressions),
            clicks: Number(row.clicks),
            inlineLinkClicks: Number(row.inlineLinkClicks),
        }));
    }

    /** `level = 'ad'` keeps one row per ad/day; summing levels would double count. Hourly rows are a separate slice. */
    private scopeFilter(accountId: string, since: Date, until: Date) {
        return and(
            eq(AdInsightBreakdownDailyEntity.accountId, accountId),
            eq(AdInsightBreakdownDailyEntity.level, "ad"),
            gte(AdInsightBreakdownDailyEntity.date, this.toDateString(since)),
            lte(AdInsightBreakdownDailyEntity.date, this.toDateString(until)),
            isNull(AdInsightBreakdownDailyEntity.hourOfDay)
        );
    }
}
