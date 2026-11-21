import {AdInsightBreakdownRepository} from "@db/repositories/ad-insight-breakdown.repository";
import {AnalyticsRepository} from "@db/repositories/analytics.repository";
import {CampaignRepository} from "@db/repositories/campaign.repository";
import {ConversationMessageRepository} from "@db/repositories/conversation-message.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {LeadRepository, type Lead, type ManualLeadChanges} from "@db/repositories/lead.repository";
import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {NotFoundError} from "@shared/errors";
import {safeTimeZone} from "@shared/dates";
import {round2, round4} from "@shared/numbers";
import {resolvePeriod} from "@shared/period";
import {ExplanationService, type ExplanationRef} from "@/modules/explanations/service";
import {formatDuration, formatNumber, formatPercent} from "@/modules/explanations/rules";
import {
    REPLY_TYPES,
    RESPONSE_BUCKETS,
    buildSankey,
    heatmapEligible,
    responseBucket,
    type ResponseBucket,
} from "@shared/audience";

const SAMPLE_DENOMINATOR = 30;
const SAMPLE_GATE = "≥ 30 lead";
const CHAT_GATE = "≥ 30 chat";
const HEATMAP_GATE = "≥ 10 lead per bucket";
const IMPRESSION_GATE = "≥ 100 tayangan";

const HEATMAP_LEVELS = ["HOT", "WARM", "COLD"] as const;

export interface AudienceQuery {
    accountId: string;
    since?: string;
    until?: string;
    campaignId?: string;
}

export interface RangeQuery {
    accountId: string;
    since?: string;
    until?: string;
}

export interface SampleBlock {
    n: number;
    denominator: number;
    eligible: boolean;
    gate: string;
}

export interface AudienceResponse {
    period: {since: string; until: string; days: number};
    previousPeriod: {since: string; until: string};
    distribution: {
        temperature: "hot" | "warm" | "cold";
        count: number;
        /** `count / total`, 4 decimals; `null` when `total === 0`. */
        share: number | null;
        /** Difference in lead count against the previous period (may be negative). */
        delta: number;
        /** Share difference in percentage points, 2 decimals; `null` when either share is `null`. */
        deltaPp: number | null;
    }[];
    total: number;
    unassessed: number;
    sankey: {nodes: ["COLD", "WARM", "HOT"]; links: {from: string; to: string; value: number}[]};
    campaigns: {
        campaignId: string;
        name: string;
        leads: number;
        hotLeads: number;
        hotLeadRate: number | null;
        note?: string;
    }[];
    sample: SampleBlock;
    note?: string;
}

export interface SpeedResponse {
    period: {since: string; until: string; days: number};
    avgFirstReplySeconds: number | null;
    longestWaitMinutes: number | null;
    /** Account-wide backlog (not period-scoped): unanswered for more than 24 hours. */
    stuckLeads: number;
    buckets: {label: string; count: number}[];
    cohortHeatmap: {
        buckets: string[];
        levels: ("HOT" | "WARM" | "COLD")[];
        cells: {level: "HOT" | "WARM" | "COLD"; bucket: string; leads: number; share: number}[];
    } | null;
    heatmapNote: string | null;
    sample: SampleBlock;
    note?: string;
    explanation: ExplanationRef | null;
}

export interface SegmentsResponse {
    period: {since: string; until: string; days: number};
    placements: {
        publisherPlatform: string | null;
        platformPosition: string | null;
        spendMinor: number;
        leads: number;
        hotLeads: number | null;
        hotRate: number | null;
        costPerHotLeadMinor: number | null;
        note?: string;
    }[];
    devices: {impressionDevice: string | null; spendMinor: number; leads: number; note?: string}[];
    hours: {hour: number; spendMinor: number; leads: number}[];
    /** Period leads without an attributable `ad_id`, so they cannot join a placement/device row. */
    unattributedLeads: number;
    sample: SampleBlock;
    note?: string;
}

export interface PipelineRow {
    leadId: number;
    name: string | null;
    phoneMasked: string | null;
    level: "COLD" | "WARM" | "HOT";
    confidence: string;
    reason: string | null;
    evidenceWamid: string | null;
    stage: string;
    adId: string | null;
    creativeId: string | null;
    firstSeenAt: string | null;
    firstRepliedAt: string | null;
    milestoneAt: {warm: string | null; hot: string | null};
    explanation: ExplanationRef | null;
}

