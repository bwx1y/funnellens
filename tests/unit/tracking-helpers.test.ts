import {describe, expect, it} from "bun:test";
import {
    browserShare,
    dedupRate,
    emqStatus,
    eventStatus,
    missingMatchKeys,
    orderEventNames,
    trackingAlertNeeded,
} from "@shared/tracking";

describe("tracking helpers", () => {
    it("computes the deduplication rate from browser, server, and duplicate counts", () => {
        expect(dedupRate(100, 80, 60)).toBe(0.6667);
        expect(dedupRate(100, 80, null)).toBeNull();
        expect(dedupRate(0, 0, 0)).toBeNull();
        expect(dedupRate(null, 80, 60)).toBeNull();
    });

    it("computes the browser share of all reported events", () => {
        expect(browserShare(100, 80)).toBe(0.5556);
        expect(browserShare(0, 0)).toBeNull();
        expect(browserShare(null, 80)).toBeNull();
    });

    it("grades an event by the first matching rule", () => {
        expect(eventStatus({dedupRate: 0.98, matchQuality: 7.5})).toBe("Sehat");
        expect(eventStatus({dedupRate: 0.9, matchQuality: 5.8})).toBe("Perlu optimalisasi");
        expect(eventStatus({dedupRate: 0.7, matchQuality: 8})).toBe("Bermasalah");
        expect(eventStatus({dedupRate: null, matchQuality: null})).toBeNull();
    });

    it("grades the EMQ card from the 0-10 average alone", () => {
        expect(emqStatus(5.8)).toBe("Perlu optimalisasi");
        expect(emqStatus(6)).toBe("Sehat");
        expect(emqStatus(3.9)).toBe("Bermasalah");
        expect(emqStatus(null)).toBeNull();
    });

    it("reports missing match keys without claiming a cause", () => {
        expect(missingMatchKeys(["em", "fn"])).toEqual(["ph"]);
        expect(missingMatchKeys(null)).toEqual([]);
        expect(missingMatchKeys(["PH", "em"])).toEqual([]);
    });

    it("raises the tracking_emq alert below the EMQ or dedup threshold", () => {
        expect(trackingAlertNeeded(5.8, 0.95)).toBe(true);
        expect(trackingAlertNeeded(6, 0.9)).toBe(false);
        expect(trackingAlertNeeded(6.1, 0.8)).toBe(true);
        expect(trackingAlertNeeded(null, null)).toBe(false);
    });

    it("orders known events canonically and unknown names alphabetically", () => {
        expect(orderEventNames(["Zeta", "Lead", "PageView", "Alpha"]))
            .toEqual(["PageView", "Lead", "Alpha", "Zeta"]);

        const input = ["Purchase", "Lead"];
        orderEventNames(input);
        expect(input).toEqual(["Purchase", "Lead"]);
    });
});
