import {Config} from "@/config";
import {MetaConnectionEntity} from "@db/schema/ads/meta-connection.entity";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {CampaignRepository} from "@db/repositories/campaign.repository";
import {AdSetRepository} from "@db/repositories/ad-set.repository";
import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {AdRepository} from "@db/repositories/ad.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import type {UpsertInsightDailyParams} from "@db/repositories/ad-insight-daily.repository";
import type {InsertAdInsightBreakdownDaily} from "@db/repositories/ad-insight-breakdown.repository";
import {InsightStagingRepository} from "@db/repositories/insight-staging.repository";
import {SyncCursorRepository} from "@db/repositories/sync-cursor.repository";
import {BadRequestError, InternalError, NotFoundError, UnauthorizedError} from "@shared/errors";
import {JwtUtil} from "@shared/jwt";
import {logger} from "@shared/logger";
import type {MetaSchema} from "@/modules/meta/schema";
import type {IMetaAdsAdapter} from "@infra/meta/base.meta";
import {FacebookSdkAdapter} from "@infra/meta/adapters/facebook-sdk.adapter";
import {deriveObjectiveGroup} from "@infra/meta/objective-group";

const GRAPH_URL = "https://graph.facebook.com";
const OAUTH_DIALOG_URL = "https://www.facebook.com";

export interface MetaConnectionView {
    id: string;
    metaUserId: string;
    metaUserName: string | null;
    scopes: string[];
    expiresAt: Date | null;
    connectedAt: Date;
    isExpired: boolean;
}

interface GraphTokenResponse {
    access_token: string;
    token_type?: string;
    expires_in?: number;
}

interface GraphDebugResponse {
    data?: {
        is_valid?: boolean;
        scopes?: string[];
        expires_at?: number;
    }
}

interface GraphUserResponse {
    id: string;
    name?: string;
}

interface GraphAdAccount {
    id: string;
    name: string;
    currency: string;
    timezone_name: string;
    account_status?: number;
    business?: {
        id: string;
        name: string;
    };
    currency_offset?: number;
}

interface GraphAdAccountsResponse {
    data: GraphAdAccount[];
    paging?: {
        cursors?: {
            before?: string;
            after?: string;
        };
        next?: string;
    };
}

interface GraphPagedResponse<T> {
    data?: T[];
    paging?: {
        next?: string;
    };
}

interface GraphCampaign {
    id: string;
    name: string;
    objective?: string;
    status?: string;
    effective_status?: string;
    buying_type?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    budget_remaining?: string;
    start_time?: string;
    stop_time?: string;
    created_time?: string;
    updated_time?: string;
}

interface GraphAdSet {
    id: string;
    name: string;
    campaign_id: string;
    status?: string;
    effective_status?: string;
    optimization_goal?: string;
    destination_type?: string;
    billing_event?: string;
    bid_strategy?: string;
    bid_amount?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    targeting?: Record<string, unknown>;
    start_time?: string;
    end_time?: string;
    created_time?: string;
    updated_time?: string;
}

interface GraphCreative {
    id: string;
    name?: string;
    object_type?: string;
    status?: string;
    video_id?: string;
    image_url?: string;
    thumbnail_url?: string;
    object_story_id?: string;
    body?: string;
    title?: string;
    call_to_action_type?: string;
    url_tags?: string;
    created_time?: string;
    updated_time?: string;
}

interface GraphVideo {
    id: string;
    length?: number;
    permalink_url?: string;
}

interface GraphAd {
    id: string;
    name: string;
    campaign_id: string;
    adset_id: string;
    status?: string;
    effective_status?: string;
    creative?: { id: string };
    created_time?: string;
    updated_time?: string;
}

/** Where a resumable walk keeps its position, and who wants to hear how many pages it skipped. */
export interface SyncCursorScope {
    accountId: string;
    resource: string;
    onSkipped?: (pages: number) => void;
}

/** The stored cursor is JSON so the page count survives a resume; an older plain URL still parses. */
function parseCursor(raw: string): {next: string; pages: number} | null {
    if (!raw.startsWith("{")) return {next: raw, pages: 1};

    try {
        const parsed = JSON.parse(raw) as {next?: unknown; pages?: unknown};
        if (typeof parsed.next !== "string") return null;
        return {next: parsed.next, pages: typeof parsed.pages === "number" ? parsed.pages : 1};
    } catch {
        return null;
    }
}

export type MetaRequester = <T>(
    path: string,
    params: Record<string, string | undefined>,
    init?: RequestInit
) => Promise<T>;

export class MetaService {
    constructor(
        private readonly metaConnectionRepository = new MetaConnectionRepository(),
        private readonly adAccountRepository = new AdAccountRepository(),
        private readonly campaignRepository = new CampaignRepository(),
        private readonly adSetRepository = new AdSetRepository(),
        private readonly adCreativeRepository = new AdCreativeRepository(),
        private readonly adRepository = new AdRepository(),
        private readonly syncRunRepository = new SyncRunRepository(),
        private readonly customRequest?: MetaRequester,
        private readonly metaAdapter: IMetaAdsAdapter = new FacebookSdkAdapter(),
        private readonly insightStagingRepository = new InsightStagingRepository(),
        private readonly syncCursorRepository = new SyncCursorRepository(),
    ) {}

