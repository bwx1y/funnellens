import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {
    AnalyticsRepository,
    type CreativeAggregate,
    type CreativeDailyPoint,
    type CreativeLeadQuality,
} from "@db/repositories/analytics.repository";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {FacebookSdkAdapter} from "@infra/meta/adapters/facebook-sdk.adapter";
import type {IMetaAdStudiesAdapter} from "@infra/meta/base.meta";
import {BadRequestError, NotFoundError} from "@shared/errors";
import {Config} from "@/config";
import {addDays, dateRange, dayCount, endOfDayUtc, startOfDayUtc} from "@shared/dates";
import {median, round4} from "@shared/numbers";
import {isPartialDay, periodLabel, resolvePeriod, type ResolvedPeriod} from "@shared/period";
import type {SampleBlock} from "@shared/funnel";
import {CreativeTaggingQueue} from "@/modules/creative/queue";
import {ExplanationService, type ExplanationRef} from "@/modules/explanations/service";
import {formatNumber, formatPercent} from "@/modules/explanations/rules";
import {
    MIN_COMPARATORS,
    PATTERN_MIN_CREATIVES,
    PATTERN_MIN_PER_SIDE,
    PATTERN_Q,
    aggregateWindow,
    attentionDimension,
    benjaminiHochberg,
    contentCompleteness,
    contentElementStatuses,
    costDimension,
    costPattern,
    experimentState,
    fatigue,
    healthDimension,
    medianGapSign,
    overallStatus,
    qualityDimension,
    trailingCtrDeclineDays,
    trendDrop,
    type ContentElement,
    type ContentElementStatus,
    type CreativeDimension,
    type CreativeStatus,
    type ExperimentState,
    type FatigueStatus,
    type PatternState,
} from "@shared/creative";

type CreativeEntity = typeof AdCreativeEntity.$inferSelect;

export const TAG_TYPES = ["hook_type", "format", "tone", "product_theme"] as const;
export type TagType = typeof TAG_TYPES[number];

const CREATIVE_GATE = "≥ 5 kreatif";
const PATTERN_GATE = "≥ 8 kreatif";
const IMPRESSION_GATE = "≥ 3.000 tayangan";
const LEAD_GATE = "≥ 10 lead matang";
const IMPRESSION_DENOMINATOR = 3000;
const LEAD_DENOMINATOR = 10;
const BASELINE_DAYS = 7;
const RECENT_DAYS = 3;
const TREND_POINTS = 30;

const EMPTY_NOTE = "Belum ada kreatif dengan data iklan pada periode ini.";
const INCOMPLETE_NOTE = "Rentang pengamatan belum lengkap sehingga kejenuhan belum bisa dinilai.";
const NO_COPY_NOTE = "Elemen konten kreatif tidak teramati.";
const FEW_LEADS_NOTE = "Lead matang belum mencapai 10 sehingga hot rate belum diukur.";
const NO_VIDEO_NOTE = "Metrik video belum tersedia pada periode ini.";
const NO_SNAPSHOT_NOTE = "Pilihan kreatif tidak tersedia pada snapshot ini";

const DIMENSION_NAMES: {key: "cost" | "attention" | "quality" | "health"; label: string}[] = [
    {key: "cost", label: "biaya"},
    {key: "attention", label: "perhatian"},
    {key: "quality", label: "kualitas"},
    {key: "health", label: "kesehatan"},
];

export type CreativeSortKey = "spend" | "results" | "costPerResult" | "ctr" | "roas" | "firstSeen";

export interface CreativeListQuery {
    accountId: string;
    since?: string;
    until?: string;
    campaignId?: string;
    days?: number;
    sortBy?: CreativeSortKey;
}

export interface CreativeRangeQuery {
    accountId: string;
    since?: string;
    until?: string;
    days?: number;
}

export interface ComparisonQuery {
    accountId: string;
    snapshotId: number;
    creativeIds: string[];
}

export type CreativeTrendMetric = "impressions" | "clicks" | "ctr" | "spend";

export interface CreativeTrendQuery {
    accountId: string;
    metric: CreativeTrendMetric;
    since?: string;
    until?: string;
    days?: number;
    creativeId?: string;
}

/** One day of the trend. Every counter is `null` when the day has no insight row. */
export interface CreativeTrendDay {
    date: string;
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    spendMinor: number | null;
}

export interface CreativeTrendSeries {
    creativeId: string | null;
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    previousPeriod: {since: string; until: string; label: string};
    current: CreativeTrendDay[];
    previous: CreativeTrendDay[];
}

export interface CreativeTrendResponse {
    metric: CreativeTrendMetric;
    creativeId: string | null;
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    previousPeriod: {since: string; until: string; label: string};
    current: {date: string; value: number | null}[];
    previous: {date: string; value: number | null}[];
    total: {current: number; previous: number; deltaPct: number | null};
    sample: SampleBlock;
    note?: string;
}

export interface TagCreateBody {
    tagType: TagType;
    tagValue: string;
    source?: "manual" | "ai";
    confidence?: number;
}

export interface CreativeDimensions {
    cost: CreativeDimension;
    attention: CreativeDimension;
    quality: CreativeDimension;
    health: CreativeDimension;
}

export interface CreativeRow {
    creativeId: string;
    name: string | null;
    objectiveGroup: "wa" | "web";
    spendMinor: number;
    results: number;
    costPerResultMinor: number | null;
    ctr: number | null;
    roas: number | null;
    frequency: number | null;
    firstSeen: string;
    mature: boolean;
    fatigued: boolean;
    allocationLimited: boolean;
    dimensions: CreativeDimensions;
    status: CreativeStatus;
    note?: string;
}

export interface CreativeKpi {
    spendMinor: number;
    impressions: number;
    count: number;
    assessed: number;
    conversations: number | null;
    purchases: number | null;
    hotShare: number | null;
}

export interface CreativeCampaignSummary {
    campaignId: string;
    name: string | null;
    spendShare: number | null;
    messageCompleteness: number | null;
}

export interface CreativeTrendPoint {
    date: string;
    spendMinor: number;
    results: number;
}

export interface CreativeListResponse {
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    sortBy: CreativeSortKey;
    creatives: CreativeRow[];
    kpi: CreativeKpi;
    campaignSummary: CreativeCampaignSummary[];
    trend: CreativeTrendPoint[];
    sample: SampleBlock;
    note?: string;
    explanation: ExplanationRef | null;
}

export interface CreativeDetailResponse {
    creativeId: string;
    name: string | null;
    objectiveGroup: "wa" | "web";
    thumbnailUrl: string | null;
    imageUrl: string | null;
    videoLengthSeconds: number | null;
    videoPermalinkUrl: string | null;
    title: string | null;
    body: string | null;
    callToActionType: string | null;
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    metrics: {
        spendMinor: number;
        impressions: number;
        clicks: number;
        results: number;
        costPerResultMinor: number | null;
        ctr: number | null;
        roas: number | null;
        frequency: number | null;
        firstSeen: string | null;
    };
    daily: {
        date: string;
        spendMinor: number;
        ctr: number | null;
        cpmMinor: number | null;
        cprMinor: number | null;
        frequency: number | null;
    }[];
    dimensions: CreativeDimensions;
    video: {
        hookRate: number | null;
        holdRate: number | null;
        retention: {p25: number | null; p50: number | null; p75: number | null; p100: number | null};
    };
    sample: SampleBlock;
    note?: string;
}

