import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {AnalyticsRepository} from "@db/repositories/analytics.repository";
import {LeadRepository} from "@db/repositories/lead.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {TrackingHealthRepository} from "@db/repositories/tracking-health.repository";
import {CampaignRepository} from "@db/repositories/campaign.repository";
import {InsightAlertRepository} from "@db/repositories/insight-alert.repository";
import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {BadRequestError} from "@shared/errors";
import {bucketIndex, dateRange} from "@shared/dates";
import {round4} from "@shared/numbers";
import {resolvePeriod} from "@shared/period";
import {funnelHealth, type FunnelHealthResult, type HealthBadge} from "@shared/health";
import {ExplanationService, type ExplanationRef} from "@/modules/explanations/service";
import {formatMoney, formatNumber, formatPercent} from "@/modules/explanations/rules";
import {
    FUNNEL_STAGES,
    buildFunnelPairs,
    leakageCaption,
    pickLeakage,
    stageChannel,
    trackingStateOf,
    type FunnelCountsLike,
    type FunnelObjectiveGroup,
    type FunnelPair,
    type FunnelPairStatus,
    type FunnelStageKey,
    type FunnelStageSource,
    type SampleBlock,
    type StageDefinition,
    type TrackingState,
} from "@shared/funnel";

const SPARKLINE_BUCKETS = 7;
const HOT_LEAD_LIMIT = 5;

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

export interface SummaryQuery {
    accountId: string;
    since?: string;
    until?: string;
    campaignId?: string;
}

export interface KpiCard {
    value: number | null;
    deltaPct: number | null;
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
    period: {since: string; until: string; days: number};
    previousPeriod: {since: string; until: string};
    currency: string;
    timezone: string;
    cards: {
        spend: KpiCard;
        leads: KpiCard;
        cplQualified: KpiCard;
        roas: KpiCard;
        funnelHealth: KpiCard & {badge: HealthBadge | null};
    };
    health: FunnelHealthResult;
    series: {
        current: {date: string; spendMinor: number; leads: number}[];
        previous: {date: string; spendMinor: number; leads: number}[];
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
    objectiveGroup?: FunnelObjectiveGroup;
}

export interface LeakageQuery {
    accountId: string;
    since?: string;
    until?: string;
}

export interface StageDetailQuery {
    accountId: string;
    stageKey: string;
    since?: string;
    until?: string;
}

export interface FunnelStageView {
    key: FunnelStageKey;
    label: string;
    value: number;
    source: FunnelStageSource;
    estimated?: true;
    /** Nilai tahap dibagi tayangan pada periode berjalan; bukan pembanding lintas periode. */
    rateFromFirst: number | null;
}

export interface FunnelResponse {
    objectiveGroup: FunnelObjectiveGroup;
    period: {since: string; until: string; days: number};
    previousPeriod: {since: string; until: string};
    stages: FunnelStageView[];
    pairs: FunnelPair[];
    sample: SampleBlock;
    note?: string;
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
    explanation: ExplanationRef | null;
}

export interface StageComparisonRow {
    stageKey: FunnelStageKey;
    label: string;
    current: number;
    previous: number;
    changePct: number | null;
    conversionRate: number | null;
    status: FunnelPairStatus;
}

export interface StageDetailResponse {
    stageKey: FunnelStageKey;
    label: string;
    objectiveGroup: FunnelObjectiveGroup;
    period: {since: string; until: string; days: number};
    previousPeriod: {since: string; until: string};
    daily: {date: string; value: number}[];
    comparisonTable: StageComparisonRow[];
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
        private readonly explanations = new ExplanationService()
    ) {}

