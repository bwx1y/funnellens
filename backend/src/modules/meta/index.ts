import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {MetaService} from "@/modules/meta/service";
import {MetaSchema} from "@/modules/meta/schema";
import {MetaSyncQueue} from "@/modules/meta/queue";
import {MetaSyncDlq} from "@/modules/meta/dlq";
import {NotFoundError} from "@shared/errors";
import {requireAdmin} from "@shared/guards";

const metaService = new MetaService();
const metaSyncQueue = new MetaSyncQueue();
const metaSyncDlq = new MetaSyncDlq();

// callback is public: Meta redirects the browser here without our JWT
export const MetaOAuthController = new Elysia({
    prefix: "/meta/oauth",
    detail: {
        tags: ["Meta Ads"]
    }
})
    .get("/callback",
        async ({query}) => metaService.handleCallback(query),
        {
            query: MetaSchema.oauthCallback,
            detail: {
                summary: "Meta OAuth callback"
            }
        })

export const MetaController = new Elysia({
    prefix: "/meta",
    detail: {
        tags: ["Meta Ads"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .use(JwtUtil.isAuthenticated)
    .get("/oauth/url",
        async ({user}) => metaService.authorizationUrl(user),
        {
            detail: {
                summary: "Get Meta OAuth authorization URL"
            }
        })
    .get("/connection",
        async ({user}) => metaService.findConnection(user.iss),
        {
            detail: {
                summary: "Get current user Meta connection"
            }
        })
    .get("/accounts",
        async ({user}) => metaService.listAccounts(user),
        {
            detail: {
                summary: "List and sync Meta ad accounts for workspace"
            }
        })
    .get("/accounts/selected",
        async ({user}) => metaService.getSelectedAccount(user),
        {
            detail: {
                summary: "Get currently selected Meta ad account"
            }
        })
    .get("/insights/non-additive",
        async ({user, query}) => metaService.getNonAdditiveMetrics(user, query),
        {
            query: MetaSchema.nonAdditiveMetrics,
            detail: {
                summary: "Get server-side deduplicated non-additive metrics (reach, frequency) from Meta"
            }
        })
    // Everything below mutates the workspace's Meta connection or enqueues sync work.
    .use(requireAdmin)
    .delete("/connection",
        async ({user}) => metaService.disconnect(user.iss),
        {
            detail: {
                summary: "Disconnect Meta connection (ADMIN)"
            }
        })
    .post("/accounts/select",
        async ({user, body}) => metaService.selectAccount(user, body),
        {
            body: MetaSchema.selectAccount,
            detail: {
                summary: "Select active Meta ad account for workspace (ADMIN)"
            }
        })
    .post("/sync/master",
        async ({user, body}) => metaService.syncMaster(user, body),
        {
            body: MetaSchema.syncMaster,
            detail: {
                summary: "Synchronize master metadata (campaigns, adsets, creatives, ads)"
            }
        })
    .post("/sync/insights",
        async ({user, body}) => metaService.syncInsights(user, body),
        {
            body: MetaSchema.syncInsights,
            detail: {
                summary: "Synchronize daily ads insights, actions, and breakdowns"
            }
        })
    .post("/queue/sync-daily",
        async ({user, body}) => {
            await metaSyncQueue.add("sync-daily", {
                userId: user.iss,
                tenantId: user.tenantId,
                accountId: body?.accountId,
            });
            return {message: "Daily sync job queued successfully"};
        },
        {
            body: MetaSchema.queueDailySync,
            detail: {
                summary: "Enqueue background daily sync job"
            }
        })
    .post("/queue/re-sync-trailing",
        async ({user, body}) => {
            await metaSyncQueue.add("re-sync-trailing", {
                userId: user.iss,
                tenantId: user.tenantId,
                accountId: body?.accountId,
                daysBack: 28,
            });
            return {message: "Trailing 28-day re-sync job queued successfully"};
        },
        {
            body: MetaSchema.queueTrailingSync,
            detail: {
                summary: "Enqueue background trailing 28-day re-sync job"
            }
        })
    .post("/queue/sync-pixels",
        async ({user, body}) => {
            await metaSyncQueue.add("sync-pixel-stats", {
                userId: user.iss,
                tenantId: user.tenantId,
                accountId: body?.accountId,
            });
            return {message: "Pixel stats sync job queued successfully"};
        },
        {
            body: MetaSchema.queuePixelStatsSync,
            detail: {
                summary: "Enqueue background pixel stats sync job"
            }
        })
    .get("/queue/dlq",
        async () => metaSyncDlq.list(),
        {
            detail: {
                summary: "List the last 50 dead-lettered Meta sync jobs"
            }
        })
    .delete("/queue/dlq/:id",
        async ({params: {id}}) => {
            const removed = await metaSyncDlq.remove(id);
            if (!removed) throw new NotFoundError("Entri DLQ tidak ditemukan");

            return {deleted: true, id};
        },
        {
            params: MetaSchema.dlqParams,
            detail: {
                summary: "Drop a handled dead-letter entry"
            }
        });
