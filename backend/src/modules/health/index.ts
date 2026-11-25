import {Elysia} from "elysia";
import {HealthService} from "@/modules/health/service";

/**
 * Deliberately unauthenticated and outside the `/api` prefix's auth chain: an orchestrator has no JWT,
 * and a probe behind auth reports "unhealthy" whenever the auth layer itself is the problem.
 */
export const HealthController = new Elysia({
    detail: {
        tags: ["Health"],
    },
})
    .decorate("healthService", new HealthService())
    .get("/healthz",
        ({healthService}) => healthService.liveness(),
        {
            detail: {
                summary: "Liveness probe; never touches a dependency"
            }
        })
    .get("/readyz",
        async ({healthService, set}) => {
            const result = await healthService.readiness();
            if (!result.status) set.status = 503;
            return result;
        },
        {
            detail: {
                summary: "Readiness probe for database, Redis, and sync freshness"
            }
        });