export interface PipelineResponse {
    period: {since: string; until: string; days: number};
    rows: PipelineRow[];
    sample: SampleBlock;
    note?: string;
}

export interface ConversationsResponse {
    period: {since: string; until: string; days: number};
    counts: {responseType: string; count: number}[];
    classifiedLeads: number;
    timed: {medianSeconds: number | null; measuredLeads: number; observedLeads: number};
    sentiment: {positif: number; netral: number; negatif: number};
    sample: SampleBlock;
    note?: string;
    explanation: ExplanationRef | null;
    timingExplanation: ExplanationRef | null;
}

export interface LeadListQuery {
    accountId: string;
    temperature?: "COLD" | "WARM" | "HOT";
    stage?: Lead["stage"];
    search?: string;
    page?: string;
    limit?: string;
    sortBy?: "createdAt" | "firstSeenAt";
}

export interface LeadListRow {
    id: number;
    name: string | null;
    phoneMasked: string | null;
    temperature: "COLD" | "WARM" | "HOT" | null;
    stage: string;
    campaignName: string | null;
    confidence: string | null;
    waitingMinutes: number | null;
    createdAt: string;
}

export interface LeadListResponse {
    data: LeadListRow[];
    page: number;
    limit: number;
    total: number;
}

export interface LeadUpdateBody {
    stage?: Lead["stage"];
    temperature?: "COLD" | "WARM" | "HOT";
    dealValueMinor?: number;
}

export interface LeadUpdateResponse {
    id: number;
    stage: string;
    temperature: "COLD" | "WARM" | "HOT" | null;
    dealValueMinor: number | null;
    updatedAt: string;
    manualAssessmentId: string | null;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class AudienceService {
    constructor(
        private readonly leadRepo = new LeadRepository(),
        private readonly assessmentRepo = new LeadAssessmentRepository(),
        private readonly breakdownRepo = new AdInsightBreakdownRepository(),
        private readonly conversationRepo = new ConversationMessageRepository(),
        private readonly analyticsRepo = new AnalyticsRepository(),
        private readonly campaignRepo = new CampaignRepository(),
        private readonly explanations = new ExplanationService()
    ) {}

    async getAudience(tenantId: string, query: AudienceQuery): Promise<AudienceResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);
        const {accountId, campaignId} = query;

        const [current, previous, transitions, campaignMetrics, campaigns] = await Promise.all([
            this.leadRepo.getTemperatureDistribution(accountId, period.start, period.end, campaignId),
            this.leadRepo.getTemperatureDistribution(accountId, period.prevStart, period.prevEnd, campaignId),
            this.assessmentRepo.getLevelTransitions(accountId, period.start, period.end, campaignId),
            this.analyticsRepo.getCampaignLeadMetrics(accountId, period.start, period.end),
            this.campaignRepo.findByAccountId(accountId),
        ]);

        const total = current.hot + current.warm + current.cold;
        const previousTotal = previous.hot + previous.warm + previous.cold;

        const shareOf = (count: number, denominator: number): number | null =>
            denominator > 0 ? round4(count / denominator) : null;

        const distribution = ([
            ["hot", current.hot, previous.hot],
            ["warm", current.warm, previous.warm],
            ["cold", current.cold, previous.cold],
        ] as const).map(([temperature, count, previousCount]) => {
            const share = shareOf(count, total);
            const previousShare = shareOf(previousCount, previousTotal);

            return {
                temperature,
                count,
                share,
                delta: count - previousCount,
                deltaPp: share !== null && previousShare !== null
                    ? round2(100 * (share - previousShare))
                    : null,
            };
        });

        const nameById = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
        const rankedCampaigns = campaignMetrics.map((metric) => {
            const hotLeadRate = metric.attributedLeads > 0
                ? round4(metric.hotLeads / metric.attributedLeads)
                : null;

            return {
                campaignId: metric.campaignId,
                name: nameById.get(metric.campaignId) ?? metric.campaignId,
                leads: metric.attributedLeads,
                hotLeads: metric.hotLeads,
                hotLeadRate,
                ...(hotLeadRate === null ? {note: "Belum ada lead teratribusi pada periode ini"} : {}),
            };
        });
        rankedCampaigns.sort((left, right) => {
            if (left.hotLeadRate === null || right.hotLeadRate === null) {
                if (left.hotLeadRate !== right.hotLeadRate) return left.hotLeadRate === null ? 1 : -1;
                return right.leads - left.leads;
            }
            return right.hotLeadRate - left.hotLeadRate || right.leads - left.leads;
        });

