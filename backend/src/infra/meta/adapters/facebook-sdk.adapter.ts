import bizSdk from "facebook-nodejs-business-sdk";
import {createHash} from "node:crypto";
import type {IMetaAdsAdapter, IMetaAdStudiesAdapter, IMetaPixelAdapter} from "../base.meta";
import type {
    MetaAdAccountDto,
    MetaAdCreativeDto,
    MetaAdPixelDto,
    MetaAdStudyDto,
    MetaAdDto,
    MetaAdInsightActionDto,
    MetaAdInsightBreakdownDailyDto,
    MetaAdInsightDailyDto,
    MetaAdSetDto,
    MetaCampaignDto,
    MetaCustomPeriodMetricsDto,
    MetaPixelStatsRowDto,
    MetaVideoDto,
} from "../types";
import {logger} from "@shared/logger";
import {Config} from "@/config";

interface SdkCursorItem {
    _data?: Record<string, unknown>;
    [key: string]: unknown;
}

interface SdkCursor extends Array<SdkCursorItem> {
    hasNext(): boolean;
    next(): Promise<SdkCursor>;
}

/** Meta returns hourly buckets like `"14:00:00 - 14:59:59"`; the leading hour is the bucket. */
function parseHourOfDay(value: unknown): number | null {
    if (value == null) return null;
    const match = /^(\d{1,2})/.exec(String(value).trim());
    if (!match) return null;
    const hour = Number(match[1]);
    return hour >= 0 && hour <= 23 ? hour : null;
}

export class FacebookSdkAdapter implements IMetaAdsAdapter, IMetaAdStudiesAdapter, IMetaPixelAdapter {
    private initApi(accessToken: string): void {
        bizSdk.FacebookAdsApi.init(accessToken);
    }

    private async fetchAllSdk(
        edge: (fields: string[], params: Record<string, unknown>) => Promise<SdkCursor>,
        fields: string[],
        params: Record<string, unknown> = {}
    ): Promise<Record<string, unknown>[]> {
        const rows: Record<string, unknown>[] = [];
        let cursor: SdkCursor | null = await edge(fields, {limit: 500, ...params});

        while (cursor) {
            for (const item of cursor) {
                const data = (item._data ?? item) as Record<string, unknown>;
                rows.push(data);
            }
            cursor = cursor.hasNext() ? await cursor.next() : null;
        }

        return rows;
    }

    async getAdAccounts(
        accessToken: string,
        options?: { includeBusiness?: boolean }
    ): Promise<MetaAdAccountDto[]> {
        this.initApi(accessToken);
        const user = new bizSdk.User("me");

        const baseFields = [
            "id",
            "name",
            "currency",
            "timezone_name",
            "account_status",
            "currency_offset",
        ];

        const fieldsWithBusiness = [...baseFields, "business"];
        const fieldsToQuery = options?.includeBusiness ? fieldsWithBusiness : baseFields;

        let rawAccounts: Record<string, unknown>[];
        try {
            rawAccounts = await this.fetchAllSdk(
                (f, p) => user.getAdAccounts(f, p) as Promise<SdkCursor>,
                fieldsToQuery,
                {limit: 100}
            );
        } catch (error) {
            if (fieldsToQuery.includes("business")) {
                logger.warn({error}, "Failed to fetch ad accounts with business field, retrying without business");
                rawAccounts = await this.fetchAllSdk(
                    (f, p) => user.getAdAccounts(f, p) as Promise<SdkCursor>,
                    baseFields,
                    {limit: 100}
                );
            } else {
                throw error;
            }
        }

        return rawAccounts.map((acc) => {
            const rawId = String(acc.id ?? "");
            const normalizedId = rawId.startsWith("act_") ? rawId : `act_${rawId}`;
            const businessObj = acc.business as { id?: string; name?: string } | undefined;

            return {
                id: normalizedId,
                name: String(acc.name ?? ""),
                currency: String(acc.currency ?? "IDR"),
                currencyOffset: typeof acc.currency_offset === "number" ? acc.currency_offset : 100,
                timezoneName: String(acc.timezone_name ?? "UTC"),
                accountStatus: typeof acc.account_status === "number" ? acc.account_status : null,
                businessId: businessObj?.id ?? null,
            };
        });
    }

