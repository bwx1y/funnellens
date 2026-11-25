import {median, round4} from "@shared/numbers";

/**
 * Pure creative-intelligence math: percentile gating, the four dimensions, overall status, fatigue,
 * Mann-Whitney + Benjamini-Hochberg, and the deterministic content-element reader. No I/O here.
 */

export type DimensionLabel = "kuat" | "rata-rata" | "lemah";
export type DimensionCertainty = "kurang" | "indikatif" | "terukur";

export interface CreativeDimension {
    label: DimensionLabel | null;
    certainty: DimensionCertainty;
}

export type CreativeStatus = "Belum cukup data" | "Pantau" | "Winner" | "Pertimbangkan dihentikan";
export type FatigueStatus = "Belum cukup data" | "Sehat" | "Perlu ditinjau" | "Waspada" | "Jenuh";
export type ExperimentState = "permission_missing" | "no_studies" | "results_pending" | "results_available";
export type PatternState = "insufficient_sample" | "no_clear_pattern" | "eligible_for_test";

/** A percentile needs a real cohort; below this the label is withheld. */
export const MIN_COMPARATORS = 5;
export const PATTERN_MIN_CREATIVES = 8;
export const PATTERN_MIN_PER_SIDE = 3;
export const PATTERN_Q = 0.1;

/** Midrank percentile: `(below + 0.5 * equal) / n`, 4 decimals; `null` without a cohort of 5. */
export function percentileRank(value: number | null, cohort: (number | null)[]): number | null {
    if (value === null) return null;

    const values = cohort.filter((entry): entry is number => entry !== null);
    if (values.length < MIN_COMPARATORS) return null;

    let below = 0;
    let equal = 0;
    for (const entry of values) {
        if (entry < value) below += 1;
        else if (entry === value) equal += 1;
    }

    return round4((below + 0.5 * equal) / values.length);
}

export function dimensionLabel(percentile: number | null): DimensionLabel | null {
    if (percentile === null) return null;
    if (percentile >= 0.7) return "kuat";
    if (percentile >= 0.3) return "rata-rata";
    return "lemah";
}

/** Cost reads the other way around: the cheapest creative is the strongest. */
function reversed(percentile: number | null): number | null {
    return percentile === null ? null : round4(1 - percentile);
}

export function costDimension(
    costPerResultMinor: number | null,
    cohort: (number | null)[],
    results: number
): CreativeDimension {
    const certainty: DimensionCertainty = results >= 50 ? "terukur" : results >= 10 ? "indikatif" : "kurang";
    if (certainty === "kurang") return {label: null, certainty};

    return {label: dimensionLabel(reversed(percentileRank(costPerResultMinor, cohort))), certainty};
}

export function attentionDimension(
    ctr: number | null,
    cohort: (number | null)[],
    impressions: number
): CreativeDimension {
    const certainty: DimensionCertainty = impressions >= 5000
        ? "terukur"
        : impressions >= 3000
            ? "indikatif"
            : "kurang";
    if (certainty === "kurang") return {label: null, certainty};

    return {label: dimensionLabel(percentileRank(ctr, cohort)), certainty};
}

export function qualityDimension(
    rate: number | null,
    cohort: (number | null)[],
    sampleSize: number
): CreativeDimension {
    const certainty: DimensionCertainty = sampleSize >= 20 ? "terukur" : sampleSize >= 10 ? "indikatif" : "kurang";
    if (certainty === "kurang") return {label: null, certainty};

    return {label: dimensionLabel(percentileRank(rate, cohort)), certainty};
}

/**
 * Age plus trend. `ctrDrop` is the relative CTR decline (`0.15` = down 15%); `null` when the trend
 * cannot be measured, which keeps the label withheld without hiding a measurable age.
 */
export function healthDimension(ageDays: number, ctrDrop: number | null): CreativeDimension {
    if (ageDays < 7) return {label: null, certainty: "kurang"};

    const certainty: DimensionCertainty = ageDays >= 14 ? "terukur" : "indikatif";
    if (ctrDrop === null) return {label: null, certainty};

    return {label: ctrDrop <= 0 ? "kuat" : ctrDrop < 0.15 ? "rata-rata" : "lemah", certainty};
}

export interface OverallInput {
    cost: CreativeDimension;
    attention: CreativeDimension;
    quality: CreativeDimension;
    health: CreativeDimension;
    mature: boolean;
    fatigued: boolean;
    allocationLimited: boolean;
}

