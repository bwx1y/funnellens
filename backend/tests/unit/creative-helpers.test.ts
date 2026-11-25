import {describe, expect, it} from "bun:test";
import {
    CONTENT_ELEMENTS,
    aggregateWindow,
    attentionDimension,
    benjaminiHochberg,
    contentCompleteness,
    contentElementStatuses,
    costDimension,
    costPattern,
    dimensionLabel,
    experimentState,
    fatigue,
    healthDimension,
    mannWhitneyU,
    overallStatus,
    percentileRank,
    qualityDimension,
    trailingCtrDeclineDays,
    trendDrop,
    type CreativeDimension,
    type DailyPointLike,
} from "@shared/creative";

const COST_COHORT = [3000, 5000, 6000, 7000, 8000, 10000, 11667, 4286];
const CTR_COHORT = [0.01, 0.015, 0.02, 0.02, 0.0243, 0.025, 0.03, 0.05];

const dimension = (
    label: CreativeDimension["label"],
    certainty: CreativeDimension["certainty"]
): CreativeDimension => ({label, certainty});

function point(date: string, values: Partial<DailyPointLike>): DailyPointLike {
    return {date, spendMinor: 0, impressions: 0, clicks: 0, reach: 0, results: 0, ...values};
}

describe("creative percentile gates", () => {
    it("ranks a value with the midrank formula and refuses a thin cohort", () => {
        expect(percentileRank(0.02, [0.01, 0.015, 0.02, 0.02, 0.03])).toBe(0.6);
        expect(percentileRank(0.02, [0.01, 0.015, 0.03])).toBeNull();
        expect(percentileRank(null, [0.01, 0.02, 0.03, 0.04, 0.05])).toBeNull();
    });

    it("maps percentiles onto three labels", () => {
        expect(dimensionLabel(0.7)).toBe("kuat");
        expect(dimensionLabel(0.3)).toBe("rata-rata");
        expect(dimensionLabel(0.29)).toBe("lemah");
        expect(dimensionLabel(null)).toBeNull();
    });

    it("gates the cost dimension on results and reverses the percentile", () => {
        expect(costDimension(4286, COST_COHORT, 14)).toEqual(dimension("kuat", "indikatif"));
        expect(costDimension(4286, COST_COHORT, 9)).toEqual(dimension(null, "kurang"));
        expect(costDimension(4286, COST_COHORT, 50).certainty).toBe("terukur");
    });

    it("gates attention on impressions and quality on the assessed sample", () => {
        expect(attentionDimension(0.02, CTR_COHORT, 2999)).toEqual(dimension(null, "kurang"));
        expect(attentionDimension(0.02, CTR_COHORT, 3000).certainty).toBe("indikatif");
        expect(attentionDimension(0.02, CTR_COHORT, 5000).certainty).toBe("terukur");

        expect(qualityDimension(0.25, [0.1, 0.2, 0.25, 0.3, 0.4], 10).certainty).toBe("indikatif");
        expect(qualityDimension(0.25, [0.1, 0.2, 0.25, 0.3, 0.4], 20).certainty).toBe("terukur");
    });

    it("gates health on age and withholds the label without a trend", () => {
        expect(healthDimension(6, -0.1)).toEqual(dimension(null, "kurang"));
        expect(healthDimension(7, 0)).toEqual(dimension("kuat", "indikatif"));
        expect(healthDimension(14, 0.2)).toEqual(dimension("lemah", "terukur"));
        expect(healthDimension(14, null)).toEqual(dimension(null, "terukur"));
    });
});