    async getCampaigns(accessToken: string, accountId: string): Promise<MetaCampaignDto[]> {
        this.initApi(accessToken);
        const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const account = new bizSdk.AdAccount(normalizedAccountId);

        const fields = [
            bizSdk.Campaign.Fields.id,
            bizSdk.Campaign.Fields.name,
            bizSdk.Campaign.Fields.objective,
            bizSdk.Campaign.Fields.status,
            bizSdk.Campaign.Fields.effective_status,
            bizSdk.Campaign.Fields.buying_type,
            bizSdk.Campaign.Fields.daily_budget,
            bizSdk.Campaign.Fields.lifetime_budget,
            bizSdk.Campaign.Fields.budget_remaining,
            bizSdk.Campaign.Fields.start_time,
            bizSdk.Campaign.Fields.stop_time,
            bizSdk.Campaign.Fields.created_time,
            bizSdk.Campaign.Fields.updated_time,
        ];

        const rawCampaigns = await this.fetchAllSdk(
            (f, p) => account.getCampaigns(f, p) as Promise<SdkCursor>,
            fields
        );

        return rawCampaigns.map((c) => ({
            id: String(c.id),
            name: String(c.name),
            objective: c.objective ? String(c.objective) : null,
            status: c.status ? String(c.status) : null,
            effectiveStatus: c.effective_status ? String(c.effective_status) : null,
            buyingType: c.buying_type ? String(c.buying_type) : null,
            dailyBudgetMinor: c.daily_budget ? Number(c.daily_budget) : null,
            lifetimeBudgetMinor: c.lifetime_budget ? Number(c.lifetime_budget) : null,
            budgetRemainingMinor: c.budget_remaining ? Number(c.budget_remaining) : null,
            startTime: c.start_time ? new Date(String(c.start_time)) : null,
            stopTime: c.stop_time ? new Date(String(c.stop_time)) : null,
            createdTime: c.created_time ? new Date(String(c.created_time)) : null,
            updatedTime: c.updated_time ? new Date(String(c.updated_time)) : null,
            raw: c,
        }));
    }

    async getAdSets(accessToken: string, accountId: string): Promise<MetaAdSetDto[]> {
        this.initApi(accessToken);
        const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const account = new bizSdk.AdAccount(normalizedAccountId);

        const fields = [
            bizSdk.AdSet.Fields.id,
            bizSdk.AdSet.Fields.name,
            bizSdk.AdSet.Fields.campaign_id,
            bizSdk.AdSet.Fields.status,
            bizSdk.AdSet.Fields.effective_status,
            bizSdk.AdSet.Fields.optimization_goal,
            "destination_type",
            bizSdk.AdSet.Fields.billing_event,
            bizSdk.AdSet.Fields.bid_strategy,
            bizSdk.AdSet.Fields.bid_amount,
            bizSdk.AdSet.Fields.daily_budget,
            bizSdk.AdSet.Fields.lifetime_budget,
            bizSdk.AdSet.Fields.targeting,
            bizSdk.AdSet.Fields.start_time,
            bizSdk.AdSet.Fields.end_time,
            bizSdk.AdSet.Fields.created_time,
            bizSdk.AdSet.Fields.updated_time,
        ];

        const rawAdSets = await this.fetchAllSdk(
            (f, p) => account.getAdSets(f, p) as Promise<SdkCursor>,
            fields
        );

        return rawAdSets.map((s) => ({
            id: String(s.id),
            name: String(s.name),
            campaignId: String(s.campaign_id),
            status: s.status ? String(s.status) : null,
            effectiveStatus: s.effective_status ? String(s.effective_status) : null,
            optimizationGoal: s.optimization_goal ? String(s.optimization_goal) : null,
            destinationType: s.destination_type ? String(s.destination_type) : null,
            billingEvent: s.billing_event ? String(s.billing_event) : null,
            bidStrategy: s.bid_strategy ? String(s.bid_strategy) : null,
            bidAmountMinor: s.bid_amount ? Number(s.bid_amount) : null,
            dailyBudgetMinor: s.daily_budget ? Number(s.daily_budget) : null,
            lifetimeBudgetMinor: s.lifetime_budget ? Number(s.lifetime_budget) : null,
            targeting: (s.targeting as Record<string, unknown> | undefined) ?? null,
            startTime: s.start_time ? new Date(String(s.start_time)) : null,
            endTime: s.end_time ? new Date(String(s.end_time)) : null,
            createdTime: s.created_time ? new Date(String(s.created_time)) : null,
            updatedTime: s.updated_time ? new Date(String(s.updated_time)) : null,
            raw: s,
        }));
    }

