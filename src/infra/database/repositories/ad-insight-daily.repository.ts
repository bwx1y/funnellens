import {DatabaseRepository, type DatabaseTransaction} from "./base.repository";
import {AdInsightDailyEntity} from "@db/schema/ads/ad-insight-daily.entity";
import {AdInsightActionEntity} from "@db/schema/ads/ad-insight-action.entity";
import {sql} from "drizzle-orm";

export const ATTRIBUTION_WINDOW = "7d_click";

// Precedence order: first non-null wins, so the same lead/purchase is never summed twice
// (Meta returns several aliases for one conversion in the same insight row).
export const LEAD_ACTION_PRECEDENCE = [
    "onsite_conversion.messaging_conversation_started_7d",
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
] as const;

export const PURCHASE_ACTION_PRECEDENCE = [
    "purchase",
    "omni_purchase",
    "offsite_conversion.fb_pixel_purchase",
] as const;

export type AdInsightDaily = typeof AdInsightDailyEntity.$inferSelect;
export type InsertAdInsightDaily = typeof AdInsightDailyEntity.$inferInsert;

export interface UpsertInsightDailyParams extends InsertAdInsightDaily {
    actions?: Omit<typeof AdInsightActionEntity.$inferInsert, "insightDailyId">[];
}

export interface InsightDailySlice {
    accountId: string;
    since: string; // YYYY-MM-DD
    until: string; // YYYY-MM-DD
    attributionWindow?: string; // defaults to ATTRIBUTION_WINDOW
}

export interface AggregatedKPIs {
    spendMinor: number;
    impressions: number;
    clicks: number;
    inlineLinkClicks: number;
    leads: number;
    purchaseValueMinor: number;
}

export interface DailyTrendPoint {
    date: string;
    spendMinor: number;
    leads: number;
}

export interface CampaignPerformance {
    campaignId: string;
    campaignName: string;
    spendMinor: number;
    leads: number;
    purchaseValueMinor: number;
    costPerLeadMinor: number | null;
    roas: number | null;
}

const CHUNK_SIZE = 500;
const ACTION_CHUNK_SIZE = 1000;

export const LEAD_COUNT_SQL = sql`coalesce(
    max(a.count) filter (where a.action_type = 'onsite_conversion.messaging_conversation_started_7d'),
    max(a.count) filter (where a.action_type = 'lead'),
    max(a.count) filter (where a.action_type = 'onsite_conversion.lead_grouped'),
    max(a.count) filter (where a.action_type = 'offsite_conversion.fb_pixel_lead'),
    0
)`;

export const PURCHASE_VALUE_SQL = sql`coalesce(
    max(a.value_minor) filter (where a.action_type = 'purchase'),
    max(a.value_minor) filter (where a.action_type = 'omni_purchase'),
    max(a.value_minor) filter (where a.action_type = 'offsite_conversion.fb_pixel_purchase'),
    0
)`;

export const PURCHASE_COUNT_SQL = sql`coalesce(
    max(a.count) filter (where a.action_type = 'purchase'),
    max(a.count) filter (where a.action_type = 'omni_purchase'),
    max(a.count) filter (where a.action_type = 'offsite_conversion.fb_pixel_purchase'),
    0
)`;

const PER_INSIGHT_ACTIONS_SQL = sql`(
    select a.insight_daily_id,
           ${LEAD_COUNT_SQL} as leads,
           ${PURCHASE_VALUE_SQL} as purchase_value_minor
    from ad_insight_actions a
    group by a.insight_daily_id
)`;

type InsightKeyFields = Pick<InsertAdInsightDaily, "level" | "entityId" | "date" | "attributionWindow">;

interface AggregatedKPIRow {
    spend_minor: string;
    impressions: string;
    clicks: string;
    inline_link_clicks: string;
    leads: string;
    purchase_value_minor: string;
}

interface DailyTrendRow {
    date: string;
    spend_minor: string;
    leads: string;
}

interface CampaignPerformanceRow {
    campaign_id: string;
    campaign_name: string;
    spend_minor: string;
    leads: string;
    purchase_value_minor: string;
}

function insightKey(row: InsightKeyFields): string {
    return `${row.level}|${row.entityId}|${row.date}|${row.attributionWindow}`;
}

