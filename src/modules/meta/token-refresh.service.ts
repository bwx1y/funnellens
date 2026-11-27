import {Config} from "@/config";
import {logger} from "@shared/logger";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";

const GRAPH_URL = "https://graph.facebook.com";

/** Refresh inside this window; Meta invalidates a token without warning, so a week is the safety margin. */
export const TOKEN_REFRESH_WINDOW_DAYS = 7;

interface TokenExchangeResponse {
    access_token: string;
    expires_in?: number;
}

export interface TokenRefreshResult {
    tenantId: string;
    refreshed: boolean;
    expiresAt: string | null;
    error?: string;
}

/**
 * Trades a still-valid token for a long-lived one (`grant_type=fb_exchange_token`). Meta does not issue
 * refresh tokens for this flow, so the only way to keep a connection alive is to renew before expiry.
 *
 * A failed refresh is logged and reported, never thrown: one dead connection must not stop the job from
 * refreshing the others.
 */
export class MetaTokenRefreshService {
    constructor(
        private readonly connectionRepo = new MetaConnectionRepository(),
        private readonly request: GraphRequester = fetchGraph
    ) {}

    async refreshExpiring(now: Date = new Date()): Promise<TokenRefreshResult[]> {
        const threshold = new Date(now.getTime() + TOKEN_REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const connections = await this.connectionRepo.findExpiringBefore(threshold);
        const results: TokenRefreshResult[] = [];

        for (const connection of connections) {
            try {
                const exchanged = await this.request<TokenExchangeResponse>("/oauth/access_token", {
                    grant_type: "fb_exchange_token",
                    client_id: Config.meta.appId,
                    client_secret: Config.meta.appSecret,
                    fb_exchange_token: connection.accessToken,
                });

                const expiresAt = exchanged.expires_in === undefined
                    ? null
                    : new Date(now.getTime() + exchanged.expires_in * 1000);

                const updated = await this.connectionRepo.updateTokens(connection.id, {
                    accessToken: exchanged.access_token,
                    expiresAt,
                });

                results.push({
                    tenantId: connection.tenantId,
                    refreshed: true,
                    expiresAt: updated?.expiresAt?.toISOString() ?? null,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn({err: error, tenantId: connection.tenantId}, "Meta token refresh failed");
                results.push({
                    tenantId: connection.tenantId,
                    refreshed: false,
                    expiresAt: connection.expiresAt?.toISOString() ?? null,
                    error: message,
                });
            }
        }

        return results;
    }
}

type GraphRequester = <T>(path: string, params: Record<string, string | undefined>) => Promise<T>;

async function fetchGraph<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${GRAPH_URL}/${Config.meta.apiVersion}${path}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value);
    }

    const response = await fetch(url);
    const body = await response.json().catch(() => null) as {error?: {message?: string}} | null;
    if (!response.ok || body?.error) {
        throw new Error(`Meta token exchange failed: ${body?.error?.message ?? response.statusText}`);
    }

    return body as T;
}