export interface FatigueWindowRow {
    date: string;
    ctr: number | null;
    cpmMinor: number | null;
    cprMinor: number | null;
    frequency: number | null;
}

export interface FatigueRow {
    creativeId: string;
    name: string | null;
    status: FatigueStatus;
    drop: number | null;
    frequency: {base: number | null; now: number | null};
    base: FatigueWindowRow;
    now: FatigueWindowRow;
    consecutiveDays: number;
    complete: boolean;
    confounded: boolean;
    nextCheck: string | null;
    note?: string;
}

export interface FatigueResponse {
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    creatives: FatigueRow[];
    sample: SampleBlock;
    note?: string;
    explanation: ExplanationRef | null;
}

export interface PatternRow {
    tagType: TagType;
    tagValue: string;
    state: PatternState;
    withCount: number;
    withoutCount: number;
    withMedianCostPerResultMinor: number | null;
    withoutMedianCostPerResultMinor: number | null;
    medianYesMinor: number | null;
    medianNoMinor: number | null;
    supported: boolean;
    consistent: boolean;
    clear: boolean;
    pValue: number | null;
    adjustedPValue: number | null;
    significant: boolean;
}

export interface PatternsResponse {
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    attributes: PatternRow[];
    tested: number;
    sample: SampleBlock;
    note?: string;
    explanation: ExplanationRef | null;
}

export interface LeadQualityRow {
    creativeId: string;
    name: string | null;
    costPerConversationMinor: number | null;
    hotLeads: number;
    assessedMatureLeads: number;
    hotRate: number | null;
    completeness: number | null;
    contentElements: Record<ContentElement, ContentElementStatus>;
    messageEvidence: {present: number; assessed: number; expected: 7};
    sample: SampleBlock;
    note?: string;
}

export interface LeadQualityResponse {
    period: {since: string; until: string; days: number; label: string; isPartial: boolean};
    rows: LeadQualityRow[];
    sample: SampleBlock;
    note?: string;
    explanation: ExplanationRef | null;
}

export interface ComparisonItem {
    creativeId: string;
    name: string | null;
    spendMinor: number;
    results: number;
    costPerResultMinor: number | null;
    ctr: number | null;
    roas: number | null;
    frequency: number | null;
    firstSeen: string;
}

export interface ComparisonTab {
    goal: "wa" | "web";
    items: ComparisonItem[];
    canCompare: boolean;
    evidenceType: "observational";
    snapshotId: number;
    explanation: ExplanationRef | null;
}

export interface ExperimentStudy {
    id: string;
    name: string | null;
    type: string | null;
    startTime: string | null;
    endTime: string | null;
    resultsFirstAvailableDate: string | null;
    hasResult: boolean;
}

export interface ExperimentsResponse {
    state: ExperimentState;
    hasAccess: boolean;
    studyCount: number;
    studies: ExperimentStudy[];
    note?: string;
}

export interface TagRow {
    creativeId: string;
    tagType: TagType;
    tagValue: string;
    source: "manual" | "ai";
    confidence: number | null;
}

interface AllocationEntry {
    dailyBudgetMinor: number | null;
    effectiveStatus: string | null;
}

/** The account-wide cohort: percentiles always come from here, never from the filtered row set. */
interface Cohort {
    aggregates: CreativeAggregate[];
    qualityByCreative: Map<string, CreativeLeadQuality>;
    allocationByCreative: Map<string, AllocationEntry[]>;
    pointsByCreative: Map<string, CreativeDailyPoint[]>;
    creativeById: Map<string, CreativeEntity>;
    costCohort: (number | null)[];
    ctrCohort: (number | null)[];
    qualityCohort: (number | null)[];
}

/** One aggregate row with the ratios every endpoint needs; nothing here is a composite score. */
interface DerivedRow {
    aggregate: CreativeAggregate;
    ctr: number | null;
    costPerResultMinor: number | null;
    roas: number | null;
    frequency: number | null;
    qualityRate: number | null;
    qualitySample: number;
    ageDays: number;
    mature: boolean;
    allocationLimited: boolean;
}

function periodBlock(
    period: ResolvedPeriod,
    timezoneName: string
): {since: string; until: string; days: number; label: string; isPartial: boolean} {
    return {
        since: period.since,
        until: period.until,
        days: period.days,
        label: periodLabel(period.since, period.until),
        isPartial: isPartialDay(period.until, timezoneName),
    };
}

function creativeGate(n: number): SampleBlock {
    return {n, denominator: MIN_COMPARATORS, eligible: n >= MIN_COMPARATORS, gate: CREATIVE_GATE};
}

/**
 * Creative intelligence: four gated dimensions with a status, fatigue with confounder checks, tag
 * patterns, lead quality per creative, snapshot comparison, Meta A/B availability, and tagging.
 * No composite creative score exists: every number is a raw ratio or a percentile of the account cohort.
 */
export class CreativeService {
    constructor(
        private readonly analyticsRepo = new AnalyticsRepository(),
        private readonly creativeRepo = new AdCreativeRepository(),
        private readonly syncRunRepo = new SyncRunRepository(),
        private readonly metaConnectionRepo = new MetaConnectionRepository(),
        private readonly adStudies: IMetaAdStudiesAdapter = new FacebookSdkAdapter(),
        private readonly taggingQueue = new CreativeTaggingQueue(),
        private readonly explanations = new ExplanationService()
    ) {}

