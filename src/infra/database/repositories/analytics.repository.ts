import {DatabaseRepository} from "./base.repository";
import {PixelSourceEntity} from "@db/schema/ads/pixel-source.entity";
import {eq, sql} from "drizzle-orm";
import {ATTRIBUTION_WINDOW} from "./ad-insight-daily.repository";
import type {FunnelObjectiveGroup} from "@shared/funnel";

export interface FunnelCounts {
    spendMinor: number;
    impressions: number;
    /** `inline_link_clicks`: the denominator of the funnel conversion ratio. */
    linkClicks: number;
    /** `null` when Meta never reported the event in the window; never a stand-in zero. */
    lpv: number | null;
    viewContent: number | null;
    addToCart: number | null;
    purchase: number | null;
    messagingStarted: number;
    /** Objective-aware conversions from the `ad_insight_metrics` view (`leads` for WA, `purchases` for web). */
    results: number;
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
    /** Total clicks: the denominator of the creative CTR. */
    clicks: number;
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
    clicks: number;
    reach: number;
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

interface FunnelRow {
    spend_minor: string;
    impressions: string;
    link_clicks: string;
    lpv: string | null;
    view_content: string | null;
    add_to_cart: string | null;
    purchase: string | null;
    messaging_started: string;
    results: string;
    purchase_value_minor: string;
}

interface LeadStageRow {
    observed: string;
    replied: string;
    qualified: string;
    closed: string;
    first_hot: string;
}

interface DailyQualifiedRow {
    date: string;
    leads: string;
    qualified: string;
}

interface DailyMetaStageRow {
    date: string;
    impressions: string;
    link_clicks: string;
    messaging_started: string;
    lpv: string | null;
    view_content: string | null;
    add_to_cart: string | null;
    purchase: string | null;
}

interface DailyLeadStageRow {
    date: string;
    observed: string;
    replied: string;
    qualified: string;
    closed: string;
}

interface CampaignLeadRow {
    campaign_id: string;
    attributed_leads: string;
    hot_leads: string;
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
    clicks: string;
    link_clicks: string;
    results: string;
    purchase_value_minor: string;
    reach: string;
    first_seen: string;
}

interface CreativeDailyRow {
    creative_id: string;
    date: string;
    spend_minor: string;
    impressions: string;
    clicks: string;
    reach: string;
    results: string;
}

interface CreativeAllocationRow {
    creative_id: string;
    adset_id: string;
    daily_budget_minor: string | null;
    effective_status: string | null;
}

interface CreativeVideoRow {
    video3_sec: string | null;
    thruplay: string | null;
    p25: string | null;
    p50: string | null;
    p75: string | null;
    p100: string | null;
    impressions: string;
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

/** One row of the `ad_insight_metrics` view mapped to a daily point; shared by every daily reader. */
function toDailyPoint(row: CreativeDailyRow): CreativeDailyPoint {
    const spendMinor = Number(row.spend_minor);
    const impressions = Number(row.impressions);
    const results = Number(row.results);
    const reach = Number(row.reach);

    return {
        date: row.date,
        spendMinor,
        impressions,
        clicks: Number(row.clicks),
        reach,
        results,
        ctr: ratio(Number(row.clicks), impressions),
        cpmMinor: impressions > 0 ? (spendMinor / impressions) * 1000 : null,
        cprMinor: ratio(spendMinor, results),
        frequency: ratio(impressions, reach),
    };
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
                coalesce(sum(i.spend_minor), 0)            as spend_minor,
                coalesce(sum(i.impressions), 0)            as impressions,
                coalesce(sum(i.inline_link_clicks), 0)     as link_clicks,
                sum(i.lpv)                                 as lpv,
                sum(i.view_content)                        as view_content,
                sum(i.add_to_cart)                         as add_to_cart,
                sum(i.purchases)                           as purchase,
                coalesce(sum(i.leads), 0)                  as messaging_started,
                coalesce(sum(i.results), 0)                as results,
                coalesce(sum(i.purchase_value_minor), 0)   as purchase_value_minor
            from ad_insight_metrics i
            where ${this.insightScope(accountId, since, until, {campaignId, objectiveGroup})}
        `) as unknown as FunnelRow[];

        const row = rows[0];
        return {
            spendMinor: Number(row.spend_minor),
            impressions: Number(row.impressions),
            linkClicks: Number(row.link_clicks),
            lpv: row.lpv === null ? null : Number(row.lpv),
            viewContent: row.view_content === null ? null : Number(row.view_content),
            addToCart: row.add_to_cart === null ? null : Number(row.add_to_cart),
            purchase: row.purchase === null ? null : Number(row.purchase),
            messagingStarted: Number(row.messaging_started),
            results: Number(row.results),
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

    /** Daily leads and qualified leads (stages `QUALIFIED`/`CLOSING`), one row per UTC date. */
    async getDailyQualifiedLeads(
        accountId: string,
        since: Date,
        until: Date,
        campaignId?: string
    ): Promise<{date: string; leads: number; qualified: number}[]> {
        const rows = await this.database.execute(sql`
            select (l.first_seen_at at time zone 'UTC')::date::text as date,
                   count(*)                                             as leads,
                   count(*) filter (where l.stage in ('QUALIFIED', 'CLOSING')) as qualified
            from leads l
            where l.account_id = ${accountId}
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
              ${campaignId === undefined ? sql`` : sql`and l.campaign_id = ${campaignId}`}
            group by 1
            order by 1 asc
        `) as unknown as DailyQualifiedRow[];

        return rows.map((row) => ({
            date: row.date,
            leads: Number(row.leads),
            qualified: Number(row.qualified),
        }));
    }

    /**
     * One row per UTC date for the stage-detail trend. Same view and scope as `getFunnelCounts`, so
     * the daily numbers add up to the funnel totals.
     */
    async getDailyMetaStages(
        accountId: string,
        since: Date,
        until: Date,
        objectiveGroup: FunnelObjectiveGroup
    ): Promise<{
        date: string;
        impressions: number;
        linkClicks: number;
        messagingStarted: number;
        lpv: number | null;
        viewContent: number | null;
        addToCart: number | null;
        purchase: number | null;
    }[]> {
        const rows = await this.database.execute(sql`
            select i.date::text                            as date,
                   coalesce(sum(i.impressions), 0)         as impressions,
                   coalesce(sum(i.inline_link_clicks), 0)  as link_clicks,
                   coalesce(sum(i.leads), 0)               as messaging_started,
                   -- No coalesce: an all-null day means the event was never reported, and 0 would be a
                   -- different claim. sum ignores nulls, so a reported day still adds up.
                   sum(i.lpv)                              as lpv,
                   sum(i.view_content)                     as view_content,
                   sum(i.add_to_cart)                      as add_to_cart,
                   sum(i.purchases)                        as purchase
            from ad_insight_metrics i
            where ${this.insightScope(accountId, since, until, {objectiveGroup})}
            group by i.date
            order by i.date asc
        `) as unknown as DailyMetaStageRow[];

        return rows.map((row) => ({
            date: row.date,
            impressions: Number(row.impressions),
            linkClicks: Number(row.link_clicks),
            messagingStarted: Number(row.messaging_started),
            lpv: row.lpv === null ? null : Number(row.lpv),
            viewContent: row.view_content === null ? null : Number(row.view_content),
            addToCart: row.add_to_cart === null ? null : Number(row.add_to_cart),
            purchase: row.purchase === null ? null : Number(row.purchase),
        }));
    }

    /** One row per UTC date; the cohort filter matches `getLeadStageCounts` exactly. */
    async getDailyLeadStages(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{date: string; observed: number; replied: number; qualified: number; closed: number}[]> {
        const rows = await this.database.execute(sql`
            select (l.first_seen_at at time zone 'UTC')::date::text                       as date,
                   count(*)                                                               as observed,
                   count(*) filter (where l.first_replied_at is not null)                  as replied,
                   count(*) filter (where l.stage in ('QUALIFIED', 'CLOSING'))             as qualified,
                   count(*) filter (where l.stage = 'CLOSED' or l.closed_at is not null)   as closed
            from leads l
            where l.account_id = ${accountId}
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
            group by 1
            order by 1 asc
        `) as unknown as DailyLeadStageRow[];

        return rows.map((row) => ({
            date: row.date,
            observed: Number(row.observed),
            replied: Number(row.replied),
            qualified: Number(row.qualified),
            closed: Number(row.closed),
        }));
    }

    /**
     * Attributed leads and the subset that turned HOT inside the period, per campaign.
     * The milestone join is period-scoped so a lead whose HOT event falls outside the window is not hot.
     */
    async getCampaignLeadMetrics(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{campaignId: string; attributedLeads: number; hotLeads: number}[]> {
        const rows = await this.database.execute(sql`
            select l.campaign_id                            as campaign_id,
                   count(*)                                 as attributed_leads,
                   count(*) filter (where m.lead_id is not null) as hot_leads
            from leads l
            left join lead_milestones m
                   on m.lead_id = l.id
                  and m.level = 'HOT'
                  and m.first_at >= ${since.toISOString()}::timestamptz
                  and m.first_at <= ${until.toISOString()}::timestamptz
            where l.account_id = ${accountId}
              and l.campaign_id is not null
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
            group by l.campaign_id
        `) as unknown as CampaignLeadRow[];

        return rows.map((row) => ({
            campaignId: row.campaign_id,
            attributedLeads: Number(row.attributed_leads),
            hotLeads: Number(row.hot_leads),
        }));
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
            select ad.creative_id                           as creative_id,
                   i.objective_group                        as objective_group,
                   coalesce(sum(i.spend_minor), 0)          as spend_minor,
                   coalesce(sum(i.impressions), 0)          as impressions,
                   coalesce(sum(i.clicks), 0)               as clicks,
                   coalesce(sum(i.inline_link_clicks), 0)   as link_clicks,
                   coalesce(sum(i.results), 0)              as results,
                   coalesce(sum(i.purchase_value_minor), 0) as purchase_value_minor,
                   coalesce(sum(i.reach), 0)                as reach,
                   min(i.date)::text                        as first_seen
            from ad_insight_metrics i
            join ads ad on ad.id = i.ad_id
            where ${this.insightScope(accountId, since, until, {campaignId})}
            group by ad.creative_id, i.objective_group
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
                clicks: Number(row.clicks),
                linkClicks: Number(row.link_clicks),
                results: Number(row.results),
                purchaseValueMinor: Number(row.purchase_value_minor),
                frequency: ratio(impressions, reach),
                firstSeen: row.first_seen,
            };
        });
    }

    /**
     * One series per creative, keyed by `creative_id`: fatigue needs the whole cohort's daily shape in a
     * single round trip instead of one query per creative.
     */
    async getCreativeDailySeries(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{creativeId: string; points: CreativeDailyPoint[]}[]> {
        const rows = await this.database.execute(sql`
            select ad.creative_id                   as creative_id,
                   i.date::text                     as date,
                   coalesce(sum(i.spend_minor), 0)  as spend_minor,
                   coalesce(sum(i.impressions), 0)  as impressions,
                   coalesce(sum(i.clicks), 0)       as clicks,
                   coalesce(sum(i.reach), 0)        as reach,
                   coalesce(sum(i.results), 0)      as results
            from ad_insight_metrics i
            join ads ad on ad.id = i.ad_id
            where ${this.insightScope(accountId, since, until)}
            group by ad.creative_id, i.date
            order by 1 asc, 2 asc
        `) as unknown as CreativeDailyRow[];

        const byCreative = new Map<string, CreativeDailyPoint[]>();
        for (const row of rows) {
            const point = toDailyPoint(row);
            const bucket = byCreative.get(row.creative_id);
            if (bucket === undefined) {
                byCreative.set(row.creative_id, [point]);
            } else {
                bucket.push(point);
            }
        }

        return [...byCreative.entries()].map(([creativeId, points]) => ({creativeId, points}));
    }

    async getCreativeDaily(
        accountId: string,
        since: Date,
        until: Date,
        creativeId: string
    ): Promise<CreativeDailyPoint[]> {
        const series = await this.getCreativeDailySeries(accountId, since, until);
        return series.find((row) => row.creativeId === creativeId)?.points ?? [];
    }

    /** Ad sets that delivered each creative, with the budget and status that can cap the creative. */
    async getCreativeAllocation(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{creativeId: string; adsetId: string; dailyBudgetMinor: number | null; effectiveStatus: string | null}[]> {
        const rows = await this.database.execute(sql`
            select distinct ad.creative_id      as creative_id,
                   ad.adset_id                  as adset_id,
                   s.daily_budget_minor         as daily_budget_minor,
                   s.effective_status           as effective_status
            from ad_insight_metrics i
            join ads ad on ad.id = i.ad_id
            join ad_sets s on s.id = ad.adset_id
            where ${this.insightScope(accountId, since, until)}
        `) as unknown as CreativeAllocationRow[];

        return rows.map((row) => ({
            creativeId: row.creative_id,
            adsetId: row.adset_id,
            dailyBudgetMinor: row.daily_budget_minor === null ? null : Number(row.daily_budget_minor),
            effectiveStatus: row.effective_status,
        }));
    }

    /**
     * Video counters are summed without `coalesce`: `null` means the counter was never reported, `0`
     * means it was reported as zero, and the service must keep those apart.
     */
    async getCreativeVideoMetrics(
        accountId: string,
        since: Date,
        until: Date,
        creativeId: string
    ): Promise<{
        video3Sec: number | null;
        thruplay: number | null;
        p25: number | null;
        p50: number | null;
        p75: number | null;
        p100: number | null;
        impressions: number;
    }> {
        const [row] = await this.database.execute(sql`
            select sum(d.video_3_sec_watched_actions)    as video3_sec,
                   sum(d.video_thruplay_watched_actions) as thruplay,
                   sum(d.video_p25_watched_actions)      as p25,
                   sum(d.video_p50_watched_actions)      as p50,
                   sum(d.video_p75_watched_actions)      as p75,
                   sum(d.video_p100_watched_actions)     as p100,
                   coalesce(sum(d.impressions), 0)       as impressions
            from ad_insights_daily d
            join ads ad on ad.id = d.ad_id
            where d.account_id = ${accountId}
              and d.level = 'ad'
              and d.attribution_window = ${ATTRIBUTION_WINDOW}
              and d.date >= ${this.toDateString(since)}
              and d.date <= ${this.toDateString(until)}
              and ad.creative_id = ${creativeId}
        `) as unknown as CreativeVideoRow[];

        const toCount = (value: string | null) => (value === null ? null : Number(value));

        return {
            video3Sec: toCount(row?.video3_sec ?? null),
            thruplay: toCount(row?.thruplay ?? null),
            p25: toCount(row?.p25 ?? null),
            p50: toCount(row?.p50 ?? null),
            p75: toCount(row?.p75 ?? null),
            p100: toCount(row?.p100 ?? null),
            impressions: Number(row?.impressions ?? 0),
        };
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
                       coalesce(sum(i.results), 0)      as results
                from ad_insight_metrics i
                join ads ad on ad.id = i.ad_id
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
                   coalesce(sum(i.results), 0)       as results
            from creative_tags t
            join ads ad on ad.creative_id = t.creative_id
            join ad_insight_metrics i on i.ad_id = ad.id
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
            ${objectiveGroup === undefined ? sql`` : sql`and i.objective_group = ${objectiveGroup}`}`;
    }
}