const ALLOCATION_NOTE = "Alokasi anggaran ad set membatasi kreatif ini.";

/** First matching rule wins; there is no composite score anywhere in this pipeline. */
export function overallStatus(input: OverallInput): {status: CreativeStatus; note?: string} {
    const {cost, attention, quality, health, mature, fatigued, allocationLimited} = input;

    let status: CreativeStatus;
    if ([cost, attention, quality, health].every((dimension) => dimension.certainty === "kurang")) {
        status = "Belum cukup data";
    } else if (fatigued) {
        status = "Pertimbangkan dihentikan";
    } else if (cost.label === "lemah" && attention.label === "lemah" && quality.label === "lemah") {
        status = "Pertimbangkan dihentikan";
    } else if (
        mature
        && cost.label === "kuat"
        && attention.label === "kuat"
        && quality.label !== "lemah"
        && health.label !== "lemah"
    ) {
        status = "Winner";
    } else {
        status = "Pantau";
    }

    if (allocationLimited && (status === "Winner" || status === "Pertimbangkan dihentikan")) {
        return {status: "Pantau", note: ALLOCATION_NOTE};
    }

    return {status};
}

export interface FatigueWindow {
    ctr: number | null;
    cpmMinor: number | null;
    cprMinor: number | null;
    frequency: number | null;
}

/**
 * `confounded` means the delivery got cheaper (CPM fell), so a CTR drop is not necessarily creative
 * fatigue. A drop needs 3 consecutive declining days, a rising CPR, and no confounder to be `Jenuh`.
 */
export function fatigue(
    base: FatigueWindow,
    now: FatigueWindow,
    consecutiveDays: number,
    complete: boolean,
    confounded: boolean
): {status: FatigueStatus; drop: number | null} {
    const drop = base.ctr !== null && base.ctr > 0 && now.ctr !== null
        ? round4((base.ctr - now.ctr) / base.ctr)
        : null;

    if (!complete || base.ctr === null || base.ctr <= 0 || now.ctr === null) {
        return {status: "Belum cukup data", drop};
    }

    if (
        drop === null
        || drop < 0.15
        || base.frequency === null
        || now.frequency === null
        || now.frequency <= base.frequency
    ) {
        return {status: "Sehat", drop};
    }

    if (confounded) return {status: "Perlu ditinjau", drop};

    if (
        drop >= 0.25
        && base.cprMinor !== null
        && now.cprMinor !== null
        && now.cprMinor > base.cprMinor
        && consecutiveDays >= 3
    ) {
        return {status: "Jenuh", drop};
    }

    return {status: "Waspada", drop};
}

export interface DailyPointLike {
    date: string;
    spendMinor: number;
    impressions: number;
    clicks: number;
    reach: number;
    results: number;
}

/** Sums the window first, then divides: a ratio of totals, never an average of daily ratios. */
export function aggregateWindow(points: DailyPointLike[]): FatigueWindow {
    let spendMinor = 0;
    let impressions = 0;
    let clicks = 0;
    let reach = 0;
    let results = 0;

    for (const point of points) {
        spendMinor += point.spendMinor;
        impressions += point.impressions;
        clicks += point.clicks;
        reach += point.reach;
        results += point.results;
    }

    return {
        ctr: impressions > 0 ? round4(clicks / impressions) : null,
        cpmMinor: impressions > 0 ? round4((spendMinor / impressions) * 1000) : null,
        cprMinor: results > 0 ? round4(spendMinor / results) : null,
        frequency: reach > 0 ? round4(impressions / reach) : null,
    };
}

/** Length of the run of trailing days whose CTR stays below `baselineCtr`; `0` without a baseline. */
export function trailingCtrDeclineDays(points: DailyPointLike[], baselineCtr: number | null): number {
    if (baselineCtr === null || baselineCtr <= 0) return 0;

    let days = 0;
    for (let index = points.length - 1; index >= 0; index -= 1) {
        const point = points[index];
        const ctr = point.impressions > 0 ? point.clicks / point.impressions : null;
        if (ctr === null || ctr >= baselineCtr) break;
        days += 1;
    }

    return days;
}