    async authorizationUrl(user: { iss: string; tenantId: string }): Promise<{ url: string; expiresIn: number }> {
        this.assertConfigured();

        const state = await JwtUtil.signOAuthState({userId: user.iss, tenantId: user.tenantId});
        const url = new URL(`${OAUTH_DIALOG_URL}/${Config.meta.apiVersion}/dialog/oauth`);
        url.searchParams.set("client_id", Config.meta.appId);
        url.searchParams.set("redirect_uri", Config.meta.redirectUri);
        url.searchParams.set("state", state);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", Config.meta.scopes.join(","));

        return {url: url.toString(), expiresIn: 600};
    }

    async handleCallback(query: MetaSchema["oauthCallback"]): Promise<MetaConnectionView> {
        this.assertConfigured();

        const {userId, tenantId} = await JwtUtil.verifyOAuthState(query.state);

        if (query.error) {
            throw new BadRequestError(`Meta OAuth denied: ${query.error_description ?? query.error}`);
        }

        if (!query.code) {
            throw new BadRequestError("Missing OAuth code");
        }

        const shortLived = await this.request<GraphTokenResponse>("/oauth/access_token", {
            client_id: Config.meta.appId,
            redirect_uri: Config.meta.redirectUri,
            client_secret: Config.meta.appSecret,
            code: query.code,
        });

        const longLived = await this.request<GraphTokenResponse>("/oauth/access_token", {
            grant_type: "fb_exchange_token",
            client_id: Config.meta.appId,
            client_secret: Config.meta.appSecret,
            fb_exchange_token: shortLived.access_token,
        });

        const accessToken = longLived.access_token;

        const debug = await this.request<GraphDebugResponse>("/debug_token", {
            input_token: accessToken,
            access_token: `${Config.meta.appId}|${Config.meta.appSecret}`,
        });

        if (debug.data?.is_valid !== true) {
            throw new BadRequestError("Meta access token is invalid");
        }

        const me = await this.request<GraphUserResponse>("/me", {
            fields: "id,name",
            access_token: accessToken,
        });

        const metaExpiresAt = debug.data?.expires_at ?? 0;
        const expiresAt = metaExpiresAt > 0
            ? new Date(metaExpiresAt * 1000)
            : longLived.expires_in
                ? new Date(Date.now() + longLived.expires_in * 1000)
                : null;

        const entity = await this.metaConnectionRepository.upsert({
            userId,
            tenantId,
            metaUserId: me.id,
            metaUserName: me.name ?? null,
            accessToken,
            scopes: debug.data.scopes ?? Config.meta.scopes,
            expiresAt,
        });

        return this.toView(entity);
    }

    async findConnection(userId: string): Promise<MetaConnectionView> {
        const entity = await this.metaConnectionRepository.findByUserId(userId);
        if (entity == null) {
            throw new NotFoundError("Meta connection not found");
        }

        return this.toView(entity);
    }

    async disconnect(userId: string): Promise<{ message: string }> {
        const entity = await this.metaConnectionRepository.findByUserId(userId);
        if (entity == null) {
            throw new NotFoundError("Meta connection not found");
        }

        // Revoking at Meta makes the stored token useless even if the row outlives this call; a failed
        // revoke is a warning, not a reason to keep a connection the user asked to remove.
        try {
            await this.request(`/${entity.metaUserId}/permissions`, {access_token: entity.accessToken}, {method: "DELETE"});
        } catch (error) {
            logger.warn({error, userId}, "Failed to revoke Meta token");
        }

        const deleted = await this.metaConnectionRepository.deleteByUserId(userId);
        if (deleted == null) {
            throw new NotFoundError("Meta connection not found");
        }

        return {message: "Meta connection disconnected"};
    }

