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

/** A snapshot older than this many hours cannot vouch for tracking today. */
export const FRESHNESS_STALE_HOURS = 48;
/** A key event without a snapshot in this window is missing, not merely stale. */
export const FRESHNESS_TRACKED_HOURS = 7 * 24;

/** Where a tracking warning sends the reader; one page inspects events, sync, EMQ, and deduplication. */
export const TRACKING_ROUTE = "/tracking-health";

export type WarningCode =
    | "ATTRIBUTION_FRESHNESS"
    | "PIXEL_EVENT_MISSING"
    | "SYNC_FAILED"
    | "EMQ_LOW"
    | "DEDUP_LOW";

/** A factual, cause-free pointer on the tracking-health panel. */
export interface TrackingWarning {
    code: WarningCode;
    level: "INFO" | "WARNING" | "CRITICAL";
    message: string;
    route: string | null;
}

/** One event's newest snapshot: `lastSeenAt` is the snapshot date, not a timestamp. */
export interface DataFreshnessEntry {
    eventName: string;
    lastSeenAt: string | null;
    hoursOld: number | null;
    stale: boolean;
}

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

/**
 * Whole hours between a snapshot date (`YYYY-MM-DD`, read as UTC midnight) and `now`; clamped at 0
 * because an account east of UTC can report tomorrow's date while the server is still on today.
 */
export function hoursSince(date: string, now: number): number | null {
    const seenAt = Date.parse(`${date}T00:00:00.000Z`);
    if (Number.isNaN(seenAt)) return null;

    return Math.max(0, Math.floor((now - seenAt) / 3_600_000));
}

/**
 * One row per event of the account, taken from the newest snapshot date of that event. Key events are
 * always listed so a missing Lead/Purchase has an entry to point at.
 */
export function buildDataFreshness(input: {
    latest: {eventName: string; date: string}[];
    keyEvents?: readonly string[];
    now: number;
}): DataFreshnessEntry[] {
    const seen = new Map(input.latest.map((row) => [row.eventName, row.date]));
    const names = orderEventNames([
        ...new Set([...input.latest.map((row) => row.eventName), ...(input.keyEvents ?? [])]),
    ]);

    return names.map((eventName) => {
        const lastSeenAt = seen.get(eventName) ?? null;
        const hoursOld = lastSeenAt === null ? null : hoursSince(lastSeenAt, input.now);

        return {
            eventName,
            lastSeenAt,
            hoursOld,
            stale: lastSeenAt === null || hoursOld === null || hoursOld > FRESHNESS_STALE_HOURS,
        };
    });
}

/** Percent label with an Indonesian decimal comma; these messages are read by operators, not parsed. */
function percentLabel(ratio: number): string {
    return `${String(Math.round(ratio * 1000) / 10).replace(".", ",")}%`;
}

/**
 * The panel's warning list, in a fixed severity order. Every message states what was observed, never
 * why; `syncFailure` is non-null only when the newest run of the account failed.
 */
export function buildTrackingWarnings(input: {
    freshness: DataFreshnessEntry[];
    keyEvents?: readonly string[];
    emqAverage: number | null;
    dedupRate: number | null;
    syncFailure?: {error: string | null} | null;
}): TrackingWarning[] {
    const warnings: TrackingWarning[] = [];

    const staleNames = input.freshness
        .filter((entry) => entry.stale)
        .map((entry) => entry.eventName);
    if (staleNames.length > 0) {
        warnings.push({
            code: "ATTRIBUTION_FRESHNESS",
            level: "WARNING",
            message: `Data atribusi ${staleNames.join(", ")} tidak tersedia dalam ` +
                `${FRESHNESS_STALE_HOURS} jam terakhir.`,
            route: TRACKING_ROUTE,
        });
    }

    const keyEvents = input.keyEvents ?? EMQ_KEY_EVENTS;
    const byName = new Map(input.freshness.map((entry) => [entry.eventName, entry]));
    const missing = keyEvents.filter((eventName) => {
        const entry = byName.get(eventName);
        return entry === undefined ||
            entry.lastSeenAt === null ||
            entry.hoursOld === null ||
            entry.hoursOld > FRESHNESS_TRACKED_HOURS;
    });
    if (missing.length > 0) {
        warnings.push({
            code: "PIXEL_EVENT_MISSING",
            level: "CRITICAL",
            message: `Event kunci ${missing.join(", ")} tidak memiliki data dalam ` +
                `${FRESHNESS_TRACKED_HOURS / 24} hari terakhir.`,
            route: TRACKING_ROUTE,
        });
    }

    if (input.syncFailure != null) {
        const error = input.syncFailure.error?.trim();
        warnings.push({
            code: "SYNC_FAILED",
            level: "CRITICAL",
            message: error === undefined || error === ""
                ? "Sinkronisasi terakhir gagal."
                : `Sinkronisasi terakhir gagal: ${error}`,
            route: TRACKING_ROUTE,
        });
    }

    if (input.emqAverage !== null && input.emqAverage < EMQ_THRESHOLD) {
        warnings.push({
            code: "EMQ_LOW",
            level: "WARNING",
            message: `Event Match Quality rata-rata ${input.emqAverage.toFixed(2)} di bawah ambang ` +
                `${EMQ_THRESHOLD} dari ${EMQ_SCALE}.`,
            route: TRACKING_ROUTE,
        });
    }

    if (input.dedupRate !== null && input.dedupRate < DEDUP_WARNING) {
        warnings.push({
            code: "DEDUP_LOW",
            level: "WARNING",
            message: `Rasio deduplikasi ${percentLabel(input.dedupRate)} di bawah target ` +
                `${percentLabel(DEDUP_WARNING)}.`,
            route: TRACKING_ROUTE,
        });
    }

    return warnings;
}
