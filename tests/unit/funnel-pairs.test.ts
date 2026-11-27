import {describe, expect, it} from "bun:test";
import {
    computePair,
    leakageCaption,
    pairStatus,
    pickLeakage,
    pickPriorityStage,
    stageChannel,
    trackingStateOf,
    type FunnelPair,
    type FunnelStageKey,
} from "@shared/funnel";
import {direction} from "@shared/numbers";

const RATIO_NOTE = "Rasio tidak tersedia karena salah satu periode tidak memiliki angka pada tahap sebelumnya.";
const GATE_NOTE = "Gerbang sampel belum terpenuhi sehingga perbandingan belum dapat diandalkan.";

function pairWith(deltaPp: number, eligible = true): FunnelPair {
    return {
        from: "link_clicks",
        to: "messaging_started",
        rate: 0.2,
        baseline: 0.2 - deltaPp / 100,
        deltaPp,
        direction: direction(deltaPp),
        estimatedGap: 10,
        status: pairStatus(deltaPp),
        eligible,
        sample: {n: 180, denominator: 900, eligible, gate: "≥ 100 per periode"},
    };
}

describe("computePair", () => {
    it("compares 180/900 against 250/1000 as a 5pp drop", () => {
        const pair = computePair({
            from: "link_clicks",
            to: "messaging_started",
            current: {before: 900, after: 180},
            previous: {before: 1000, after: 250},
            trackingState: "up_to_date",
        });

        expect(pair.rate).toBe(0.2);
        expect(pair.baseline).toBe(0.25);
        expect(pair.deltaPp).toBe(-5);
        expect(pair.estimatedGap).toBe(45);
        expect(pair.status).toBe("perlu_perhatian");
        expect(pair.eligible).toBe(true);
        expect(pair.sample).toEqual({n: 180, denominator: 900, eligible: true, gate: "≥ 100 per periode"});
        expect(pair.note).toBeUndefined();
    });

    it("returns nulls with a note when the current period has no denominator", () => {
        const pair = computePair({
            from: "link_clicks",
            to: "messaging_started",
            current: {before: 0, after: 0},
            previous: {before: 1000, after: 250},
            trackingState: "up_to_date",
        });

        expect(pair.rate).toBeNull();
        expect(pair.deltaPp).toBeNull();
        expect(pair.estimatedGap).toBeNull();
        expect(pair.status).toBeNull();
        expect(pair.note).toBe(RATIO_NOTE);
    });

    it("flags a click-stage comparison below the 100 gate", () => {
        const pair = computePair({
            from: "link_clicks",
            to: "messaging_started",
            current: {before: 50, after: 10},
            previous: {before: 1000, after: 250},
            trackingState: "up_to_date",
        });

        expect(pair.eligible).toBe(false);
        expect(pair.sample.gate).toBe("≥ 100 per periode");
        expect(pair.note).toBe(GATE_NOTE);
    });

    it("uses the 30 gate for stages after the click", () => {
        const pair = computePair({
            from: "observed",
            to: "replied",
            current: {before: 40, after: 20},
            previous: {before: 40, after: 20},
            trackingState: "up_to_date",
        });

        expect(pair.sample.gate).toBe("≥ 30 per periode");
        expect(pair.eligible).toBe(true);
        expect(pair.note).toBeUndefined();
    });

    it("marks a stale tracking state ineligible even above the gate", () => {
        const pair = computePair({
            from: "link_clicks",
            to: "messaging_started",
            current: {before: 900, after: 180},
            previous: {before: 1000, after: 250},
            trackingState: "stale",
        });

        expect(pair.eligible).toBe(false);
        expect(pair.sample.eligible).toBe(false);
        expect(pair.note).toBe(GATE_NOTE);
    });
});

describe("pairStatus", () => {
    it("maps deltaPp onto the three badges", () => {
        expect(pairStatus(-15)).toBe("kritis");
        expect(pairStatus(-5)).toBe("perlu_perhatian");
        expect(pairStatus(-4.99)).toBe("normal");
        expect(pairStatus(0)).toBe("normal");
        expect(pairStatus(null)).toBeNull();
    });
});

describe("pickLeakage", () => {
    it("picks the most negative eligible transition", () => {
        expect(pickLeakage([pairWith(-5), pairWith(-12)])?.deltaPp).toBe(-12);
    });

    it("ignores ineligible and improving transitions", () => {
        expect(pickLeakage([pairWith(-20, false), pairWith(3)])).toBeNull();
    });

    it("returns null for an empty list", () => {
        expect(pickLeakage([])).toBeNull();
    });
});

describe("pickPriorityStage", () => {
    function pair(from: FunnelStageKey, to: FunnelStageKey, deltaPp: number | null, eligible = true): FunnelPair {
        return {
            from,
            to,
            rate: 0.2,
            baseline: 0.2,
            deltaPp,
            direction: direction(deltaPp),
            estimatedGap: 10,
            status: pairStatus(deltaPp),
            eligible,
            sample: {n: 180, denominator: 900, eligible, gate: "≥ 100 per periode"},
        };
    }

    it("returns the transition with the largest eligible drop", () => {
        const priority = pickPriorityStage([
            pair("impressions", "link_clicks", -2),
            pair("link_clicks", "messaging_started", -12),
            pair("messaging_started", "observed", -8),
        ]);

        expect(priority).toEqual({from: "link_clicks", to: "messaging_started", deltaPp: -12});
    });

    it("breaks a tie towards the deeper stage", () => {
        const priority = pickPriorityStage([
            pair("impressions", "link_clicks", -6),
            pair("observed", "replied", -6),
            pair("link_clicks", "messaging_started", -6),
        ]);

        expect(priority).toEqual({from: "observed", to: "replied", deltaPp: -6});
    });

    it("ignores ineligible pairs, null deltas, and rising transitions", () => {
        expect(pickPriorityStage([
            pair("impressions", "link_clicks", -30, false),
            pair("link_clicks", "messaging_started", null),
            pair("messaging_started", "observed", 4),
        ])).toBeNull();
    });

    it("returns null for an empty funnel", () => {
        expect(pickPriorityStage([])).toBeNull();
    });
});

describe("leakageCaption", () => {
    it("states lost chats, never money", () => {
        expect(leakageCaption(45)).toBe("≈45 chat hilang");
    });
});

describe("stageChannel", () => {
    it("maps web stages to the web channel", () => {
        expect(stageChannel("purchase")).toBe("web");
        expect(stageChannel("lpv")).toBe("web");
        expect(stageChannel("view_content")).toBe("web");
        expect(stageChannel("add_to_cart")).toBe("web");
    });

    it("maps whatsapp stages to the wa channel", () => {
        expect(stageChannel("closed")).toBe("wa");
        expect(stageChannel("impressions")).toBe("wa");
        expect(stageChannel("observed")).toBe("wa");
    });

    it("returns null for an unknown stage", () => {
        expect(stageChannel("bogus")).toBeNull();
    });
});

describe("trackingStateOf", () => {
    it("distinguishes never-synced from overdue", () => {
        expect(trackingStateOf({lastSuccessAt: null, overdue: true})).toBe("unknown");
        expect(trackingStateOf({lastSuccessAt: new Date(), overdue: true})).toBe("stale");
        expect(trackingStateOf({lastSuccessAt: new Date(), overdue: false})).toBe("up_to_date");
    });
});
