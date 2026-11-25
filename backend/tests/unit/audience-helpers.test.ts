import {describe, expect, it} from "bun:test";
import {buildSankey, heatmapEligible, responseBucket} from "@shared/audience";
import {safeTimeZone} from "@shared/dates";
import {median, round2, round4} from "@shared/numbers";

describe("median", () => {
    it("returns null for an empty input", () => {
        expect(median([])).toBeNull();
    });

    it("averages the two middle values for an even count", () => {
        expect(median([600, 1800])).toBe(1200);
        expect(median([1, 2, 3, 10])).toBe(2.5);
    });

    it("returns the middle value for an odd count", () => {
        expect(median([3, 1, 2])).toBe(2);
    });
});

describe("rounding", () => {
    it("rounds to 2 and 4 decimals", () => {
        expect(round2(1.005)).toBe(1);
        expect(round4(0.016666)).toBe(0.0167);
    });
});

describe("responseBucket", () => {
    it("maps each boundary to its bucket", () => {
        expect(responseBucket(0)).toBe("< 15 menit");
        expect(responseBucket(899)).toBe("< 15 menit");
        expect(responseBucket(900)).toBe("15–60 menit");
        expect(responseBucket(3599)).toBe("15–60 menit");
        expect(responseBucket(3600)).toBe("1–4 jam");
        expect(responseBucket(14399)).toBe("1–4 jam");
        expect(responseBucket(14400)).toBe("> 4 jam");
    });
});

describe("heatmapEligible", () => {
    it("requires at least 10 leads in every bucket", () => {
        expect(heatmapEligible([10, 10, 10, 10])).toBe(true);
        expect(heatmapEligible([10, 10, 10, 9])).toBe(false);
    });
});

describe("buildSankey", () => {
    it("drops same-level pairs and keeps the fixed node order", () => {
        const sankey = buildSankey([
            {from: "COLD", to: "WARM", value: 3},
            {from: "HOT", to: "HOT", value: 5},
        ]);

        expect(sankey.nodes).toEqual(["COLD", "WARM", "HOT"]);
        expect(sankey.links).toEqual([{from: "COLD", to: "WARM", value: 3}]);
    });
});

describe("safeTimeZone", () => {
    it("keeps a valid IANA name and falls back to UTC", () => {
        expect(safeTimeZone("Asia/Jakarta")).toBe("Asia/Jakarta");
        expect(safeTimeZone("Mars/Phobos")).toBe("UTC");
    });
});