describe("creative overall status", () => {
    const unknown = dimension(null, "kurang");
    const strong = dimension("kuat", "indikatif");
    const weak = dimension("lemah", "indikatif");
    const average = dimension("rata-rata", "indikatif");

    it("returns Belum cukup data when every dimension is gated out", () => {
        expect(overallStatus({
            cost: unknown,
            attention: unknown,
            quality: unknown,
            health: unknown,
            mature: false,
            fatigued: false,
            allocationLimited: false,
        })).toEqual({status: "Belum cukup data"});
    });

    it("stops fatigued creatives before any other rule", () => {
        expect(overallStatus({
            cost: strong,
            attention: strong,
            quality: strong,
            health: strong,
            mature: true,
            fatigued: true,
            allocationLimited: false,
        })).toEqual({status: "Pertimbangkan dihentikan"});
    });

    it("stops a creative that is weak on cost, attention, and quality", () => {
        expect(overallStatus({
            cost: weak,
            attention: weak,
            quality: weak,
            health: average,
            mature: true,
            fatigued: false,
            allocationLimited: false,
        })).toEqual({status: "Pertimbangkan dihentikan"});
    });

    it("crowns a mature winner only on strong cost and attention", () => {
        expect(overallStatus({
            cost: strong,
            attention: strong,
            quality: average,
            health: strong,
            mature: true,
            fatigued: false,
            allocationLimited: false,
        })).toEqual({status: "Winner"});

        expect(overallStatus({
            cost: strong,
            attention: strong,
            quality: average,
            health: strong,
            mature: false,
            fatigued: false,
            allocationLimited: false,
        })).toEqual({status: "Pantau"});
    });

    it("downgrades to Pantau when the ad set allocation caps the creative", () => {
        expect(overallStatus({
            cost: strong,
            attention: strong,
            quality: strong,
            health: strong,
            mature: true,
            fatigued: false,
            allocationLimited: true,
        })).toEqual({status: "Pantau", note: "Alokasi anggaran ad set membatasi kreatif ini."});
    });
});

describe("creative fatigue", () => {
    const base = {ctr: 0.02, cpmMinor: 10000, cprMinor: 10000, frequency: 2};

    it("refuses to judge an incomplete window", () => {
        expect(fatigue(base, {ctr: 0.01, cpmMinor: 15000, cprMinor: 20000, frequency: 3}, 4, false, false))
            .toEqual({status: "Belum cukup data", drop: 0.5});
    });

    it("stays Sehat while the drop is small or frequency does not rise", () => {
        expect(fatigue(base, {ctr: 0.018, cpmMinor: 15000, cprMinor: 20000, frequency: 3}, 3, true, false))
            .toEqual({status: "Sehat", drop: 0.1});

        expect(fatigue(base, {ctr: 0.012, cpmMinor: 15000, cprMinor: 20000, frequency: 2}, 3, true, false))
            .toEqual({status: "Sehat", drop: 0.4});
    });

    it("asks for review when delivery got cheaper", () => {
        expect(fatigue(base, {ctr: 0.014, cpmMinor: 8000, cprMinor: 20000, frequency: 3}, 4, true, true))
            .toEqual({status: "Perlu ditinjau", drop: 0.3});
    });

    it("marks Jenuh only with a deep drop, a rising CPR, and 3 declining days", () => {
        expect(fatigue(base, {ctr: 0.014074, cpmMinor: 15000, cprMinor: 15000, frequency: 2.5}, 3, true, false))
            .toEqual({status: "Jenuh", drop: 0.2963});
    });

    it("falls back to Waspada for a mid-sized drop", () => {
        expect(fatigue(base, {ctr: 0.016, cpmMinor: 15000, cprMinor: 15000, frequency: 2.5}, 3, true, false))
            .toEqual({status: "Waspada", drop: 0.2});
    });
});

