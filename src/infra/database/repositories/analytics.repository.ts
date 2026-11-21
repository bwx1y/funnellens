import {DatabaseRepository} from "./base.repository";
import {PixelSourceEntity} from "@db/schema/ads/pixel-source.entity";
import {eq, sql} from "drizzle-orm";
import {
    ATTRIBUTION_WINDOW,
    LEAD_COUNT_SQL,
    PURCHASE_COUNT_SQL,
    PURCHASE_VALUE_SQL,
} from "./ad-insight-daily.repository";

export interface FunnelCounts {
    impressions: number;
    linkClicks: number;
    lpv: number;
    viewContent: number;
    addToCart: number;
    purchase: number;
    messagingStarted: number;
    purchaseValueMinor: number;
}

export interface LeadStageCounts {
    observed: number;
    replied: number;
    qualified: number;
    closed: number;
    firstHot: number;
}

export interface LeadReplyPair {
    leadId: number;
    replySeconds: number | null;
    eventAt: Date;
}

export interface CreativeAggregate {
    creativeId: string;
    objectiveGroup: "wa" | "web";
    spendMinor: number;
    impressions: number;
    linkClicks: number;
    results: number;
    purchaseValueMinor: number;
    frequency: number | null;
    firstSeen: string;
}

export interface CreativeDailyPoint {
    date: string;
    spendMinor: number;
    impressions: number;
    results: number;
    ctr: number | null;
    cpmMinor: number | null;
    cprMinor: number | null;
    frequency: number | null;
}

export interface CreativeLeadQuality {
    creativeId: string;
    spendMinor: number;
    results: number;
    hotLeads: number;
    assessedMatureLeads: number;
}

export interface PatternGroup {
    tagValue: string;
    creativeIds: string[];
    ctr: number[];
    cpr: number[];
}

export interface TrackingSummary {
    lastSuccessAt: Date | null;
    lastSuccessResource: string | null;
    overdueHours: number | null;
    overdue: boolean;
    pixelSources: (typeof PixelSourceEntity.$inferSelect)[];
}

const LPV_COUNT_SQL = sql`coalesce(max(a.count) filter (where a.action_type = 'landing_page_view'), 0)`;

const VIEW_CONTENT_COUNT_SQL = sql`coalesce(
    max(a.count) filter (where a.action_type = 'view_content'),
    max(a.count) filter (where a.action_type = 'offsite_conversion.fb_pixel_view_content'),
    0
)`;

const ADD_TO_CART_COUNT_SQL = sql`coalesce(
    max(a.count) filter (where a.action_type = 'add_to_cart'),
    max(a.count) filter (where a.action_type = 'offsite_conversion.fb_pixel_add_to_cart'),
    0
)`;

const ANALYTICS_ACTIONS_SQL = sql`(
    select a.insight_daily_id,
           ${LEAD_COUNT_SQL} as leads,
           ${PURCHASE_COUNT_SQL} as purchases,
           ${PURCHASE_VALUE_SQL} as purchase_value_minor,
           ${LPV_COUNT_SQL} as lpv,
           ${VIEW_CONTENT_COUNT_SQL} as view_content,
           ${ADD_TO_CART_COUNT_SQL} as add_to_cart
    from ad_insight_actions a
    group by a.insight_daily_id
)`;

// `wa` counts conversations, `web` counts purchases: one conversion per objective group, never both.
const RESULTS_SQL = sql`case when coalesce(s.objective_group, 'web') = 'wa' then per.leads else per.purchases end`;

interface FunnelRow {
    impressions: string;
    link_clicks: string;
    lpv: string;
    view_content: string;
    add_to_cart: string;
    purchase: string;
    messaging_started: string;
    purchase_value_minor: string;
}

interface LeadStageRow {
    observed: string;
    replied: string;
    qualified: string;
    closed: string;
    first_hot: string;
}

interface LeadReplyRow {
    lead_id: string;
    reply_seconds: number | null;
    event_at: Date;
}

interface CreativeAggregateRow {
    creative_id: string;
    objective_group: string;
    spend_minor: string;
    impressions: string;
    link_clicks: string;
    results: string;
    purchase_value_minor: string;
    reach: string;
    first_seen: string;
}

interface CreativeDailyRow {
    date: string;
    spend_minor: string;
    impressions: string;
    clicks: string;
    reach: string;
    results: string;
}

interface CreativeLeadQualityRow {
    creative_id: string;
    spend_minor: string;
    results: string;
    hot_leads: string;
    assessed_mature_leads: string;
}

interface PatternRow {
    tag_value: string;
    creative_id: string;
    impressions: string;
    clicks: string;
    spend_minor: string;
    results: string;
}

