import {describe, expect, it} from "bun:test";
import {CONFIDENCE_LEVELS, REPLY_TYPES, SENTIMENTS, TEMPERATURE_LEVELS} from "@shared/audience";
import {
    DECISION_SCHEMA,
    SIGNAL_SCHEMA,
    rubricFor,
    type Decision,
} from "@/modules/audience/constants";
import {pairReply, validateEvidence} from "@/modules/audience/assess.service";

const MESSAGES = [{wamid: "w-in-1"}, {wamid: "w-out-1"}, {wamid: null}];

function decision(overrides: Partial<Decision> = {}): Decision {
    return {
        level: "HOT",
        confidence: "tinggi",
        reason: "Menyebut jumlah dan meminta invoice",
        evidenceWamid: "w-in-1",
        responseType: "Komitmen",
        sentiment: "positif",
        ...overrides,
    };
}

describe("assessment schemas", () => {
    it("keeps the decision literals identical to the shared vocabularies", () => {
        const properties = (DECISION_SCHEMA as unknown as {
            properties: Record<string, {type: string; enum: string[]}>;
        }).properties;
        const of = (key: string) => {
            expect(properties[key].type).toBe("string");
            return properties[key].enum;
        };

        expect(of("level")).toEqual([...TEMPERATURE_LEVELS]);
        expect(of("confidence")).toEqual([...CONFIDENCE_LEVELS]);
        expect(of("responseType")).toEqual([...REPLY_TYPES]);
        expect(of("sentiment")).toEqual([...SENTIMENTS]);
    });

    it("asks level 1 for one signal per message", () => {
        const schema = SIGNAL_SCHEMA as unknown as {
            properties: {signals: {items: {properties: Record<string, unknown>; required: string[]}}};
        };

        const items = schema.properties.signals.items;
        expect(Object.keys(items.properties)).toEqual([
            "wamid", "intent", "product", "budget", "urgency", "objection", "sentiment",
        ]);
        expect(items.required).toContain("wamid");
        expect(items.required).toContain("intent");
        // No `anyOf`/`const`: Gemini rejects those inside a response schema.
        expect(JSON.stringify(SIGNAL_SCHEMA)).not.toContain("const");
        expect(JSON.stringify(DECISION_SCHEMA)).not.toContain("anyOf");
    });
});

describe("rubricFor", () => {
    it("carries the tenant offer context", () => {
        const rubric = rubricFor({name: "Toko Bulpoint", address: "Bandung"});

        expect(rubric).toContain("Nama penjual: Toko Bulpoint");
        expect(rubric).toContain("Lokasi/penawaran: Bandung");
        expect(rubric).toContain("RUBRIK PENILAIAN LEAD");
    });

    it("falls back to the default rubric when the tenant has no context", () => {
        const rubric = rubricFor({name: "  ", address: null});

        expect(rubric).toContain("Konteks penawaran: belum diisi");
        expect(rubric).not.toContain("Nama penjual:");
        expect(rubricFor(null)).toBe(rubric);
    });
});

describe("validateEvidence", () => {
    it("accepts a decision whose evidence is in the input", () => {
        expect(validateEvidence(decision(), MESSAGES)).toBeNull();
    });

    it("rejects evidence outside the input", () => {
        expect(validateEvidence(decision({evidenceWamid: "w-missing"}), MESSAGES))
            .toBe("evidenceWamid w-missing tidak ada di input");
        expect(validateEvidence(decision({evidenceWamid: "  "}), MESSAGES)).toBe("evidenceWamid kosong");
    });

    it("rejects unknown vocabularies", () => {
        expect(validateEvidence(decision({responseType: "Basa-basi" as never}), MESSAGES))
            .toBe("responseType Basa-basi tidak dikenal");
        expect(validateEvidence(decision({confidence: "pasti" as never}), MESSAGES))
            .toBe("confidence pasti tidak dikenal");
        expect(validateEvidence(decision({sentiment: "marah" as never}), MESSAGES))
            .toBe("sentiment marah tidak dikenal");
        expect(validateEvidence(decision({level: "PANAS" as never}), MESSAGES))
            .toBe("level PANAS tidak dikenal");
    });

    it("rejects an empty reason", () => {
        expect(validateEvidence(decision({reason: " "}), MESSAGES)).toBe("reason kosong");
    });
});

describe("pairReply", () => {
    const sentAt = new Date("2026-04-01T02:00:00.000Z");

    it("prefers the reply that quotes the message", () => {
        const pair = pairReply({
            sentAt,
            contextReply: {wamid: "w-out-1", sentAt: new Date("2026-04-01T02:02:00.000Z")},
            sequenceReply: {wamid: "w-out-0", sentAt: new Date("2026-04-01T02:01:00.000Z")},
        });

        expect(pair).toEqual({
            pairMethod: "reply",
            csAt: new Date("2026-04-01T02:02:00.000Z"),
            responseSeconds: 120,
        });
    });

    it("falls back to the first reply inside the window", () => {
        const pair = pairReply({
            sentAt,
            contextReply: null,
            sequenceReply: {wamid: "w-out-2", sentAt: new Date("2026-04-01T02:05:00.000Z")},
        });

        expect(pair).toEqual({
            pairMethod: "sequence",
            csAt: new Date("2026-04-01T02:05:00.000Z"),
            responseSeconds: 300,
        });
    });

    it("returns null without a reply and never reports a negative wait", () => {
        expect(pairReply({sentAt, contextReply: null, sequenceReply: null})).toBeNull();
        expect(pairReply({
            sentAt,
            contextReply: {wamid: "w-out-3", sentAt: new Date("2026-04-01T01:59:00.000Z")},
            sequenceReply: null,
        })).toBeNull();
    });
});
