import {BadRequestError} from "@shared/errors";
import {addDays, dayCount, endOfDayUtc, startOfDayUtc, todayInZone} from "@shared/dates";

export const DEFAULT_PERIOD_DAYS = 30;
export const PERIOD_DAYS = [7, 14, 30] as const;
export type PeriodDays = typeof PERIOD_DAYS[number];
export const DEFAULT_SNAPSHOT_END = "2026-11-19";

const MONTH_NAMES_ID = [
    "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
];

export interface ResolvedPeriod {
    since: string;
    until: string;
    days: number;
    previousSince: string;
    previousUntil: string;
    snapshotEnd: string;
    start: Date;
    end: Date;
    prevStart: Date;
    prevEnd: Date;
}

/**
 * Formats date range label in id-ID style.
 * - Same month & year: "13–19 Nov 2026"
 * - Different month, same year: "27 Okt – 25 Nov 2026"
 * - Different year: "28 Des 2026 – 3 Jan 2027"
 */
export function periodLabel(since: string, until: string): string {
    const [y1, m1, d1] = since.split("-").map(Number);
    const [y2, m2, d2] = until.split("-").map(Number);

    const month1 = MONTH_NAMES_ID[m1 - 1];
    const month2 = MONTH_NAMES_ID[m2 - 1];

    if (y1 === y2) {
        if (m1 === m2) {
            return `${d1}–${d2} ${month2} ${y2}`;
        }
        return `${d1} ${month1} – ${d2} ${month2} ${y2}`;
    }

    return `${d1} ${month1} ${y1} – ${d2} ${month2} ${y2}`;
}

/** Returns `true` when `until` equals today in the account timezone. */
export function isPartialDay(until: string, timezoneName: string, now: Date = new Date()): boolean {
    return until === todayInZone(timezoneName);
}

/**
 * Resolves period contract:
 * - `days` provided -> validated against PERIOD_DAYS, until defaults to DEFAULT_SNAPSHOT_END, days takes precedence over since/until.
 * - `days` omitted -> defaults to last 30 days ending today in account timezone.
 */
export function resolvePeriod(
    account: {timezoneName: string},
    query: {since?: string; until?: string; days?: number}
): ResolvedPeriod {
    let until: string;
    let since: string;
    let days: number;

    if (query.days !== undefined) {
        if (!PERIOD_DAYS.includes(query.days as PeriodDays)) {
            throw new BadRequestError("days harus 7, 14, atau 30", "INVALID_DAYS");
        }
        days = query.days;
        until = query.until ?? DEFAULT_SNAPSHOT_END;
        since = addDays(until, -(days - 1));
    } else {
        until = query.until ?? todayInZone(account.timezoneName);
        since = query.since ?? addDays(until, -(DEFAULT_PERIOD_DAYS - 1));
        if (since > until) {
            throw new BadRequestError("Rentang tanggal tidak valid");
        }
        days = dayCount(since, until);
    }

    const previousUntil = addDays(since, -1);
    const previousSince = addDays(previousUntil, -(days - 1));

    return {
        since,
        until,
        days,
        previousSince,
        previousUntil,
        snapshotEnd: until,
        start: startOfDayUtc(since),
        end: endOfDayUtc(until),
        prevStart: startOfDayUtc(previousSince),
        prevEnd: endOfDayUtc(previousUntil),
    };
}
