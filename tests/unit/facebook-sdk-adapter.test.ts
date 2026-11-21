import {describe, expect, it, mock} from "bun:test";
import {FacebookSdkAdapter} from "@/infra/meta/adapters/facebook-sdk.adapter";
import type {IMetaAdsAdapter} from "@/infra/meta/base.meta";

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
    });

    it("getVideoDetails handles invalid videoId gracefully without crashing", async () => {
        const adapter = new FacebookSdkAdapter();
        const video = await adapter.getVideoDetails("test-token", "non-existent-video-id");
        expect(video).toBeNull();
    });
});
