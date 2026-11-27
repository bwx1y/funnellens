import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {BadRequestError} from "@shared/errors";
import {InsightService} from "@/modules/insights/service";
import {InsightSchema} from "@/modules/insights/schema";

/** The same lowercase header the global plugin reads; a retry is answered before this handler runs. */
const IDEMPOTENCY_HEADER = "idempotency-key";

export const InsightController = new Elysia({
    prefix: "/insights",
    detail: {
        tags: ["Insights"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("insightService", new InsightService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        async ({user, query, insightService}) => insightService.list(user.tenantId, user.iss, query),
        {
            query: InsightSchema.list,
            detail: {
                summary: "List insights by review tab (active or done) for the caller"
            }
        })
    // Static path before `/:key/...`: even though Elysia prefers static routes, keeping the order
    // explicit means a later `:key` route can never shadow the badge.
    .get("/unread-count",
        async ({user, query, insightService}) => insightService.unreadCount(user.tenantId, user.iss, query),
        {
            query: InsightSchema.unread,
            detail: {
                summary: "Count the caller's unread insights in the active tab"
            }
        })
    .patch("/:key/review",
        async ({user, params: {key}, body, headers, insightService}) => {
            const idempotencyKey = headers[IDEMPOTENCY_HEADER]?.trim();
            if (idempotencyKey === undefined || idempotencyKey === "") {
                throw new BadRequestError("Header Idempotency-Key wajib diisi", "IDEMPOTENCY_KEY_REQUIRED");
            }

            return insightService.review(user.tenantId, user.iss, key, body);
        },
        {
            params: InsightSchema.params,
            body: InsightSchema.review,
            detail: {
                summary: "Mark one insight read, done, or active for the caller"
            }
        })
    .get("/:key/history",
        async ({user, params: {key}, insightService}) =>
            insightService.history(user.tenantId, user.iss, key),
        {
            params: InsightSchema.params,
            detail: {
                summary: "The caller's review history for one insight"
            }
        });
