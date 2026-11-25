import {describe, expect, it} from "bun:test";
import {direction} from "@shared/numbers";
import {
    DEFAULT_SNAPSHOT_END,
    isPartialDay,
    periodLabel,
    resolvePeriod,
} from "@shared/period";
import {BadRequestError} from "@shared/errors";
import {todayInZone} from "@shared/dates";

describe("periodLabel", () => {
    it("formats same month and year without leading zeros", () => {
        expect(periodLabel("2026-11-13", "2026-11-19")).toBe("13–19 Nov 2026");
        expect(periodLabel("2026-05-01", "2026-05-07")).toBe("1–7 Mei 2026");
    });

    it("formats different months in same year", () => {
        expect(periodLabel("2026-10-27", "2026-11-25")).toBe("27 Okt – 25 Nov 2026");
        expect(periodLabel("2026-02-21", "2026-03-02")).toBe("21 Feb – 2 Mar 2026");
    });

    it("formats date range crossing calendar years", () => {
        expect(periodLabel("2026-12-28", "2027-01-03")).toBe("28 Des 2026 – 3 Jan 2027");
    });
});

describe("isPartialDay", () => {
    it("returns true only when until equals today in account timezone", () => {
        const tz = "Asia/Jakarta";
        const today = todayInZone(tz);
        expect(isPartialDay(today, tz)).toBe(true);
        expect(isPartialDay("2026-11-19", tz)).toBe(today === "2026-11-19");
    });
});

describe("resolvePeriod", () => {
    const account = {timezoneName: "Asia/Jakarta"};

    it("defaults until to DEFAULT_SNAPSHOT_END and computes since when days is provided", () => {
        const resolved = resolvePeriod(account, {days: 7});
        expect(resolved.days).toBe(7);
        expect(resolved.until).toBe(DEFAULT_SNAPSHOT_END);
        expect(resolved.since).toBe("2026-11-13");
        expect(resolved.previousUntil).toBe("2026-11-12");
        expect(resolved.previousSince).toBe("2026-11-06");
    });

    it("supports 14 and 30 days presets", () => {
        const resolved14 = resolvePeriod(account, {days: 14});
        expect(resolved14.days).toBe(14);
        expect(resolved14.until).toBe(DEFAULT_SNAPSHOT_END);
        expect(resolved14.since).toBe("2026-11-06");

        const resolved30 = resolvePeriod(account, {days: 30});
        expect(resolved30.days).toBe(30);
        expect(resolved30.until).toBe(DEFAULT_SNAPSHOT_END);
        expect(resolved30.since).toBe("2026-10-21");
    });

    it("allows custom until with days", () => {
        const resolved = resolvePeriod(account, {days: 7, until: "2026-12-01"});
        expect(resolved.days).toBe(7);
        expect(resolved.until).toBe("2026-12-01");
        expect(resolved.since).toBe("2026-11-25");
    });

    it("throws 400 INVALID_DAYS for unsupported days values", () => {
        expect(() => resolvePeriod(account, {days: 10 as any})).toThrow(BadRequestError);
        try {
            resolvePeriod(account, {days: 10 as any});
        } catch (err: any) {
            expect(err.code).toBe("INVALID_DAYS");
            expect(err.statusCode).toBe(400);
        }
    });

    it("falls back to default 30-day period when days is omitted", () => {
        const resolved = resolvePeriod(account, {since: "2026-11-01", until: "2026-11-10"});
        expect(resolved.days).toBe(10);
        expect(resolved.since).toBe("2026-11-01");
        expect(resolved.until).toBe("2026-11-10");
    });

    it("throws 400 when since > until", () => {
        expect(() => resolvePeriod(account, {since: "2026-11-10", until: "2026-11-01"})).toThrow(BadRequestError);
    });
});

describe("direction", () => {
    it("maps positive numbers to up", () => {
        expect(direction(10)).toBe("up");
        expect(direction(0.001)).toBe("up");
    });

    it("maps negative numbers to down", () => {
        expect(direction(-5)).toBe("down");
        expect(direction(-0.1)).toBe("down");
    });

    it("maps zero to neutral", () => {
        expect(direction(0)).toBe("neutral");
    });

    it("maps null to null", () => {
        expect(direction(null)).toBeNull();
    });
});