    async getAdCreatives(accessToken: string, accountId: string): Promise<MetaAdCreativeDto[]> {
        this.initApi(accessToken);
        const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const account = new bizSdk.AdAccount(normalizedAccountId);

        const fields = [
            bizSdk.AdCreative.Fields.id,
            bizSdk.AdCreative.Fields.name,
            bizSdk.AdCreative.Fields.object_type,
            bizSdk.AdCreative.Fields.status,
            bizSdk.AdCreative.Fields.video_id,
            bizSdk.AdCreative.Fields.image_url,
            bizSdk.AdCreative.Fields.thumbnail_url,
            bizSdk.AdCreative.Fields.object_story_id,
            bizSdk.AdCreative.Fields.body,
            bizSdk.AdCreative.Fields.title,
            bizSdk.AdCreative.Fields.call_to_action_type,
            bizSdk.AdCreative.Fields.url_tags,
        ];

        const rawCreatives = await this.fetchAllSdk(
            (f, p) => account.getAdCreatives(f, p) as Promise<SdkCursor>,
            fields
        );

        return rawCreatives.map((cr) => ({
            id: String(cr.id),
            name: cr.name ? String(cr.name) : null,
            objectType: cr.object_type ? String(cr.object_type) : null,
            status: cr.status ? String(cr.status) : null,
            videoId: cr.video_id ? String(cr.video_id) : null,
            videoLengthSeconds: null,
            videoPermalinkUrl: null,
            imageUrl: cr.image_url ? String(cr.image_url) : null,
            thumbnailUrl: cr.thumbnail_url ? String(cr.thumbnail_url) : null,
            objectStoryId: cr.object_story_id ? String(cr.object_story_id) : null,
            body: cr.body ? String(cr.body) : null,
            title: cr.title ? String(cr.title) : null,
            callToActionType: cr.call_to_action_type ? String(cr.call_to_action_type) : null,
            urlTags: cr.url_tags ? String(cr.url_tags) : null,
            createdTime: cr.created_time ? new Date(String(cr.created_time)) : null,
            updatedTime: cr.updated_time ? new Date(String(cr.updated_time)) : null,
            raw: cr,
        }));
    }

    async getAds(accessToken: string, accountId: string): Promise<MetaAdDto[]> {
        this.initApi(accessToken);
        const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const account = new bizSdk.AdAccount(normalizedAccountId);

        const fields = [
            bizSdk.Ad.Fields.id,
            bizSdk.Ad.Fields.name,
            bizSdk.Ad.Fields.campaign_id,
            bizSdk.Ad.Fields.adset_id,
            bizSdk.Ad.Fields.status,
            bizSdk.Ad.Fields.effective_status,
            bizSdk.Ad.Fields.creative,
            bizSdk.Ad.Fields.created_time,
            bizSdk.Ad.Fields.updated_time,
        ];

        const rawAds = await this.fetchAllSdk(
            (f, p) => account.getAds(f, p) as Promise<SdkCursor>,
            fields
        );

        return rawAds.map((ad) => {
            const creativeObj = ad.creative as { id?: string } | undefined;

            return {
                id: String(ad.id),
                name: String(ad.name),
                campaignId: String(ad.campaign_id),
                adsetId: String(ad.adset_id),
                creativeId: creativeObj?.id ? String(creativeObj.id) : null,
                status: ad.status ? String(ad.status) : null,
                effectiveStatus: ad.effective_status ? String(ad.effective_status) : null,
                createdTime: ad.created_time ? new Date(String(ad.created_time)) : null,
                updatedTime: ad.updated_time ? new Date(String(ad.updated_time)) : null,
                raw: ad,
            };
        });
    }

