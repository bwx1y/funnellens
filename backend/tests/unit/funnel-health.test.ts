import {describe, expect, it} from "bun:test";
import {funnelHealth} from "@shared/health";

describe("funnelHealth", () => {
    it("weights conversion, reply, and tracking 40/30/30", () => {
        const result = funnelHealth({conversion: 0.05, baseline: 0.10, onTimeReplyShare: 0.8, emq: 8, dedup: 0.9});

        expect(result.components.map((component) => component.score)).toEqual([50, 80, 85]);
        expect(result.components.map((component) => component.weight)).toEqual([40, 30, 30]);
        expect(result.score).toBe(70);
        expect(result.badge).toBe("Perlu perhatian");
        expect(result.note).toBeUndefined();
    });

    it("renormalizes the weights when the conversion baseline is missing", () => {
        const result = funnelHealth({conversion: null, baseline: null, onTimeReplyShare: 0.8, emq: 8, dedup: 0.9});

        expect(result.components.map((component) => component.score)).toEqual([null, 80, 85]);
        expect(result.score).toBe(83);
        expect(result.badge).toBe("Prima");
        expect(result.note).toBeUndefined();
    });

    it("returns a null score when fewer than two components are measurable", () => {
        const result = funnelHealth({conversion: 0.05, baseline: 0.10, onTimeReplyShare: null, emq: null, dedup: null});

        expect(result.score).toBeNull();
        expect(result.badge).toBeNull();
        expect(result.note).toBe("Komponen pengukuran belum cukup");
        expect(result.components.length).toBe(3);
    });

    it("treats tracking as one component when only one of emq and dedup is present", () => {
        const result = funnelHealth({conversion: null, baseline: null, onTimeReplyShare: null, emq: null, dedup: 0.9});

        expect(result.components[2].score).toBe(90);
        expect(result.score).toBeNull();
        expect(result.note).toBe("Komponen pengukuran belum cukup");
    });

    it("clamps a conversion above the baseline at 100", () => {
        const result = funnelHealth({conversion: 0.2, baseline: 0.1, onTimeReplyShare: null, emq: null, dedup: null});

        expect(result.components[0].score).toBe(100);
    });
});
