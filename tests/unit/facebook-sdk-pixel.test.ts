import {afterEach, describe, expect, it, mock} from "bun:test";
import bizSdk from "facebook-nodejs-business-sdk";
import {FacebookSdkAdapter} from "@/infra/meta/adapters/facebook-sdk.adapter";
import type {IMetaPixelAdapter} from "@/infra/meta/base.meta";

interface FakeCursor extends Array<Record<string, unknown>> {
    hasNext(): boolean;
}

function fakeCursor(rows: Record<string, unknown>[]): FakeCursor {
    return Object.assign([...rows], {hasNext: () => false});
}

const originalGetAdsPixels = bizSdk.AdAccount.prototype.getAdsPixels;
const originalGetStats = bizSdk.AdsPixel.prototype.getStats;

function stubPixels(rows: Record<string, unknown>[]) {
    bizSdk.AdAccount.prototype.getAdsPixels = mock(async () => fakeCursor(rows)) as unknown as
        typeof originalGetAdsPixels;
}

function stubStats(rows: Record<string, unknown>[]) {
    bizSdk.AdAccount.prototype.getAdsPixels = mock(async () => fakeCursor([
        {id: "px1", name: "Pixel Utama", code: "px", last_fired_time: "2026-03-02T10:00:00+0000"},
    ])) as unknown as typeof originalGetAdsPixels;
    bizSdk.AdsPixel.prototype.getStats = mock(async () => fakeCursor(rows)) as unknown as
        typeof originalGetStats;
}

function stubStatsFailure(error: unknown) {
    bizSdk.AdAccount.prototype.getAdsPixels = mock(async () => fakeCursor([
        {id: "px1", name: "Pixel Utama", code: "px"},
    ])) as unknown as typeof originalGetAdsPixels;
    bizSdk.AdsPixel.prototype.getStats = mock(async () => {
        throw error;
    }) as unknown as typeof originalGetStats;
}

afterEach(() => {
    bizSdk.AdAccount.prototype.getAdsPixels = originalGetAdsPixels;
    bizSdk.AdsPixel.prototype.getStats = originalGetStats;
});

describe("FacebookSdkAdapter pixels", () => {
    it("maps ad pixels with last fire time and match keys", async () => {
        stubPixels([
            {
                id: "px1",
                name: "Pixel Utama",
                code: "px",
                last_fired_time: "2026-03-02T10:00:00+0000",
                automatic_matching_fields: ["em", "ph"],
            },
            {id: "px2"},
        ]);

        const adapter: IMetaPixelAdapter = new FacebookSdkAdapter();
        const result = await adapter.getAdPixels("token", "act_1");

        expect(result.hasAccess).toBe(true);
        expect(result.pixels.length).toBe(2);
        expect(result.pixels[0].id).toBe("px1");
        expect(result.pixels[0].name).toBe("Pixel Utama");
        expect(result.pixels[0].code).toBe("px");
        expect(result.pixels[0].lastFiredTime?.toISOString()).toBe("2026-03-02T10:00:00.000Z");
        expect(result.pixels[0].automaticMatchingFields).toEqual(["em", "ph"]);
        expect(result.pixels[1]).toMatchObject({
            id: "px2",
            name: null,
            code: null,
            lastFiredTime: null,
            automaticMatchingFields: [],
        });
    });

    it("maps pixel event stats and keeps unreported counts null", async () => {
        stubStats([
            {
                value: "Lead",
                browser_count: 100,
                server_count: 80,
                duplicate_count: 60,
                match_quality: 5.8,
            },
            {value: "PageView"},
        ]);

        const adapter = new FacebookSdkAdapter();
        const result = await adapter.getPixelStats("token", "px1", {since: "2026-03-02", until: "2026-03-02"});

        expect(result.hasAccess).toBe(true);
        expect(result.rows.length).toBe(2);
        expect(result.rows[0]).toMatchObject({
            eventName: "Lead",
            browserCount: 100,
            serverCount: 80,
            duplicateCount: 60,
            matchQuality: 5.8,
        });
        expect(result.rows[1]).toMatchObject({
            eventName: "PageView",
            browserCount: null,
            serverCount: null,
            duplicateCount: null,
            matchQuality: null,
        });
    });

    it("turns an HTTP 403 into hasAccess false", async () => {
        stubStatsFailure({status: 403, message: "(#200) Missing permission"});

        const adapter = new FacebookSdkAdapter();
        expect(await adapter.getPixelStats("token", "px1", {since: "2026-03-02", until: "2026-03-02"}))
            .toEqual({hasAccess: false, rows: []});
    });

    it("rethrows any other Graph failure", async () => {
        stubStatsFailure({code: 1, message: "Unknown error"});

        const adapter = new FacebookSdkAdapter();
        await expect(adapter.getPixelStats("token", "px1", {since: "2026-03-02", until: "2026-03-02"}))
            .rejects.toBeDefined();
    });
});