    async getVideoDetails(accessToken: string, videoId: string): Promise<MetaVideoDto | null> {
        this.initApi(accessToken);
        try {
            const video = new bizSdk.AdVideo(videoId);
            const readResult = await video.read(["id", "length", "permalink_url"]);
            const data = (readResult._data ?? readResult) as Record<string, unknown>;

            return {
                id: String(data.id ?? videoId),
                length: typeof data.length === "number" ? data.length : null,
                permalinkUrl: data.permalink_url ? String(data.permalink_url) : null,
            };
        } catch (error) {
            logger.warn({videoId, error}, "Failed to read video details via SDK");
            return null;
        }
    }

    async getDailyAdInsights(
        accessToken: string,
        accountId: string,
        options: {
            since: string;
            until: string;
            currency?: string;
            currencyOffset?: number;
        }
    ): Promise<MetaAdInsightDailyDto[]> {
        this.initApi(accessToken);
        const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const account = new bizSdk.AdAccount(normalizedAccountId);
        const currencyOffset = options.currencyOffset ?? 100;
        const defaultCurrency = options.currency ?? "IDR";

        const fields = [
            "account_id",
            "campaign_id",
            "adset_id",
            "ad_id",
            "date_start",
            "date_stop",
            "spend",
            "impressions",
            "reach",
            "frequency",
            "clicks",
            "inline_link_clicks",
            "unique_clicks",
            "ctr",
            "cpc",
            "cpm",
            "actions",
            "action_values",
            "cost_per_action_type",
            "video_play_actions",
            "video_thruplay_watched_actions",
            "video_p25_watched_actions",
            "video_p50_watched_actions",
            "video_p75_watched_actions",
            "video_p100_watched_actions",
            "video_avg_time_watched_actions",
            "action_report_time",
            "video_3_sec_watched_actions",
        ];

        const params = {
            level: "ad",
            time_increment: 1,
            time_range: {since: options.since, until: options.until},
            action_attribution_windows: ["7d_click"],
        };

        const rawInsights = await this.fetchAllSdk(
            (f, p) => account.getInsights(f, p) as Promise<SdkCursor>,
            fields,
            params
        );

        const todayStr = new Date().toISOString().slice(0, 10);

        return rawInsights.map((row) => {
            const rawSpend = Number(row.spend ?? 0);
            const spendMinor = Math.round(rawSpend * currencyOffset);
            const cpcMinor = row.cpc ? Math.round(Number(row.cpc) * currencyOffset) : null;
            const cpmMinor = row.cpm ? Math.round(Number(row.cpm) * currencyOffset) : null;
            const dateStr = String(row.date_start ?? row.date_stop ?? options.since);
            const isFinal = dateStr < todayStr;

            // Extract video metric helper
            const extractVideoMetric = (fieldVal: unknown): number | null => {
                if (!Array.isArray(fieldVal) || fieldVal.length === 0) return null;
                const first = fieldVal[0] as { value?: string | number };
                return first?.value != null ? Number(first.value) : null;
            };

            const videoPlay = extractVideoMetric(row.video_play_actions);
            const videoThruplay = extractVideoMetric(row.video_thruplay_watched_actions);
            const videoP25 = extractVideoMetric(row.video_p25_watched_actions);
            const videoP50 = extractVideoMetric(row.video_p50_watched_actions);
            const videoP75 = extractVideoMetric(row.video_p75_watched_actions);
            const videoP100 = extractVideoMetric(row.video_p100_watched_actions);
            const videoAvgTime = extractVideoMetric(row.video_avg_time_watched_actions);

            // Extract actions & action_values into relational array
            const actionsArr = Array.isArray(row.actions) ? (row.actions as Record<string, unknown>[]) : [];
            const actionValuesArr = Array.isArray(row.action_values) ? (row.action_values as Record<string, unknown>[]) : [];
            const costPerActionArr = Array.isArray(row.cost_per_action_type) ? (row.cost_per_action_type as Record<string, unknown>[]) : [];

            const actionValuesMap = new Map<string, number>();
            for (const av of actionValuesArr) {
                if (av.action_type && av.value != null) {
                    actionValuesMap.set(String(av.action_type), Math.round(Number(av.value) * currencyOffset));
                }
            }

            const costPerActionMap = new Map<string, number>();
            for (const cpa of costPerActionArr) {
                if (cpa.action_type && cpa.value != null) {
                    costPerActionMap.set(String(cpa.action_type), Math.round(Number(cpa.value) * currencyOffset));
                }
            }

            const extractedActions: MetaAdInsightActionDto[] = actionsArr.map((a) => {
                const type = String(a.action_type);
                return {
                    actionType: type,
                    count: String(a.value ?? "0"),
                    valueMinor: actionValuesMap.get(type) ?? null,
                    costPerActionMinor: costPerActionMap.get(type) ?? null,
                };
            });

            return {
                accountId: normalizedAccountId,
                level: "ad",
                entityId: String(row.ad_id),
                campaignId: row.campaign_id ? String(row.campaign_id) : null,
                adsetId: row.adset_id ? String(row.adset_id) : null,
                adId: String(row.ad_id),
                date: dateStr,
                attributionWindow: "7d_click",
                currency: String(row.account_currency ?? defaultCurrency),
                currencyOffset,
                spendMinor,
                impressions: Number(row.impressions ?? 0),
                reach: row.reach != null ? Number(row.reach) : null,
                frequency: row.frequency != null ? String(row.frequency) : null,
                clicks: Number(row.clicks ?? 0),
                inlineLinkClicks: row.inline_link_clicks != null ? Number(row.inline_link_clicks) : null,
                uniqueClicks: row.unique_clicks != null ? Number(row.unique_clicks) : null,
                ctr: row.ctr != null ? String(row.ctr) : null,
                cpcMinor,
                cpmMinor,
                actions: row.actions ?? null,
                actionValues: row.action_values ?? null,
                costPerActionType: row.cost_per_action_type ?? null,
                videoPlayActions: videoPlay,
                video30SecWatchedActions: null,
                videoThruplayWatchedActions: videoThruplay,
                videoP25WatchedActions: videoP25,
                videoP50WatchedActions: videoP50,
                videoP75WatchedActions: videoP75,
                videoP100WatchedActions: videoP100,
                videoAvgTimeWatchedSeconds: videoAvgTime != null ? String(videoAvgTime) : null,
                graphVersion: Config.meta.apiVersion,
                actionReportTime: row.action_report_time ? String(row.action_report_time) : "impression",
                video3SecWatchedActions: extractVideoMetric(row.video_3_sec_watched_actions),
                isFinal,
                extractedActions,
            };
        });
    }

