import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {AlertService} from "@/modules/alerts/service";
import {AlertsSchema} from "@/modules/alerts/schema";

export const AlertsController = new Elysia({
    prefix: "/alerts",
    detail: {
        tags: ["Alerts"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("alertService", new AlertService())
    .use(JwtUtil.isAuthenticated)
    .get("/badge",
        async ({user, query, alertService}) => alertService.badge(user.tenantId, query),
        {
            query: AlertsSchema.badge,
            detail: {
                summary: "Count active alerts for the badge"
            }
        })
    .get("/",
        async ({user, query, alertService}) => alertService.list(user.tenantId, query),
        {
            query: AlertsSchema.list,
            detail: {
                summary: "List alerts by status"
            }
        })
    .patch("/:id/snooze",
        async ({user, params: {id}, body, alertService}) => alertService.snooze(user.tenantId, Number(id), body),
        {
            params: AlertsSchema.params,
            body: AlertsSchema.snooze,
            detail: {
                summary: "Snooze an alert for 24 or 168 hours"
            }
        })
    .patch("/:id/resolve",
        async ({user, params: {id}, alertService}) => alertService.resolve(user.tenantId, Number(id), user.iss),
        {
            params: AlertsSchema.params,
            detail: {
                summary: "Resolve an alert"
            }
        });
