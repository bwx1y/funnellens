import {describe, expect, it} from "bun:test";
import {encode, decode} from "@toon-format/toon";

describe("TOON format parser & schema in worker", () => {
    it("encodes and decodes simple message correctly", () => {
        const payload = {message: "halo mau beli bulpoint"};
        const encoded = encode(payload);
        const decoded = decode(encoded) as typeof payload;
        expect(decoded.message).toBe("halo mau beli bulpoint");
    });

    it("encodes and decodes batch messages correctly", () => {
        const payload = {
            messages: [
                {time: 123456, body: "halo kak"},
                {time: 123460, body: "bulpoint harga berapa?"},
            ],
        };
        const encoded = encode(payload);
        const decoded = decode(encoded) as any;
        expect(decoded.messages.length).toBe(2);
        expect(decoded.messages[1].body).toBe("bulpoint harga berapa?");
    });

    it("safely decodes raw TOON response and markdown-wrapped TOON", () => {
        const parseToonSafely = <T>(rawText: string): T => {
            const cleaned = rawText
                .replace(/^```(?:toon)?\s*/i, "")
                .replace(/^```json\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/, "")
                .trim();
            try {
                return decode(cleaned) as T;
            } catch {
                return JSON.parse(cleaned) as T;
            }
        };

        const rawToon = "lead_type: HOT\nconfidence_score: 0.95\ndetected_product: bulpoint\nreasoning: Mau pesan";
        const res1 = parseToonSafely<any>(rawToon);
        expect(res1.lead_type).toBe("HOT");
        expect(res1.confidence_score).toBe(0.95);

        const markdownToon = "```toon\nlead_type: WARM\nconfidence_score: 0.8\ndetected_product: bulpoint\nreasoning: Tanya stok\n```";
        const res2 = parseToonSafely<any>(markdownToon);
        expect(res2.lead_type).toBe("WARM");
        expect(res2.detected_product).toBe("bulpoint");
    });
});
