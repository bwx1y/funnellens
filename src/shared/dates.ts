const MS_PER_DAY = 86_400_000;

/** UTC `YYYY-MM-DD` for a `Date` instant. */
export function toDateString(value: Date): string {
    return value.toISOString().slice(0, 10);
}

export function startOfDayUtc(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
}

export function endOfDayUtc(date: string): Date {
    return new Date(`${date}T23:59:59.999Z`);
}

export function addDays(date: string, days: number): string {
    const [year, month, day] = date.split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return shifted.toISOString().slice(0, 10);
}

/** Inclusive day count: `2026-03-01`..`2026-03-01` is 1; non-positive when `since` is after `until`. */
export function dayCount(since: string, until: string): number {
    return dayDiff(since, until) + 1;
}

/**
 * Today's date in the account timezone. An unknown IANA name from Meta must not fail the request,
 * so the UTC date is the fallback.
 */
export function todayInZone(timezoneName: string): string {
    try {
        return new Intl.DateTimeFormat("en-CA", {timeZone: timezoneName}).format(new Date());
    } catch {
        return toDateString(new Date());
    }
}

/** Maps a date inside `since..since + days - 1` onto one of 7 sparkline buckets. */
export function bucketIndex(date: string, since: string, days: number): number {
    return Math.min(6, Math.max(0, Math.floor(dayDiff(since, date) * 7 / days)));
}

function dayDiff(from: string, to: string): number {
    return Math.round((utcMillis(to) - utcMillis(from)) / MS_PER_DAY);
}

function utcMillis(date: string): number {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
}
