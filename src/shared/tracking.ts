import {round4} from "@shared/numbers";

/**
 * Pure tracking-health math: deduplication, browser share, event/card status, match-key gaps, and the
 * alert threshold. No I/O here; an unmeasurable value is `null`, never `0`.
 */

export type TrackingStatus = "Sehat" | "Perlu optimalisasi" | "Bermasalah";

/** Column order of the event table; names outside the list follow alphabetically. */
export const EVENT_NAMES = [
    "PageView",
    "ViewContent",
    "Lead",
    "Purchase",
    "AddToCart",
    "InitiateCheckout",
] as const;

export const EMQ_KEY_EVENTS = ["Lead", "Purchase"] as const;

/** EMQ is reported on a 0–10 scale by Meta. */
export const EMQ_SCALE = 10;
export const EMQ_THRESHOLD = 6;
export const EMQ_CRITICAL = 4;

export const DEDUP_TARGET = 0.9;
export const DEDUP_WARNING = 0.9;
export const DEDUP_CRITICAL = 0.8;
export const DEDUP_ALERT_THRESHOLD = 0.85;

export const EVENT_SAMPLE_DENOMINATOR = 100;
export const EVENT_GATE = "≥ 100 event";

/** Match keys Meta accepts for a Lead event; a missing one is a next check, never a cause. */
const MATCH_KEYS = ["ph", "em"] as const;
export type MatchKey = typeof MATCH_KEYS[number];

/** `1 - duplicate / (browser + server)`, 4 decimals; `null` on a `null` input or an empty denominator. */
export function dedupRate(
    browserCount: number | null,
    serverCount: number | null,
    duplicateCount: number | null
): number | null {
    if (browserCount === null || serverCount === null || duplicateCount === null) return null;

    const total = browserCount + serverCount;
    if (total <= 0) return null;

    return round4(1 - duplicateCount / total);
}

/** Share of events that arrived from the browser, 4 decimals; `null` on a `null` input or an empty total. */
export function browserShare(browserCount: number | null, serverCount: number | null): number | null {
    if (browserCount === null || serverCount === null) return null;

    const total = browserCount + serverCount;
    if (total <= 0) return null;

    return round4(browserCount / total);
}

/** Status of one event row; the first matching rule wins, `null` when nothing was measured. */
export function eventStatus(input: {
    dedupRate: number | null;
    matchQuality: number | null;
}): TrackingStatus | null {
    const {dedupRate: rate, matchQuality} = input;
    if (rate === null && matchQuality === null) return null;

    if (
        (matchQuality !== null && matchQuality < EMQ_CRITICAL) ||
        (rate !== null && rate < DEDUP_CRITICAL)
    ) {
        return "Bermasalah";
    }

    if (
        (matchQuality !== null && matchQuality < EMQ_THRESHOLD) ||
        (rate !== null && rate < DEDUP_WARNING)
    ) {
        return "Perlu optimalisasi";
    }

    return "Sehat";
}

/** Status of the EMQ card from the 0–10 average alone; deduplication does not take part. */
export function emqStatus(average: number | null): TrackingStatus | null {
    if (average === null) return null;
    if (average < EMQ_CRITICAL) return "Bermasalah";
    if (average < EMQ_THRESHOLD) return "Perlu optimalisasi";

    return "Sehat";
}

/** Pixel match keys that are not enabled; an unknown field list claims nothing. */
export function missingMatchKeys(fields: string[] | null): MatchKey[] {
    if (fields === null || fields.length === 0) return [];

    const enabled = new Set(fields.map((field) => field.toLowerCase()));
    return MATCH_KEYS.filter((key) => !enabled.has(key));
}

/** Alert rule `tracking_emq`: EMQ below 6 or deduplication below 0.85. */
export function trackingAlertNeeded(emqAvg: number | null, dedupRate: number | null): boolean {
    return (emqAvg !== null && emqAvg < EMQ_THRESHOLD) ||
        (dedupRate !== null && dedupRate < DEDUP_ALERT_THRESHOLD);
}

/** Canonical event order, unknown names trailing alphabetically. The input is not mutated. */
export function orderEventNames(names: string[]): string[] {
    const rank = (name: string): number => {
        const index = EVENT_NAMES.indexOf(name as typeof EVENT_NAMES[number]);
        return index === -1 ? EVENT_NAMES.length : index;
    };

    return [...names].sort((left, right) => {
        const delta = rank(left) - rank(right);
        if (delta !== 0) return delta;
        return left.localeCompare(right);
    });
}
