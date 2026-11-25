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
