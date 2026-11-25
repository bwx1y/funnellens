import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {AnalyticsRepository} from "@db/repositories/analytics.repository";
import {LeadRepository} from "@db/repositories/lead.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {TrackingHealthRepository} from "@db/repositories/tracking-health.repository";
import {CampaignRepository} from "@db/repositories/campaign.repository";
import {InsightAlertRepository} from "@db/repositories/insight-alert.repository";
import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {AggregationCache, AGGREGATION_CACHE_TTL_SECONDS} from "@infra/cache";
import {BadRequestError} from "@shared/errors";
import {bucketIndex, addDays, dateRange, dayCount, endOfDayUtc, startOfDayUtc} from "@shared/dates";
import {direction, round4, type DeltaDirection} from "@shared/numbers";
import {isPartialDay, periodLabel, resolvePeriod} from "@shared/period";
import {markCacheHit} from "@shared/request-context";
import {funnelHealth, type FunnelHealthResult, type HealthBadge} from "@shared/health";
import {ExplanationService, type ExplanationRef} from "@/modules/explanations/service";
import {formatMoney, formatNumber, formatPercent} from "@/modules/explanations/rules";
import {
    FUNNEL_STAGES,
    buildFunnelPairs,
    leakageCaption,
    missingEventNote,
    pickLeakage,
    pickPriorityStage,
    stageChannel,
    trackingStateOf,
    type FunnelCountsLike,
    type FunnelObjectiveGroup,
    type FunnelPair,
    type FunnelPairStatus,
    type FunnelStageKey,
    type FunnelStageSource,
    type PriorityStage,
    type SampleBlock,
    type StageDefinition,
    type TrackingState,
} from "@shared/funnel";

const SPARKLINE_BUCKETS = 7;
const HOT_LEAD_LIMIT = 5;
const HISTORY_PERIODS = 4;

/** Fill-in for the half of the counts a daily row does not carry; the stage reader picks its own field. */
const EMPTY_FUNNEL_COUNTS: FunnelCountsLike = {
    impressions: 0,
    linkClicks: 0,
    messagingStarted: 0,
    lpv: 0,
    viewContent: 0,
    addToCart: 0,
    purchase: 0,
    observed: 0,
    replied: 0,
    qualified: 0,
    closed: 0,
};

/** `null + n = n`, `null + null = null`: a counter stays "not reported" until a row reports it. */
function addNullable(total: number | null, value: number | null): number | null {
    if (value === null) return total;
    return (total ?? 0) + value;
}

/** The inspection steps a human runs when a stage drops; grouped by what is actually checked. */
const STAGE_CHECK_GROUPS = {
    campaign: [
        {key: "campaign_status", label: "Periksa status campaign di Meta", route: "/app/funnel"},
        {key: "objective_channel", label: "Bandingkan objective campaign dengan channel funnel", route: "/app/funnel"},
    ],
    reply: [
        {key: "reply_speed", label: "Periksa kecepatan balas CS", route: "/app/audience"},
        {key: "ctwa_attribution", label: "Cek atribusi CTWA pada lead baru", route: "/app/tracking"},
    ],
    tracking: [
        {key: "tracking_event", label: "Periksa tracking-health event terkait", route: "/app/tracking"},
        {key: "meta_vs_order", label: "Bandingkan event Meta dengan pesanan tercatat", route: "/app/tracking"},
    ],
    closing: [
        {key: "qualified_without_close", label: "Tinjau lead qualified tanpa closing", route: "/app/audience"},
        {key: "deal_value", label: "Periksa nilai deal yang belum tercatat", route: "/app/audience"},
    ],
};

/** Static per-stage inspection steps; `done` is always `false` because the server records no manual work. */
const STAGE_CHECKS: Record<FunnelStageKey, {key: string; label: string; route: string | null}[]> = {
    impressions: STAGE_CHECK_GROUPS.campaign,
    link_clicks: STAGE_CHECK_GROUPS.campaign,
    messaging_started: STAGE_CHECK_GROUPS.reply,
    observed: STAGE_CHECK_GROUPS.reply,
    replied: STAGE_CHECK_GROUPS.reply,
    lpv: STAGE_CHECK_GROUPS.tracking,
    view_content: STAGE_CHECK_GROUPS.tracking,
    add_to_cart: STAGE_CHECK_GROUPS.tracking,
    purchase: STAGE_CHECK_GROUPS.tracking,
    qualified: STAGE_CHECK_GROUPS.closing,
    closed: STAGE_CHECK_GROUPS.closing,
};

export interface SummaryQuery {
    accountId: string;
    since?: string;
    until?: string;
    campaignId?: string;
    days?: number;
}

export interface KpiCard {
    value: number | null;
    deltaPct: number | null;
    direction?: DeltaDirection | null;
    sparkline: (number | null)[] | null;
    note?: string;
}

export interface SummaryCampaignRow {
    campaignId: string;
    name: string;
    status: string | null;
    spendMinor: number;
    leads: number;
    costPerLeadMinor: number | null;
    hotLeadRate: number | null;
    roas: number | null;
    note?: string;
}