    async getSummary(tenantId: string, query: SummaryQuery): Promise<SummaryResponse> {
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
        const purchaseByBucket = new Array<number>(SPARKLINE_BUCKETS).fill(0);
        const qualifiedByBucket = new Array<number>(SPARKLINE_BUCKETS).fill(0);

        for (const point of trend) {
            const index = bucket(point.date);
            spendByBucket[index] += point.spendMinor;
            leadsByBucket[index] += point.leads;
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
        const spendCard: KpiCard = {value: current.spendMinor, deltaPct: spendDelta, sparkline: spendByBucket};
        if (spendDelta === null) {
            spendCard.note = "Perbandingan tidak tersedia karena periode sebelumnya tanpa belanja.";
        }

        const leadsDelta = percentChange(current.messagingStarted, previous.messagingStarted);
        const leadsCard: KpiCard = {value: current.messagingStarted, deltaPct: leadsDelta, sparkline: leadsByBucket};
        if (leadsDelta === null) {
            leadsCard.note = "Perbandingan tidak tersedia karena periode sebelumnya tanpa lead.";
        }

        const cplQualified = qualified > 0 ? Math.round(current.spendMinor / qualified) : null;
        const cplDelta = qualified > 0 && previousQualified > 0
            ? percentChange(current.spendMinor / qualified, previous.spendMinor / previousQualified)
            : null;
        const cplCard: KpiCard = {value: cplQualified, deltaPct: cplDelta, sparkline: cplSparkline};
        if (cplQualified === null) {
            cplCard.note = "Belum ada lead qualified pada periode ini";
        } else if (cplDelta === null) {
            cplCard.note = "Perbandingan tidak tersedia karena periode sebelumnya tanpa lead qualified.";
        }

        const roas = current.spendMinor > 0 ? round4(current.purchaseValueMinor / current.spendMinor) : null;
        const previousRoas = previous.spendMinor > 0 ? round4(previous.purchaseValueMinor / previous.spendMinor) : null;
        const roasDelta = roas !== null && previousRoas !== null ? percentChange(roas, previousRoas) : null;
        const roasCard: KpiCard = {value: roas, deltaPct: roasDelta, sparkline: roasSparkline};
        if (roas === null) {
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
            period: {since, until, days},
            previousPeriod: {since: previousSince, until: previousUntil},
            currency: account.currency,
            timezone: account.timezoneName,
            cards: {
                spend: spendCard,
                leads: leadsCard,
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

    async getFunnel(tenantId: string, query: FunnelQuery): Promise<FunnelResponse> {
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

            return {
                key: definition.key,
                label: definition.label,
                value,
                source: definition.source,
                ...(definition.estimated === true ? {estimated: true as const} : {}),
                rateFromFirst: impressions > 0 ? round4(value / impressions) : null,
            };
        });

        const response: FunnelResponse = {
            objectiveGroup,
            period: {since: period.since, until: period.until, days: period.days},
            previousPeriod: {since: period.previousSince, until: period.previousUntil},
            stages,
            pairs: funnel.pairs,
            sample: funnel.sample,
        };

        const note = this.funnelNote(trackingState, funnel.pairs);
        if (note !== undefined) response.note = note;

        return response;
    }

    async getLeakage(tenantId: string, query: LeakageQuery): Promise<LeakageResponse> {
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
                explanation: null,
            };
        }

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
            severity: leak.deltaPp !== null && leak.deltaPp <= -15
                ? "CRITICAL"
                : leak.deltaPp !== null && leak.deltaPp <= -5
                    ? "WARNING"
                    : null,
            trackingState,
            impactMinor: null,
            impactCaption: leak.estimatedGap === null ? null : leakageCaption(leak.estimatedGap),
            note: null,
            explanation,
        };
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

            return {
                stageKey: stage.key,
                label: stage.label,
                current,
                previous,
                changePct: percentChange(current, previous),
                conversionRate: incoming?.rate ?? null,
                status: incoming?.status ?? "normal",
            };
        });

        const response: StageDetailResponse = {
            stageKey: definition.key,
            label: definition.label,
            objectiveGroup,
            period: {since: period.since, until: period.until, days: period.days},
            previousPeriod: {since: period.previousSince, until: period.previousUntil},
            daily,
            comparisonTable,
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
        stages: {key: FunnelStageKey; value: number}[];
        previousStages: {key: FunnelStageKey; value: number}[];
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
                n: stages[0].value,
                denominator: 100,
                eligible: stages[0].value >= 100,
                gate: "≥ 100 tayangan",
            },
        };
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
                byDate.set(row.date, definition.read({...EMPTY_FUNNEL_COUNTS, ...row}));
            }
        } else {
            const rows = await this.analyticsRepo.getDailyLeadStages(accountId, start, end);
            for (const row of rows) {
                byDate.set(row.date, definition.read({...EMPTY_FUNNEL_COUNTS, ...row}));
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

function toSeriesPoint(point: {date: string; spendMinor: number; leads: number}): {
    date: string;
    spendMinor: number;
    leads: number;
} {
    return {date: point.date, spendMinor: point.spendMinor, leads: point.leads};
}

/** Percent change rounded to 2 decimals; `null` when the previous value is 0 (no usable baseline). */
function percentChange(current: number, previous: number): number | null {
    return previous === 0 ? null : Math.round(((current - previous) / previous) * 10000) / 100;
}

