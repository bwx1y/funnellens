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

    /** Hourly slice only (`hour_of_day` not null): `scopeFilter` excludes those rows by design. */
    async getHourlyMetrics(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{hour: number; spendMinor: number; impressions: number}[]> {
        const rows = await this.database.execute(sql`
            select i.hour_of_day                        as hour,
                   coalesce(sum(i.spend_minor), 0)      as spend_minor,
                   coalesce(sum(i.impressions), 0)      as impressions
            from ad_insights_breakdown_daily i
            where i.account_id = ${accountId}
              and i.level = 'ad'
              and i.hour_of_day is not null
              and i.date >= ${this.toDateString(since)}
              and i.date <= ${this.toDateString(until)}
            group by 1
            order by 1 asc
        `) as unknown as {hour: number; spend_minor: string; impressions: string}[];

        return rows.map((row) => ({
            hour: Number(row.hour),
            spendMinor: Number(row.spend_minor),
            impressions: Number(row.impressions),
        }));
    }

    /** One row per ad: which distinct placements/devices that ad has in the period. */
    async getAdAttributionMap(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{
        adId: string;
        placementCount: number;
        publisherPlatform: string | null;
        platformPosition: string | null;
        placementKeys: string[];
        deviceCount: number;
        impressionDevice: string | null;
        deviceKeys: string[];
    }[]> {
        const rows = await this.database.execute(sql`
            select coalesce(i.ad_id, i.entity_id)                                              as ad_id,
                   count(distinct coalesce(i.publisher_platform, '') || '|' || coalesce(i.platform_position, '')) as placement_count,
                   min(i.publisher_platform)                                                   as publisher_platform,
                   min(i.platform_position)                                                    as platform_position,
                   array_agg(distinct coalesce(i.publisher_platform, '') || '|' || coalesce(i.platform_position, '')) as placement_keys,
                   count(distinct coalesce(i.impression_device, ''))                           as device_count,
                   min(i.impression_device)                                                    as impression_device,
                   array_agg(distinct coalesce(i.impression_device, ''))                       as device_keys
            from ad_insights_breakdown_daily i
            where i.account_id = ${accountId}
              and i.level = 'ad'
              and i.hour_of_day is null
              and i.date >= ${this.toDateString(since)}
              and i.date <= ${this.toDateString(until)}
            group by 1
        `) as unknown as {
            ad_id: string;
            placement_count: string;
            publisher_platform: string | null;
            platform_position: string | null;
            placement_keys: string[];
            device_count: string;
            impression_device: string | null;
            device_keys: string[];
        }[];

        return rows.map((row) => ({
            adId: row.ad_id,
            placementCount: Number(row.placement_count),
            publisherPlatform: row.publisher_platform,
            platformPosition: row.platform_position,
            placementKeys: row.placement_keys,
            deviceCount: Number(row.device_count),
            impressionDevice: row.impression_device,
            deviceKeys: row.device_keys,
        }));
    }
}
