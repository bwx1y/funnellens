import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {AnalyticsService} from "@/modules/analytics/service";
import {AnalyticsSchema} from "@/modules/analytics/schema";

export const AnalyticsController = new Elysia({
    prefix: "/analytics",
    detail: {
        tags: ["Analytics"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("analyticsService", new AnalyticsService())
    .use(JwtUtil.isAuthenticated)
    .get("/summary",
        // `request` lets the service flag a cache hit, which the envelope reports as `meta.cached`.
        async ({user, query, analyticsService, request}) =>
            analyticsService.getSummary(user.tenantId, query, request),
        {
            query: AnalyticsSchema.summary,
            detail: {
                summary: "Get overview summary (KPI cards, health, trend, campaigns)"
            }
        })
    .get("/funnel",
        async ({user, query, analyticsService, request}) =>
            analyticsService.getFunnel(user.tenantId, query, request),
        {
            query: AnalyticsSchema.funnel,
            detail: {
                summary: "Get funnel stages per channel with period-over-period pairs"
            }
        })
    .get("/funnel/stage-detail",
        async ({user, query, analyticsService}) => analyticsService.getStageDetail(user.tenantId, query),
        {
            query: AnalyticsSchema.stageDetail,
            detail: {
                summary: "Get daily trend and comparison table for one funnel stage"
            }
        })
    .get("/leakage",
        async ({user, query, analyticsService, request}) =>
            analyticsService.getLeakage(user.tenantId, query, request),
        {
            query: AnalyticsSchema.leakage,
            detail: {
                summary: "Get the weakest eligible funnel transition"
            }
        })
    .get("/leaks/history",
        async ({user, query, analyticsService}) => analyticsService.getLeakHistory(user.tenantId, query),
        {
            query: AnalyticsSchema.leakHistory,
            detail: {
                summary: "Get the weakest transition of each of the last four periods"
            }
        })