    async listCreatives(tenantId: string, query: CreativeListQuery): Promise<CreativeListResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);
        const [cohort, objectiveGroups, campaignSpend] = await Promise.all([
            this.loadCohort(query.accountId, period),
            this.analyticsRepo.getObjectiveGroups(query.accountId, query.campaignId),
            this.analyticsRepo.getCreativeCampaignSpend(query.accountId, period.start, period.end, query.campaignId),
        ]);

        const aggregates = query.campaignId === undefined
            ? cohort.aggregates
            : await this.analyticsRepo.getCreativeAggregates(
                query.accountId,
                period.start,
                period.end,
                query.campaignId
            );

        const sortBy: CreativeSortKey = query.sortBy ?? "spend";
        const creatives = aggregates
            .map((aggregate) => this.toCreativeRow(aggregate, cohort, period))
            .sort((left, right) => compareCreativeRows(left, right, sortBy));

        // A channel the account never ran has no KPI: `null`, never a fabricated zero.
        const [waCounts, webCounts] = await Promise.all([
            objectiveGroups.includes("wa")
                ? this.analyticsRepo.getFunnelCounts(query.accountId, period.start, period.end, query.campaignId, "wa")
                : null,
            objectiveGroups.includes("web")
                ? this.analyticsRepo.getFunnelCounts(query.accountId, period.start, period.end, query.campaignId, "web")
                : null,
        ]);

        const creativeIds = new Set(aggregates.map((aggregate) => aggregate.creativeId));
        let hotLeads = 0;
        let assessedMatureLeads = 0;
        for (const creativeId of creativeIds) {
            const quality = cohort.qualityByCreative.get(creativeId);
            hotLeads += quality?.hotLeads ?? 0;
            assessedMatureLeads += quality?.assessedMatureLeads ?? 0;
        }

        const kpi: CreativeKpi = {
            spendMinor: aggregates.reduce((sum, aggregate) => sum + aggregate.spendMinor, 0),
            impressions: aggregates.reduce((sum, aggregate) => sum + aggregate.impressions, 0),
            count: creatives.length,
            assessed: creatives.filter((row) => row.dimensions.cost.certainty !== "kurang").length,
            conversations: waCounts === null ? null : waCounts.messagingStarted,
            purchases: webCounts === null ? null : webCounts.purchase,
            hotShare: assessedMatureLeads === 0 ? null : round4(hotLeads / assessedMatureLeads),
        };

        const campaignTotals = new Map<string, {name: string | null; spendMinor: number; creativeIds: Set<string>}>();
        for (const row of campaignSpend) {
            const entry = campaignTotals.get(row.campaignId)
                ?? {name: row.campaignName, spendMinor: 0, creativeIds: new Set<string>()};
            entry.name = entry.name ?? row.campaignName;
            entry.spendMinor += row.spendMinor;
            entry.creativeIds.add(row.creativeId);
            campaignTotals.set(row.campaignId, entry);
        }
        const totalCampaignSpend = campaignSpend.reduce((sum, row) => sum + row.spendMinor, 0);
        const campaignSummary: CreativeCampaignSummary[] = [...campaignTotals.entries()]
            .sort(([leftId, left], [rightId, right]) =>
                right.spendMinor - left.spendMinor || compareIds(leftId, rightId))
            .map(([campaignId, entry]) => ({
                campaignId,
                name: entry.name,
                spendShare: totalCampaignSpend > 0 ? round4(entry.spendMinor / totalCampaignSpend) : null,
                messageCompleteness: this.messageCompleteness(cohort.creativeById, entry.creativeIds),
            }));

        // The cohort series starts at the first observation, which can predate the period.
        const trendByDate = new Map<string, {spendMinor: number; results: number}>();
        for (const [creativeId, points] of cohort.pointsByCreative) {
            if (!creativeIds.has(creativeId)) continue;
            for (const point of points) {
                if (point.date < period.since || point.date > period.until) continue;
                const day = trendByDate.get(point.date) ?? {spendMinor: 0, results: 0};
                day.spendMinor += point.spendMinor;
                day.results += point.results;
                trendByDate.set(point.date, day);
            }
        }
        const trend: CreativeTrendPoint[] = [...trendByDate.entries()]
            .sort(([left], [right]) => compareIds(left, right))
            .slice(-TREND_POINTS)
            .map(([date, totals]) => ({date, spendMinor: totals.spendMinor, results: totals.results}));

        const response: CreativeListResponse = {
            period: periodBlock(period, account.timezoneName),
            sortBy,
            creatives,
            kpi,
            campaignSummary,
            trend,
            sample: creativeGate(creatives.length),
            explanation: await this.explanations.ensure({
                tenantId,
                accountId: query.accountId,
                context: "creative_dimensions",
                entityType: "account",
                entityId: query.accountId,
                filter: {since: period.since, until: period.until, campaignId: query.campaignId ?? ""},
                snapshotId: `${period.since}..${period.until}`,
                facts: {
                    creatives: formatNumber(creatives.length),
                    fatigued: formatNumber(creatives.filter((row) => row.fatigued).length),
                    weak: formatNumber(creatives.filter((row) => row.status === "Pertimbangkan dihentikan").length),
                    gate: creativeGate(creatives.length).gate,
                },
                evidenceIds: creatives.map((row) => row.creativeId),
            }),
        };
        if (creatives.length === 0) response.note = EMPTY_NOTE;

        return response;
    }

    async getFatigue(tenantId: string, query: CreativeRangeQuery): Promise<FatigueResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);
        const cohort = await this.loadCohort(query.accountId, period);

        const seen = new Set<string>();
        const creatives: FatigueRow[] = [];
        for (const aggregate of cohort.aggregates) {
            if (seen.has(aggregate.creativeId)) continue;
            const points = cohort.pointsByCreative.get(aggregate.creativeId) ?? [];
            if (points.length === 0) continue;

            seen.add(aggregate.creativeId);
            creatives.push(this.buildFatigueRow(aggregate, points, cohort, period));
        }

        creatives.sort((left, right) => {
            if (left.drop === null && right.drop === null) return compareIds(left.creativeId, right.creativeId);
            if (left.drop === null) return 1;
            if (right.drop === null) return -1;
            if (left.drop === right.drop) return compareIds(left.creativeId, right.creativeId);
            return right.drop - left.drop;
        });

        const fatigued = creatives.filter((row) => row.status === "Jenuh");
        const drops = fatigued
            .map((row) => row.drop)
            .filter((drop): drop is number => drop !== null)
            .map((drop) => Math.abs(drop));
        const frequencies = fatigued
            .map((row) => row.now.frequency)
            .filter((frequency): frequency is number => frequency !== null);

        const response: FatigueResponse = {
            period: periodBlock(period, account.timezoneName),
            creatives,
            sample: creativeGate(creatives.length),
            explanation: await this.explanations.ensure({
                tenantId,
                accountId: query.accountId,
                context: "creative_fatigue",
                entityType: "account",
                entityId: query.accountId,
                filter: {since: period.since, until: period.until},
                snapshotId: `${period.since}..${period.until}`,
                facts: {
                    fatigued: formatNumber(fatigued.length),
                    drop: formatPercent(median(drops)),
                    frequency: formatNumber(frequencies.length === 0 ? null : Math.max(...frequencies)),
                    ...(fatigued.length === 0 ? {} : {__direction: "down" as const}),
                },
                evidenceIds: fatigued.map((row) => row.creativeId),
            }),
        };
        if (creatives.length === 0) response.note = EMPTY_NOTE;

        return response;
    }

    async getPatterns(tenantId: string, query: CreativeRangeQuery): Promise<PatternsResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);
        const cohort = await this.loadCohort(query.accountId, period);

        const cohortIds = new Set(cohort.aggregates.map((aggregate) => aggregate.creativeId));
        const cprByCreative = new Map<string, number>();
        for (const aggregate of cohort.aggregates) {
            if (aggregate.results <= 0 || cprByCreative.has(aggregate.creativeId)) continue;
            cprByCreative.set(aggregate.creativeId, Math.round(aggregate.spendMinor / aggregate.results));
        }

        // Consistency compares the same tag membership in both halves of the window.
        const halfDays = Math.floor(period.days / 2);
        const firstHalfEnd = halfDays >= 1 ? addDays(period.since, halfDays - 1) : period.since;
        const secondHalfStart = addDays(firstHalfEnd, 1);
        const [firstHalfAggregates, secondHalfAggregates] = await Promise.all([
            this.analyticsRepo.getCreativeAggregates(query.accountId, period.start, endOfDayUtc(firstHalfEnd)),
            this.analyticsRepo.getCreativeAggregates(query.accountId, startOfDayUtc(secondHalfStart), period.end),
        ]);
        const firstHalfCpr = halfCostPerResult(firstHalfAggregates);
        const secondHalfCpr = halfCostPerResult(secondHalfAggregates);

        const halfSign = (costPerResult: Map<string, number>, tagged: Set<string>): -1 | 1 | null => {
            const withAttr: number[] = [];
            const withoutAttr: number[] = [];
            for (const [creativeId, cpr] of costPerResult) {
                (tagged.has(creativeId) ? withAttr : withoutAttr).push(cpr);
            }
            return medianGapSign(withAttr, withoutAttr);
        };

        const groupsByTagType = await Promise.all(
            TAG_TYPES.map((tagType) => this.analyticsRepo.getPatternGroups(
                query.accountId,
                period.start,
                period.end,
                tagType
            ))
        );

        const attributes: PatternRow[] = [];
        TAG_TYPES.forEach((tagType, index) => {
            for (const group of groupsByTagType[index]) {
                const tagged = new Set(group.creativeIds);

                const withAttr: number[] = [];
                for (const creativeId of tagged) {
                    if (!cohortIds.has(creativeId)) continue;
                    const cpr = cprByCreative.get(creativeId);
                    if (cpr !== undefined) withAttr.push(cpr);
                }

                const withoutAttr: number[] = [];
                for (const [creativeId, cpr] of cprByCreative) {
                    if (!tagged.has(creativeId)) withoutAttr.push(cpr);
                }

                const pattern = costPattern(withAttr, withoutAttr);
                const firstSign = halfSign(firstHalfCpr, tagged);
                const secondSign = halfSign(secondHalfCpr, tagged);
                const consistent = firstSign !== null && firstSign === secondSign;
                attributes.push({
                    tagType,
                    tagValue: group.tagValue,
                    state: pattern.state,
                    withCount: withAttr.length,
                    withoutCount: withoutAttr.length,
                    withMedianCostPerResultMinor: pattern.withMedian,
                    withoutMedianCostPerResultMinor: pattern.withoutMedian,
                    medianYesMinor: pattern.withMedian,
                    medianNoMinor: pattern.withoutMedian,
                    supported: false,
                    consistent,
                    clear: false,
                    pValue: pattern.pValue,
                    adjustedPValue: null,
                    significant: false,
                });
            }
        });

        // One correction across every tested row of every tag type, not one per tag type.
        const correction = benjaminiHochberg(attributes.map((row) => row.pValue), PATTERN_Q);
        attributes.forEach((row, index) => {
            const adjusted = correction.adjusted[index];
            row.adjustedPValue = adjusted === null ? null : round4(adjusted);
            row.significant = correction.significant[index];
            row.supported = row.significant
                && row.withCount >= PATTERN_MIN_PER_SIDE
                && row.withoutCount >= PATTERN_MIN_PER_SIDE;
            row.clear = row.supported && row.consistent;

            const insufficient = row.withCount < PATTERN_MIN_PER_SIDE
                || row.withoutCount < PATTERN_MIN_PER_SIDE
                || cohortIds.size < PATTERN_MIN_CREATIVES;
            row.state = row.clear
                ? "eligible_for_test"
                : insufficient
                    ? "insufficient_sample"
                    : "no_clear_pattern";
        });

        const significant = attributes.filter((row) => row.significant);
        const strongest = significant.reduce<PatternRow | null>(
            (best, row) => best === null
                || (row.adjustedPValue ?? Infinity) < (best.adjustedPValue ?? Infinity)
                ? row
                : best,
            null
        );

        const response: PatternsResponse = {
            period: periodBlock(period, account.timezoneName),
            attributes,
            tested: attributes.filter((row) => row.pValue !== null).length,
            sample: {
                n: cohortIds.size,
                denominator: PATTERN_MIN_CREATIVES,
                eligible: cohortIds.size >= PATTERN_MIN_CREATIVES,
                gate: PATTERN_GATE,
            },
            explanation: await this.explanations.ensure({
                tenantId,
                accountId: query.accountId,
                context: "creative_pattern",
                entityType: "account",
                entityId: query.accountId,
                filter: {since: period.since, until: period.until},
                snapshotId: `${period.since}..${period.until}`,
                facts: {
                    tested: formatNumber(attributes.filter((row) => row.pValue !== null).length),
                    significant: formatNumber(significant.length),
                    attribute: strongest === null ? "belum ada" : `${strongest.tagType}=${strongest.tagValue}`,
                },
                evidenceIds: significant.map((row) => `${row.tagType}=${row.tagValue}`),
            }),
        };
        if (cohortIds.size < PATTERN_MIN_CREATIVES) {
            response.note = "Kreatif pada periode ini belum mencapai 8 sehingga pola belum bisa diuji.";
        }

        return response;
    }

    async getLeadQuality(tenantId: string, query: CreativeRangeQuery): Promise<LeadQualityResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);
        const [cohort, creatives] = await Promise.all([
            this.loadCohort(query.accountId, period),
            this.creativeRepo.findByAccountId(query.accountId),
        ]);

        const creativeById = new Map(creatives.map((creative) => [creative.id, creative]));
        const seen = new Set<string>();
        const rows: LeadQualityRow[] = [];

        for (const aggregate of cohort.aggregates) {
            if (seen.has(aggregate.creativeId)) continue;
            seen.add(aggregate.creativeId);

            const quality = cohort.qualityByCreative.get(aggregate.creativeId);
            const creative = creativeById.get(aggregate.creativeId) ?? null;
            const hotLeads = quality?.hotLeads ?? 0;
            const assessedMatureLeads = quality?.assessedMatureLeads ?? 0;

            const statuses = contentElementStatuses({
                title: creative?.title ?? null,
                body: creative?.body ?? null,
                callToActionType: creative?.callToActionType ?? null,
            });
            const {completeness, evidence} = contentCompleteness(statuses);

            const row: LeadQualityRow = {
                creativeId: aggregate.creativeId,
                name: creative?.name ?? null,
                costPerConversationMinor: aggregate.results > 0
                    ? Math.round(aggregate.spendMinor / aggregate.results)
                    : null,
                hotLeads,
                assessedMatureLeads,
                hotRate: assessedMatureLeads >= LEAD_DENOMINATOR
                    ? round4(hotLeads / assessedMatureLeads)
                    : null,
                completeness,
                contentElements: statuses,
                messageEvidence: evidence,
                sample: {
                    n: assessedMatureLeads,
                    denominator: LEAD_DENOMINATOR,
                    eligible: assessedMatureLeads >= LEAD_DENOMINATOR,
                    gate: LEAD_GATE,
                },
            };

            // The copy is the narrower gate: without it no element is readable at all.
            if (completeness === null) row.note = NO_COPY_NOTE;
            else if (row.hotRate === null) row.note = FEW_LEADS_NOTE;

            rows.push(row);
        }

        const best = rows.reduce<LeadQualityRow | null>(
            (top, row) => row.hotRate === null
                ? top
                : top === null || top.hotRate === null || row.hotRate > top.hotRate
                    ? row
                    : top,
            null
        );

        const response: LeadQualityResponse = {
            period: periodBlock(period, account.timezoneName),
            rows,
            sample: creativeGate(rows.length),
            explanation: await this.explanations.ensure({
                tenantId,
                accountId: query.accountId,
                context: "lead_quality",
                entityType: "account",
                entityId: query.accountId,
                filter: {since: period.since, until: period.until},
                snapshotId: `${period.since}..${period.until}`,
                facts: {
                    creatives: formatNumber(rows.length),
                    hotRate: formatPercent(best?.hotRate ?? null),
                    best: best === null ? "belum ada" : best.name ?? best.creativeId,
                },
                evidenceIds: rows.map((row) => row.creativeId),
            }),
        };
        if (rows.length === 0) response.note = EMPTY_NOTE;

        return response;
    }

    async compareCreatives(tenantId: string, body: ComparisonQuery): Promise<ComparisonTab[]> {
        await requireAccountScope(tenantId, body.accountId);

        const snapshot = await this.syncRunRepo.findById(body.snapshotId);
        if (
            snapshot === null
            || snapshot.accountId !== body.accountId
            || snapshot.status !== "SUCCESS"
            || snapshot.resource !== "insights"
            || snapshot.rangeSince === null
            || snapshot.rangeUntil === null
        ) {
            throw new BadRequestError(NO_SNAPSHOT_NOTE);
        }

        const ids = [...new Set(body.creativeIds)];
        const since = startOfDayUtc(snapshot.rangeSince);
        const until = endOfDayUtc(snapshot.rangeUntil);

        const eligible = await this.creativeRepo.eligibleByIds(body.accountId, ids, {since, until});
        if (eligible.length !== ids.length) throw new BadRequestError(NO_SNAPSHOT_NOTE);

        const aggregates = await this.analyticsRepo.getCreativeAggregates(body.accountId, since, until);
        const byCreative = new Map<string, CreativeAggregate>();
        for (const aggregate of aggregates) {
            if (!byCreative.has(aggregate.creativeId)) byCreative.set(aggregate.creativeId, aggregate);
        }

        const tabs: ComparisonTab[] = [];
        for (const goal of ["wa", "web"] as const) {
            const items: ComparisonItem[] = [];
            for (const creativeId of ids) {
                const aggregate = byCreative.get(creativeId);
                if (aggregate === undefined || aggregate.objectiveGroup !== goal) continue;

                items.push({
                    creativeId,
                    name: null,
                    spendMinor: aggregate.spendMinor,
                    results: aggregate.results,
                    costPerResultMinor: aggregate.results > 0
                        ? Math.round(aggregate.spendMinor / aggregate.results)
                        : null,
                    ctr: aggregate.impressions > 0 ? round4(aggregate.clicks / aggregate.impressions) : null,
                    roas: aggregate.spendMinor > 0
                        ? round4(aggregate.purchaseValueMinor / aggregate.spendMinor)
                        : null,
                    frequency: aggregate.frequency === null ? null : round4(aggregate.frequency),
                    firstSeen: aggregate.firstSeen,
                });
            }

            if (items.length === 0) continue;

            const left = items[0];
            const right = items[1];
            const delta = left !== undefined && right !== undefined
                && left.costPerResultMinor !== null && right.costPerResultMinor !== null
                && right.costPerResultMinor > 0
                ? round4((left.costPerResultMinor - right.costPerResultMinor) / right.costPerResultMinor)
                : null;
            const direction = delta === null ? undefined : delta < 0 ? "down" : "up";
            const metric = goal === "wa" ? "biaya per percakapan" : "biaya per hasil";

            tabs.push({
                goal,
                items,
                canCompare: items.length >= 2,
                evidenceType: "observational",
                snapshotId: snapshot.id,
                explanation: await this.explanations.ensure({
                    tenantId,
                    accountId: body.accountId,
                    context: "comparison",
                    entityType: "creative",
                    entityId: `${ids.join("|")}:${goal}`,
                    filter: {creativeIds: [...ids].sort(), goal},
                    snapshotId: String(snapshot.id),
                    facts: {
                        left: left?.name ?? left?.creativeId ?? "kreatif",
                        right: right?.name ?? right?.creativeId ?? "kreatif",
                        metric,
                        delta: formatPercent(delta),
                        ...(direction === undefined ? {} : {__direction: direction}),
                    },
                    evidenceIds: ids,
                }),
            });
        }

        if (tabs.length === 0) throw new BadRequestError(NO_SNAPSHOT_NOTE);
        return tabs;
    }

    async getExperiments(tenantId: string, query: {accountId: string}): Promise<ExperimentsResponse> {
        await requireAccountScope(tenantId, query.accountId);

        const connection = await this.metaConnectionRepo.findByTenantId(tenantId);
        if (connection === null) {
            return {
                state: "permission_missing",
                hasAccess: false,
                studyCount: 0,
                studies: [],
                note: "Koneksi Meta belum tersedia.",
            };
        }

        const {hasAccess, studies} = await this.adStudies.getAdStudies(connection.accessToken, connection.metaUserId);
        const state = experimentState(hasAccess, studies.length, studies.some((study) => study.resultsFirstAvailableDate !== null));

        const response: ExperimentsResponse = {
            state,
            hasAccess,
            studyCount: studies.length,
            studies: studies.map((study) => ({
                ...study,
                hasResult: study.resultsFirstAvailableDate !== null,
            })),
        };

        if (state === "permission_missing") response.note = "Izin Meta belum mencakup ad studies.";
        else if (state === "no_studies") response.note = "Belum ada studi A/B pada akun Meta ini.";
        else if (state === "results_pending") response.note = "Studi sudah ada tetapi hasilnya belum tersedia.";

        return response;
    }

    async getCreativeDetail(
        tenantId: string,
        creativeId: string,
        query: CreativeRangeQuery
    ): Promise<CreativeDetailResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);

        const creative = await this.creativeRepo.findByIdForTenant(tenantId, creativeId);
        if (creative === null) throw new NotFoundError("Kreatif tidak ditemukan");

        const [cohort, points, video] = await Promise.all([
            this.loadCohort(query.accountId, period),
            this.analyticsRepo.getCreativeDaily(query.accountId, period.start, period.end, creativeId),
            this.analyticsRepo.getCreativeVideoMetrics(query.accountId, period.start, period.end, creativeId),
        ]);

        const aggregate = cohort.aggregates.find((row) => row.creativeId === creativeId) ?? null;

        const videoMetrics = {
            hookRate: video.video3Sec !== null && video.impressions > 0
                ? round4(video.video3Sec / video.impressions)
                : null,
            holdRate: video.thruplay !== null && video.video3Sec !== null && video.video3Sec > 0
                ? round4(video.thruplay / video.video3Sec)
                : null,
            retention: {
                p25: retentionRate(video.p25, video.video3Sec),
                p50: retentionRate(video.p50, video.video3Sec),
                p75: retentionRate(video.p75, video.video3Sec),
                p100: retentionRate(video.p100, video.video3Sec),
            },
        };

        const impressions = aggregate?.impressions ?? 0;
        const sample: SampleBlock = {
            n: impressions,
            denominator: IMPRESSION_DENOMINATOR,
            eligible: impressions >= IMPRESSION_DENOMINATOR,
            gate: IMPRESSION_GATE,
        };

        const response: CreativeDetailResponse = {
            creativeId,
            name: creative.name ?? null,
            objectiveGroup: aggregate?.objectiveGroup ?? "wa",
            thumbnailUrl: creative.thumbnailUrl ?? null,
            imageUrl: creative.imageUrl ?? null,
            videoLengthSeconds: creative.videoLengthSeconds === null ? null : Number(creative.videoLengthSeconds),
            videoPermalinkUrl: creative.videoPermalinkUrl ?? null,
            title: creative.title ?? null,
            body: creative.body ?? null,
            callToActionType: creative.callToActionType ?? null,
            period: periodBlock(period, account.timezoneName),
            metrics: {
                spendMinor: aggregate?.spendMinor ?? 0,
                impressions,
                clicks: aggregate?.clicks ?? 0,
                results: aggregate?.results ?? 0,
                costPerResultMinor: aggregate === null
                    ? null
                    : ratioOrNull(aggregate.spendMinor, aggregate.results, true),
                ctr: aggregate === null ? null : ratioOrNull(aggregate.clicks, aggregate.impressions, false),
                roas: aggregate === null ? null : ratioOrNull(aggregate.purchaseValueMinor, aggregate.spendMinor, false),
                frequency: aggregate?.frequency === null || aggregate === null ? null : round4(aggregate.frequency),
                firstSeen: aggregate?.firstSeen ?? null,
            },
            daily: points.map((point) => ({
                date: point.date,
                spendMinor: point.spendMinor,
                ctr: point.ctr,
                cpmMinor: point.cpmMinor,
                cprMinor: point.cprMinor,
                frequency: point.frequency,
            })),
            dimensions: aggregate === null
                ? {
                    cost: {label: null, certainty: "kurang"},
                    attention: {label: null, certainty: "kurang"},
                    quality: {label: null, certainty: "kurang"},
                    health: {label: null, certainty: "kurang"},
                }
                : this.toCreativeRow(aggregate, cohort, period).dimensions,
            video: videoMetrics,
            sample,
        };

        const notes: string[] = [];
        if (videoMetrics.hookRate === null || videoMetrics.holdRate === null) notes.push(NO_VIDEO_NOTE);

        const gated = DIMENSION_NAMES
            .filter(({key}) => response.dimensions[key].certainty === "kurang")
            .map(({label}) => label);
        if (gated.length > 0) notes.push(`Dimensi ${gated.join(", ")} belum lolos gerbang sampel.`);
        if (aggregate === null) notes.push("Belum ada data iklan pada periode ini.");

        if (notes.length > 0) response.note = notes.join(" ");
        return response;
    }

    /**
     * Day-by-day counters for the selected period and the one before it, one entry per calendar day.
     * Days without insight rows keep `null` so the chart shows a gap, never a fabricated zero. The CSV
     * export reads this same series, which is what keeps the file and the JSON identical.
     */
    async getTrendSeries(tenantId: string, query: CreativeTrendQuery): Promise<CreativeTrendSeries> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);

        const [currentSeries, previousSeries] = await Promise.all([
            this.analyticsRepo.getCreativeDailySeries(query.accountId, period.start, period.end),
            this.analyticsRepo.getCreativeDailySeries(query.accountId, period.prevStart, period.prevEnd),
        ]);

        const toDays = (
            series: {creativeId: string; points: CreativeDailyPoint[]}[],
            dates: string[]
        ): CreativeTrendDay[] => {
            const byDate = new Map<string, CreativeTrendDay>();
            for (const entry of series) {
                if (query.creativeId !== undefined && entry.creativeId !== query.creativeId) continue;
                for (const point of entry.points) {
                    const day = byDate.get(point.date) ?? {
                        date: point.date,
                        impressions: 0,
                        clicks: 0,
                        ctr: null,
                        spendMinor: 0,
                    };
                    day.impressions = (day.impressions ?? 0) + point.impressions;
                    day.clicks = (day.clicks ?? 0) + point.clicks;
                    day.spendMinor = (day.spendMinor ?? 0) + point.spendMinor;
                    byDate.set(point.date, day);
                }
            }

            return dates.map((date) => {
                const day = byDate.get(date);
                if (day === undefined) {
                    return {date, impressions: null, clicks: null, ctr: null, spendMinor: null};
                }

                return {...day, ctr: ratioOrNull(day.clicks ?? 0, day.impressions ?? 0, false)};
            });
        };

        return {
            creativeId: query.creativeId ?? null,
            period: periodBlock(period, account.timezoneName),
            previousPeriod: {
                since: period.previousSince,
                until: period.previousUntil,
                label: periodLabel(period.previousSince, period.previousUntil),
            },
            current: toDays(currentSeries, dateRange(period.since, period.until)),
            previous: toDays(previousSeries, dateRange(period.previousSince, period.previousUntil)),
        };
    }

    /** The selected metric over the same two windows; totals use the summed counters, not day means. */
    async getTrend(tenantId: string, query: CreativeTrendQuery): Promise<CreativeTrendResponse> {
        const series = await this.getTrendSeries(tenantId, query);

        const valueOf = (day: CreativeTrendDay): number | null => {
            switch (query.metric) {
                case "impressions":
                    return day.impressions;
                case "clicks":
                    return day.clicks;
                case "ctr":
                    return day.ctr;
                case "spend":
                    return day.spendMinor;
            }
        };

        const totalOf = (days: CreativeTrendDay[]): number => {
            const impressions = days.reduce((sum, day) => sum + (day.impressions ?? 0), 0);
            const clicks = days.reduce((sum, day) => sum + (day.clicks ?? 0), 0);

            switch (query.metric) {
                case "impressions":
                    return impressions;
                case "clicks":
                    return clicks;
                case "spend":
                    return days.reduce((sum, day) => sum + (day.spendMinor ?? 0), 0);
                case "ctr":
                    return ratioOrNull(clicks, impressions, false) ?? 0;
            }
        };

        const currentTotal = totalOf(series.current);
        const previousTotal = totalOf(series.previous);
        const deltaPct = previousTotal === 0
            ? null
            : Math.round(((currentTotal - previousTotal) / previousTotal) * 10000) / 100;
        const impressions = series.current.reduce((sum, day) => sum + (day.impressions ?? 0), 0);

        const response: CreativeTrendResponse = {
            metric: query.metric,
            creativeId: series.creativeId,
            period: series.period,
            previousPeriod: series.previousPeriod,
            current: series.current.map((day) => ({date: day.date, value: valueOf(day)})),
            previous: series.previous.map((day) => ({date: day.date, value: valueOf(day)})),
            total: {current: currentTotal, previous: previousTotal, deltaPct},
            sample: {
                n: impressions,
                denominator: IMPRESSION_DENOMINATOR,
                eligible: impressions >= IMPRESSION_DENOMINATOR,
                gate: IMPRESSION_GATE,
            },
        };

        const note = this.trendNote(series, query.metric, deltaPct);
        if (note !== undefined) response.note = note;

        return response;
    }

    private trendNote(series: CreativeTrendSeries, metric: CreativeTrendMetric, deltaPct: number | null): string | undefined {
        if (series.current.every((day) => day.impressions === null)) {
            return "Belum ada data iklan pada periode ini.";
        }
        if (deltaPct === null) {
            return "Perbandingan tidak tersedia karena periode sebelumnya tanpa nilai.";
        }
        if (metric === "ctr" && series.current.some((day) => day.ctr === null && day.impressions !== null)) {
            return "Sebagian hari tanpa tayangan sehingga CTR hari itu tidak terukur.";
        }

        return undefined;
    }

    async addTag(tenantId: string, creativeId: string, body: TagCreateBody): Promise<TagRow> {
        const creative = await this.creativeRepo.findByIdForTenant(tenantId, creativeId);
        if (creative === null) throw new NotFoundError("Kreatif tidak ditemukan");

        const tagValue = body.tagValue.trim();
        const source = body.source ?? "manual";
        await this.creativeRepo.upsertTags(creativeId, [{
            tagType: body.tagType,
            tagValue,
            source,
            confidence: body.confidence === undefined ? null : body.confidence.toFixed(4),
        }]);

        return {
            creativeId,
            tagType: body.tagType,
            tagValue,
            source,
            confidence: body.confidence ?? null,
        };
    }

    async removeTag(tenantId: string, creativeId: string, tagId: number): Promise<{deleted: true}> {
        const creative = await this.creativeRepo.findByIdForTenant(tenantId, creativeId);
        if (creative === null) throw new NotFoundError("Kreatif tidak ditemukan");

        const deleted = await this.creativeRepo.deleteTag(creativeId, tagId);
        if (!deleted) throw new NotFoundError("Tag tidak ditemukan");

        return {deleted: true};
    }

    async queueAiTags(tenantId: string, creativeId: string): Promise<{jobId: string; queued: true}> {
        const creative = await this.creativeRepo.findByIdForTenant(tenantId, creativeId);
        if (creative === null) throw new NotFoundError("Kreatif tidak ditemukan");

        // BullMQ only accepts a custom id that contains `:` when it has exactly three segments.
        const jobId = `tag:${creativeId}:ai`;
        await this.taggingQueue.add("creative-tagging", {creativeId}, {jobId});

        return {jobId, queued: true};
    }

    /**
     * Mean of `messageEvidence.present / 7` over the campaign's creatives that have readable copy.
     * A creative without copy contributes nothing instead of pulling the mean to zero; with no copy at
     * all the campaign gets `null`.
     */
    private messageCompleteness(
        creativeById: Map<string, CreativeEntity>,
        creativeIds: Set<string>
    ): number | null {
        const values: number[] = [];
        for (const creativeId of creativeIds) {
            const creative = creativeById.get(creativeId);
            const statuses = contentElementStatuses({
                title: creative?.title ?? null,
                body: creative?.body ?? null,
                callToActionType: creative?.callToActionType ?? null,
            });
            const {evidence} = contentCompleteness(statuses);
            if (evidence.assessed > 0) values.push(evidence.present / evidence.expected);
        }

        return values.length === 0
            ? null
            : round4(values.reduce((sum, value) => sum + value, 0) / values.length);
    }

    /** One round trip per source table; every endpoint derives its rows from this shared cohort. */
    private async loadCohort(accountId: string, period: ResolvedPeriod): Promise<Cohort> {
        const [aggregates, quality, allocation, creatives] = await Promise.all([
            this.analyticsRepo.getCreativeAggregates(accountId, period.start, period.end),
            this.analyticsRepo.getCreativeLeadQuality(accountId, period.start, period.end),
            this.analyticsRepo.getCreativeAllocation(accountId, period.start, period.end),
            this.creativeRepo.findByAccountId(accountId),
        ]);

        // The baseline sits right after the first observed day, which can predate the period.
        const minFirstSeen = aggregates.reduce<string | null>(
            (earliest, aggregate) => (earliest === null || aggregate.firstSeen < earliest ? aggregate.firstSeen : earliest),
            null
        );
        const series = minFirstSeen === null
            ? []
            : await this.analyticsRepo.getCreativeDailySeries(accountId, startOfDayUtc(minFirstSeen), period.end);

        const qualityByCreative = new Map(quality.map((row) => [row.creativeId, row]));

        const allocationByCreative = new Map<string, AllocationEntry[]>();
        for (const row of allocation) {
            const entry = {dailyBudgetMinor: row.dailyBudgetMinor, effectiveStatus: row.effectiveStatus};
            const bucket = allocationByCreative.get(row.creativeId);
            if (bucket === undefined) allocationByCreative.set(row.creativeId, [entry]);
            else bucket.push(entry);
        }

        const pointsByCreative = new Map(series.map((row) => [row.creativeId, row.points]));
        const creativeById = new Map(creatives.map((creative) => [creative.id, creative]));

        const derived = aggregates.map((aggregate) => this.deriveRow(aggregate, {
            qualityByCreative,
            allocationByCreative,
        }, period));

        return {
            aggregates,
            qualityByCreative,
            allocationByCreative,
            pointsByCreative,
            creativeById,
            costCohort: derived.map((row) => row.costPerResultMinor),
            ctrCohort: derived.map((row) => row.ctr),
            qualityCohort: derived.map((row) => row.qualityRate),
        };
    }

    private deriveRow(
        aggregate: CreativeAggregate,
        context: {
            qualityByCreative: Map<string, CreativeLeadQuality>;
            allocationByCreative: Map<string, AllocationEntry[]>;
        },
        period: ResolvedPeriod
    ): DerivedRow {
        const quality = context.qualityByCreative.get(aggregate.creativeId);
        const assessedMatureLeads = quality?.assessedMatureLeads ?? 0;

        const qualityRate = aggregate.objectiveGroup === "wa"
            ? (assessedMatureLeads >= 1 && quality !== undefined ? round4(quality.hotLeads / assessedMatureLeads) : null)
            : (aggregate.linkClicks > 0 ? round4(aggregate.results / aggregate.linkClicks) : null);

        const adsets = context.allocationByCreative.get(aggregate.creativeId) ?? [];
        const dailySpendMinor = aggregate.spendMinor / period.days;

        const ageDays = dayCount(aggregate.firstSeen, period.until);

        return {
            aggregate,
            ctr: aggregate.impressions > 0 ? round4(aggregate.clicks / aggregate.impressions) : null,
            costPerResultMinor: aggregate.results > 0 ? Math.round(aggregate.spendMinor / aggregate.results) : null,
            roas: aggregate.spendMinor > 0 ? round4(aggregate.purchaseValueMinor / aggregate.spendMinor) : null,
            frequency: aggregate.frequency === null ? null : round4(aggregate.frequency),
            qualityRate,
            qualitySample: aggregate.objectiveGroup === "wa" ? assessedMatureLeads : aggregate.results,
            ageDays,
            mature: ageDays >= Config.analytics.maturityDays,
            allocationLimited: adsets.some((adset) =>
                (adset.dailyBudgetMinor !== null && adset.dailyBudgetMinor < 3 * dailySpendMinor)
                || adset.effectiveStatus !== "ACTIVE"),
        };
    }

    private toCreativeRow(aggregate: CreativeAggregate, cohort: Cohort, period: ResolvedPeriod): CreativeRow {
        const derived = this.deriveRow(aggregate, cohort, period);
        const points = (cohort.pointsByCreative.get(aggregate.creativeId) ?? [])
            .filter((point) => point.date >= period.since && point.date <= period.until);

        const dimensions: CreativeDimensions = {
            cost: costDimension(derived.costPerResultMinor, cohort.costCohort, aggregate.results),
            attention: attentionDimension(derived.ctr, cohort.ctrCohort, aggregate.impressions),
            quality: qualityDimension(derived.qualityRate, cohort.qualityCohort, derived.qualitySample),
            health: healthDimension(derived.ageDays, trendDrop(points)),
        };

        const fatigued = this.buildFatigueRow(aggregate, cohort.pointsByCreative.get(aggregate.creativeId) ?? [], cohort, period).status === "Jenuh";
        const {status, note} = overallStatus({
            ...dimensions,
            mature: derived.mature,
            fatigued,
            allocationLimited: derived.allocationLimited,
        });

        const row: CreativeRow = {
            creativeId: aggregate.creativeId,
            name: cohort.creativeById.get(aggregate.creativeId)?.name ?? null,
            objectiveGroup: aggregate.objectiveGroup,
            spendMinor: aggregate.spendMinor,
            results: aggregate.results,
            costPerResultMinor: derived.costPerResultMinor,
            ctr: derived.ctr,
            roas: derived.roas,
            frequency: derived.frequency,
            firstSeen: aggregate.firstSeen,
            mature: derived.mature,
            fatigued,
            allocationLimited: derived.allocationLimited,
            dimensions,
            status,
        };
        if (note !== undefined) row.note = note;

        return row;
    }

    private buildFatigueRow(
        aggregate: CreativeAggregate,
        points: CreativeDailyPoint[],
        cohort: Cohort,
        period: ResolvedPeriod
    ): FatigueRow {
        const firstSeen = aggregate.firstSeen;
        const baselineEnd = addDays(firstSeen, BASELINE_DAYS - 1);

        const basePoints = points.filter((point) => point.date >= firstSeen && point.date <= baselineEnd);
        const recentPoints = points.slice(-RECENT_DAYS);

        const base = aggregateWindow(basePoints);
        const now = aggregateWindow(recentPoints);
        const nowDate = recentPoints[recentPoints.length - 1]?.date ?? firstSeen;

        const present = new Set(points.map((point) => point.date));
        // A complete window means every day from the first observation to the period end is present:
        // a creative that only ran for one day cannot be judged for fatigue inside a 12-day period.
        const complete = dateRange(firstSeen, period.until).every((date) => present.has(date));

        const consecutiveDays = trailingCtrDeclineDays(points, base.ctr);
        const confounded = base.cpmMinor !== null && now.cpmMinor !== null && now.cpmMinor < base.cpmMinor;
        const {status, drop} = fatigue(base, now, consecutiveDays, complete, confounded);

        const row: FatigueRow = {
            creativeId: aggregate.creativeId,
            name: cohort.creativeById.get(aggregate.creativeId)?.name ?? null,
            status,
            drop,
            frequency: {base: base.frequency, now: now.frequency},
            base: {
                date: basePoints[basePoints.length - 1]?.date ?? firstSeen,
                ctr: base.ctr,
                cpmMinor: base.cpmMinor,
                cprMinor: base.cprMinor,
                frequency: base.frequency,
            },
            now: {
                date: nowDate,
                ctr: now.ctr,
                cpmMinor: now.cpmMinor,
                cprMinor: now.cprMinor,
                frequency: now.frequency,
            },
            consecutiveDays,
            complete,
            confounded,
            nextCheck: status === "Waspada" || status === "Jenuh" ? addDays(nowDate, 1) : null,
        };
        if (status === "Belum cukup data") row.note = INCOMPLETE_NOTE;

        return row;
    }
}

