import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {AnalyticsRepository} from "@db/repositories/analytics.repository";
import {LeadRepository} from "@db/repositories/lead.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {TrackingHealthRepository} from "@db/repositories/tracking-health.repository";
import {CampaignRepository} from "@db/repositories/campaign.repository";
import {InsightAlertRepository} from "@db/repositories/insight-alert.repository";
import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {BadRequestError} from "@shared/errors";
import {addDays, bucketIndex, dayCount, endOfDayUtc, startOfDayUtc, todayInZone} from "@shared/dates";
import {funnelHealth, type FunnelHealthResult, type HealthBadge} from "@shared/health";

const SPARKLINE_BUCKETS = 7;
const DEFAULT_PERIOD_DAYS = 30;
const HOT_LEAD_LIMIT = 5;

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
    ) {}

    async getSummary(tenantId: string, query: SummaryQuery): Promise<SummaryResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);

        const until = query.until ?? todayInZone(account.timezoneName);
        const since = query.since ?? addDays(until, -(DEFAULT_PERIOD_DAYS - 1));
        if (since > until) {
            throw new BadRequestError("Rentang tanggal tidak valid");
        }

        const days = dayCount(since, until);
        const previousUntil = addDays(since, -1);
        const previousSince = addDays(previousUntil, -(days - 1));

        const start = startOfDayUtc(since);
        const end = endOfDayUtc(until);
        const prevStart = startOfDayUtc(previousSince);
        const prevEnd = endOfDayUtc(previousUntil);
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
        };
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

function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}