describe("creative daily windows", () => {
    it("aggregates a window as a ratio of totals", () => {
        const window = aggregateWindow([
            point("2026-03-01", {spendMinor: 50000, impressions: 1000, clicks: 30, reach: 500, results: 5}),
            point("2026-03-02", {spendMinor: 50000, impressions: 1000, clicks: 20, reach: 500, results: 5}),
        ]);

        expect(window).toEqual({ctr: 0.025, cpmMinor: 50000, cprMinor: 10000, frequency: 2});
        expect(aggregateWindow([])).toEqual({ctr: null, cpmMinor: null, cprMinor: null, frequency: null});
    });

    it("counts trailing days below the baseline CTR", () => {
        const points = [
            point("2026-03-01", {impressions: 1000, clicks: 27}),
            point("2026-03-02", {impressions: 1000, clicks: 27}),
            point("2026-03-03", {impressions: 1000, clicks: 25}),
            point("2026-03-04", {impressions: 1000, clicks: 24}),
            point("2026-03-05", {impressions: 1000, clicks: 23}),
        ];

        expect(trailingCtrDeclineDays(points, 0.027)).toBe(3);
        expect(trailingCtrDeclineDays([...points, point("2026-03-06", {impressions: 1000, clicks: 30})], 0.027)).toBe(0);
        expect(trailingCtrDeclineDays(points, null)).toBe(0);
    });

    it("compares the first three points against the last three", () => {
        expect(trendDrop([point("2026-03-01", {impressions: 1000, clicks: 30})])).toBeNull();

        const points = [
            point("2026-03-01", {impressions: 1000, clicks: 30}),
            point("2026-03-02", {impressions: 1000, clicks: 30}),
            point("2026-03-03", {impressions: 1000, clicks: 30}),
            point("2026-03-04", {impressions: 1000, clicks: 20}),
            point("2026-03-05", {impressions: 1000, clicks: 20}),
            point("2026-03-06", {impressions: 1000, clicks: 20}),
        ];

        expect(trendDrop(points)).toBe(0.3333);
    });
});

describe("pattern statistics", () => {
    it("computes a two-sided Mann-Whitney U with the normal approximation", () => {
        const {u, pValue} = mannWhitneyU([1, 2, 3], [4, 5, 6]);

        expect(u).toBe(0);
        expect(pValue).toBeGreaterThan(0.05);
        expect(pValue).toBeLessThan(0.2);
        expect(mannWhitneyU([1, 1, 1], [1, 1, 1]).pValue).toBe(1);
    });

    it("adjusts p-values with Benjamini-Hochberg and keeps nulls out", () => {
        const {adjusted, significant} = benjaminiHochberg([0.01, 0.04, null], 0.1);

        expect(adjusted).toEqual([0.02, 0.04, null]);
        expect(significant).toEqual([true, true, false]);
    });

    it("withholds a pattern below 8 creatives or 3 per side", () => {
        expect(costPattern([1, 2], [3, 4, 5, 6, 7, 8])).toEqual({
            state: "insufficient_sample",
            withMedian: null,
            withoutMedian: null,
            pValue: null,
        });

        const pattern = costPattern([1, 2, 3], [4, 5, 6, 7, 8]);
        expect(pattern.state).toBe("no_clear_pattern");
        expect(pattern.withMedian).toBe(2);
        expect(pattern.withoutMedian).toBe(6);
        expect(pattern.pValue).not.toBeNull();
    });

    it("maps the four experiment states", () => {
        expect(experimentState(false, 3, true)).toBe("permission_missing");
        expect(experimentState(true, 0, false)).toBe("no_studies");
        expect(experimentState(true, 2, false)).toBe("results_pending");
        expect(experimentState(true, 2, true)).toBe("results_available");
    });
});

describe("creative content elements", () => {
    it("reads the seven elements out of the creative copy", () => {
        const statuses = contentElementStatuses({
            title: "Promo",
            body: "Promo harga Rp 50.000, chat sekarang",
            callToActionType: "WHATSAPP_MESSAGE",
        });

        expect(statuses).toEqual({
            penawaran: "hadir",
            produk_manfaat: "absen",
            harga: "hadir",
            cta: "hadir",
            target: "absen",
            kredibilitas: "absen",
            urgensi: "hadir",
        });
        expect(contentCompleteness(statuses)).toEqual({
            completeness: 0.5714,
            evidence: {present: 4, assessed: 7, expected: 7},
        });
    });

    it("marks everything unobserved when the copy is empty", () => {
        const statuses = contentElementStatuses({title: null, body: null, callToActionType: null});

        expect(CONTENT_ELEMENTS.every((element) => statuses[element] === "tak_teramati")).toBe(true);
        expect(contentCompleteness(statuses)).toEqual({
            completeness: null,
            evidence: {present: 0, assessed: 0, expected: 7},
        });
    });
});