    async listAccounts(user: { iss: string; tenantId: string }) {
        const connection = await this.metaConnectionRepository.findByUserId(user.iss);
        if (connection == null) {
            throw new UnauthorizedError("Meta connection not found. Please connect your Meta account first.");
        }

        if (connection.expiresAt && connection.expiresAt.getTime() <= Date.now()) {
            throw new UnauthorizedError("Meta access token has expired. Please reconnect.");
        }

        const hasBusinessScope = connection.scopes.includes("business_management");

        // Use customRequest if provided (for backwards-compatibility in existing tests), otherwise use metaAdapter
        if (this.customRequest) {
            const fields = hasBusinessScope
                ? "id,name,currency,timezone_name,account_status,business,currency_offset"
                : "id,name,currency,timezone_name,account_status,currency_offset";

            let response: GraphAdAccountsResponse;
            try {
                response = await this.request<GraphAdAccountsResponse>("/me/adaccounts", {
                    fields,
                    access_token: connection.accessToken,
                    limit: "100",
                });
            } catch (error) {
                if (fields.includes("business")) {
                    response = await this.request<GraphAdAccountsResponse>("/me/adaccounts", {
                        fields: "id,name,currency,timezone_name,account_status,currency_offset",
                        access_token: connection.accessToken,
                        limit: "100",
                    });
                } else {
                    throw error;
                }
            }

            if (response.data && response.data.length > 0) {
                const rows = response.data.map((acc) => ({
                    id: acc.id.startsWith("act_") ? acc.id : `act_${acc.id}`,
                    tenantId: user.tenantId,
                    name: acc.name,
                    currency: acc.currency,
                    currencyOffset: acc.currency_offset ?? 100,
                    timezoneName: acc.timezone_name,
                    accountStatus: acc.account_status ?? null,
                    businessId: acc.business?.id ?? null,
                }));

                await this.adAccountRepository.upsertBatch(rows);
            }
        } else {
            const accounts = await this.metaAdapter.getAdAccounts(connection.accessToken, {
                includeBusiness: hasBusinessScope,
            });

            if (accounts.length > 0) {
                const rows = accounts.map((acc) => ({
                    id: acc.id,
                    tenantId: user.tenantId,
                    name: acc.name,
                    currency: acc.currency,
                    currencyOffset: acc.currencyOffset,
                    timezoneName: acc.timezoneName,
                    accountStatus: acc.accountStatus,
                    businessId: acc.businessId,
                }));

                await this.adAccountRepository.upsertBatch(rows);
            }
        }

        return await this.adAccountRepository.findByTenantId(user.tenantId);
    }

    async selectAccount(user: { iss: string; tenantId: string }, body: MetaSchema["selectAccount"]) {
        const normalizedId = body.accountId.startsWith("act_") ? body.accountId : `act_${body.accountId}`;

        const account = await this.adAccountRepository.findById(normalizedId, user.tenantId);
        if (!account) {
            throw new NotFoundError(`Ad account ${normalizedId} not found in this workspace`);
        }

        const updated = await this.adAccountRepository.selectAccount(user.tenantId, normalizedId);

        return {
            message: "Ad account selected successfully",
            account: updated,
        };
    }

    async getSelectedAccount(user: { iss: string; tenantId: string }) {
        return await this.adAccountRepository.findSelectedByTenantId(user.tenantId);
    }

    /**
     * Walks every page of a Graph edge. With a `cursor` scope the walk is resumable: the position after
     * each page is persisted, a job killed mid-walk restarts at that page instead of page one, and the
     * cursor is deleted once the walk reaches its end. The cursor also remembers how many pages it has
     * already covered, which is what a resumed run reports as skipped.
     */
    async fetchAll<T>(
        path: string,
        params: Record<string, string | undefined>,
        accessToken: string,
        cursor?: SyncCursorScope
    ): Promise<T[]> {
        const rows: T[] = [];
        let pagesWalked = 0;
        let currentPath: string | null = path;
        let currentParams: Record<string, string | undefined> | null = {
            ...params,
            access_token: accessToken,
            limit: params.limit ?? "500",
        };

        if (cursor !== undefined) {
            const saved = await this.syncCursorRepository.find(cursor.accountId, cursor.resource);
            const resumed = saved === null ? null : parseCursor(saved.cursor);
            if (resumed !== null) {
                const nextUrl = new URL(resumed.next);
                currentPath = nextUrl.pathname.replace(/^\/v\d+\.\d+/, "");
                const nextParams: Record<string, string> = {};
                nextUrl.searchParams.forEach((value: string, key: string) => {
                    nextParams[key] = value;
                });
                currentParams = nextParams;
                pagesWalked = resumed.pages;
                cursor.onSkipped?.(resumed.pages);
            }
        }

        while (currentPath) {
            const res: GraphPagedResponse<T> = await this.request<GraphPagedResponse<T>>(
                currentPath,
                currentParams ?? {}
            );

            if (res.data && res.data.length > 0) {
                rows.push(...res.data);
            }

            pagesWalked += 1;

            if (res.paging?.next) {
                const nextUrl: URL = new URL(res.paging.next);
                // Strip Graph API version prefix e.g. /v21.0
                currentPath = nextUrl.pathname.replace(/^\/v\d+\.\d+/, "");
                const nextParams: Record<string, string> = {};
                nextUrl.searchParams.forEach((value: string, key: string) => {
                    nextParams[key] = value;
                });
                currentParams = nextParams;

                if (cursor !== undefined) {
                    await this.syncCursorRepository.save(
                        cursor.accountId,
                        cursor.resource,
                        JSON.stringify({next: res.paging.next, pages: pagesWalked})
                    );
                }
            } else {
                currentPath = null;
                currentParams = null;
            }
        }

        if (cursor !== undefined) {
            await this.syncCursorRepository.clear(cursor.accountId, cursor.resource);
        }

        return rows;
    }

