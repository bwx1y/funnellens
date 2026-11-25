import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {
    AnalyticsRepository,
    type FunnelCounts,
    type LeadStageCounts,
} from "@db/repositories/analytics.repository";
import {ConversationMessageRepository} from "@db/repositories/conversation-message.repository";
import {
    InsightAlertRepository,
    type InsightAlertUpsert,
} from "@db/repositories/insight-alert.repository";
import {LeadRepository} from "@db/repositories/lead.repository";
import {PixelSourceRepository} from "@db/repositories/pixel-source.repository";
import {TrackingHealthRepository} from "@db/repositories/tracking-health.repository";
import {CreativeService} from "@/modules/creative/service";
import {NotFoundError} from "@shared/errors";
import {round4} from "@shared/numbers";
import {resolvePeriod, type ResolvedPeriod} from "@shared/period";
import {trackingAlertNeeded} from "@shared/tracking";
import {
    HOT_LEAD_SCAN_LIMIT,
    HOT_LEAD_WAIT_MINUTES,
    LEAK_RULES,
    conversationReconciliationGap,
    leakLevel,
    type AlertRuleKey,
} from "@shared/alerts";
import {
    FUNNEL_STAGES,
    buildFunnelPairs,
    leakageCaption,
    trackingStateOf,
    type FunnelCountsLike,
    type FunnelStageKey,
} from "@shared/funnel";

/**
 * The single writer of alert rows derived from analytics. `evaluate` builds the rows without
 * touching the table; `run` persists them and closes the ones whose condition no longer holds.
 */

export interface AlertEvaluateResult {
    accountId: string;
    upserted: number;
    resolved: number;
    alerts: InsightAlertUpsert[];
}

const LEAK_TITLES: Record<string, string> = {
    leak_click_to_landing: "Klik tautan tidak berubah menjadi chat",
    leak_chat_to_reply: "Chat masuk belum dibalas",
    leak_qualified_to_closed: "Lead qualified tidak menjadi closing",
};

const EVALUATED_RULES: AlertRuleKey[] = [
    ...LEAK_RULES.map((rule) => rule.ruleKey),
    "unreplied_hot_lead",
    "creative_fatigue",
    "tracking_emq",
    "conversation_reconciliation",
    // `sync_failed` is deliberately absent: `MetaSyncDeadLetter.clearAlert` resolves that row on the
    // next successful sync, and this evaluator never emits it. Listing it here would close a live
    // failure alert on the next hourly run, before anything proved the sync works again.
];

/** The Meta columns come from the funnel query; lead counts replace the four cross stages. */
function toCounts(meta: FunnelCounts, leads: LeadStageCounts): FunnelCountsLike {
    return {
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
    };
}

/** The `wa` stages are all reported counts, so a null here means the funnel has no numbers at all. */
function readStages(counts: FunnelCountsLike): {key: FunnelStageKey; value: number | null}[] {
    return FUNNEL_STAGES.wa.map((definition) => ({key: definition.key, value: definition.read(counts)}));
}

