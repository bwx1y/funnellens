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
        async ({user, query, analyticsService}) => analyticsService.getSummary(user.tenantId, query),
        {
            query: AnalyticsSchema.summary,
            detail: {
                summary: "Get overview summary (KPI cards, health, trend, campaigns)"
            }
        })