    async resolveTargetAccountId(tenantId: string, requestedAccountId?: string): Promise<string> {
        if (requestedAccountId) {
            const normalized = requestedAccountId.startsWith("act_") ? requestedAccountId : `act_${requestedAccountId}`;
            const account = await this.adAccountRepository.findById(normalized, tenantId);
            if (!account) {
                throw new NotFoundError(`Ad account ${normalized} not found in this workspace database.`);
            }
            return normalized;
        }

        const selected = await this.adAccountRepository.findSelectedByTenantId(tenantId);
        if (selected) {
            return selected.id;
        }

        const accounts = await this.adAccountRepository.findByTenantId(tenantId);
        if (accounts.length > 0) {
            const first = accounts[0];
            await this.adAccountRepository.selectAccount(tenantId, first.id);
            logger.info({tenantId, accountId: first.id}, "Auto-selected first ad account from database");
            return first.id;
        }

        throw new BadRequestError("No ad accounts found in database for this workspace. Please fetch /api/meta/accounts first.");
    }

    async syncMaster(
        user: { iss: string; tenantId: string },
        body?: MetaSchema["syncMaster"] | null
    ) {
        const connection = await this.metaConnectionRepository.findByUserId(user.iss);
        if (connection == null) {
            throw new UnauthorizedError("Meta connection not found. Please connect your Meta account first.");
        }

        if (connection.expiresAt && connection.expiresAt.getTime() <= Date.now()) {
            throw new UnauthorizedError("Meta access token has expired. Please reconnect.");
        }

        const normalizedAccountId = await this.resolveTargetAccountId(user.tenantId, body?.accountId);
        const syncRun = await this.syncRunRepository.create({accountId: normalizedAccountId, resource: "master"});

        try {
            logger.info({accountId: normalizedAccountId}, "Starting Meta master metadata sync");

            let campaignsData;
            let adSetsData;
            let creativesData;
            let adsData;
            // Pages an interrupted earlier run already walked; reported on the sync run.
            let skippedPages = 0;
            const cursorOf = (resource: string): SyncCursorScope => ({
                accountId: normalizedAccountId,
                resource,
                onSkipped: (pages) => {
                    skippedPages += pages;
                },
            });

            if (this.customRequest) {
                // Fallback / legacy customRequest path for custom mock tests
                const rawCampaigns = await this.fetchAll<GraphCampaign>(
                    `/${normalizedAccountId}/campaigns`,
                    {
                        fields: "id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,updated_time",
                    },
                    connection.accessToken,
                    cursorOf("master-campaigns")
                );
                campaignsData = rawCampaigns.map((c) => ({
                    id: c.id,
                    name: c.name,
                    objective: c.objective ?? null,
                    status: c.status ?? null,
                    effectiveStatus: c.effective_status ?? null,
                    buyingType: c.buying_type ?? null,
                    dailyBudgetMinor: c.daily_budget ? Number(c.daily_budget) : null,
                    lifetimeBudgetMinor: c.lifetime_budget ? Number(c.lifetime_budget) : null,
                    budgetRemainingMinor: c.budget_remaining ? Number(c.budget_remaining) : null,
                    startTime: c.start_time ? new Date(c.start_time) : null,
                    stopTime: c.stop_time ? new Date(c.stop_time) : null,
                    createdTime: c.created_time ? new Date(c.created_time) : null,
                    updatedTime: c.updated_time ? new Date(c.updated_time) : null,
                    raw: c as unknown as Record<string, unknown>,
                }));

                const rawAdSets = await this.fetchAll<GraphAdSet>(
                    `/${normalizedAccountId}/adsets`,
                    {
                        fields: "id,name,campaign_id,status,effective_status,optimization_goal,destination_type,billing_event,bid_strategy,bid_amount,daily_budget,lifetime_budget,targeting,start_time,end_time,created_time,updated_time",
                    },
                    connection.accessToken,
                    cursorOf("master-adsets")
                );
                adSetsData = rawAdSets.map((s) => ({
                    id: s.id,
                    name: s.name,
                    campaignId: s.campaign_id,
                    status: s.status ?? null,
                    effectiveStatus: s.effective_status ?? null,
                    optimizationGoal: s.optimization_goal ?? null,
                    destinationType: s.destination_type ?? null,
                    billingEvent: s.billing_event ?? null,
                    bidStrategy: s.bid_strategy ?? null,
                    bidAmountMinor: s.bid_amount ? Number(s.bid_amount) : null,
                    dailyBudgetMinor: s.daily_budget ? Number(s.daily_budget) : null,
                    lifetimeBudgetMinor: s.lifetime_budget ? Number(s.lifetime_budget) : null,
                    targeting: s.targeting ?? null,
                    startTime: s.start_time ? new Date(s.start_time) : null,
                    endTime: s.end_time ? new Date(s.end_time) : null,
                    createdTime: s.created_time ? new Date(s.created_time) : null,
                    updatedTime: s.updated_time ? new Date(s.updated_time) : null,
                    raw: s as unknown as Record<string, unknown>,
                }));

                const rawCreatives = await this.fetchAll<GraphCreative>(
                    `/${normalizedAccountId}/adcreatives`,
                    {
                        fields: "id,name,object_type,status,video_id,image_url,thumbnail_url,object_story_id,body,title,call_to_action_type,url_tags,created_time,updated_time",
                    },
                    connection.accessToken,
                    cursorOf("master-creatives")
                );

                const videoDetailsMap = new Map<string, GraphVideo>();
                const videoIds = Array.from(new Set(rawCreatives.map((cr) => cr.video_id).filter((id): id is string => Boolean(id))));

                await Promise.allSettled(
                    videoIds.map(async (videoId) => {
                        try {
                            const video = await this.request<GraphVideo>(`/${videoId}`, {
                                fields: "id,length,permalink_url",
                                access_token: connection.accessToken,
                            });
                            videoDetailsMap.set(videoId, video);
                        } catch (err) {
                            logger.warn({videoId, err}, "Failed to fetch video details for creative");
                        }
                    })
                );

                creativesData = rawCreatives.map((cr) => {
                    const video = cr.video_id ? videoDetailsMap.get(cr.video_id) : undefined;
                    return {
                        id: cr.id,
                        name: cr.name ?? null,
                        objectType: cr.object_type ?? null,
                        status: cr.status ?? null,
                        videoId: cr.video_id ?? null,
                        videoLengthSeconds: video?.length != null ? String(video.length) : null,
                        videoPermalinkUrl: video?.permalink_url ?? null,
                        imageUrl: cr.image_url ?? null,
                        thumbnailUrl: cr.thumbnail_url ?? null,
                        objectStoryId: cr.object_story_id ?? null,
                        body: cr.body ?? null,
                        title: cr.title ?? null,
                        callToActionType: cr.call_to_action_type ?? null,
                        urlTags: cr.url_tags ?? null,
                        createdTime: cr.created_time ? new Date(cr.created_time) : null,
                        updatedTime: cr.updated_time ? new Date(cr.updated_time) : null,
                        raw: cr as unknown as Record<string, unknown>,
                    };
                });

                const rawAds = await this.fetchAll<GraphAd>(
                    `/${normalizedAccountId}/ads`,
                    {
                        fields: "id,name,campaign_id,adset_id,status,effective_status,creative,created_time,updated_time",
                    },
                    connection.accessToken,
                    cursorOf("master-ads")
                );
                adsData = rawAds.map((ad) => ({
                    id: ad.id,
                    name: ad.name,
                    campaignId: ad.campaign_id,
                    adsetId: ad.adset_id,
                    creativeId: ad.creative?.id ?? null,
                    status: ad.status ?? null,
                    effectiveStatus: ad.effective_status ?? null,
                    createdTime: ad.created_time ? new Date(ad.created_time) : null,
                    updatedTime: ad.updated_time ? new Date(ad.updated_time) : null,
                    raw: ad as unknown as Record<string, unknown>,
                }));
            } else {
                // Meta SDK Adapter path
                campaignsData = await this.metaAdapter.getCampaigns(connection.accessToken, normalizedAccountId);
                adSetsData = await this.metaAdapter.getAdSets(connection.accessToken, normalizedAccountId);
                const rawCreatives = await this.metaAdapter.getAdCreatives(connection.accessToken, normalizedAccountId);

                // Fetch video details for creatives that have a video_id
                const videoDetailsMap = new Map<string, { length: number | null; permalinkUrl: string | null }>();
                const videoIds = Array.from(new Set(rawCreatives.map((cr) => cr.videoId).filter((id): id is string => Boolean(id))));

                await Promise.allSettled(
                    videoIds.map(async (videoId) => {
                        const video = await this.metaAdapter.getVideoDetails(connection.accessToken, videoId);
                        if (video) {
                            videoDetailsMap.set(videoId, video);
                        }
                    })
                );

                creativesData = rawCreatives.map((cr) => {
                    const video = cr.videoId ? videoDetailsMap.get(cr.videoId) : undefined;
                    return {
                        ...cr,
                        videoLengthSeconds: video?.length != null ? String(video.length) : null,
                        videoPermalinkUrl: video?.permalinkUrl ?? null,
                    };
                });

                adsData = await this.metaAdapter.getAds(connection.accessToken, normalizedAccountId);
            }

            // 1. Persist Campaigns
            const campaigns = campaignsData.map((c) => ({
                id: c.id,
                accountId: normalizedAccountId,
                name: c.name,
                objective: c.objective,
                status: c.status,
                effectiveStatus: c.effectiveStatus,
                buyingType: c.buyingType,
                dailyBudgetMinor: c.dailyBudgetMinor,
                lifetimeBudgetMinor: c.lifetimeBudgetMinor,
                budgetRemainingMinor: c.budgetRemainingMinor,
                startTime: c.startTime,
                stopTime: c.stopTime,
                createdTime: c.createdTime,
                updatedTime: c.updatedTime,
                raw: c.raw,
            }));
            await this.campaignRepository.upsertBatch(campaigns);

            // 2. Persist AdSets
            const adSets = adSetsData.map((s) => ({
                id: s.id,
                accountId: normalizedAccountId,
                campaignId: s.campaignId,
                name: s.name,
                status: s.status,
                effectiveStatus: s.effectiveStatus,
                optimizationGoal: s.optimizationGoal,
                objectiveGroup: deriveObjectiveGroup(s.optimizationGoal, s.destinationType),
                billingEvent: s.billingEvent,
                bidStrategy: s.bidStrategy,
                bidAmountMinor: s.bidAmountMinor,
                dailyBudgetMinor: s.dailyBudgetMinor,
                lifetimeBudgetMinor: s.lifetimeBudgetMinor,
                targeting: s.targeting,
                startTime: s.startTime,
                endTime: s.endTime,
                createdTime: s.createdTime,
                updatedTime: s.updatedTime,
                raw: s.raw,
            }));
            await this.adSetRepository.upsertBatch(adSets);

            // 3. Persist AdCreatives
            const creatives = creativesData.map((cr) => ({
                id: cr.id,
                accountId: normalizedAccountId,
                name: cr.name,
                objectType: cr.objectType,
                status: cr.status,
                videoId: cr.videoId,
                videoLengthSeconds: cr.videoLengthSeconds,
                videoPermalinkUrl: cr.videoPermalinkUrl,
                imageUrl: cr.imageUrl,
                thumbnailUrl: cr.thumbnailUrl,
                objectStoryId: cr.objectStoryId,
                body: cr.body,
                title: cr.title,
                callToActionType: cr.callToActionType,
                urlTags: cr.urlTags,
                createdTime: cr.createdTime,
                updatedTime: cr.updatedTime,
                raw: cr.raw,
            }));
            await this.adCreativeRepository.upsertBatch(creatives);

            // 4. Persist Ads
            const validCreativeIds = new Set(creatives.map((c) => c.id));
            const ads = adsData.map((ad) => ({
                id: ad.id,
                accountId: normalizedAccountId,
                campaignId: ad.campaignId,
                adsetId: ad.adsetId,
                creativeId: ad.creativeId && validCreativeIds.has(ad.creativeId) ? ad.creativeId : null,
                name: ad.name,
                status: ad.status,
                effectiveStatus: ad.effectiveStatus,
                createdTime: ad.createdTime,
                updatedTime: ad.updatedTime,
                raw: ad.raw,
            }));
            await this.adRepository.upsertBatch(ads);

            const totalRows = campaigns.length + adSets.length + creatives.length + ads.length;
            await this.syncRunRepository.complete(syncRun.id, totalRows, skippedPages);

            logger.info({accountId: normalizedAccountId, totalRows}, "Meta master metadata sync completed");

            return {
                message: "Master metadata synchronized successfully",
                accountId: normalizedAccountId,
                counts: {
                    campaigns: campaigns.length,
                    adSets: adSets.length,
                    creatives: creatives.length,
                    ads: ads.length,
                },
            };
        } catch (error) {
            const errMessage = error instanceof Error ? error.message : String(error);
            await this.syncRunRepository.fail(syncRun.id, errMessage);
            logger.error({accountId: normalizedAccountId, error: errMessage}, "Meta master metadata sync failed");
            throw error;
        }
    }