        return {
            period: {since: period.since, until: period.until, days: period.days},
            previousPeriod: {since: period.previousSince, until: period.previousUntil},
            distribution,
            total,
            unassessed: current.unassessed,
            sankey: buildSankey(transitions),
            campaigns: rankedCampaigns,
            sample: {
                n: total,
                denominator: SAMPLE_DENOMINATOR,
                eligible: total >= SAMPLE_DENOMINATOR,
                gate: SAMPLE_GATE,
            },
            ...(total === 0
                ? {note: "Belum ada lead pada periode ini."}
                : current.unassessed > 0
                    ? {note: `${current.unassessed} lead belum dinilai sehingga tidak masuk distribusi.`}
                    : {}),
        };
    }

    async getSpeed(tenantId: string, query: RangeQuery): Promise<SpeedResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);

        const [metrics, firstResponses] = await Promise.all([
            this.leadRepo.getSpeedMetrics(query.accountId, period.start, period.end),
            this.conversationRepo.getLeadFirstResponses(query.accountId, period.start, period.end),
        ]);

        const leadsPerBucket = RESPONSE_BUCKETS.map((bucket) =>
            firstResponses.filter((row) => responseBucket(row.responseSeconds) === bucket).length
        );
        const countsByBucket = new Map<ResponseBucket, number>(
            RESPONSE_BUCKETS.map((bucket, index) => [bucket, leadsPerBucket[index]])
        );
        const buckets = RESPONSE_BUCKETS.map((label) => ({label, count: countsByBucket.get(label) ?? 0}));

        const eligible = heatmapEligible(leadsPerBucket);
        const cohortHeatmap = eligible
            ? {
                buckets: [...RESPONSE_BUCKETS],
                levels: [...HEATMAP_LEVELS],
                cells: HEATMAP_LEVELS.flatMap((level) =>
                    RESPONSE_BUCKETS.map((bucket) => {
                        const bucketLeads = firstResponses
                            .filter((row) => responseBucket(row.responseSeconds) === bucket).length;
                        const leads = firstResponses
                            .filter((row) =>
                                row.temperature === level && responseBucket(row.responseSeconds) === bucket
                            ).length;

                        return {
                            level,
                            bucket,
                            leads,
                            share: bucketLeads > 0 ? round4(leads / bucketLeads) : 0,
                        };
                    })
                ),
            }
            : null;

        const explanation = await this.explanations.ensure({
            tenantId,
            accountId: query.accountId,
            context: "velocity",
            entityType: "account",
            entityId: query.accountId,
            filter: {since: period.since, until: period.until},
            snapshotId: `${period.since}..${period.until}`,
            facts: {
                avg: formatDuration(metrics.avgFirstReplySeconds),
                longest: formatDuration(
                    metrics.longestWaitMinutes === null ? null : metrics.longestWaitMinutes * 60
                ),
                stuck: formatNumber(metrics.stuckLeads),
                slowest: buckets[buckets.length - 1].label,
            },
            evidenceIds: [],
        });

        return {
            period: {since: period.since, until: period.until, days: period.days},
            avgFirstReplySeconds: metrics.avgFirstReplySeconds,
            longestWaitMinutes: metrics.longestWaitMinutes,
            stuckLeads: metrics.stuckLeads,
            buckets,
            cohortHeatmap,
            heatmapNote: eligible
                ? null
                : `Setiap bucket butuh ≥ 10 lead; bucket terkecil berisi ${Math.min(...leadsPerBucket)} lead.`,
            sample: {
                n: Math.min(...leadsPerBucket),
                denominator: 10,
                eligible,
                gate: HEATMAP_GATE,
            },
            ...(metrics.avgFirstReplySeconds === null
                ? {note: "Belum ada lead yang dibalas pada periode ini."}
                : {}),
            explanation,
        };
    }

    async getSegments(tenantId: string, query: RangeQuery): Promise<SegmentsResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);
        const timeZone = safeTimeZone(account.timezoneName);
        const {accountId} = query;

        const [
            placementMetrics,
            deviceMetrics,
            hourlyMetrics,
            adAttribution,
            leadCountsByAd,
            leadCountsByHour,
            distribution,
        ] = await Promise.all([
            this.breakdownRepo.getPlacementMetrics(accountId, period.start, period.end),
            this.breakdownRepo.getDeviceMetrics(accountId, period.start, period.end),
            this.breakdownRepo.getHourlyMetrics(accountId, period.start, period.end),
            this.breakdownRepo.getAdAttributionMap(accountId, period.start, period.end),
            this.leadRepo.getLeadCountsByAd(accountId, period.start, period.end),
            this.leadRepo.getLeadCountsByHour(accountId, period.start, period.end, timeZone),
            this.leadRepo.getTemperatureDistribution(accountId, period.start, period.end),
        ]);

        const leadMap = new Map(leadCountsByAd.map((row) => [row.adId, row]));
        const placementKey = (publisher: string | null, position: string | null): string =>
            `${publisher ?? ""}|${position ?? ""}`;

        const placements = placementMetrics.map((row) => {
            const key = placementKey(row.publisherPlatform, row.platformPosition);
            const adsHere = adAttribution.filter((ad) => ad.placementKeys.includes(key));
            const leads = adsHere
                .filter((ad) => ad.placementCount === 1)
                .reduce((sum, ad) => sum + (leadMap.get(ad.adId)?.leads ?? 0), 0);
            const ambiguous = adsHere.some((ad) => ad.placementCount > 1);

            if (ambiguous) {
                return {
                    publisherPlatform: row.publisherPlatform,
                    platformPosition: row.platformPosition,
                    spendMinor: row.spendMinor,
                    leads,
                    hotLeads: null,
                    hotRate: null,
                    costPerHotLeadMinor: null,
                    note: "atribusi placement tidak tunggal",
                };
            }

            const hotLeads = adsHere
                .reduce((sum, ad) => sum + (leadMap.get(ad.adId)?.hotLeads ?? 0), 0);
            const hotRate = leads > 0 ? round4(hotLeads / leads) : null;

            return {
                publisherPlatform: row.publisherPlatform,
                platformPosition: row.platformPosition,
                spendMinor: row.spendMinor,
                leads,
                hotLeads,
                hotRate,
                costPerHotLeadMinor: hotLeads > 0 ? Math.round(row.spendMinor / hotLeads) : null,
                ...(hotRate === null ? {note: "Belum ada lead teratribusi pada placement ini"} : {}),
            };
        });

        const devices = deviceMetrics.map((row) => {
            const key = row.impressionDevice ?? "";
            const adsHere = adAttribution.filter((ad) => ad.deviceKeys.includes(key));
            const leads = adsHere
                .filter((ad) => ad.deviceCount === 1)
                .reduce((sum, ad) => sum + (leadMap.get(ad.adId)?.leads ?? 0), 0);
            const ambiguous = adsHere.some((ad) =>
                ad.deviceCount > 1 && (leadMap.get(ad.adId)?.leads ?? 0) > 0
            );

            return {
                impressionDevice: row.impressionDevice,
                spendMinor: row.spendMinor,
                leads,
                ...(ambiguous ? {note: "atribusi device tidak tunggal"} : {}),
            };
        });

        const spendByHour = new Map(hourlyMetrics.map((row) => [row.hour, row.spendMinor]));
        const leadsByHour = new Map(leadCountsByHour.map((row) => [row.hour, row.leads]));
        const hours = Array.from({length: 24}, (_, hour) => ({
            hour,
            spendMinor: spendByHour.get(hour) ?? 0,
            leads: leadsByHour.get(hour) ?? 0,
        }));

        const totalLeads = distribution.hot + distribution.warm + distribution.cold + distribution.unassessed;
        const attributedLeads = leadCountsByAd.reduce((sum, row) => sum + row.leads, 0);
        const unattributedLeads = totalLeads - attributedLeads;
        const impressions = placementMetrics.reduce((sum, row) => sum + row.impressions, 0);

        return {
            period: {since: period.since, until: period.until, days: period.days},
            placements,
            devices,
            hours,
            unattributedLeads,
            sample: {
                n: impressions,
                denominator: 100,
                eligible: impressions >= 100,
                gate: IMPRESSION_GATE,
            },
            ...(unattributedLeads > 0
                ? {note: `${unattributedLeads} lead tanpa atribusi iklan tidak masuk baris placement/device.`}
                : {}),
        };
    }

    async getPipeline(tenantId: string, query: RangeQuery): Promise<PipelineResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);

        const effective = await this.assessmentRepo.getEffectivePipeline(
            query.accountId,
            period.start,
            period.end
        );

        const explanationRefs = await this.explanations.ensureMany(effective.map((row) => ({
            tenantId,
            accountId: query.accountId,
            context: "lead_detail" as const,
            entityType: "lead",
            entityId: String(row.leadId),
            filter: {since: period.since, until: period.until, block: "pipeline"},
            snapshotId: `${period.since}..${period.until}`,
            facts: {
                level: row.level,
                confidence: row.confidence,
                stage: row.stage,
                replied: row.firstRepliedAt === null ? "belum dibalas" : "sudah dibalas",
                milestone: row.hotAt?.toISOString() ?? row.warmAt?.toISOString() ?? "belum ada",
            },
            evidenceIds: row.evidenceWamid === null ? [] : [row.evidenceWamid],
        })));

        const rows: PipelineRow[] = effective.map((row, index) => ({
            leadId: row.leadId,
            name: row.name,
            phoneMasked: row.phoneMasked,
            level: row.level,
            confidence: row.confidence,
            reason: row.reason,
            evidenceWamid: row.evidenceWamid,
            stage: row.stage,
            adId: row.adId,
            creativeId: row.creativeId,
            firstSeenAt: row.firstSeenAt?.toISOString() ?? null,
            firstRepliedAt: row.firstRepliedAt?.toISOString() ?? null,
            milestoneAt: {
                warm: row.warmAt?.toISOString() ?? null,
                hot: row.hotAt?.toISOString() ?? null,
            },
            explanation: explanationRefs[index],
        }));

        return {
            period: {since: period.since, until: period.until, days: period.days},
            rows,
            sample: {
                n: rows.length,
                denominator: SAMPLE_DENOMINATOR,
                eligible: rows.length >= SAMPLE_DENOMINATOR,
                gate: SAMPLE_GATE,
            },
            ...(rows.length === 0 ? {note: "Belum ada lead dengan assessment pada periode ini."} : {}),
        };
    }

    async getConversations(tenantId: string, query: RangeQuery): Promise<ConversationsResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);

        const [lastClassified, timed] = await Promise.all([
            this.conversationRepo.getLastClassifiedCounts(query.accountId, period.start, period.end),
            this.conversationRepo.getTimedInsights(query.accountId, period.start, period.end),
        ]);

        const countByType = new Map<string, number>();
        for (const row of lastClassified) {
            countByType.set(row.responseType, (countByType.get(row.responseType) ?? 0) + row.total);
        }
        const counts = REPLY_TYPES.map((responseType) => ({
            responseType,
            count: countByType.get(responseType) ?? 0,
        }));
        const classifiedLeads = lastClassified.reduce((sum, row) => sum + row.total, 0);

        const sentiment = {positif: 0, netral: 0, negatif: 0};
        for (const row of lastClassified) {
            if (row.sentiment === "positif" || row.sentiment === "netral" || row.sentiment === "negatif") {
                sentiment[row.sentiment] += row.total;
            }
        }

        const timedBlock = {
            medianSeconds: timed.medianSeconds === null ? null : Math.round(timed.medianSeconds),
            measuredLeads: timed.measuredLeads,
            observedLeads: timed.observedLeads,
        };

        // The dominant type follows REPLY_TYPES order on a tie: `counts` is built in that order.
        let dominant = {responseType: "belum ada", count: 0};
        for (const row of counts) {
            if (row.count > dominant.count) dominant = row;
        }

        const snapshotId = `${period.since}..${period.until}`;
        const [explanation, timingExplanation] = await Promise.all([
            this.explanations.ensure({
                tenantId,
                accountId: query.accountId,
                context: "conversation_types",
                entityType: "account",
                entityId: query.accountId,
                filter: {since: period.since, until: period.until},
                snapshotId,
                facts: {
                    classified: formatNumber(classifiedLeads),
                    dominant: dominant.responseType,
                    dominantCount: formatNumber(dominant.count),
                    reject: formatNumber(counts.find((row) => row.responseType === "Menolak")?.count ?? 0),
                },
                evidenceIds: [],
            }),
            this.explanations.ensure({
                tenantId,
                accountId: query.accountId,
                context: "conversation_timing",
                entityType: "account",
                entityId: query.accountId,
                filter: {since: period.since, until: period.until, block: "timing"},
                snapshotId,
                facts: {
                    median: formatDuration(timedBlock.medianSeconds),
                    measured: formatNumber(timedBlock.measuredLeads),
                    observed: formatNumber(timedBlock.observedLeads),
                },
                evidenceIds: [],
            }),
        ]);

        return {
            period: {since: period.since, until: period.until, days: period.days},
            counts,
            classifiedLeads,
            timed: timedBlock,
            sentiment,
            sample: {
                n: classifiedLeads,
                denominator: SAMPLE_DENOMINATOR,
                eligible: classifiedLeads >= SAMPLE_DENOMINATOR,
                gate: CHAT_GATE,
            },
            ...(timed.observedLeads === 0
                ? {note: "Belum ada pesan pada periode ini."}
                : classifiedLeads < SAMPLE_DENOMINATOR
                    ? {note: "Sampel terklasifikasi belum mencapai 30 chat."}
                    : {}),
            explanation,
            timingExplanation,
        };
    }

    async listLeads(tenantId: string, query: LeadListQuery): Promise<LeadListResponse> {
        await requireAccountScope(tenantId, query.accountId);

        const page = query.page === undefined ? DEFAULT_PAGE : Math.max(Number(query.page), 1);
        const limit = query.limit === undefined
            ? DEFAULT_LIMIT
            : Math.min(Math.max(Number(query.limit), 1), MAX_LIMIT);

        const [{leads, total}, campaigns] = await Promise.all([
            this.leadRepo.getLeadList(query.accountId, {
                temperature: query.temperature,
                stage: query.stage,
                search: query.search,
                page,
                limit,
                sortBy: query.sortBy,
            }),
            this.campaignRepo.findByAccountId(query.accountId),
        ]);

        const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
        const assessments = await Promise.all(
            leads.map((lead) => this.assessmentRepo.latestByLead(lead.id))
        );
        const now = Date.now();

        return {
            data: leads.map((lead, index) => ({
                id: lead.id,
                name: lead.name,
                phoneMasked: lead.phoneMasked,
                temperature: lead.temperature,
                stage: lead.stage,
                campaignName: lead.campaignId === null
                    ? null
                    : campaignNames.get(lead.campaignId) ?? lead.campaignId,
                confidence: assessments[index]?.confidence ?? null,
                waitingMinutes: lead.firstRepliedAt === null && lead.firstSeenAt !== null
                    ? Math.max(0, Math.floor((now - lead.firstSeenAt.getTime()) / 60_000))
                    : null,
                createdAt: lead.createdAt.toISOString(),
            })),
            page,
            limit,
            total,
        };
    }

    async updateLead(tenantId: string, leadId: number, body: LeadUpdateBody): Promise<LeadUpdateResponse> {
        const lead = await this.leadRepo.getByIdForTenant(tenantId, leadId);
        if (lead === null) throw new NotFoundError("Lead tidak ditemukan");

        const changes: ManualLeadChanges = {};
        if (body.stage !== undefined) changes.stage = body.stage;
        if (body.temperature !== undefined) changes.temperature = body.temperature;
        if (body.dealValueMinor !== undefined) changes.dealValueMinor = body.dealValueMinor;

        const {lead: updated, manualAssessmentId} = await this.leadRepo.updateManual(leadId, changes);

        return {
            id: updated.id,
            stage: updated.stage,
            temperature: updated.temperature,
            dealValueMinor: updated.dealValueMinor,
            updatedAt: updated.updatedAt.toISOString(),
            manualAssessmentId,
        };
    }
}