export interface SummaryResponse {
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    previousPeriod: {since: string; until: string; label: string};
    currency: string;
    timezone: string;
    cards: {
        spend: KpiCard;
        leads: KpiCard;
        clicks: KpiCard;
        cplQualified: KpiCard;
        roas: KpiCard;
        funnelHealth: KpiCard & {badge: HealthBadge | null};
    };
    health: FunnelHealthResult;
    series: {
        current: {date: string; spendMinor: number; leads: number; clicks: number}[];
        previous: {date: string; spendMinor: number; leads: number; clicks: number}[];
    };
    unrepliedHotLeads: {
        leadId: number;
        name: string | null;
        phoneMasked: string | null;
        confidence: string | null;
        waitingMinutes: number | null;
    }[];
    summary: {
        leakageNeedingAttention: number;
        unrepliedHotLeads: number;
        winnerCreatives: null;
        winnerCreativesNote: string;
    };
    campaigns: SummaryCampaignRow[];
    sample: {n: number; denominator: number; eligible: boolean; gate: string};
    explanation: ExplanationRef | null;
}

export interface FunnelQuery {
    accountId: string;
    since?: string;
    until?: string;
    campaignId?: string;
    days?: number;
    objectiveGroup?: FunnelObjectiveGroup;
}

/** The fields the aggregation cache keys on; every cached query is a superset of this. */
interface CacheableQuery {
    accountId: string;
    since?: string;
    until?: string;
    days?: number;
    campaignId?: string;
    objectiveGroup?: string;
}

export interface LeakageQuery {
    accountId: string;
    since?: string;
    until?: string;
    days?: number;
}

export interface StageDetailQuery {
    accountId: string;
    stageKey: string;
    since?: string;
    until?: string;
    days?: number;
}

export interface FunnelStageView {
    key: FunnelStageKey;
    label: string;
    /** `null` when Meta never reported the event in this period: a gap, not a zero. */
    value: number | null;
    /** Same stage in the previous period; `0` when that period had none. */
    previousValue: number | null;
    changeCount: number | null;
    source: FunnelStageSource;
    estimated?: true;
    /** Nilai tahap dibagi tayangan pada periode berjalan; bukan pembanding lintas periode. */
    rateFromFirst: number | null;
    /** `value / stages[0].value`, 4 decimals; `null` when the first stage is 0. */
    share: number | null;
    note?: string;
}

export interface FunnelResponse {
    objectiveGroup: FunnelObjectiveGroup;
    stageCount: number;
    stageKeys: FunnelStageKey[];
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    previousPeriod: {since: string; until: string; label: string};
    stages: FunnelStageView[];
    pairs: FunnelPair[];
    /** The drop the funnel page should open first; `null` when nothing eligible dropped. */
    priorityStage: PriorityStage | null;
    sample: SampleBlock;
    note?: string;
}

export interface LeakageCampaignRow {
    campaignId: string;
    name: string;
    rate: number | null;
    baseline: number | null;
    deltaPp: number | null;
    estimatedGap: number | null;
    eligible: boolean;
}

export interface LeakageResponse {
    transition: string | null;
    rate: number | null;
    baseline: number | null;
    deltaPp: number | null;
    estimatedGap: number | null;
    severity: "WARNING" | "CRITICAL" | null;
    trackingState: TrackingState;
    impactMinor: null;
    impactCaption: string | null;
    note: string | null;
    campaigns: LeakageCampaignRow[];
    explanation: ExplanationRef | null;
}

export interface LeakHistoryQuery {
    accountId: string;
    since?: string;
    until?: string;
    days?: number;
    objectiveGroup?: FunnelObjectiveGroup;
}

export interface LeakHistoryPeriod {
    since: string;
    until: string;
    label: string;
    transition: string | null;
    rate: number | null;
    baseline: number | null;
    deltaPp: number | null;
    estimatedGap: number | null;
    severity: "WARNING" | "CRITICAL" | null;
}

export interface LeakHistoryResponse {
    objectiveGroup: FunnelObjectiveGroup;
    /** Newest first; at most four consecutive windows. */
    periods: LeakHistoryPeriod[];
    stages: {key: FunnelStageKey; label: string; values: (number | null)[]}[];
    sample: SampleBlock;
    note?: string;
}

export interface StageComparisonRow {
    stageKey: FunnelStageKey;
    label: string;
    current: number | null;
    previous: number | null;
    changePct: number | null;
    direction: DeltaDirection | null;
    conversionRate: number | null;
    status: FunnelPairStatus;
}

export interface StageHistoryPoint {
    since: string;
    until: string;
    label: string;
    value: number | null;
}

export interface StageCheck {
    key: string;
    label: string;
    /** Manual step: the server never claims it was performed. */
    done: false;
    route: string | null;
}

export interface StageDetailResponse {
    stageKey: FunnelStageKey;
    label: string;
    objectiveGroup: FunnelObjectiveGroup;
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    previousPeriod: {since: string; until: string; label: string};
    daily: {date: string; value: number}[];
    comparisonTable: StageComparisonRow[];
    history: StageHistoryPoint[];
    explanation: ExplanationRef | null;
    checks: StageCheck[];
    sample: SampleBlock;
    note?: string;
}

/**
 * Overview endpoint. Every card value is either a real number or `null` with a note: a missing
 * measurement is never reported as zero.
 */
export class AnalyticsService {
    constructor(
        private readonly insightDailyRepo = new AdInsightDailyRepository(),
        private readonly analyticsRepo = new AnalyticsRepository(),
        private readonly leadRepo = new LeadRepository(),
        private readonly assessmentRepo = new LeadAssessmentRepository(),
        private readonly trackingHealthRepo = new TrackingHealthRepository(),
        private readonly campaignRepo = new CampaignRepository(),
        private readonly alertRepo = new InsightAlertRepository(),
        private readonly explanations = new ExplanationService(),
        private readonly cache = new AggregationCache()
    ) {}