    async syncInsights(
        user: { iss: string; tenantId: string },
        body?: MetaSchema["syncInsights"] | null
    ) {
        const connection = await this.metaConnectionRepository.findByUserId(user.iss);
        if (connection == null) {
            throw new UnauthorizedError("Meta connection not found. Please connect your Meta account first.");
        }

        if (connection.expiresAt && connection.expiresAt.getTime() <= Date.now()) {
            throw new UnauthorizedError("Meta access token has expired. Please reconnect.");
        }

        const normalizedAccountId = await this.resolveTargetAccountId(user.tenantId, body?.accountId);
        const account = await this.adAccountRepository.findById(normalizedAccountId, user.tenantId);

        const currency = account?.currency ?? "IDR";
        const currencyOffset = account?.currencyOffset ?? 100;

        const today = new Date();
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const since = body?.since ?? thirtyDaysAgo.toISOString().slice(0, 10);
        const until = body?.until ?? today.toISOString().slice(0, 10);
        const includeBreakdowns = body?.includeBreakdowns ?? true;

        const syncRun = await this.syncRunRepository.create({
            accountId: normalizedAccountId,
            resource: "insights",
            rangeSince: since,
            rangeUntil: until,
        });

        try {
            logger.info({accountId: normalizedAccountId, since, until}, "Starting Meta ads insights sync");

            // 1. Fetch daily insights level 'ad'
            const dailyData = await this.metaAdapter.getDailyAdInsights(
                connection.accessToken,
                normalizedAccountId,
                {since, until, currency, currencyOffset}
            );

            const dailyRows: UpsertInsightDailyParams[] = dailyData.map((d) => ({
                accountId: d.accountId,
                level: d.level,
                entityId: d.entityId,
                campaignId: d.campaignId,
                adsetId: d.adsetId,
                adId: d.adId,
                date: d.date,
                attributionWindow: d.attributionWindow,
                currency: d.currency,
                currencyOffset: d.currencyOffset,
                spendMinor: d.spendMinor,
                impressions: d.impressions,
                reach: d.reach,
                frequency: d.frequency,
                clicks: d.clicks,
                inlineLinkClicks: d.inlineLinkClicks,
                uniqueClicks: d.uniqueClicks,
                ctr: d.ctr,
                cpcMinor: d.cpcMinor,
                cpmMinor: d.cpmMinor,
                actionValues: d.actionValues,
                costPerActionType: d.costPerActionType,
                videoPlayActions: d.videoPlayActions,
                video30SecWatchedActions: d.video30SecWatchedActions,
                videoThruplayWatchedActions: d.videoThruplayWatchedActions,
                videoP25WatchedActions: d.videoP25WatchedActions,
                videoP50WatchedActions: d.videoP50WatchedActions,
                videoP75WatchedActions: d.videoP75WatchedActions,
                videoP100WatchedActions: d.videoP100WatchedActions,
                videoAvgTimeWatchedSeconds: d.videoAvgTimeWatchedSeconds,
                graphVersion: d.graphVersion,
                actionReportTime: d.actionReportTime,
                video3SecWatchedActions: d.video3SecWatchedActions,
                isFinal: d.isFinal,
                actions: d.extractedActions,
            }));

            await this.insightStagingRepository.write(syncRun.id, "insight_daily", dailyRows);

            // 2. Fetch daily breakdowns if requested
            if (includeBreakdowns) {
                const breakdownData = await this.metaAdapter.getDailyAdBreakdowns(
                    connection.accessToken,
                    normalizedAccountId,
                    {since, until, currencyOffset}
                );

                const breakdownRows: InsertAdInsightBreakdownDaily[] = breakdownData.map((b) => ({
                    accountId: b.accountId,
                    level: b.level,
                    entityId: b.entityId,
                    campaignId: b.campaignId,
                    adsetId: b.adsetId,
                    adId: b.adId,
                    date: b.date,
                    attributionWindow: b.attributionWindow,
                    publisherPlatform: b.publisherPlatform,
                    platformPosition: b.platformPosition,
                    impressionDevice: b.impressionDevice,
                    hourOfDay: b.hourOfDay,
                    age: b.age,
                    gender: b.gender,
                    country: b.country,
                    region: b.region,
                    breakdownHash: b.breakdownHash,
                    spendMinor: b.spendMinor,
                    impressions: b.impressions,
                    reach: b.reach,
                    clicks: b.clicks,
                    inlineLinkClicks: b.inlineLinkClicks,
                    actions: b.actions,
                    actionValues: b.actionValues,
                }));

                await this.insightStagingRepository.write(syncRun.id, "insight_breakdown", breakdownRows);
            }

            // 3. Publish the whole slice atomically (rows + sync run status)
            const published = await this.insightStagingRepository.publishCompleteSlice({
                runId: syncRun.id,
                accountId: normalizedAccountId,
                since,
                until,
                kinds: includeBreakdowns ? ["insight_daily", "insight_breakdown"] : ["insight_daily"],
            });

            logger.info(
                {accountId: normalizedAccountId, published},
                "Meta ads insights sync completed"
            );

            return {
                message: "Ads insights synchronized successfully",
                accountId: normalizedAccountId,
                since,
                until,
                counts: {
                    dailyInsights: published.dailyInsights,
                    breakdowns: published.breakdowns,
                    total: published.total,
                },
            };
        } catch (error) {
            const errMessage = error instanceof Error ? error.message : String(error);
            await this.insightStagingRepository.cleanup(syncRun.id).catch((cleanupError) => {
                logger.warn({cleanupError, runId: syncRun.id}, "Failed to clean insight staging");
            });
            await this.syncRunRepository.fail(syncRun.id, errMessage);
            logger.error({accountId: normalizedAccountId, error: errMessage}, "Meta ads insights sync failed");
            throw error;
        }
    }

