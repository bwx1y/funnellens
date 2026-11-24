import {afterEach, describe, expect, it, mock} from "bun:test";
import {createHash} from "node:crypto";
import bizSdk from "facebook-nodejs-business-sdk";
import {FacebookSdkAdapter} from "@/infra/meta/adapters/facebook-sdk.adapter";
import type {IMetaAdsAdapter} from "@/infra/meta/base.meta";
import {Config} from "@/config";

type GetInsightsArgs = [fields: string[], params: Record<string, unknown>];

interface FakeCursor extends Array<Record<string, unknown>> {
    hasNext(): boolean;
}

function fakeCursor(rows: Record<string, unknown>[]): FakeCursor {
    return Object.assign([...rows], {hasNext: () => false});
}

const originalGetInsights = bizSdk.AdAccount.prototype.getInsights;
const originalGetAdSets = bizSdk.AdAccount.prototype.getAdSets;
const originalReadVideo = bizSdk.AdVideo.prototype.read;

function stubInsights(rows: Record<string, unknown>[]) {
    const calls: GetInsightsArgs[] = [];
    bizSdk.AdAccount.prototype.getInsights = mock(async function (
        this: unknown,
        fields: string[],
        params: Record<string, unknown>
    ) {
        calls.push([fields, params]);
        return fakeCursor(rows);
    }) as unknown as typeof originalGetInsights;
    return calls;
}

afterEach(() => {
    bizSdk.AdAccount.prototype.getInsights = originalGetInsights;
    bizSdk.AdAccount.prototype.getAdSets = originalGetAdSets;
    bizSdk.AdVideo.prototype.read = originalReadVideo;
});

