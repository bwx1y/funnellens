import type {FunnelStageKey} from "@shared/funnel";

/**
 * Pure alert vocabulary: rule keys, leakage thresholds, the snooze window, and the `active`
 * predicate. No I/O here; the engine and the HTTP service both read these tables.
 */

export type AlertStatusFilter = "active" | "snoozed" | "resolved";

export type LeakRuleKey = "leak_click_to_landing" | "leak_chat_to_reply" | "leak_qualified_to_closed";
/** `sync_failed` is written by the dead-letter hook, not the hourly evaluator: it fires when a job dies. */
export type AlertRuleKey =
    | LeakRuleKey
    | "unreplied_hot_lead"
    | "creative_fatigue"
    | "tracking_emq"
    | "conversation_reconciliation"
    | "sync_failed";

/** The three WhatsApp leakage transitions; the `≈{gap} chat hilang` caption only holds for this channel. */
export const LEAK_RULES: {ruleKey: LeakRuleKey; from: FunnelStageKey; to: FunnelStageKey}[] = [
    {ruleKey: "leak_click_to_landing", from: "link_clicks", to: "messaging_started"},
    {ruleKey: "leak_chat_to_reply", from: "observed", to: "replied"},
    {ruleKey: "leak_qualified_to_closed", from: "qualified", to: "closed"},
];

export const LEAK_WARNING_PP = -5;
export const LEAK_CRITICAL_PP = -15;

/** A HOT lead unanswered for longer than this is already late. */
export const HOT_LEAD_WAIT_MINUTES = 30;
/** One page of the oldest unanswered HOT leads; the backlog count is a separate repository method. */
export const HOT_LEAD_SCAN_LIMIT = 50;

export const SNOOZE_HOURS = [24, 168] as const;
export type SnoozeHours = typeof SNOOZE_HOURS[number];

/**
 * A stable public id for one alert, derived from the rule and the entity it is about — never from the
 * auto-increment id, so the same alert keeps its key across syncs (and across snapshots of the API).
 * `entityId` may itself contain a colon; only the first one separates the two halves.
 */
export function insightKey(alert: {ruleKey: string; entityId: string}): string {
    return `${alert.ruleKey}:${alert.entityId}`;
}

/** Inverse of {@link insightKey}; `null` for a string without the separator. */
export function parseInsightKey(key: string): {ruleKey: string; entityId: string} | null {
    const separator = key.indexOf(":");
    if (separator <= 0) return null;

    return {ruleKey: key.slice(0, separator), entityId: key.slice(separator + 1)};
}

/** One user's own state on an alert: unread, read (badge cleared), done (out of the active tab). */
export type ReviewStatus = "read" | "done" | "active";
export const REVIEW_STATUSES: ReviewStatus[] = ["read", "done", "active"];
/** Newest first; more than this is history nobody scrolls. */
export const REVIEW_HISTORY_LIMIT = 50;

/** Meta's own conversation count may differ from ours by attribution lag; only a real gap alerts. */
export const CONVERSATION_RECONCILIATION_TOLERANCE = 0.1;

/** `difference = meta − observed`; a negative gap means we saw chats Meta never attributed. */
export function conversationReconciliationGap(input: {
    metaConversations: number;
    observedConversations: number;
}): {difference: number; rate: number | null; breached: boolean} {
    const difference = input.metaConversations - input.observedConversations;
    const denominator = Math.max(input.metaConversations, input.observedConversations);
    const rate = denominator === 0 ? null : Math.abs(difference) / denominator;

    return {
        difference,
        rate: rate === null ? null : Math.round(rate * 10_000) / 10_000,
        breached: rate !== null && rate > CONVERSATION_RECONCILIATION_TOLERANCE,
    };
}

/** `null` when the transition did not drop; `≤ −15` CRITICAL; `≤ −5` WARNING. */
export function leakLevel(deltaPp: number | null): "WARNING" | "CRITICAL" | null {
    if (deltaPp === null) return null;
    if (deltaPp <= LEAK_CRITICAL_PP) return "CRITICAL";
    if (deltaPp <= LEAK_WARNING_PP) return "WARNING";

    return null;
}

/** `now + hours`; the service computes it once so the response and the row share one instant. */
export function snoozedUntil(hours: SnoozeHours, now: Date): Date {
    return new Date(now.getTime() + hours * 3_600_000);
}