    async getDailyAdBreakdowns(
        accessToken: string,
        accountId: string,
        options: {
            since: string;
            until: string;
            currencyOffset?: number;
        }
    ): Promise<MetaAdInsightBreakdownDailyDto[]> {
        this.initApi(accessToken);
        const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const account = new bizSdk.AdAccount(normalizedAccountId);
        const currencyOffset = options.currencyOffset ?? 100;

        const fields = [
            "account_id",
            "campaign_id",
            "adset_id",
            "ad_id",
            "date_start",
            "date_stop",
            "spend",
            "impressions",
            "reach",
            "clicks",
            "inline_link_clicks",
            "actions",
            "action_values",
        ];

        const params = {
            level: "ad",
            time_increment: 1,
            time_range: {since: options.since, until: options.until},
            action_attribution_windows: ["7d_click"],
            breakdowns: ["publisher_platform", "platform_position", "impression_device"],
        };

        const rawRows = await this.fetchAllSdk(
            (f, p) => account.getInsights(f, p) as Promise<SdkCursor>,
            fields,
            params
        );

        return rawRows.map((row) => {
            const rawSpend = Number(row.spend ?? 0);
            const spendMinor = Math.round(rawSpend * currencyOffset);
            const dateStr = String(row.date_start ?? row.date_stop ?? options.since);
            const pubPlatform = row.publisher_platform ? String(row.publisher_platform) : null;
            const platPosition = row.platform_position ? String(row.platform_position) : null;
            const impDevice = row.impression_device ? String(row.impression_device) : null;

            const hashInput = `${pubPlatform ?? ""}|${platPosition ?? ""}|${impDevice ?? ""}`;
            const breakdownHash = createHash("sha256").update(hashInput).digest("hex").slice(0, 32);

            return {
                accountId: normalizedAccountId,
                level: "ad",
                entityId: String(row.ad_id),
                campaignId: row.campaign_id ? String(row.campaign_id) : null,
                adsetId: row.adset_id ? String(row.adset_id) : null,
                adId: String(row.ad_id),
                date: dateStr,
                attributionWindow: "7d_click",
                publisherPlatform: pubPlatform,
                platformPosition: platPosition,
                impressionDevice: impDevice,
                hourOfDay: null,
                age: null,
                gender: null,
                country: null,
                region: null,
                breakdownHash,
                spendMinor,
                impressions: Number(row.impressions ?? 0),
                reach: row.reach != null ? Number(row.reach) : null,
                clicks: Number(row.clicks ?? 0),
                inlineLinkClicks: row.inline_link_clicks != null ? Number(row.inline_link_clicks) : null,
                actions: row.actions ?? null,
                actionValues: row.action_values ?? null,
            };
        });
    }

