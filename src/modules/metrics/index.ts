import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {requireAdmin} from "@shared/guards";
import {renderMetrics} from "@infra/metrics";

/**
 * Prometheus scrape target. Admin-only because request rates and route inventory describe the whole
 * deployment, not one workspace.
 */
export const MetricsController = new Elysia({
    prefix: "/metrics",
    detail: {
        tags: ["Ops"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .use(JwtUtil.isAuthenticated)
    .use(requireAdmin)
    .get("/",
        ({set}) => {
            set.headers["content-type"] = "text/plain; version=0.0.4; charset=utf-8";
            return renderMetrics();
        },
        {
            detail: {
                summary: "Prometheus text exposition of request counters and latency"
            }
        });
