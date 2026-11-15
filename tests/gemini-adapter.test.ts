import {describe, expect, it, mock} from "bun:test";
import {GeminiAdapter} from "@/providers/ai/adapter/gemini.adapter";

describe("GeminiAdapter failover & quota handling", () => {
    it("should instantiate with provided keys or config keys", () => {
        const adapter = new GeminiAdapter(["key1", "key2"]);
        expect(adapter).toBeDefined();
    });

    it("should correctly identify quota exhausted errors", () => {
        const adapter = new GeminiAdapter(["k1", "k2"]);
        const isQuotaExhausted = (adapter as any).isQuotaExhaustedError.bind(adapter);

        expect(isQuotaExhausted({status: 429})).toBe(true);
        expect(isQuotaExhausted({code: "RESOURCE_EXHAUSTED"})).toBe(true);
        expect(isQuotaExhausted(new Error("Quota exceeded for model gemini"))).toBe(true);
        expect(isQuotaExhausted(new Error("Rate limit exceeded"))).toBe(true);
        expect(isQuotaExhausted(new Error("Invalid API key"))).toBe(false);
        expect(isQuotaExhausted(new Error("Bad request"))).toBe(false);
    });

    it("should fail immediately if error is not quota related without trying next key", async () => {
        const adapter = new GeminiAdapter(["k1", "k2"]);
        let attempts = 0;

        const p = (adapter as any).executeWithFailover(async () => {
            attempts++;
            throw new Error("Invalid argument");
        });

        await expect(p).rejects.toThrow("Invalid argument");
        expect(attempts).toBe(1);
    });

    it("should switch to next key if quota is exhausted", async () => {
        const adapter = new GeminiAdapter(["k1", "k2"]);
        const usedClients: any[] = [];

        const res = await (adapter as any).executeWithFailover(async (client: any) => {
            usedClients.push(client);
            if (usedClients.length === 1) {
                throw new Error("429 RESOURCE_EXHAUSTED: Quota exceeded");
            }
            return {data: "ok"};
        });

        expect(res.data).toBe("ok");
        expect(usedClients.length).toBe(2);
    });
});