    async getHourlyAdBreakdowns(
        accessToken: string,
        accountId: string,
        options: {
            since: string;
            until: string;
            currencyOffset?: number;
        }
    ): Promise<MetaAdInsightBreakdownDailyDto[]> {
        this.initApi(accessToken);
        const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const account = new bizSdk.AdAccount(normalizedAccountId);
        const currencyOffset = options.currencyOffset ?? 100;

        const fields = [
            "account_id",
            "campaign_id",
            "adset_id",
            "ad_id",
            "date_start",
            "date_stop",
            "spend",
            "impressions",
            "reach",
            "clicks",
            "inline_link_clicks",
            "actions",
            "action_values",
        ];

        const params = {
            level: "ad",
            time_increment: 1,
            time_range: {since: options.since, until: options.until},
            action_attribution_windows: ["7d_click"],
            breakdowns: [
                "publisher_platform",
                "platform_position",
                "impression_device",
                "hourly_stats_aggregated_by_advertiser_time_zone",
            ],
        };

        const rawRows = await this.fetchAllSdk(
            (f, p) => account.getInsights(f, p) as Promise<SdkCursor>,
            fields,
            params
        );

        return rawRows.map((row) => {
            const rawSpend = Number(row.spend ?? 0);
            const spendMinor = Math.round(rawSpend * currencyOffset);
            const dateStr = String(row.date_start ?? row.date_stop ?? options.since);
            const pubPlatform = row.publisher_platform ? String(row.publisher_platform) : null;
            const platPosition = row.platform_position ? String(row.platform_position) : null;
            const impDevice = row.impression_device ? String(row.impression_device) : null;
            const hourOfDay = parseHourOfDay(row.hourly_stats_aggregated_by_advertiser_time_zone);

            const hashInput = `${pubPlatform ?? ""}|${platPosition ?? ""}|${impDevice ?? ""}|${hourOfDay ?? ""}`;
            const breakdownHash = createHash("sha256").update(hashInput).digest("hex").slice(0, 32);

            return {
                accountId: normalizedAccountId,
                level: "ad",
                entityId: String(row.ad_id),
                campaignId: row.campaign_id ? String(row.campaign_id) : null,
                adsetId: row.adset_id ? String(row.adset_id) : null,
                adId: String(row.ad_id),
                date: dateStr,
                attributionWindow: "7d_click",
                publisherPlatform: pubPlatform,
                platformPosition: platPosition,
                impressionDevice: impDevice,
                hourOfDay,
                age: null,
                gender: null,
                country: null,
                region: null,
                breakdownHash,
                spendMinor,
                impressions: Number(row.impressions ?? 0),
                reach: row.reach != null ? Number(row.reach) : null,
                clicks: Number(row.clicks ?? 0),
                inlineLinkClicks: row.inline_link_clicks != null ? Number(row.inline_link_clicks) : null,
                actions: row.actions ?? null,
                actionValues: row.action_values ?? null,
            };
        });
    }