/** Mean with 4 decimals; `null` for an empty input. */
function mean(values: number[]): number | null {
    if (values.length === 0) return null;

    return round4(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export class AlertEvaluateService {
    constructor(
        private readonly adAccountRepo = new AdAccountRepository(),
        private readonly analyticsRepo = new AnalyticsRepository(),
        private readonly leadRepo = new LeadRepository(),
        private readonly trackingHealthRepo = new TrackingHealthRepository(),
        private readonly pixelSourceRepo = new PixelSourceRepository(),
        private readonly alertRepo = new InsightAlertRepository(),
        private readonly creativeService = new CreativeService(),
        private readonly conversationMessageRepo = new ConversationMessageRepository()
    ) {}

    /** Builds the alert rows of one account and period without writing to `insight_alerts`. */
    async evaluate(accountId: string, period: ResolvedPeriod): Promise<InsightAlertUpsert[]> {
        const account = await this.adAccountRepo.findById(accountId);
        if (account === null) throw new NotFoundError("Akun iklan tidak ditemukan");

        const [
            meta,
            previousMeta,
            leads,
            previousLeads,
            trackingSummary,
            latestStatus,
            pixelSources,
            hotLeads,
            observedConversations,
        ] = await Promise.all([
            this.analyticsRepo.getFunnelCounts(accountId, period.start, period.end, undefined, "wa"),
            this.analyticsRepo.getFunnelCounts(accountId, period.prevStart, period.prevEnd, undefined, "wa"),
            this.analyticsRepo.getLeadStageCounts(accountId, period.start, period.end),
            this.analyticsRepo.getLeadStageCounts(accountId, period.prevStart, period.prevEnd),
            this.analyticsRepo.getTrackingSummary(accountId),
            this.trackingHealthRepo.getLatestStatus(accountId),
            this.pixelSourceRepo.findByAccountId(accountId),
            this.leadRepo.getUnrepliedHotLeads(accountId, HOT_LEAD_SCAN_LIMIT),
            this.conversationMessageRepo.countInboundConversations(accountId, period.start, period.end),
        ]);

        const trackingState = trackingStateOf(trackingSummary);
        const current = readStages(toCounts(meta, leads));
        const previous = readStages(toCounts(previousMeta, previousLeads));
        const pairs = buildFunnelPairs(current, previous, trackingState);
        const alerts: InsightAlertUpsert[] = [];

        for (const rule of LEAK_RULES) {
            const pair = pairs.find((entry) => entry.from === rule.from && entry.to === rule.to);
            if (pair === undefined) continue;

            const level = pair.eligible ? leakLevel(pair.deltaPp) : null;
            if (level === null) continue;
            if (pair.rate === null || pair.baseline === null || pair.deltaPp === null) continue;

            alerts.push({
                accountId,
                ruleKey: rule.ruleKey,
                level,
                entityType: "account",
                entityId: "",
                status: "ACTIVE",
                title: LEAK_TITLES[rule.ruleKey],
                body: `Rasio ${pair.from} → ${pair.to} ${pair.rate} vs baseline ${pair.baseline}; ` +
                    `turun ${Math.abs(pair.deltaPp)} poin persen.`,
                metric: "deltaPp",
                impactMinor: null,
                impactCaption: pair.estimatedGap === null ? null : leakageCaption(pair.estimatedGap),
                confidence: "tinggi",
                sampleSize: pair.sample.n,
                route: "/analytics/funnel",
                evidence: {
                    transition: `${pair.from}→${pair.to}`,
                    rate: pair.rate,
                    baseline: pair.baseline,
                    deltaPp: pair.deltaPp,
                    estimatedGap: pair.estimatedGap,
                    since: period.since,
                    until: period.until,
                    trackingState,
                },
            });
        }

        for (const lead of hotLeads) {
            if (lead.firstSeenAt === null) continue;

            const waitingMinutes = Math.floor((Date.now() - lead.firstSeenAt.getTime()) / 60_000);
            if (waitingMinutes <= HOT_LEAD_WAIT_MINUTES) continue;

            alerts.push({
                accountId,
                ruleKey: "unreplied_hot_lead",
                level: "CRITICAL",
                entityType: "lead",
                entityId: String(lead.id),
                status: "ACTIVE",
                title: "Lead HOT belum dibalas",
                body: `Lead HOT menunggu ${waitingMinutes} menit tanpa balasan.`,
                metric: "waitingMinutes",
                impactMinor: null,
                impactCaption: null,
                confidence: "tinggi",
                sampleSize: null,
                route: `/leads/${lead.id}`,
                evidence: {
                    leadId: lead.id,
                    firstSeenAt: lead.firstSeenAt.toISOString(),
                    waitingMinutes,
                    temperature: "HOT",
                },
            });
        }

        const fatigue = await this.creativeService.getFatigue(account.tenantId, {
            accountId,
            since: period.since,
            until: period.until,
        });
        for (const row of fatigue.creatives) {
            if (row.status !== "Jenuh") continue;

            alerts.push({
                accountId,
                ruleKey: "creative_fatigue",
                level: "WARNING",
                entityType: "creative",
                entityId: row.creativeId,
                status: "ACTIVE",
                title: "Kreatif mulai jenuh",
                body: `Kreatif ${row.name ?? row.creativeId} turun ${row.drop} dengan ` +
                    `${row.consecutiveDays} hari penurunan berturut-turut.`,
                metric: "drop",
                impactMinor: null,
                impactCaption: null,
                confidence: "sedang",
                sampleSize: null,
                route: "/analytics/creatives",
                evidence: {
                    creativeId: row.creativeId,
                    drop: row.drop,
                    consecutiveDays: row.consecutiveDays,
                    frequency: row.frequency,
                    since: period.since,
                    until: period.until,
                },
            });
        }

        // Same inputs and threshold as the `sync-pixel-stats` job, so both paths upsert one row.
        const emqAvg = mean(
            pixelSources
                .map((pixel) => pixel.emqAvg)
                .filter((value): value is string => value !== null)
                .map(Number)
        );
        const dedup = latestStatus.dedupRate;
        if (trackingAlertNeeded(emqAvg, dedup)) {
            alerts.push({
                accountId,
                ruleKey: "tracking_emq",
                level: "WARNING",
                entityType: "account",
                entityId: "",
                status: "ACTIVE",
                title: "Event Match Quality perlu perhatian",
                body: `EMQ rata-rata ${emqAvg === null ? "tidak tersedia" : emqAvg.toFixed(2)} dari 10; ` +
                    `rasio deduplikasi ${dedup === null ? "tidak tersedia" : dedup.toFixed(2)}.`,
                metric: "emq",
                impactMinor: null,
                impactCaption: null,
                confidence: "sedang",
                sampleSize: null,
                route: "/tracking-health",
                evidence: {emqAvg, dedupRate: dedup, date: latestStatus.date},
            });
        }

        const gap = conversationReconciliationGap({
            metaConversations: meta.messagingStarted,
            observedConversations,
        });
        if (gap.breached) {
            const caption = gap.difference >= 0
                ? `≈${gap.difference} percakapan tidak tercatat`
                : `≈${Math.abs(gap.difference)} percakapan tidak teratribusi di Meta`;

            alerts.push({
                accountId,
                ruleKey: "conversation_reconciliation",
                level: "WARNING",
                entityType: "account",
                entityId: "",
                status: "ACTIVE",
                title: "Jumlah percakapan tidak cocok dengan Meta",
                body: `Meta mencatat ${meta.messagingStarted} percakapan; inbox mencatat ` +
                    `${observedConversations} percakapan pada periode ini.`,
                metric: "difference",
                impactMinor: null,
                impactCaption: caption,
                confidence: "sedang",
                sampleSize: observedConversations,
                route: "/tracking-health",
                evidence: {
                    metaConversations: meta.messagingStarted,
                    observedConversations,
                    difference: gap.difference,
                    rate: gap.rate,
                    since: period.since,
                    until: period.until,
                },
            });
        }

        return alerts;
    }

    /** Persists the current evaluation and closes every alert of a rule that no longer fires. */
    async run(tenantId: string, accountId: string, period?: ResolvedPeriod): Promise<AlertEvaluateResult> {
        const account = await this.adAccountRepo.findById(accountId, tenantId);
        if (account === null) throw new NotFoundError("Akun iklan tidak ditemukan");

        const resolved = period ?? resolvePeriod(account, {});
        const alerts = await this.evaluate(accountId, resolved);

        for (const alert of alerts) {
            await this.alertRepo.upsert(alert);
        }

        let closed = 0;
        for (const ruleKey of EVALUATED_RULES) {
            const keep = alerts
                .filter((alert) => alert.ruleKey === ruleKey)
                .map((alert) => alert.entityId ?? "");
            closed += await this.alertRepo.resolveByRuleKey(accountId, ruleKey, keep);
        }

        return {accountId, upserted: alerts.length, resolved: closed, alerts};
    }
}