    async syncHourlyBreakdowns(
        user: { iss: string; tenantId: string },
        body?: { accountId?: string; since?: string; until?: string } | null
    ) {
        const connection = await this.metaConnectionRepository.findByUserId(user.iss);
        if (connection == null) {
            throw new UnauthorizedError("Meta connection not found. Please connect your Meta account first.");
        }

        if (connection.expiresAt && connection.expiresAt.getTime() <= Date.now()) {
            throw new UnauthorizedError("Meta access token has expired. Please reconnect.");
        }

        const normalizedAccountId = await this.resolveTargetAccountId(user.tenantId, body?.accountId);
        const account = await this.adAccountRepository.findById(normalizedAccountId, user.tenantId);
        const currencyOffset = account?.currencyOffset ?? 100;

        const until = body?.until ?? new Date().toISOString().slice(0, 10);
        const since = body?.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const syncRun = await this.syncRunRepository.create({
            accountId: normalizedAccountId,
            resource: "insights-hourly",
            rangeSince: since,
            rangeUntil: until,
        });

        try {
            logger.info({accountId: normalizedAccountId, since, until}, "Starting Meta hourly breakdown sync");

            const hourlyData = await this.metaAdapter.getHourlyAdBreakdowns(
                connection.accessToken,
                normalizedAccountId,
                {since, until, currencyOffset}
            );

            const rows: InsertAdInsightBreakdownDaily[] = hourlyData.map((b) => ({
                accountId: b.accountId,
                level: b.level,
                entityId: b.entityId,
                campaignId: b.campaignId,
                adsetId: b.adsetId,
                adId: b.adId,
                date: b.date,
                attributionWindow: b.attributionWindow,
                publisherPlatform: b.publisherPlatform,
                platformPosition: b.platformPosition,
                impressionDevice: b.impressionDevice,
                hourOfDay: b.hourOfDay,
                age: b.age,
                gender: b.gender,
                country: b.country,
                region: b.region,
                breakdownHash: b.breakdownHash,
                spendMinor: b.spendMinor,
                impressions: b.impressions,
                reach: b.reach,
                clicks: b.clicks,
                inlineLinkClicks: b.inlineLinkClicks,
                actions: b.actions,
                actionValues: b.actionValues,
            }));

            await this.insightStagingRepository.write(syncRun.id, "insight_breakdown_hourly", rows);

            const published = await this.insightStagingRepository.publishCompleteSlice({
                runId: syncRun.id,
                accountId: normalizedAccountId,
                since,
                until,
                kinds: ["insight_breakdown_hourly"],
            });

            logger.info({accountId: normalizedAccountId, published}, "Meta hourly breakdown sync completed");

            return {
                message: "Hourly breakdowns synchronized successfully",
                accountId: normalizedAccountId,
                since,
                until,
                counts: {
                    breakdowns: published.breakdowns,
                    total: published.total,
                },
            };
        } catch (error) {
            const errMessage = error instanceof Error ? error.message : String(error);
            await this.insightStagingRepository.cleanup(syncRun.id).catch((cleanupError) => {
                logger.warn({cleanupError, runId: syncRun.id}, "Failed to clean insight staging");
            });
            await this.syncRunRepository.fail(syncRun.id, errMessage);
            logger.error({accountId: normalizedAccountId, error: errMessage}, "Meta hourly breakdown sync failed");
            throw error;
        }
    }