    async getCustomPeriodMetrics(
        accessToken: string,
        accountId: string,
        options: {
            level: "account" | "campaign" | "adset" | "ad";
            entityId?: string;
            since: string;
            until: string;
            currencyOffset?: number;
        }
    ): Promise<MetaCustomPeriodMetricsDto | null> {
        this.initApi(accessToken);
        const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const currencyOffset = options.currencyOffset ?? 100;
        const targetEntityId = options.entityId ?? (options.level === "account" ? normalizedAccountId : undefined);

        if (!targetEntityId) {
            throw new Error(`entityId is required when level is '${options.level}'`);
        }

        const fields = ["reach", "frequency", "impressions", "spend", "clicks"];
        const params = {
            level: options.level,
            time_range: {since: options.since, until: options.until},
        };

        try {
            let cursor: SdkCursor;
            if (options.level === "account") {
                const account = new bizSdk.AdAccount(targetEntityId);
                cursor = (await account.getInsights(fields, params)) as SdkCursor;
            } else if (options.level === "campaign") {
                const campaign = new bizSdk.Campaign(targetEntityId);
                cursor = (await campaign.getInsights(fields, params)) as SdkCursor;
            } else if (options.level === "adset") {
                const adSet = new bizSdk.AdSet(targetEntityId);
                cursor = (await adSet.getInsights(fields, params)) as SdkCursor;
            } else {
                const ad = new bizSdk.Ad(targetEntityId);
                cursor = (await ad.getInsights(fields, params)) as SdkCursor;
            }

            if (!cursor || cursor.length === 0) {
                return null;
            }

            const raw = (cursor[0]._data ?? cursor[0]) as Record<string, unknown>;
            const rawSpend = Number(raw.spend ?? 0);
            const spendMinor = Math.round(rawSpend * currencyOffset);

            return {
                accountId: normalizedAccountId,
                level: options.level,
                entityId: targetEntityId,
                since: options.since,
                until: options.until,
                reach: Number(raw.reach ?? 0),
                frequency: String(raw.frequency ?? "0"),
                impressions: Number(raw.impressions ?? 0),
                spendMinor,
                clicks: Number(raw.clicks ?? 0),
                raw,
            };
        } catch (error) {
            logger.error({error, options}, "Failed to fetch custom period non-additive metrics");
            throw error;
        }
    }

    /**
     * `ad_studies` needs a permission the token may not carry. That case is a normal answer for the
     * endpoint (`permission_missing`), not a 500, so it is mapped here instead of in the service.
     */
    async getAdStudies(
        accessToken: string,
        metaUserId: string
    ): Promise<{hasAccess: boolean; studies: MetaAdStudyDto[]}> {
        this.initApi(accessToken);
        const user = new bizSdk.User(metaUserId);

        const fields = ["id", "name", "type", "start_time", "end_time", "results_first_available_date"];

        try {
            const rows = await this.fetchAllSdk(
                (f, p) => user.getAdStudies(f, p) as Promise<SdkCursor>,
                fields,
                {limit: 100}
            );

            return {
                hasAccess: true,
                studies: rows.map((row) => ({
                    id: String(row.id),
                    name: row.name ? String(row.name) : null,
                    type: row.type ? String(row.type) : null,
                    startTime: row.start_time ? String(row.start_time) : null,
                    endTime: row.end_time ? String(row.end_time) : null,
                    resultsFirstAvailableDate: row.results_first_available_date
                        ? String(row.results_first_available_date)
                        : null,
                })),
            };
        } catch (error) {
            if (isPermissionError(error)) return {hasAccess: false, studies: []};
            throw error;
        }
    }