describe("FacebookSdkAdapter", () => {
    it("instantiates successfully and satisfies IMetaAdsAdapter interface", () => {
        const adapter: IMetaAdsAdapter = new FacebookSdkAdapter();
        expect(adapter).toBeDefined();
        expect(typeof adapter.getAdAccounts).toBe("function");
        expect(typeof adapter.getCampaigns).toBe("function");
        expect(typeof adapter.getAdSets).toBe("function");
        expect(typeof adapter.getAdCreatives).toBe("function");
        expect(typeof adapter.getAds).toBe("function");
        expect(typeof adapter.getVideoDetails).toBe("function");
        expect(typeof adapter.getDailyAdInsights).toBe("function");
        expect(typeof adapter.getDailyAdBreakdowns).toBe("function");
        expect(typeof adapter.getHourlyAdBreakdowns).toBe("function");
    });

    it("getVideoDetails handles invalid videoId gracefully without crashing", async () => {
        const readVideo = mock(async () => {
            throw new Error("Unsupported get request: video not found");
        });
        bizSdk.AdVideo.prototype.read = readVideo as typeof originalReadVideo;
        const adapter = new FacebookSdkAdapter();
        const video = await adapter.getVideoDetails("test-token", "non-existent-video-id");
        expect(video).toBeNull();
        expect(readVideo).toHaveBeenCalledTimes(1);
    });

    it("getAdSets requests destination_type and maps it into the DTO", async () => {
        const calls: string[][] = [];
        bizSdk.AdAccount.prototype.getAdSets = mock(async function (
            this: unknown,
            fields: string[]
        ) {
            calls.push(fields);
            return fakeCursor([
                {
                    id: "adset_1",
                    name: "WA AdSet",
                    campaign_id: "camp_1",
                    optimization_goal: "CONVERSATIONS",
                    destination_type: "WHATSAPP",
                },
            ]);
        }) as unknown as typeof originalGetAdSets;

        const adapter = new FacebookSdkAdapter();
        const adSets = await adapter.getAdSets("token", "act_123");

        expect(calls[0]).toContain("destination_type");
        expect(adSets[0].destinationType).toBe("WHATSAPP");
        expect(adSets[0].optimizationGoal).toBe("CONVERSATIONS");
    });

    it("getDailyAdInsights requests and maps graph_version, action_report_time, video_3_sec_watched_actions", async () => {
        const calls = stubInsights([
            {
                account_id: "act_123",
                campaign_id: "camp_1",
                adset_id: "adset_1",
                ad_id: "ad_1",
                date_start: "2026-11-19",
                date_stop: "2026-11-19",
                spend: "12.34",
                impressions: "1000",
                reach: "900",
                clicks: "20",
                inline_link_clicks: "10",
                action_report_time: "conversion",
                video_3_sec_watched_actions: [{action_type: "video_view", value: "1234"}],
                video_thruplay_watched_actions: [{action_type: "video_view", value: "500"}],
                actions: [{action_type: "lead", value: "3"}],
            },
        ]);

        const adapter = new FacebookSdkAdapter();
        const rows = await adapter.getDailyAdInsights("token", "act_123", {
            since: "2026-11-01",
            until: "2026-11-19",
            currencyOffset: 100,
        });

        expect(calls.length).toBe(1);
        const [fields, params] = calls[0];
        expect(fields).toContain("action_report_time");
        expect(fields).toContain("video_3_sec_watched_actions");
        expect(params.level).toBe("ad");
        expect(params.time_increment).toBe(1);

        expect(rows.length).toBe(1);
        expect(rows[0].graphVersion).toBe(Config.meta.apiVersion);
        expect(rows[0].actionReportTime).toBe("conversion");
        expect(rows[0].video3SecWatchedActions).toBe(1234);
        expect(rows[0].videoThruplayWatchedActions).toBe(500);
        expect(rows[0].spendMinor).toBe(1234);
        expect(rows[0].extractedActions).toEqual([
            {actionType: "lead", count: "3", valueMinor: null, costPerActionMinor: null},
        ]);
    });

    it("getDailyAdInsights falls back to the impression report time", async () => {
        stubInsights([
            {
                ad_id: "ad_1",
                date_start: "2026-11-19",
                spend: "1",
                impressions: "1",
                clicks: "0",
            },
        ]);

        const adapter = new FacebookSdkAdapter();
        const rows = await adapter.getDailyAdInsights("token", "act_123", {
            since: "2026-11-01",
            until: "2026-11-19",
        });

        expect(rows[0].actionReportTime).toBe("impression");
        expect(rows[0].video3SecWatchedActions).toBeNull();
    });

    it("getHourlyAdBreakdowns requests the hourly breakdown and hashes hour_of_day into the key", async () => {
        const calls = stubInsights([
            {
                account_id: "act_123",
                campaign_id: "camp_1",
                adset_id: "adset_1",
                ad_id: "ad_1",
                date_start: "2026-11-19",
                date_stop: "2026-11-19",
                spend: "5.5",
                impressions: "120",
                clicks: "4",
                inline_link_clicks: "2",
                publisher_platform: "instagram",
                platform_position: "story",
                impression_device: "smartphone",
                hourly_stats_aggregated_by_advertiser_time_zone: "14:00:00 - 14:59:59",
            },
        ]);

        const adapter = new FacebookSdkAdapter();
        const rows = await adapter.getHourlyAdBreakdowns("token", "act_123", {
            since: "2026-11-01",
            until: "2026-11-19",
            currencyOffset: 100,
        });

        expect(calls.length).toBe(1);
        const [fields, params] = calls[0];
        expect(fields).toContain("date_start");
        expect(params.breakdowns).toContain("hourly_stats_aggregated_by_advertiser_time_zone");
        expect(params.breakdowns).toContain("publisher_platform");
        expect(params.level).toBe("ad");

        expect(rows.length).toBe(1);
        expect(rows[0].hourOfDay).toBe(14);
        expect(rows[0].publisherPlatform).toBe("instagram");
        expect(rows[0].impressionDevice).toBe("smartphone");
        expect(rows[0].spendMinor).toBe(550);
        expect(rows[0].breakdownHash).toBe(
            createHash("sha256").update("instagram|story|smartphone|14").digest("hex").slice(0, 32)
        );
    });

    it("getHourlyAdBreakdowns keeps unparsable hour buckets as null", async () => {
        stubInsights([
            {
                ad_id: "ad_1",
                date_start: "2026-11-19",
                spend: "1",
                impressions: "1",
                clicks: "0",
                hourly_stats_aggregated_by_advertiser_time_zone: "unknown",
            },
        ]);

        const adapter = new FacebookSdkAdapter();
        const rows = await adapter.getHourlyAdBreakdowns("token", "act_123", {
            since: "2026-11-01",
            until: "2026-11-19",
        });

        expect(rows[0].hourOfDay).toBeNull();
        expect(rows[0].breakdownHash).toBe(
            createHash("sha256").update("|||").digest("hex").slice(0, 32)
        );
    });
});