    /**
     * Read-through cache for the three heavy aggregations. The key carries the tenant, so the lookup
     * happens before the account scope check — a second identical call must not reach Postgres at all.
     * `getStageDetail` is deliberately absent: `stageKey` multiplies the key space for little reuse.
     */
    private async cached<T>(
        endpoint: string,
        tenantId: string,
        query: CacheableQuery,
        build: () => Promise<T>,
        request?: Request
    ): Promise<T> {
        const key = this.cache.key({endpoint, tenantId, ...query});
        const hit = await this.cache.get<T>(key);
        if (hit !== null) {
            if (request !== undefined) markCacheHit(request);
            return hit;
        }

        const value = await build();
        await this.cache.set(key, value, AGGREGATION_CACHE_TTL_SECONDS);

        return value;
    }

    async getSummary(tenantId: string, query: SummaryQuery, request?: Request): Promise<SummaryResponse> {
        return this.cached("summary", tenantId, query, () => this.buildSummary(tenantId, query), request);
    }

    private async buildSummary(tenantId: string, query: SummaryQuery): Promise<SummaryResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);

        const {since, until, days, previousSince, previousUntil, start, end, prevStart, prevEnd} =
            resolvePeriod(account, query);
        const {accountId, campaignId} = query;

        const [
            current,
            previous,
            stages,
            previousStages,
            trend,
            prevTrend,
            dailyLeads,
            timeliness,
            tracking,
            hotLeads,
            hotLeadCount,
            activeAlerts,
            perf,
            campaigns,
            leadMetrics,
        ] = await Promise.all([
            this.analyticsRepo.getFunnelCounts(accountId, start, end, campaignId),
            this.analyticsRepo.getFunnelCounts(accountId, prevStart, prevEnd, campaignId),
            this.analyticsRepo.getLeadStageCounts(accountId, start, end, campaignId),
            this.analyticsRepo.getLeadStageCounts(accountId, prevStart, prevEnd, campaignId),
            this.insightDailyRepo.getDailyTrend(accountId, start, end, campaignId),
            this.insightDailyRepo.getDailyTrend(accountId, prevStart, prevEnd, campaignId),
            this.analyticsRepo.getDailyQualifiedLeads(accountId, start, end, campaignId),
            this.leadRepo.getReplyTimeliness(accountId, start, end),
            this.trackingHealthRepo.getLatestStatus(accountId),
            this.leadRepo.getUnrepliedHotLeads(accountId, HOT_LEAD_LIMIT),
            this.leadRepo.countUnrepliedHotLeads(accountId),
            this.alertRepo.findActiveByAccountId(accountId),
            this.insightDailyRepo.getCampaignPerformance(accountId, start, end),
            this.campaignRepo.findByAccountId(accountId),
            this.analyticsRepo.getCampaignLeadMetrics(accountId, start, end),
        ]);

        const bucket = (date: string) => bucketIndex(date, since, days);

        const spendByBucket = new Array<number>(SPARKLINE_BUCKETS).fill(0);
        const leadsByBucket = new Array<number>(SPARKLINE_BUCKETS).fill(0);
        const clicksByBucket = new Array<number>(SPARKLINE_BUCKETS).fill(0);
        const purchaseByBucket = new Array<number>(SPARKLINE_BUCKETS).fill(0);
        const qualifiedByBucket = new Array<number>(SPARKLINE_BUCKETS).fill(0);

        for (const point of trend) {
            const index = bucket(point.date);
            spendByBucket[index] += point.spendMinor;
            leadsByBucket[index] += point.leads;
            clicksByBucket[index] += point.linkClicks;
            purchaseByBucket[index] += point.purchaseValueMinor;
        }
        for (const point of dailyLeads) {
            qualifiedByBucket[bucket(point.date)] += point.qualified;
        }

        const cplSparkline = spendByBucket.map((spend, index) =>
            qualifiedByBucket[index] > 0 ? Math.round(spend / qualifiedByBucket[index]) : null
        );
        const roasSparkline = spendByBucket.map((spend, index) =>
            spend > 0 ? round4(purchaseByBucket[index] / spend) : null
        );

        const qualified = stages.qualified;
        const previousQualified = previousStages.qualified;

        const spendDelta = percentChange(current.spendMinor, previous.spendMinor);
        const spendCard: KpiCard = {
            value: current.spendMinor,
            deltaPct: spendDelta,
            direction: direction(spendDelta),
            sparkline: spendByBucket,
        };
        if (spendDelta === null) {
            spendCard.note = "Perbandingan tidak tersedia karena periode sebelumnya tanpa belanja.";
        }

        const leadsDelta = percentChange(current.messagingStarted, previous.messagingStarted);
        const leadsCard: KpiCard = {
            value: current.messagingStarted,
            deltaPct: leadsDelta,
            direction: direction(leadsDelta),
            sparkline: leadsByBucket,
        };
        if (leadsDelta === null) {
            leadsCard.note = "Perbandingan tidak tersedia karena periode sebelumnya tanpa lead.";
        }

        const clicksDelta = percentChange(current.linkClicks, previous.linkClicks);
        const clicksCard: KpiCard = {
            value: current.linkClicks,
            deltaPct: clicksDelta,
            direction: direction(clicksDelta),
            sparkline: clicksByBucket,
        };
        if (clicksDelta === null) {
            clicksCard.note = "Perbandingan tidak tersedia karena periode sebelumnya tanpa klik tautan.";
        }

        const cplQualified = qualified > 0 ? Math.round(current.spendMinor / qualified) : null;
        const cplDelta = qualified > 0 && previousQualified > 0
            ? percentChange(current.spendMinor / qualified, previous.spendMinor / previousQualified)
            : null;
        const cplCard: KpiCard = {
            value: cplQualified,
            deltaPct: cplDelta,
            direction: direction(cplDelta),
            sparkline: cplSparkline,
        };
        if (cplQualified === null) {
            cplCard.note = "Belum ada lead qualified pada periode ini";
        } else if (cplDelta === null) {
            cplCard.note = "Perbandingan tidak tersedia karena periode sebelumnya tanpa lead qualified.";
        }

        // ROAS is only meaningful when Meta reported purchases at all; a zero purchase value would
        // render as a real 0,00x and read as "the ads sold nothing" instead of "no data".
        const purchasesAvailable = current.purchase !== null;
        const roas = purchasesAvailable && current.spendMinor > 0
            ? round4(current.purchaseValueMinor / current.spendMinor)
            : null;
        const previousRoas = purchasesAvailable && previous.spendMinor > 0
            ? round4(previous.purchaseValueMinor / previous.spendMinor)
            : null;
        const roasDelta = roas !== null && previousRoas !== null ? percentChange(roas, previousRoas) : null;
        const roasCard: KpiCard = {
            value: roas,
            deltaPct: roasDelta,
            direction: direction(roasDelta),
            sparkline: roasSparkline,
        };
        if (!purchasesAvailable) {
            roasCard.note = "Event purchase tidak tersedia pada periode ini.";
        } else if (roas === null) {
            roasCard.note = "Belanja iklan nol pada periode ini";
        } else if (roasDelta === null) {
            roasCard.note = "Perbandingan tidak tersedia karena periode sebelumnya tanpa belanja.";
        }

        const health = funnelHealth({
            conversion: current.linkClicks > 0 ? current.results / current.linkClicks : null,
            baseline: previous.linkClicks > 0 ? previous.results / previous.linkClicks : null,
            onTimeReplyShare: timeliness.totalLeads > 0 ? timeliness.onTimeReplies / timeliness.totalLeads : null,
            emq: tracking.matchQuality,
            dedup: tracking.dedupRate,
        });

        const funnelCard: KpiCard & {badge: HealthBadge | null} = {
            value: health.score,
            deltaPct: null,
            direction: null,
            sparkline: null,
            badge: health.badge,
            note: health.score === null
                ? "Komponen pengukuran belum cukup"
                : "Delta skor tidak dihitung karena baseline historis belum tersedia.",
        };

        const unrepliedHotLeads = await Promise.all(hotLeads.map(async (lead) => {
            const assessment = await this.assessmentRepo.latestByLead(lead.id);
            return {
                leadId: lead.id,
                name: lead.name,
                phoneMasked: lead.phoneMasked,
                confidence: assessment?.confidence ?? null,
                waitingMinutes: lead.firstSeenAt === null
                    ? null
                    : Math.max(0, Math.floor((Date.now() - lead.firstSeenAt.getTime()) / 60_000)),
            };
        }));

        const statusById = new Map(campaigns.map((campaign) => [campaign.id, campaign.status]));
        const metricsByCampaign = new Map(leadMetrics.map((metrics) => [metrics.campaignId, metrics]));
        const performance = campaignId === undefined
            ? perf
            : perf.filter((row) => row.campaignId === campaignId);

        const campaignRows: SummaryCampaignRow[] = performance.map((row) => {
            const metrics = metricsByCampaign.get(row.campaignId);
            const attributedLeads = metrics?.attributedLeads ?? 0;
            const hotLeadRate = attributedLeads > 0
                ? Math.round(((metrics?.hotLeads ?? 0) / attributedLeads) * 10000) / 10000
                : null;

            const summaryRow: SummaryCampaignRow = {
                campaignId: row.campaignId,
                name: row.campaignName,
                status: statusById.get(row.campaignId) ?? null,
                spendMinor: row.spendMinor,
                leads: row.leads,
                costPerLeadMinor: row.costPerLeadMinor,
                hotLeadRate,
                roas: row.roas,
            };
            if (hotLeadRate === null) {
                summaryRow.note = "Belum ada lead teratribusi pada periode ini";
            }

            return summaryRow;
        });

        const explanation = await this.explanations.ensure({
            tenantId,
            accountId,
            context: "summary",
            entityType: "account",
            entityId: accountId,
            filter: {since, until},
            snapshotId: `${since}..${until}`,
            facts: {
                spend: formatMoney(current.spendMinor, account.currency),
                leads: formatNumber(current.messagingStarted),
                cpl: formatMoney(cplQualified, account.currency),
                health: formatNumber(health.score),
                badge: health.badge ?? "belum ada",
                hot: formatNumber(hotLeadCount),
            },
            evidenceIds: activeAlerts.map((alert) => String(alert.id)),
        });

        return {
            period: {
                since,
                until,
                days,
                label: periodLabel(since, until),
                isPartial: isPartialDay(until, account.timezoneName),
            },
            previousPeriod: {
                since: previousSince,
                until: previousUntil,
                label: periodLabel(previousSince, previousUntil),
            },
            currency: account.currency,
            timezone: account.timezoneName,
            cards: {
                spend: spendCard,
                leads: leadsCard,
                clicks: clicksCard,
                cplQualified: cplCard,
                roas: roasCard,
                funnelHealth: funnelCard,
            },
            health,
            series: {
                current: trend.map(toSeriesPoint),
                previous: prevTrend.map(toSeriesPoint),
            },
            unrepliedHotLeads,
            summary: {
                leakageNeedingAttention: activeAlerts.filter((alert) => alert.ruleKey.startsWith("leak_")).length,
                unrepliedHotLeads: hotLeadCount,
                winnerCreatives: null,
                winnerCreativesNote: "Status kreatif belum tersedia",
            },
            campaigns: campaignRows,
            sample: {
                n: current.impressions,
                denominator: 100,
                eligible: current.impressions >= 100,
                gate: "≥ 100 tayangan",
            },
            explanation,
        };
    }

    async getFunnel(tenantId: string, query: FunnelQuery, request?: Request): Promise<FunnelResponse> {
        return this.cached("funnel", tenantId, query, () => this.buildFunnel(tenantId, query), request);
    }

    private async buildFunnel(tenantId: string, query: FunnelQuery): Promise<FunnelResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const objectiveGroup = query.objectiveGroup ?? "wa";
        const period = resolvePeriod(account, query);

        const trackingState = trackingStateOf(await this.analyticsRepo.getTrackingSummary(query.accountId));
        const funnel = await this.loadFunnel({
            accountId: query.accountId,
            campaignId: query.campaignId,
            objectiveGroup,
            start: period.start,
            end: period.end,
            prevStart: period.prevStart,
            prevEnd: period.prevEnd,
            trackingState,
        });

        const impressions = funnel.stages[0].value;
        const stages: FunnelStageView[] = FUNNEL_STAGES[objectiveGroup].map((definition, index) => {
            const value = funnel.stages[index].value;
            const previousValue = funnel.previousStages[index].value;
            const ratio = (numerator: number | null): number | null =>
                numerator === null || impressions === null || impressions <= 0
                    ? null
                    : round4(numerator / impressions);

            return {
                key: definition.key,
                label: definition.label,
                value,
                previousValue,
                changeCount: value === null || previousValue === null ? null : value - previousValue,
                source: definition.source,
                ...(definition.estimated === true ? {estimated: true as const} : {}),
                rateFromFirst: ratio(value),
                share: ratio(value),
                // A stage Meta never reported says so instead of showing a zero.
                ...(value === null ? {note: missingEventNote(definition.key)} : {}),
            };
        });

        const response: FunnelResponse = {
            objectiveGroup,
            stageCount: stages.length,
            stageKeys: stages.map((stage) => stage.key),
            period: {
                since: period.since,
                until: period.until,
                days: period.days,
                label: periodLabel(period.since, period.until),
                isPartial: isPartialDay(period.until, account.timezoneName),
            },
            previousPeriod: {
                since: period.previousSince,
                until: period.previousUntil,
                label: periodLabel(period.previousSince, period.previousUntil),
            },
            stages,
            pairs: funnel.pairs,
            priorityStage: pickPriorityStage(funnel.pairs),
            sample: funnel.sample,
        };

        const note = this.funnelNote(trackingState, funnel.pairs);
        if (note !== undefined) response.note = note;

        return response;
    }

    async getLeakage(tenantId: string, query: LeakageQuery, request?: Request): Promise<LeakageResponse> {
        return this.cached("leakage", tenantId, query, () => this.buildLeakage(tenantId, query), request);
    }

    private async buildLeakage(tenantId: string, query: LeakageQuery): Promise<LeakageResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);

        const trackingState = trackingStateOf(await this.analyticsRepo.getTrackingSummary(query.accountId));
        // WhatsApp only: the caption speaks about lost chats, and `web` would need its own wording.
        const funnel = await this.loadFunnel({
            accountId: query.accountId,
            objectiveGroup: "wa",
            start: period.start,
            end: period.end,
            prevStart: period.prevStart,
            prevEnd: period.prevEnd,
            trackingState,
        });

        const leak = pickLeakage(funnel.pairs);
        if (leak === null) {
            return {
                transition: null,
                rate: null,
                baseline: null,
                deltaPp: null,
                estimatedGap: null,
                severity: null,
                trackingState,
                impactMinor: null,
                impactCaption: null,
                note: funnel.pairs.some((pair) => pair.eligible)
                    ? "Tidak ada transisi yang menurun pada periode ini."
                    : "Cakupan belum cukup untuk membandingkan konversi.",
                campaigns: [],
                explanation: null,
            };
        }

        const campaigns = await this.leakageCampaigns({
            accountId: query.accountId,
            from: leak.from,
            to: leak.to,
            start: period.start,
            end: period.end,
            prevStart: period.prevStart,
            prevEnd: period.prevEnd,
            trackingState,
        });

        const direction = leak.deltaPp === null ? undefined : leak.deltaPp < 0 ? "down" : "up";
        const explanation = await this.explanations.ensure({
            tenantId,
            accountId: query.accountId,
            context: "funnel_leak",
            entityType: "account",
            entityId: query.accountId,
            filter: {since: period.since, until: period.until},
            snapshotId: `${period.since}..${period.until}`,
            facts: {
                previous: formatPercent(leak.baseline),
                current: formatPercent(leak.rate),
                transition: `${leak.from}→${leak.to}`,
                gap: formatNumber(leak.estimatedGap),
                ...(direction === undefined ? {} : {__direction: direction}),
            },
            evidenceIds: [],
        });

        return {
            transition: `${leak.from}→${leak.to}`,
            rate: leak.rate,
            baseline: leak.baseline,
            deltaPp: leak.deltaPp,
            estimatedGap: leak.estimatedGap,
            severity: leakSeverity(leak.deltaPp),
            trackingState,
            impactMinor: null,
            impactCaption: leak.estimatedGap === null ? null : leakageCaption(leak.estimatedGap),
            note: null,
            campaigns,
            explanation,
        };
    }

    /**
     * Per-campaign view of the transition that won `pickLeakage`: the same current/previous windows,
     * narrowed to one campaign. Sorted by the biggest drop first, unmeasured campaigns last.
     */
    private async leakageCampaigns(params: {
        accountId: string;
        from: FunnelStageKey;
        to: FunnelStageKey;
        start: Date;
        end: Date;
        prevStart: Date;
        prevEnd: Date;
        trackingState: TrackingState;
    }): Promise<LeakageCampaignRow[]> {
        const {accountId, from, to, start, end, prevStart, prevEnd, trackingState} = params;
        const campaigns = await this.campaignRepo.findByAccountId(accountId);

        const rows = await Promise.all(campaigns.map(async (campaign): Promise<LeakageCampaignRow> => {
            const funnel = await this.loadFunnel({
                accountId,
                campaignId: campaign.id,
                objectiveGroup: "wa",
                start,
                end,
                prevStart,
                prevEnd,
                trackingState,
            });
            const pair = funnel.pairs.find((candidate) => candidate.from === from && candidate.to === to);

            return {
                campaignId: campaign.id,
                name: campaign.name,
                rate: pair?.rate ?? null,
                baseline: pair?.baseline ?? null,
                deltaPp: pair?.deltaPp ?? null,
                estimatedGap: pair?.estimatedGap ?? null,
                eligible: pair?.eligible ?? false,
            };
        }));

        return rows.sort((left, right) => {
            if (left.deltaPp === null && right.deltaPp === null) return left.name.localeCompare(right.name);
            if (left.deltaPp === null) return 1;
            if (right.deltaPp === null) return -1;
            if (left.deltaPp !== right.deltaPp) return left.deltaPp - right.deltaPp;
            return left.name.localeCompare(right.name);
        });
    }

    /**
     * The weakest transition of each of the last four consecutive windows, newest first. A window
     * without rows reports `null` stage values instead of a fabricated zero, and the window count is
     * capped by the days that actually have insight rows.
     */
    async getLeakHistory(tenantId: string, query: LeakHistoryQuery): Promise<LeakHistoryResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const objectiveGroup = query.objectiveGroup ?? "wa";
        const period = resolvePeriod(account, query);
        const trackingState = trackingStateOf(await this.analyticsRepo.getTrackingSummary(query.accountId));

        const available = await this.availableDays(query.accountId, period.until);
        const count = Math.min(HISTORY_PERIODS, Math.floor(available / period.days));
        const windows = trailingWindows(period.until, period.days, count);

        const snapshots = await Promise.all(windows.map(async (window) => {
            const {counts, hasMeta, hasLeads} = await this.windowCounts({
                accountId: query.accountId,
                objectiveGroup,
                since: window.since,
                until: window.until,
            });
            return {window, counts, hasMeta, hasLeads};
        }));

        const definitions = FUNNEL_STAGES[objectiveGroup];
        const periods: LeakHistoryPeriod[] = snapshots.map((snapshot, index) => {
            const older = snapshots[index + 1];
            const pairs = buildFunnelPairs(
                definitions.map((definition) => ({key: definition.key, value: definition.read(snapshot.counts)})),
                older === undefined
                    ? []
                    : definitions.map((definition) => ({key: definition.key, value: definition.read(older.counts)})),
                trackingState
            );
            const leak = pickLeakage(pairs);

            return {
                since: snapshot.window.since,
                until: snapshot.window.until,
                label: periodLabel(snapshot.window.since, snapshot.window.until),
                transition: leak === null ? null : `${leak.from}→${leak.to}`,
                rate: leak?.rate ?? null,
                baseline: leak?.baseline ?? null,
                deltaPp: leak?.deltaPp ?? null,
                estimatedGap: leak?.estimatedGap ?? null,
                severity: leakSeverity(leak?.deltaPp ?? null),
            };
        });

        const stages = definitions.map((definition) => ({
            key: definition.key,
            label: definition.label,
            values: snapshots.map((snapshot) => {
                const present = definition.source === "meta" ? snapshot.hasMeta : snapshot.hasLeads;
                return present ? definition.read(snapshot.counts) : null;
            }),
        }));

        const newest = snapshots[0];
        const sample: SampleBlock = newest === undefined
            ? {n: 0, denominator: 100, eligible: false, gate: "≥ 100 tayangan"}
            : {
                n: newest.counts.impressions,
                denominator: 100,
                eligible: newest.counts.impressions >= 100,
                gate: "≥ 100 tayangan",
            };

        const response: LeakHistoryResponse = {objectiveGroup, periods, stages, sample};

        if (snapshots.length === 0) {
            response.note = "Belum ada data insight untuk membangun riwayat kebocoran.";
        } else if (trackingState !== "up_to_date") {
            response.note = "Status tracking belum terkini sehingga seluruh transisi ditandai belum layak dibandingkan.";
        }

        return response;
    }

    async getStageDetail(tenantId: string, query: StageDetailQuery): Promise<StageDetailResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);

        const objectiveGroup = stageChannel(query.stageKey);
        if (objectiveGroup === null) throw new BadRequestError("Tahap funnel tidak dikenal");
        const definition = FUNNEL_STAGES[objectiveGroup].find((stage) => stage.key === query.stageKey);
        if (definition === undefined) throw new BadRequestError("Tahap funnel tidak dikenal");

        const period = resolvePeriod(account, query);
        const trackingState = trackingStateOf(await this.analyticsRepo.getTrackingSummary(query.accountId));
        const funnel = await this.loadFunnel({
            accountId: query.accountId,
            objectiveGroup,
            start: period.start,
            end: period.end,
            prevStart: period.prevStart,
            prevEnd: period.prevEnd,
            trackingState,
        });

        const dates = dateRange(period.since, period.until);
        const byDate = await this.dailyStageByDate({
            accountId: query.accountId,
            start: period.start,
            end: period.end,
            objectiveGroup,
            definition,
        });

        const daily = dates.map((date) => ({date, value: byDate.get(date) ?? 0}));

        const comparisonTable: StageComparisonRow[] = FUNNEL_STAGES[objectiveGroup].map((stage, index) => {
            const current = funnel.stages[index].value;
            const previous = funnel.previousStages[index].value;
            const incoming = index === 0 ? null : funnel.pairs[index - 1];
            const changePct = percentChange(current, previous);

            return {
                stageKey: stage.key,
                label: stage.label,
                current,
                previous,
                changePct,
                direction: direction(changePct),
                conversionRate: incoming?.rate ?? null,
                status: incoming?.status ?? "normal",
            };
        });

        const stageIndex = FUNNEL_STAGES[objectiveGroup].findIndex((stage) => stage.key === definition.key);
        const deltaPp = stageIndex === 0 ? null : funnel.pairs[stageIndex - 1].deltaPp ?? null;

        const available = await this.availableDays(query.accountId, period.until);
        const historyCount = Math.min(HISTORY_PERIODS, Math.floor(available / period.days));
        const history = await this.stageHistory({
            accountId: query.accountId,
            objectiveGroup,
            definition,
            until: period.until,
            days: period.days,
            count: historyCount,
        });

        const explanation = await this.explanations.ensure({
            tenantId,
            accountId: query.accountId,
            context: "funnel_stage",
            entityType: "stage",
            entityId: definition.key,
            filter: {since: period.since, until: period.until},
            snapshotId: `${period.since}..${period.until}`,
            facts: {
                stage: definition.label,
                current: formatNumber(funnel.stages[stageIndex].value),
                previous: formatNumber(funnel.previousStages[stageIndex].value),
                rate: formatPercent(stageIndex === 0 ? null : funnel.pairs[stageIndex - 1].rate),
                deltaPp: deltaPp === null ? "belum terukur" : `${formatNumber(deltaPp)} pp`,
                ...(deltaPp === null ? {} : {__direction: deltaPp < 0 ? "down" as const : "up" as const}),
            },
            evidenceIds: [],
        });

        const response: StageDetailResponse = {
            stageKey: definition.key,
            label: definition.label,
            objectiveGroup,
            period: {
                since: period.since,
                until: period.until,
                days: period.days,
                label: periodLabel(period.since, period.until),
                isPartial: isPartialDay(period.until, account.timezoneName),
            },
            previousPeriod: {
                since: period.previousSince,
                until: period.previousUntil,
                label: periodLabel(period.previousSince, period.previousUntil),
            },
            daily,
            comparisonTable,
            history,
            explanation,
            checks: STAGE_CHECKS[definition.key].map((check) => ({...check, done: false as const})),
            sample: funnel.sample,
        };

        const note = this.funnelNote(trackingState, funnel.pairs);
        if (note !== undefined) response.note = note;

        return response;
    }

    /** Shared by all three endpoints: the two periods of counts plus the derived pairs. */
    private async loadFunnel(params: {
        accountId: string;
        campaignId?: string;
        objectiveGroup: FunnelObjectiveGroup;
        start: Date;
        end: Date;
        prevStart: Date;
        prevEnd: Date;
        trackingState: TrackingState;
    }): Promise<{
        stages: {key: FunnelStageKey; value: number | null}[];
        previousStages: {key: FunnelStageKey; value: number | null}[];
        pairs: FunnelPair[];
        sample: SampleBlock;
    }> {
        const {accountId, campaignId, objectiveGroup, start, end, prevStart, prevEnd, trackingState} = params;

        const [current, previous, leadStages, previousLeadStages] = await Promise.all([
            this.analyticsRepo.getFunnelCounts(accountId, start, end, campaignId, objectiveGroup),
            this.analyticsRepo.getFunnelCounts(accountId, prevStart, prevEnd, campaignId, objectiveGroup),
            this.analyticsRepo.getLeadStageCounts(accountId, start, end, campaignId),
            this.analyticsRepo.getLeadStageCounts(accountId, prevStart, prevEnd, campaignId),
        ]);

        const toCounts = (
            meta: typeof current,
            leads: typeof leadStages
        ): FunnelCountsLike => ({
            impressions: meta.impressions,
            linkClicks: meta.linkClicks,
            messagingStarted: meta.messagingStarted,
            lpv: meta.lpv,
            viewContent: meta.viewContent,
            addToCart: meta.addToCart,
            purchase: meta.purchase,
            observed: leads.observed,
            replied: leads.replied,
            qualified: leads.qualified,
            closed: leads.closed,
        });

        const currentCounts = toCounts(current, leadStages);
        const previousCounts = toCounts(previous, previousLeadStages);
        const definitions = FUNNEL_STAGES[objectiveGroup];

        const stages = definitions.map((definition) => ({key: definition.key, value: definition.read(currentCounts)}));
        const previousStages = definitions.map((definition) => ({
            key: definition.key,
            value: definition.read(previousCounts),
        }));

        return {
            stages,
            previousStages,
            pairs: buildFunnelPairs(stages, previousStages, trackingState),
            sample: {
                n: stages[0].value ?? 0,
                denominator: 100,
                eligible: (stages[0].value ?? 0) >= 100,
                gate: "≥ 100 tayangan",
            },
        };
    }

    /** Days covered by insight rows up to `until`; `0` when the account never synced. */
    private async availableDays(accountId: string, until: string): Promise<number> {
        const oldest = await this.insightDailyRepo.getOldestInsightDate(accountId);
        return oldest === null ? 0 : Math.max(0, dayCount(oldest, until));
    }

    /**
     * Sums one window from the daily readers instead of the totals reader: the row count is what
     * separates "no data" from a real zero, and the totals reader collapses both to `0`.
     */
    private async windowCounts(params: {
        accountId: string;
        objectiveGroup: FunnelObjectiveGroup;
        since: string;
        until: string;
    }): Promise<{counts: FunnelCountsLike; hasMeta: boolean; hasLeads: boolean}> {
        const {accountId, objectiveGroup, since, until} = params;
        const start = startOfDayUtc(since);
        const end = endOfDayUtc(until);

        const [metaRows, leadRows] = await Promise.all([
            this.analyticsRepo.getDailyMetaStages(accountId, start, end, objectiveGroup),
            this.analyticsRepo.getDailyLeadStages(accountId, start, end),
        ]);

        const counts: FunnelCountsLike = {...EMPTY_FUNNEL_COUNTS};
        // The four web event counters start at `null` and only become numbers once a row reports them:
        // summing into a zero would turn "never reported" into "reported zero".
        counts.lpv = null;
        counts.viewContent = null;
        counts.addToCart = null;
        counts.purchase = null;
        for (const row of metaRows) {
            counts.impressions += row.impressions;
            counts.linkClicks += row.linkClicks;
            counts.messagingStarted += row.messagingStarted;
            counts.lpv = addNullable(counts.lpv, row.lpv);
            counts.viewContent = addNullable(counts.viewContent, row.viewContent);
            counts.addToCart = addNullable(counts.addToCart, row.addToCart);
            counts.purchase = addNullable(counts.purchase, row.purchase);
        }
        for (const row of leadRows) {
            counts.observed += row.observed;
            counts.replied += row.replied;
            counts.qualified += row.qualified;
            counts.closed += row.closed;
        }

        return {counts, hasMeta: metaRows.length > 0, hasLeads: leadRows.length > 0};
    }

    /** One value per trailing window, newest first; a window without rows stays `null`. */
    private async stageHistory(params: {
        accountId: string;
        objectiveGroup: FunnelObjectiveGroup;
        definition: StageDefinition;
        until: string;
        days: number;
        count: number;
    }): Promise<StageHistoryPoint[]> {
        const {accountId, objectiveGroup, definition, until, days, count} = params;
        const windows = trailingWindows(until, days, count);

        return Promise.all(windows.map(async (window) => {
            const byDate = await this.dailyStageByDate({
                accountId,
                start: startOfDayUtc(window.since),
                end: endOfDayUtc(window.until),
                objectiveGroup,
                definition,
            });
            const value = byDate.size === 0
                ? null
                : [...byDate.values()].reduce((sum, entry) => sum + entry, 0);

            return {
                since: window.since,
                until: window.until,
                label: periodLabel(window.since, window.until),
                value,
            };
        }));
    }

    /**
     * Zero-fills nothing: only dates with rows are returned, the caller fills the gaps. The stage
     * reader is reused so the daily series and the funnel totals agree by construction.
     */
    private async dailyStageByDate(params: {
        accountId: string;
        start: Date;
        end: Date;
        objectiveGroup: FunnelObjectiveGroup;
        definition: StageDefinition;
    }): Promise<Map<string, number>> {
        const {accountId, start, end, objectiveGroup, definition} = params;
        const byDate = new Map<string, number>();

        if (definition.source === "meta") {
            const rows = await this.analyticsRepo.getDailyMetaStages(accountId, start, end, objectiveGroup);
            for (const row of rows) {
                // A day where Meta reported no such event contributes no point: a zero would drag the
                // history average down for a measurement that simply did not happen.
                const value = definition.read({...EMPTY_FUNNEL_COUNTS, ...row});
                if (value !== null) byDate.set(row.date, value);
            }
        } else {
            const rows = await this.analyticsRepo.getDailyLeadStages(accountId, start, end);
            for (const row of rows) {
                const value = definition.read({...EMPTY_FUNNEL_COUNTS, ...row});
                if (value !== null) byDate.set(row.date, value);
            }
        }

        return byDate;
    }

    private funnelNote(trackingState: TrackingState, pairs: FunnelPair[]): string | undefined {
        if (trackingState !== "up_to_date") {
            return "Status tracking belum terkini sehingga seluruh transisi ditandai belum layak dibandingkan.";
        }
        if (pairs.every((pair) => !pair.eligible)) {
            return "Cakupan belum cukup untuk membandingkan konversi.";
        }
        return undefined;
    }

}

function toSeriesPoint(point: {date: string; spendMinor: number; leads: number; linkClicks: number}): {
    date: string;
    spendMinor: number;
    leads: number;
    clicks: number;
} {
    return {date: point.date, spendMinor: point.spendMinor, leads: point.leads, clicks: point.linkClicks};
}

interface TrailingWindow {
    since: string;
    until: string;
}

/** Consecutive `days`-long windows ending at `until`, newest first. */
function trailingWindows(until: string, days: number, count: number): TrailingWindow[] {
    return Array.from({length: Math.max(0, count)}, (_, index) => ({
        since: addDays(until, -(index + 1) * days + 1),
        until: addDays(until, -index * days),
    }));
}

function leakSeverity(deltaPp: number | null): "WARNING" | "CRITICAL" | null {
    if (deltaPp === null) return null;
    if (deltaPp <= -15) return "CRITICAL";
    if (deltaPp <= -5) return "WARNING";
    return null;
}

/** Percent change rounded to 2 decimals; `null` when the previous value is 0 (no usable baseline). */
function percentChange(current: number | null, previous: number | null): number | null {
    if (current === null || previous === null || previous === 0) return null;

    return Math.round(((current - previous) / previous) * 10000) / 100;
}