interface LatestSuccessRow {
    finished_at: Date | null;
    resource: string;
}

interface SnapshotRow {
    snapshot_id: string | null;
}

function ratio(numerator: number, denominator: number): number | null {
    return denominator > 0 ? numerator / denominator : null;
}

/**
 * Cross-table aggregations for the analytics, alerts, WA, and explanation features.
 * Every method returns raw numbers: gates (`>= 100`), samples, badges, and `null`-with-note wording
 * belong to the services.
 */
export class AnalyticsRepository extends DatabaseRepository {
    async getFunnelCounts(
        accountId: string,
        since: Date,
        until: Date,
        campaignId?: string,
        objectiveGroup?: string
    ): Promise<FunnelCounts> {
        const rows = await this.database.execute(sql`
            select
                coalesce(sum(i.impressions), 0)            as impressions,
                coalesce(sum(i.inline_link_clicks), 0)     as link_clicks,
                coalesce(sum(per.lpv), 0)                  as lpv,
                coalesce(sum(per.view_content), 0)         as view_content,
                coalesce(sum(per.add_to_cart), 0)          as add_to_cart,
                coalesce(sum(per.purchases), 0)            as purchase,
                coalesce(sum(per.leads), 0)                as messaging_started,
                coalesce(sum(per.purchase_value_minor), 0) as purchase_value_minor
            from ad_insights_daily i
            left join ${ANALYTICS_ACTIONS_SQL} per on per.insight_daily_id = i.id
            left join ad_sets s on s.id = i.adset_id
            where ${this.insightScope(accountId, since, until, {campaignId, objectiveGroup})}
        `) as unknown as FunnelRow[];

        const row = rows[0];
        return {
            impressions: Number(row.impressions),
            linkClicks: Number(row.link_clicks),
            lpv: Number(row.lpv),
            viewContent: Number(row.view_content),
            addToCart: Number(row.add_to_cart),
            purchase: Number(row.purchase),
            messagingStarted: Number(row.messaging_started),
            purchaseValueMinor: Number(row.purchase_value_minor),
        };
    }

    /**
     * `firstHot` is restricted to the observed cohort so the numerator and the denominator describe
     * the same lead set.
     */
    async getLeadStageCounts(
        accountId: string,
        since: Date,
        until: Date,
        campaignId?: string
    ): Promise<LeadStageCounts> {
        const rows = await this.database.execute(sql`
            select
                count(*)                                                              as observed,
                count(*) filter (where l.first_replied_at is not null)                 as replied,
                count(*) filter (where l.stage in ('QUALIFIED', 'CLOSING'))            as qualified,
                count(*) filter (where l.stage = 'CLOSED' or l.closed_at is not null)  as closed,
                count(*) filter (where exists (
                    select 1 from lead_milestones m
                    where m.lead_id = l.id
                      and m.level = 'HOT'
                      and m.first_at >= ${since.toISOString()}::timestamptz
                      and m.first_at <= ${until.toISOString()}::timestamptz
                ))                                                                    as first_hot
            from leads l
            where l.account_id = ${accountId}
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
              ${campaignId === undefined ? sql`` : sql`and l.campaign_id = ${campaignId}`}
        `) as unknown as LeadStageRow[];

        const row = rows[0];
        return {
            observed: Number(row.observed),
            replied: Number(row.replied),
            qualified: Number(row.qualified),
            closed: Number(row.closed),
            firstHot: Number(row.first_hot),
        };
    }

    /** One row per observed lead, unreplied leads included (`replySeconds: null`). */
    async getLeadReplyPairs(accountId: string, since: Date, until: Date): Promise<LeadReplyPair[]> {
        const rows = await this.database.execute(sql`
            select l.id as lead_id,
                   case
                       when l.first_replied_at is null or l.first_seen_at is null then null
                       else greatest(0, round(extract(epoch from (l.first_replied_at - l.first_seen_at))))::int
                   end as reply_seconds,
                   l.first_seen_at as event_at
            from leads l
            where l.account_id = ${accountId}
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
            order by l.first_seen_at asc
        `) as unknown as LeadReplyRow[];

        return rows.map((row) => ({
            leadId: Number(row.lead_id),
            replySeconds: row.reply_seconds === null ? null : Number(row.reply_seconds),
            eventAt: new Date(row.event_at),
        }));
    }