    /** `adspixels` is the pixel inventory: id, code, last fire time, and the match keys Meta already has. */
    async getAdPixels(
        accessToken: string,
        accountId: string
    ): Promise<{hasAccess: boolean; pixels: MetaAdPixelDto[]}> {
        this.initApi(accessToken);
        const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const account = new bizSdk.AdAccount(normalizedAccountId);

        const fields = ["id", "name", "code", "last_fired_time", "automatic_matching_fields"];

        try {
            const rows = await this.fetchAllSdk(
                (f, p) => account.getAdsPixels(f, p) as Promise<SdkCursor>,
                fields,
                {limit: 100}
            );

            return {
                hasAccess: true,
                pixels: rows.map((row) => ({
                    id: String(row.id),
                    name: row.name ? String(row.name) : null,
                    code: row.code ? String(row.code) : null,
                    lastFiredTime: parseDate(row.last_fired_time),
                    automaticMatchingFields: Array.isArray(row.automatic_matching_fields)
                        ? row.automatic_matching_fields.map(String)
                        : [],
                })),
            };
        } catch (error) {
            if (isPermissionError(error)) return {hasAccess: false, pixels: []};
            throw error;
        }
    }

    /**
     * `aggregation=event` splits every event into browser and server counts. Meta only reports the
     * split for pixels with CAPI traffic, so an absent key maps to `null` — never to `0`.
     */
    async getPixelStats(
        accessToken: string,
        pixelId: string,
        options: {since: string; until: string}
    ): Promise<{hasAccess: boolean; rows: MetaPixelStatsRowDto[]}> {
        this.initApi(accessToken);
        const pixel = new bizSdk.AdsPixel(pixelId);

        try {
            const rows = await this.fetchAllSdk(
                (f, p) => pixel.getStats(f, p) as Promise<SdkCursor>,
                ["data"],
                {aggregation: "event", start_time: options.since, end_time: options.until}
            );

            const mapped: MetaPixelStatsRowDto[] = [];
            for (const row of rows) {
                const eventName = String(row.value ?? row.event_name ?? "");
                if (eventName === "") continue;

                mapped.push({
                    eventName,
                    browserCount: pickNumber(row, ["browser_count", "browserCount", "browser"]),
                    serverCount: pickNumber(row, ["server_count", "serverCount", "server"]),
                    duplicateCount: pickNumber(row, ["duplicate_count", "duplicateCount", "duplicate"]),
                    matchQuality: pickNumber(row, [
                        "match_quality",
                        "matchQuality",
                        "emq",
                        "event_match_quality",
                    ]),
                    raw: row,
                });
            }

            return {hasAccess: true, rows: mapped};
        } catch (error) {
            // `/stats` refuses a token without the pixel permission with a plain HTTP 403.
            if (isPermissionError(error)) return {hasAccess: false, rows: []};
            throw error;
        }
    }
}

function parseDate(value: unknown): Date | null {
    if (value == null) return null;

    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Meta mixes numbers and numeric strings across pixel payloads; anything else stays `null`. */
function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        if (typeof value === "string" && value.trim() !== "") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }

    return null;
}

/** Graph permission failures: codes 10/200/294, an HTTP 403, or an OAuth message naming the permission. */
function isPermissionError(error: unknown): boolean {
    if (error === null || typeof error !== "object") return false;

    const candidate = error as {
        code?: unknown;
        status?: unknown;
        message?: unknown;
        response?: {code?: unknown; status?: unknown; message?: unknown};
    };
    const code = candidate.code ?? candidate.response?.code;
    if (code === 10 || code === 200 || code === 294 || code === "10" || code === "200" || code === "294") {
        return true;
    }

    const status = candidate.status ?? candidate.response?.status;
    if (status === 403 || status === "403") return true;

    const message = candidate.message ?? candidate.response?.message;
    return typeof message === "string" && message.toLowerCase().includes("permission");
}
