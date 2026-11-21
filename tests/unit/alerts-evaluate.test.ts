import {describe, expect, it} from "bun:test";
import {AlertEvaluateService} from "@/modules/alerts/evaluate.service";
import {AlertsWorkerProcessor} from "@/modules/alerts/worker";
import type {FunnelCounts} from "@db/repositories/analytics.repository";
import type {InsightAlertUpsert} from "@db/repositories/insight-alert.repository";
import {resolvePeriod} from "@shared/period";

const period = resolvePeriod({timezoneName: "Asia/Jakarta"}, {since: "2026-02-01", until: "2026-03-02"});
const accountId = "act_eval";

/**
 * Current period clicks 1000 → 100 chats (10%); previous 1000 → 200 (20%): −10 pp, 100 chats lost.
 * Leads: current 100/90/30/10, previous 200/180/60/20, so the two lead transitions do not drop.
 */
function evaluateService(options: {
    hotLeads?: {id: number; firstSeenAt: Date | null}[];
    emqAvg?: string | null;
    dedupRate?: number | null;
} = {}) {
    const funnel = (linkClicks: number, messagingStarted: number): FunnelCounts => ({
        spendMinor: 0,
        impressions: 10_000,
        linkClicks,
        lpv: 0,
        viewContent: 0,
        addToCart: 0,
        purchase: 0,
        messagingStarted,
        results: 0,
        purchaseValueMinor: 0,
    });
    const current = funnel(1_000, 100);
    const previous = funnel(1_000, 200);
    const currentLeads = {observed: 100, replied: 90, qualified: 30, closed: 10, firstHot: 0};
    const previousLeads = {observed: 200, replied: 180, qualified: 60, closed: 20, firstHot: 0};
    const isCurrent = (since: Date) => since.getTime() === period.start.getTime();

    return new AlertEvaluateService(
        {findById: async () => ({id: accountId, tenantId: "tenant-1"})} as never,
        {
            getFunnelCounts: async (_accountId: string, since: Date) => isCurrent(since) ? current : previous,
            getLeadStageCounts: async (_accountId: string, since: Date) =>
                isCurrent(since) ? currentLeads : previousLeads,
            getTrackingSummary: async () => ({lastSuccessAt: new Date(), overdue: false}),
        } as never,
        {getUnrepliedHotLeads: async () => options.hotLeads ?? []} as never,
        {getLatestStatus: async () => ({date: "2026-03-02", dedupRate: options.dedupRate ?? 0.9})} as never,
        {
            findByAccountId: async () => options.emqAvg === undefined
                ? []
                : [{emqAvg: options.emqAvg}],
        } as never,
        {upsert: async () => undefined, resolveByRuleKey: async () => 0} as never,
        {getFatigue: async () => ({creatives: []})} as never
    );
}

const byRule = (alerts: InsightAlertUpsert[], ruleKey: string) =>
    alerts.find((alert) => alert.ruleKey === ruleKey);

describe("AlertEvaluateService.evaluate", () => {
    it("turns a 10 point leakage drop into a WARNING with the chat caption", async () => {
        const alerts = await evaluateService({emqAvg: "8.00"}).evaluate(accountId, period);
        const leak = byRule(alerts, "leak_click_to_landing");

        expect(leak).toMatchObject({
            ruleKey: "leak_click_to_landing",
            level: "WARNING",
            entityType: "account",
            entityId: "",
            impactMinor: null,
            impactCaption: "≈100 chat hilang",
            confidence: "tinggi",
            route: "/analytics/funnel",
        });
        expect(leak?.evidence).toMatchObject({deltaPp: -10, rate: 0.1, baseline: 0.2, estimatedGap: 100});
        expect(byRule(alerts, "leak_chat_to_reply")).toBeUndefined();
        expect(byRule(alerts, "leak_qualified_to_closed")).toBeUndefined();
        expect(byRule(alerts, "tracking_emq")).toBeUndefined();
    });

    it("raises an unreplied HOT lead as CRITICAL with its own entity and route", async () => {
        const firstSeenAt = new Date(Date.now() - 31 * 60_000);
        const alerts = await evaluateService({hotLeads: [{id: 7, firstSeenAt}], emqAvg: "8.00"})
            .evaluate(accountId, period);
        const hot = byRule(alerts, "unreplied_hot_lead");

        expect(hot).toMatchObject({
            level: "CRITICAL",
            entityType: "lead",
            entityId: "7",
            route: "/leads/7",
        });
        expect(hot?.evidence).toMatchObject({leadId: 7, temperature: "HOT"});
        expect(hot?.evidence).toMatchObject({waitingMinutes: expect.any(Number)});
    });

    it("does not alert for a HOT lead still inside the 30 minute window", async () => {
        const firstSeenAt = new Date(Date.now() - 10 * 60_000);
        const alerts = await evaluateService({hotLeads: [{id: 8, firstSeenAt}], emqAvg: "8.00"})
            .evaluate(accountId, period);

        expect(byRule(alerts, "unreplied_hot_lead")).toBeUndefined();
    });

    it("raises tracking_emq below 6 EMQ or below 0.85 deduplication", async () => {
        const lowEmq = await evaluateService({emqAvg: "5.50"}).evaluate(accountId, period);
        expect(byRule(lowEmq, "tracking_emq")).toMatchObject({
            level: "WARNING",
            entityId: "",
            evidence: {emqAvg: 5.5, dedupRate: 0.9},
        });

        const lowDedup = await evaluateService({emqAvg: "8.00", dedupRate: 0.80}).evaluate(accountId, period);
        expect(byRule(lowDedup, "tracking_emq")).toMatchObject({level: "WARNING"});

        const healthy = await evaluateService({emqAvg: "6.00", dedupRate: 0.85}).evaluate(accountId, period);
        expect(byRule(healthy, "tracking_emq")).toBeUndefined();
    });
});

describe("AlertsWorkerProcessor", () => {
    function worker() {
        const runs: string[] = [];
        const processor = new AlertsWorkerProcessor(
            {run: async (_tenantId: string, accountId: string) => runs.push(accountId)} as never,
            {
                findSelected: async () => [
                    {id: "act_1", tenantId: "tenant-1"},
                    {id: "act_2", tenantId: "tenant-1"},
                ],
                findById: async (id: string) => id === "act_1" ? {id: "act_1", tenantId: "tenant-1"} : null,
            } as never
        );

        return {processor, runs};
    }

    it("evaluates every selected account when the job has no account filter", async () => {
        const {processor, runs} = worker();

        await processor.process({data: {}} as never);

        expect(runs).toEqual(["act_1", "act_2"]);
    });

    it("evaluates only the requested account and skips one that is gone", async () => {
        const {processor, runs} = worker();

        await processor.process({data: {accountId: "act_1"}} as never);
        await processor.process({data: {accountId: "act_missing"}} as never);

        expect(runs).toEqual(["act_1"]);
    });
});