    async getCreativeAggregates(
        accountId: string,
        since: Date,
        until: Date,
        campaignId?: string
    ): Promise<CreativeAggregate[]> {
        const rows = await this.database.execute(sql`
            select ad.creative_id                          as creative_id,
                   coalesce(s.objective_group, 'web')      as objective_group,
                   coalesce(sum(i.spend_minor), 0)         as spend_minor,
                   coalesce(sum(i.impressions), 0)         as impressions,
                   coalesce(sum(i.inline_link_clicks), 0)  as link_clicks,
                   coalesce(sum(${RESULTS_SQL}), 0)        as results,
                   coalesce(sum(per.purchase_value_minor), 0) as purchase_value_minor,
                   coalesce(sum(i.reach), 0)               as reach,
                   min(i.date)::text                       as first_seen
            from ad_insights_daily i
            join ads ad on ad.id = i.ad_id
            left join ad_sets s on s.id = ad.adset_id
            left join ${ANALYTICS_ACTIONS_SQL} per on per.insight_daily_id = i.id
            where ${this.insightScope(accountId, since, until, {campaignId})}
            group by ad.creative_id, coalesce(s.objective_group, 'web')
            order by spend_minor desc
        `) as unknown as CreativeAggregateRow[];

        return rows.map((row) => {
            const impressions = Number(row.impressions);
            const reach = Number(row.reach);

            return {
                creativeId: row.creative_id,
                objectiveGroup: row.objective_group === "wa" ? "wa" : "web",
                spendMinor: Number(row.spend_minor),
                impressions,
                linkClicks: Number(row.link_clicks),
                results: Number(row.results),
                purchaseValueMinor: Number(row.purchase_value_minor),
                frequency: ratio(impressions, reach),
                firstSeen: row.first_seen,
            };
        });
    }

    async getCreativeDaily(
        accountId: string,
        since: Date,
        until: Date,
        creativeId: string
    ): Promise<CreativeDailyPoint[]> {
        const rows = await this.database.execute(sql`
            select i.date::text                    as date,
                   coalesce(sum(i.spend_minor), 0)   as spend_minor,
                   coalesce(sum(i.impressions), 0)   as impressions,
                   coalesce(sum(i.clicks), 0)        as clicks,
                   coalesce(sum(i.reach), 0)         as reach,
                   coalesce(sum(${RESULTS_SQL}), 0)  as results
            from ad_insights_daily i
            join ads ad on ad.id = i.ad_id
            left join ad_sets s on s.id = ad.adset_id
            left join ${ANALYTICS_ACTIONS_SQL} per on per.insight_daily_id = i.id
            where ${this.insightScope(accountId, since, until)}
              and ad.creative_id = ${creativeId}
            group by i.date
            order by i.date asc
        `) as unknown as CreativeDailyRow[];

        return rows.map((row) => {
            const spendMinor = Number(row.spend_minor);
            const impressions = Number(row.impressions);
            const results = Number(row.results);

            return {
                date: row.date,
                spendMinor,
                impressions,
                results,
                ctr: ratio(Number(row.clicks), impressions),
                cpmMinor: impressions > 0 ? (spendMinor / impressions) * 1000 : null,
                cprMinor: ratio(spendMinor, results),
                frequency: ratio(impressions, Number(row.reach)),
            };
        });
    }