function ratioOrNull(numerator: number, denominator: number, rounded: boolean): number | null {
    if (denominator <= 0) return null;
    const value = numerator / denominator;
    return rounded ? Math.round(value) : round4(value);
}

/**
 * Cost per result per creative for one half of the window. Spend and results are summed across the
 * creative's objective groups before dividing, so a creative running both channels gets one ratio.
 */
function halfCostPerResult(aggregates: CreativeAggregate[]): Map<string, number> {
    const spend = new Map<string, number>();
    const results = new Map<string, number>();
    for (const aggregate of aggregates) {
        spend.set(aggregate.creativeId, (spend.get(aggregate.creativeId) ?? 0) + aggregate.spendMinor);
        results.set(aggregate.creativeId, (results.get(aggregate.creativeId) ?? 0) + aggregate.results);
    }

    const costPerResult = new Map<string, number>();
    for (const [creativeId, totalResults] of results) {
        if (totalResults > 0) costPerResult.set(creativeId, (spend.get(creativeId) ?? 0) / totalResults);
    }
    return costPerResult;
}

function retentionRate(value: number | null, base: number | null): number | null {
    if (value === null || base === null || base <= 0) return null;
    return round4(value / base);
}

function compareIds(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function compareCreativeRows(left: CreativeRow, right: CreativeRow, sortBy: CreativeSortKey): number {
    const pick = (row: CreativeRow): number | string | null => {
        switch (sortBy) {
            case "results":
                return row.results;
            case "costPerResult":
                return row.costPerResultMinor;
            case "ctr":
                return row.ctr;
            case "roas":
                return row.roas;
            case "firstSeen":
                return row.firstSeen;
            default:
                return row.spendMinor;
        }
    };

    const leftValue = pick(left);
    const rightValue = pick(right);
    const tieBreak = compareIds(`${left.creativeId}|${left.objectiveGroup}`, `${right.creativeId}|${right.objectiveGroup}`);

    if (leftValue === null && rightValue === null) return tieBreak;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    if (leftValue === rightValue) return tieBreak;

    const ascending = sortBy === "costPerResult";
    const order = leftValue < rightValue ? -1 : 1;
    return ascending ? order : -order;
}