/** First three points against the last three; `null` when the window holds fewer than 6 points. */
export function trendDrop(points: DailyPointLike[]): number | null {
    if (points.length < 6) return null;

    const base = aggregateWindow(points.slice(0, 3));
    const recent = aggregateWindow(points.slice(-3));
    if (base.ctr === null || base.ctr <= 0 || recent.ctr === null) return null;

    return round4((base.ctr - recent.ctr) / base.ctr);
}

/** Abramowitz & Stegun 7.1.26; |error| < 1.5e-7, enough for a two-sided p-value display. */
function erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const absolute = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * absolute);
    const poly = t * (
        0.254829592
        + t * (-0.284496736
            + t * (1.421413741
                + t * (-1.453152027 + t * 1.061405429)))
    );

    return sign * (1 - poly * Math.exp(-absolute * absolute));
}

function normalCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Two-sided Mann-Whitney U with tie correction and a 0.5 continuity correction. `pValue` is not
 * rounded here: the caller rounds it once, after Benjamini-Hochberg.
 */
export function mannWhitneyU(a: number[], b: number[]): {u: number; pValue: number} {
    const n1 = a.length;
    const n2 = b.length;

    let u = 0;
    for (const left of a) {
        for (const right of b) {
            if (right < left) u += 1;
            else if (right === left) u += 0.5;
        }
    }

    const n = n1 + n2;
    if (n < 2 || n1 === 0 || n2 === 0) return {u, pValue: 1};

    const counts = new Map<number, number>();
    for (const value of [...a, ...b]) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    let tieSum = 0;
    for (const count of counts.values()) {
        tieSum += count ** 3 - count;
    }

    const sigma2 = ((n1 * n2) / 12) * ((n + 1) - tieSum / (n * (n - 1)));
    if (sigma2 <= 0) return {u, pValue: 1};

    const z = (Math.abs(u - (n1 * n2) / 2) - 0.5) / Math.sqrt(sigma2);
    if (z <= 0) return {u, pValue: 1};

    const pValue = 2 * (1 - normalCdf(z));
    return {u, pValue: Math.min(1, Math.max(0, pValue))};
}

/**
 * Benjamini-Hochberg across every tested row: `adjusted[i] = min_{k >= i} p_k * m / k` with `m` the
 * number of non-null p-values and `k` the 1-based rank. Null entries stay null and never significant.
 */
export function benjaminiHochberg(
    pValues: (number | null)[],
    q: number = PATTERN_Q
): {adjusted: (number | null)[]; significant: boolean[]} {
    const tested = pValues
        .map((pValue, index) => ({pValue, index}))
        .filter((entry): entry is {pValue: number; index: number} => entry.pValue !== null)
        .sort((left, right) => left.pValue - right.pValue);

    const adjusted: (number | null)[] = pValues.map(() => null);
    const significant: boolean[] = pValues.map(() => false);
    const m = tested.length;

    let runningMin = 1;
    for (let rank = m; rank >= 1; rank -= 1) {
        const {pValue, index} = tested[rank - 1];
        runningMin = Math.min(runningMin, (pValue * m) / rank);
        adjusted[index] = Math.min(1, runningMin);
        significant[index] = adjusted[index] <= q;
    }

    return {adjusted, significant};
}

/** Median cost per result per side; a pattern needs 8 creatives overall and 3 on each side. */
export function costPattern(
    withAttr: number[],
    withoutAttr: number[]
): {
    state: "insufficient_sample" | "no_clear_pattern";
    withMedian: number | null;
    withoutMedian: number | null;
    pValue: number | null;
} {
    const total = withAttr.length + withoutAttr.length;
    if (total < PATTERN_MIN_CREATIVES || withAttr.length < PATTERN_MIN_PER_SIDE || withoutAttr.length < PATTERN_MIN_PER_SIDE) {
        return {state: "insufficient_sample", withMedian: null, withoutMedian: null, pValue: null};
    }

    const withMedian = median(withAttr);
    const withoutMedian = median(withoutAttr);

    return {
        state: "no_clear_pattern",
        withMedian: withMedian === null ? null : Math.round(withMedian),
        withoutMedian: withoutMedian === null ? null : Math.round(withoutMedian),
        pValue: mannWhitneyU(withAttr, withoutAttr).pValue,
    };
}

/**
 * Direction of a pattern inside one half of the window: the sign of
 * `median(tagged) − median(untagged)`. A missing median or a tie returns `null`, which can never
 * match the other half and therefore never counts as consistent.
 */
