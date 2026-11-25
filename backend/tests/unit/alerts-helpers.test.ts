import {describe, expect, it} from "bun:test";
import {
    LEAK_RULES,
    leakLevel,
    snoozedUntil,
} from "@shared/alerts";

describe("alert helpers", () => {
    it("maps a leakage drop to a level at the −5 and −15 point boundaries", () => {
        expect(leakLevel(-4.99)).toBeNull();
        expect(leakLevel(-5)).toBe("WARNING");
        expect(leakLevel(-14.99)).toBe("WARNING");
        expect(leakLevel(-15)).toBe("CRITICAL");
        expect(leakLevel(null)).toBeNull();
    });

    it("keeps the three WhatsApp leakage transitions in one table", () => {
        expect(LEAK_RULES.map((rule) => [rule.ruleKey, rule.from, rule.to])).toEqual([
            ["leak_click_to_landing", "link_clicks", "messaging_started"],
            ["leak_chat_to_reply", "observed", "replied"],
            ["leak_qualified_to_closed", "qualified", "closed"],
        ]);
    });

    it("adds the snooze window to the given instant", () => {
        const now = new Date("2026-03-01T00:00:00.000Z");

        expect(snoozedUntil(24, now).toISOString()).toBe("2026-03-02T00:00:00.000Z");
        expect(snoozedUntil(168, now).toISOString()).toBe("2026-03-08T00:00:00.000Z");
    });
});
