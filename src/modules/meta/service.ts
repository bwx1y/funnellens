import {Config} from "@/config";
import {MetaConnectionEntity} from "@/database/entity/meta-connection.entity";
import {MetaConnectionRepository} from "@/database/repository/meta-connection.repository";
import {BadRequestError, InternalError, NotFoundError} from "@/utils/error";
import {JwtUtil} from "@/utils/jwt";
import {logger} from "@/utils/logger";
import type {MetaSchema} from "@/modules/meta/schema";

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

export class MetaService {
    private readonly metaConnectionRepository = new MetaConnectionRepository();

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

        try {
            await this.request("/me/permissions", {access_token: entity.accessToken}, {method: "DELETE"});
        } catch (error) {
            logger.warn({error, userId}, "Failed to revoke Meta token");
        }

        const deleted = await this.metaConnectionRepository.deleteByUserId(userId);
        if (deleted == null) {
            throw new NotFoundError("Meta connection not found");
        }

        return {message: "Meta connection disconnected"};
    }

    private assertConfigured() {
        const {appId, appSecret} = Config.meta;
        if (!appId || !appSecret || appId === "APP_ID" || appSecret === "APP_SECRET") {
            throw new InternalError("Meta OAuth is not configured: set META_APP_ID and META_APP_SECRET");
        }
    }

    private async request<T>(
        path: string,
        params: Record<string, string | undefined>,
        init?: RequestInit
    ): Promise<T> {
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
