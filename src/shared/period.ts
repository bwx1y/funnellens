import {BadRequestError} from "@shared/errors";
import {addDays, dayCount, endOfDayUtc, startOfDayUtc, todayInZone} from "@shared/dates";

export const DEFAULT_PERIOD_DAYS = 30;

export interface ResolvedPeriod {
    since: string;
    until: string;
    days: number;
    previousSince: string;
    previousUntil: string;
    start: Date;
    end: Date;
    prevStart: Date;
    prevEnd: Date;
}

/**
 * Resolves `since`/`until` (default: the last 30 days in the account timezone) plus the equally long
 * period immediately before it, in both `YYYY-MM-DD` and UTC instant form.
 */
export function resolvePeriod(
    account: {timezoneName: string},
    query: {since?: string; until?: string}
): ResolvedPeriod {
    const until = query.until ?? todayInZone(account.timezoneName);
    const since = query.since ?? addDays(until, -(DEFAULT_PERIOD_DAYS - 1));
    if (since > until) {
        throw new BadRequestError("Rentang tanggal tidak valid");
    }

    const days = dayCount(since, until);
    const previousUntil = addDays(since, -1);
    const previousSince = addDays(previousUntil, -(days - 1));

    return {
        since,
        until,
        days,
        previousSince,
        previousUntil,
        start: startOfDayUtc(since),
        end: endOfDayUtc(until),
        prevStart: startOfDayUtc(previousSince),
        prevEnd: endOfDayUtc(previousUntil),
    };
}
