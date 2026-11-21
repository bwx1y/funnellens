import {describe, expect, it} from "bun:test";
import {
    extractPlaceholders,
    fallbackText,
    formatDuration,
    formatMoney,
    formatNumber,
    formatPercent,
    hashJson,
    render,
    stableJson,
    validateNarrative,
} from "@/modules/explanations/rules";
import {EXPLANATION_CONTEXTS, outputSchemaFor, systemPromptFor} from "@/modules/explanations/contexts";

const LEAK_FACTS = {previous: "10%", current: "8%", transition: "klik ke chat"};

describe("explanation rules", () => {
    it("sorts object keys at every depth so the hash is order-independent", () => {
        expect(stableJson({b: 1, a: {d: 2, c: 3}})).toBe('{"a":{"c":3,"d":2},"b":1}');
        expect(stableJson([{b: 1, a: 2}])).toBe('[{"a":2,"b":1}]');
        expect(hashJson({b: 1, a: 2})).toBe(hashJson({a: 2, b: 1}));
        expect(hashJson({a: 2, b: 1})).not.toBe(hashJson({a: 1, b: 2}));
        expect(hashJson({a: 1})).toMatch(/^[0-9a-f]{64}$/);
    });

    it("extracts every placeholder body in order", () => {
        expect(extractPlaceholders("Konversi {previous} ke {current}")).toEqual(["previous", "current"]);
        expect(extractPlaceholders("tanpa placeholder")).toEqual([]);
        expect(extractPlaceholders("{a}{b}")).toEqual(["a", "b"]);
    });

    it("rejects a template that writes its own numbers", () => {
        expect(validateNarrative("funnel_leak", "Konversi naik 25%", {
            ...LEAK_FACTS,
            __direction: "down",
        })).toBe("template mengandung angka");
    });

    it("rejects an unknown placeholder", () => {
        expect(validateNarrative("funnel_leak", "Konversi {transition} dari {previous} ke {current} ({gap})", LEAK_FACTS))
            .toBe("placeholder gap tidak dikenal");
    });

    it("rejects a template missing a required placeholder", () => {
        expect(validateNarrative("funnel_leak", "Konversi {transition} kini {current}", LEAK_FACTS))
            .toBe("placeholder wajib previous tidak ada");
    });

    it("rejects a direction that contradicts the facts", () => {
        expect(validateNarrative(
            "funnel_leak",
            "Konversi {transition} naik dari {previous} ke {current}",
            {...LEAK_FACTS, __direction: "down"}
        )).toBe("arah narasi bertentangan dengan fakta");

        expect(validateNarrative(
            "funnel_leak",
            "Konversi {transition} turun dari {previous} ke {current}",
            {...LEAK_FACTS, __direction: "up"}
        )).toBe("arah narasi bertentangan dengan fakta");
    });

    it("accepts a usable template and renders the facts into it", () => {
        const template = "Konversi {transition} turun dari {previous} ke {current}.";

        expect(validateNarrative("funnel_leak", template, {...LEAK_FACTS, __direction: "down"})).toBeNull();
        expect(render(template, LEAK_FACTS)).toBe("Konversi klik ke chat turun dari 10% ke 8%.");
        expect(() => render("{missing}", LEAK_FACTS)).toThrow("placeholder missing tidak ada pada fakta");
    });

    it("uses the down variant of a fallback only when the facts fell", () => {
        expect(fallbackText("funnel_leak", {...LEAK_FACTS, __direction: "down"}))
            .toBe("Konversi klik ke chat turun dari 10% ke 8%. Periksa campaign yang menyumbang penurunan terbesar.");
        expect(fallbackText("funnel_leak", {...LEAK_FACTS, __direction: "up"}))
            .toBe("Konversi klik ke chat bergerak dari 10% ke 8%. Periksa campaign yang menyumbang perubahan terbesar.");
    });

    it("keeps every fallback digit-free so a rejected template still carries the block's numbers", () => {
        const contexts = Object.keys(EXPLANATION_CONTEXTS) as (keyof typeof EXPLANATION_CONTEXTS)[];

        expect(contexts.length).toBe(13);
        for (const context of contexts) {
            expect(EXPLANATION_CONTEXTS[context].fallback).not.toMatch(/\d/);
            const down = EXPLANATION_CONTEXTS[context].fallbackDown;
            if (down !== undefined) expect(down).not.toMatch(/\d/);
        }
    });

    it("names the required placeholders in the system prompt", () => {
        const prompt = systemPromptFor("summary", {spend: "Rp 1", leads: "2", hot: "3"});

        // The model drops an available-but-unspecified placeholder often enough to fail validation.
        expect(prompt).toContain("- Placeholder yang tersedia: {spend}, {leads}, {hot}.");
        expect(prompt).toContain("- Placeholder yang wajib ada: {spend}, {leads}.");
        expect(prompt).toContain('nextCheck salah satu dari: "campaign", "lead_quality", "reply_speed", "tracking"');
        expect(outputSchemaFor("summary")).toEqual({
            type: "object",
            properties: {
                template: {type: "string"},
                nextCheck: {type: "string", enum: ["campaign", "lead_quality", "reply_speed", "tracking"]},
            },
            required: ["template", "nextCheck"],
        });
    });

    it("formats money, percent, number, and duration for the Indonesian UI", () => {
        expect(formatMoney(120000000, "IDR")).toBe("Rp 1.200.000");
        expect(formatMoney(150000, "USD")).toBe("US$ 1.500");
        expect(formatMoney(null, "IDR")).toBe("belum tersedia");
        expect(formatPercent(0.125)).toBe("12,5%");
        expect(formatPercent(null)).toBe("belum terukur");
        expect(formatNumber(1234)).toBe("1.234");
        expect(formatNumber(null)).toBe("belum tersedia");
        expect(formatDuration(125)).toBe("2 menit");
        expect(formatDuration(45)).toBe("45 detik");
        expect(formatDuration(3720)).toBe("1 jam 2 menit");
        expect(formatDuration(3600)).toBe("1 jam");
        expect(formatDuration(null)).toBe("belum terukur");
    });
});