export function medianGapSign(tagged: number[], untagged: number[]): -1 | 1 | null {
    const taggedMedian = median(tagged);
    const untaggedMedian = median(untagged);
    if (taggedMedian === null || untaggedMedian === null) return null;

    const gap = taggedMedian - untaggedMedian;
    return gap === 0 ? null : gap > 0 ? 1 : -1;
}

export function experimentState(hasAccess: boolean, studyCount: number, hasResult: boolean): ExperimentState {
    if (!hasAccess) return "permission_missing";
    if (studyCount === 0) return "no_studies";
    if (!hasResult) return "results_pending";
    return "results_available";
}

export const CONTENT_ELEMENTS = [
    "penawaran",
    "produk_manfaat",
    "harga",
    "cta",
    "target",
    "kredibilitas",
    "urgensi",
] as const;

export type ContentElement = typeof CONTENT_ELEMENTS[number];
export type ContentElementStatus = "hadir" | "absen" | "tak_teramati";

const CONTENT_KEYWORDS: Record<ContentElement, string[]> = {
    penawaran: ["diskon", "promo", "gratis", "cashback", "bonus", "penawaran", "paket", "hemat"],
    produk_manfaat: [
        "manfaat",
        "membantu",
        "solusi",
        "mengatasi",
        "lebih",
        "ampuh",
        "efektif",
        "hasil",
        "khasiat",
        "tahan lama",
    ],
    harga: ["harga", "murah", "promo harga"],
    cta: ["hubungi", "chat", "pesan", "order", "beli", "klik", "daftar", "whatsapp", "konsultasi"],
    target: [
        "untuk",
        "cocok",
        "khusus",
        "bagi",
        "ibu",
        "anak",
        "pria",
        "wanita",
        "pemula",
        "profesional",
        "keluarga",
    ],
    kredibilitas: ["teruji", "bpom", "halal", "garansi", "testimoni", "review", "berpengalaman", "resmi", "sertifikat", "klinis"],
    urgensi: ["sekarang", "hari ini", "terbatas", "segera", "jangan lewatkan", "buruan", "stok terbatas"],
};

const CURRENCY_PATTERN = /\b(rp|idr)\b/;

/**
 * Evidence is the creative copy itself, not the chat: `tak_teramati` means the copy carries nothing to
 * read for that element, which is different from a copy that was read and lacks it (`absen`).
 */
export function contentElementStatuses(
    creative: {title: string | null; body: string | null; callToActionType: string | null}
): Record<ContentElement, ContentElementStatus> {
    const text = [creative.title, creative.body]
        .filter((part): part is string => part !== null && part.trim() !== "")
        .join(" ")
        .trim()
        .toLowerCase();
    const ctaText = creative.callToActionType?.trim().toLowerCase() ?? "";
    const matches = (keywords: string[]) => keywords.some((keyword) => text.includes(keyword));

    const statuses = {} as Record<ContentElement, ContentElementStatus>;
    for (const element of CONTENT_ELEMENTS) {
        if (element === "cta") {
            if (text === "" && ctaText === "") {
                statuses.cta = "tak_teramati";
            } else {
                statuses.cta = ctaText !== "" || matches(CONTENT_KEYWORDS.cta) ? "hadir" : "absen";
            }
            continue;
        }

        if (text === "") {
            statuses[element] = "tak_teramati";
            continue;
        }

        const present = matches(CONTENT_KEYWORDS[element])
            || (element === "harga" && CURRENCY_PATTERN.test(text));
        statuses[element] = present ? "hadir" : "absen";
    }

    return statuses;
}

/** `completeness` stays `null` until all seven elements were readable. */
export function contentCompleteness(
    statuses: Record<ContentElement, ContentElementStatus>
): {completeness: number | null; evidence: {present: number; assessed: number; expected: 7}} {
    let present = 0;
    let assessed = 0;
    for (const element of CONTENT_ELEMENTS) {
        const status = statuses[element];
        if (status === "hadir") {
            present += 1;
            assessed += 1;
        } else if (status === "absen") {
            assessed += 1;
        }
    }

    return {
        completeness: assessed < CONTENT_ELEMENTS.length ? null : round4(present / CONTENT_ELEMENTS.length),
        evidence: {present, assessed, expected: 7},
    };
}
