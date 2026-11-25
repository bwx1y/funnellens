import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {TrackingHealthService} from "@/modules/tracking-health/service";
import {TrackingHealthSchema} from "@/modules/tracking-health/schema";

export const TrackingHealthController = new Elysia({
    prefix: "/tracking-health",
    detail: {
        tags: ["Tracking"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("trackingHealthService", new TrackingHealthService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        async ({user, query, trackingHealthService}) =>
            trackingHealthService.getTrackingHealth(user.tenantId, query),
        {
            query: TrackingHealthSchema.health,
            detail: {
                summary: "Get pixel, CAPI, EMQ, and event tracking health"
            }
        });