    async getNonAdditiveMetrics(
        user: { iss: string; tenantId: string },
        params: MetaSchema["nonAdditiveMetrics"]
    ) {
        const connection = await this.metaConnectionRepository.findByUserId(user.iss);
        if (connection == null) {
            throw new UnauthorizedError("Meta connection not found. Please connect your Meta account first.");
        }

        if (connection.expiresAt && connection.expiresAt.getTime() <= Date.now()) {
            throw new UnauthorizedError("Meta access token has expired. Please reconnect.");
        }

        const normalizedAccountId = await this.resolveTargetAccountId(user.tenantId, params.accountId);
        const account = await this.adAccountRepository.findById(normalizedAccountId, user.tenantId);
        const currencyOffset = account?.currencyOffset ?? 100;
        const level = params.level ?? "account";

        const metrics = await this.metaAdapter.getCustomPeriodMetrics(
            connection.accessToken,
            normalizedAccountId,
            {
                level,
                entityId: params.entityId,
                since: params.since,
                until: params.until,
                currencyOffset,
            }
        );

        if (!metrics) {
            throw new NotFoundError("No metrics found for specified entity and period");
        }

        return metrics;
    }

    private assertConfigured() {
        const {appId, appSecret} = Config.meta;
        if (!appId || !appSecret || appId === "APP_ID" || appSecret === "APP_SECRET") {
            throw new InternalError("Meta OAuth is not configured: set META_APP_ID and META_APP_SECRET");
        }
    }

    protected async request<T>(
        path: string,
        params: Record<string, string | undefined>,
        init?: RequestInit
    ): Promise<T> {
        if (this.customRequest) {
            return this.customRequest<T>(path, params, init);
        }

        const url = new URL(`${GRAPH_URL}/${Config.meta.apiVersion}${path}`);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                url.searchParams.set(key, value);
            }
        }

        let response: Response;
        try {
            response = await fetch(url, init);
        } catch {
            throw new InternalError("Failed to reach Meta API");
        }

        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;

        if (!response.ok || body?.error) {
            throw new BadRequestError(`Meta API error: ${body?.error?.message ?? response.statusText}`);
        }

        return body as T;
    }

    private toView(entity: typeof MetaConnectionEntity.$inferSelect): MetaConnectionView {
        return {
            id: entity.id,
            metaUserId: entity.metaUserId,
            metaUserName: entity.metaUserName,
            scopes: entity.scopes,
            expiresAt: entity.expiresAt,
            connectedAt: entity.createdAt,
            isExpired: entity.expiresAt != null && entity.expiresAt.getTime() <= Date.now(),
        }
    }
}