export class AdInsightDailyRepository extends DatabaseRepository {
    async upsertBatch(insights: UpsertInsightDailyParams[]): Promise<void> {
        if (insights.length === 0) return;

        // Deduplicate within the batch: a repeated conflict target in one statement is rejected by Postgres.
        const byKey = new Map<string, UpsertInsightDailyParams>();
        for (const insight of insights) {
            const normalized: UpsertInsightDailyParams = {
                ...insight,
                attributionWindow: insight.attributionWindow ?? ATTRIBUTION_WINDOW,
            };
            byKey.set(insightKey(normalized), normalized);
        }

        const rows = [...byKey.values()];
        for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
            await this.upsertChunk(rows.slice(offset, offset + CHUNK_SIZE));
        }
    }

    async getAggregatedKPIs(
        accountId: string,
        since: Date,
        until: Date,
        campaignId?: string
    ): Promise<AggregatedKPIs> {
        const rows = await this.database.execute(sql`
            select
                coalesce(sum(i.spend_minor), 0)            as spend_minor,
                coalesce(sum(i.impressions), 0)            as impressions,
                coalesce(sum(i.clicks), 0)                 as clicks,
                coalesce(sum(i.inline_link_clicks), 0)     as inline_link_clicks,
                coalesce(sum(per.leads), 0)                as leads,
                coalesce(sum(per.purchase_value_minor), 0) as purchase_value_minor
            from ad_insights_daily i
            left join ${PER_INSIGHT_ACTIONS_SQL} per on per.insight_daily_id = i.id
            where ${this.scopeFilter(accountId, since, until, campaignId)}
        `) as unknown as AggregatedKPIRow[];

        const row = rows[0];
        return {
            spendMinor: Number(row.spend_minor),
            impressions: Number(row.impressions),
            clicks: Number(row.clicks),
            inlineLinkClicks: Number(row.inline_link_clicks),
            leads: Number(row.leads),
            purchaseValueMinor: Number(row.purchase_value_minor),
        };
    }

    async getDailyTrend(
        accountId: string,
        since: Date,
        until: Date,
        campaignId?: string
    ): Promise<DailyTrendPoint[]> {
        const rows = await this.database.execute(sql`
            select i.date::text                       as date,
                   coalesce(sum(i.spend_minor), 0)    as spend_minor,
                   coalesce(sum(per.leads), 0)        as leads
            from ad_insights_daily i
            left join ${PER_INSIGHT_ACTIONS_SQL} per on per.insight_daily_id = i.id
            where ${this.scopeFilter(accountId, since, until, campaignId)}
            group by i.date
            order by i.date asc
        `) as unknown as DailyTrendRow[];

        return rows.map((row) => ({
            date: row.date,
            spendMinor: Number(row.spend_minor),
            leads: Number(row.leads),
        }));
    }

    async getCampaignPerformance(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<CampaignPerformance[]> {
        const rows = await this.database.execute(sql`
            select i.campaign_id                           as campaign_id,
                   c.name                                  as campaign_name,
                   coalesce(sum(i.spend_minor), 0)            as spend_minor,
                   coalesce(sum(per.leads), 0)                as leads,
                   coalesce(sum(per.purchase_value_minor), 0) as purchase_value_minor
            from ad_insights_daily i
            join campaigns c on c.id = i.campaign_id
            left join ${PER_INSIGHT_ACTIONS_SQL} per on per.insight_daily_id = i.id
            where ${this.scopeFilter(accountId, since, until)}
            group by i.campaign_id, c.name
            order by spend_minor desc
        `) as unknown as CampaignPerformanceRow[];

        return rows.map((row) => {
            const spendMinor = Number(row.spend_minor);
            const leads = Number(row.leads);
            const purchaseValueMinor = Number(row.purchase_value_minor);

            return {
                campaignId: row.campaign_id,
                campaignName: row.campaign_name,
                spendMinor,
                leads,
                purchaseValueMinor,
                costPerLeadMinor: leads === 0 ? null : Math.round(spendMinor / leads),
                roas: spendMinor === 0 ? null : Math.round((purchaseValueMinor / spendMinor) * 10000) / 10000,
            };
        });
    }

    /**
     * `level = 'ad'` is mandatory: the unique key is per level, so summing several levels double counts.
     * Account-timezone shifting is a service concern; dates are compared as UTC `YYYY-MM-DD`.
     */
    private scopeFilter(accountId: string, since: Date, until: Date, campaignId?: string) {
        return sql`i.account_id = ${accountId}
            and i.level = 'ad'
            and i.attribution_window = ${ATTRIBUTION_WINDOW}
            and i.date >= ${this.toDateString(since)}
            and i.date <= ${this.toDateString(until)}
            ${campaignId === undefined ? sql`` : sql`and i.campaign_id = ${campaignId}`}`;
    }

    private async upsertChunk(rows: UpsertInsightDailyParams[]): Promise<void> {
        await this.database.transaction((tx) => this.insertRows(tx, rows));
    }

    /**
     * Replaces every `level = 'ad'` row of one account inside the slice: the delete and the insert share the
     * caller's transaction, so a partial slice is never visible. `ad_insight_actions` follows via FK cascade.
     */
    async replaceSlice(
        tx: DatabaseTransaction,
        slice: InsightDailySlice,
        rows: UpsertInsightDailyParams[]
    ): Promise<number> {
        const window = slice.attributionWindow ?? ATTRIBUTION_WINDOW;

        await tx.execute(sql`
            delete from ad_insights_daily
            where account_id = ${slice.accountId}
              and level = 'ad'
              and attribution_window = ${window}
              and date >= ${slice.since}::date
              and date <= ${slice.until}::date
        `);

        const byKey = new Map<string, UpsertInsightDailyParams>();
        for (const row of rows) {
            const normalized: UpsertInsightDailyParams = {
                ...row,
                attributionWindow: row.attributionWindow ?? ATTRIBUTION_WINDOW,
            };
            byKey.set(insightKey(normalized), normalized);
        }

        const deduplicated = [...byKey.values()];
        if (deduplicated.length > 0) {
            await this.insertRows(tx, deduplicated);
        }

        return deduplicated.length;
    }

    private async insertRows(tx: DatabaseTransaction, rows: UpsertInsightDailyParams[]): Promise<void> {
        const dailyRows: InsertAdInsightDaily[] = rows.map(({actions: _actions, ...row}) => row);

        const returned = await tx.insert(AdInsightDailyEntity)
            .values(dailyRows)
            .onConflictDoUpdate({
                target: [
                    AdInsightDailyEntity.accountId,
                    AdInsightDailyEntity.level,
                    AdInsightDailyEntity.entityId,
                    AdInsightDailyEntity.date,
                    AdInsightDailyEntity.attributionWindow,
                ],
                set: {
                    currency: sql`excluded.currency`,
                    currencyOffset: sql`excluded.currency_offset`,
                    spendMinor: sql`excluded.spend_minor`,
                    impressions: sql`excluded.impressions`,
                    reach: sql`excluded.reach`,
                    frequency: sql`excluded.frequency`,
                    clicks: sql`excluded.clicks`,
                    inlineLinkClicks: sql`excluded.inline_link_clicks`,
                    uniqueClicks: sql`excluded.unique_clicks`,
                    ctr: sql`excluded.ctr`,
                    cpcMinor: sql`excluded.cpc_minor`,
                    cpmMinor: sql`excluded.cpm_minor`,
                    actions: sql`excluded.actions`,
                    actionValues: sql`excluded.action_values`,
                    costPerActionType: sql`excluded.cost_per_action_type`,
                    videoPlayActions: sql`excluded.video_play_actions`,
                    video30SecWatchedActions: sql`excluded.video_30_sec_watched_actions`,
                    videoThruplayWatchedActions: sql`excluded.video_thruplay_watched_actions`,
                    videoP25WatchedActions: sql`excluded.video_p25_watched_actions`,
                    videoP50WatchedActions: sql`excluded.video_p50_watched_actions`,
                    videoP75WatchedActions: sql`excluded.video_p75_watched_actions`,
                    videoP100WatchedActions: sql`excluded.video_p100_watched_actions`,
                    videoAvgTimeWatchedSeconds: sql`excluded.video_avg_time_watched_seconds`,
                    graphVersion: sql`excluded.graph_version`,
                    actionReportTime: sql`excluded.action_report_time`,
                    video3SecWatchedActions: sql`excluded.video_3_sec_watched_actions`,
                    isFinal: sql`excluded.is_final`,
                    fetchedAt: sql`now()`,
                },
            })
            .returning({
                id: AdInsightDailyEntity.id,
                level: AdInsightDailyEntity.level,
                entityId: AdInsightDailyEntity.entityId,
                date: AdInsightDailyEntity.date,
                attributionWindow: AdInsightDailyEntity.attributionWindow,
            });

        // RETURNING order is not the input order; resolve ids through the composite key.
        const idByKey = new Map<string, number>();
        for (const row of returned) {
            idByKey.set(insightKey(row), row.id);
        }

        const actionRowsByKey = new Map<string, typeof AdInsightActionEntity.$inferInsert>();
        for (const row of rows) {
            const insightDailyId = idByKey.get(insightKey(row));
            if (insightDailyId === undefined) continue;

            for (const action of row.actions ?? []) {
                const actionRow = {...action, insightDailyId};
                actionRowsByKey.set(`${insightDailyId}|${actionRow.actionType}`, actionRow);
            }
        }

        const actionRows = [...actionRowsByKey.values()];
        for (let offset = 0; offset < actionRows.length; offset += ACTION_CHUNK_SIZE) {
            await tx.insert(AdInsightActionEntity)
                .values(actionRows.slice(offset, offset + ACTION_CHUNK_SIZE))
                .onConflictDoUpdate({
                    target: [AdInsightActionEntity.insightDailyId, AdInsightActionEntity.actionType],
                    set: {
                        count: sql`excluded.count`,
                        valueMinor: sql`excluded.value_minor`,
                        costPerActionMinor: sql`excluded.cost_per_action_minor`,
                    },
                });
        }
    }
}