    /**
     * Spend is aggregated per creative before the lead join: a lead row must never duplicate spend.
     */
    async getCreativeLeadQuality(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<CreativeLeadQuality[]> {
        const rows = await this.database.execute(sql`
            with perf as (
                select ad.creative_id                   as creative_id,
                       coalesce(sum(i.spend_minor), 0)  as spend_minor,
                       coalesce(sum(${RESULTS_SQL}), 0) as results
                from ad_insights_daily i
                join ads ad on ad.id = i.ad_id
                left join ad_sets s on s.id = ad.adset_id
                left join ${ANALYTICS_ACTIONS_SQL} per on per.insight_daily_id = i.id
                where ${this.insightScope(accountId, since, until)}
                group by ad.creative_id
            ),
            lead_stats as (
                select l.creative_id as creative_id,
                       count(*) filter (where l.temperature = 'HOT') as hot_leads,
                       count(*) filter (where exists (
                           select 1 from lead_assessments a where a.lead_id = l.id
                       )) as assessed_mature_leads
                from leads l
                where l.account_id = ${accountId}
                  and l.first_seen_at >= ${since.toISOString()}::timestamptz
                  and l.first_seen_at <= ${until.toISOString()}::timestamptz
                group by l.creative_id
            )
            select perf.creative_id                    as creative_id,
                   perf.spend_minor                    as spend_minor,
                   perf.results                        as results,
                   coalesce(ls.hot_leads, 0)           as hot_leads,
                   coalesce(ls.assessed_mature_leads, 0) as assessed_mature_leads
            from perf
            left join lead_stats ls on ls.creative_id = perf.creative_id
            order by perf.spend_minor desc
        `) as unknown as CreativeLeadQualityRow[];

        return rows.map((row) => ({
            creativeId: row.creative_id,
            spendMinor: Number(row.spend_minor),
            results: Number(row.results),
            hotLeads: Number(row.hot_leads),
            assessedMatureLeads: Number(row.assessed_mature_leads),
        }));
    }

    async getPatternGroups(
        accountId: string,
        since: Date,
        until: Date,
        tagType: string
    ): Promise<PatternGroup[]> {
        const rows = await this.database.execute(sql`
            select t.tag_value                       as tag_value,
                   ad.creative_id                    as creative_id,
                   coalesce(sum(i.impressions), 0)   as impressions,
                   coalesce(sum(i.clicks), 0)        as clicks,
                   coalesce(sum(i.spend_minor), 0)   as spend_minor,
                   coalesce(sum(${RESULTS_SQL}), 0)  as results
            from creative_tags t
            join ads ad on ad.creative_id = t.creative_id
            join ad_insights_daily i on i.ad_id = ad.id
            left join ad_sets s on s.id = ad.adset_id
            left join ${ANALYTICS_ACTIONS_SQL} per on per.insight_daily_id = i.id
            where t.tag_type = ${tagType}
              and ${this.insightScope(accountId, since, until)}
            group by t.tag_value, ad.creative_id
        `) as unknown as PatternRow[];

        const byTagValue = new Map<string, PatternRow[]>();
        for (const row of rows) {
            const bucket = byTagValue.get(row.tag_value);
            if (bucket === undefined) {
                byTagValue.set(row.tag_value, [row]);
            } else {
                bucket.push(row);
            }
        }

        return [...byTagValue.entries()]
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([tagValue, groupRows]) => {
                const sorted = [...groupRows].sort((left, right) =>
                    left.creative_id < right.creative_id ? -1 : left.creative_id > right.creative_id ? 1 : 0
                );

                const ctr: number[] = [];
                const cpr: number[] = [];
                for (const row of sorted) {
                    const ctrValue = ratio(Number(row.clicks), Number(row.impressions));
                    if (ctrValue !== null) ctr.push(ctrValue);

                    const cprValue = ratio(Number(row.spend_minor), Number(row.results));
                    if (cprValue !== null) cpr.push(cprValue);
                }

                return {
                    tagValue,
                    creativeIds: sorted.map((row) => row.creative_id),
                    ctr,
                    cpr,
                };
            });
    }

    async getTrackingSummary(accountId: string): Promise<TrackingSummary> {
        const [latest] = await this.database.execute(sql`
            select finished_at, resource
            from sync_runs
            where account_id = ${accountId}
              and status = 'SUCCESS'
            order by finished_at desc nulls last
            limit 1
        `) as unknown as LatestSuccessRow[];

        const pixelSources = await this.database.select()
            .from(PixelSourceEntity)
            .where(eq(PixelSourceEntity.accountId, accountId))
            .orderBy(PixelSourceEntity.pixelId);

        const lastSuccessAt = latest === undefined || latest.finished_at === null
            ? null
            : new Date(latest.finished_at);
        const overdueHours = lastSuccessAt === null
            ? null
            : Math.floor((Date.now() - lastSuccessAt.getTime()) / 3_600_000);

        return {
            lastSuccessAt,
            lastSuccessResource: latest?.resource ?? null,
            overdueHours,
            overdue: overdueHours === null || overdueHours > 24,
            pixelSources,
        };
    }

    async getLatestSnapshotId(accountId: string): Promise<number | null> {
        const [row] = await this.database.execute(sql`
            select max(id) as snapshot_id
            from sync_runs
            where account_id = ${accountId}
              and status = 'SUCCESS'
              and resource = 'insights'
        `) as unknown as SnapshotRow[];

        return row.snapshot_id === null ? null : Number(row.snapshot_id);
    }

    /**
     * `level = 'ad'` is mandatory: the unique key is per level, so summing several levels double counts.
     * Account-timezone shifting is a service concern; dates are compared as UTC `YYYY-MM-DD`.
     */
    private insightScope(
        accountId: string,
        since: Date,
        until: Date,
        options: {campaignId?: string; objectiveGroup?: string} = {}
    ) {
        const {campaignId, objectiveGroup} = options;

        return sql`i.account_id = ${accountId}
            and i.level = 'ad'
            and i.attribution_window = ${ATTRIBUTION_WINDOW}
            and i.date >= ${this.toDateString(since)}
            and i.date <= ${this.toDateString(until)}
            ${campaignId === undefined ? sql`` : sql`and i.campaign_id = ${campaignId}`}
            ${objectiveGroup === undefined ? sql`` : sql`and coalesce(s.objective_group, 'web') = ${objectiveGroup}`}`;
    }
}
