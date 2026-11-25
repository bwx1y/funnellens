import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {requireAdmin} from "@shared/guards";
import {AudienceService} from "@/modules/audience/service";
import {AudienceSchema} from "@/modules/audience/schema";

export const AudienceController = new Elysia({
    prefix: "/analytics/audience",
    detail: {
        tags: ["Audience"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("audienceService", new AudienceService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        async ({user, query, audienceService}) => audienceService.getAudience(user.tenantId, query),
        {
            query: AudienceSchema.audience,
            detail: {
                summary: "Get temperature distribution, cohort flow, and campaign hot-lead ranking"
            }
        })
    .get("/speed",
        async ({user, query, audienceService}) => audienceService.getSpeed(user.tenantId, query),
        {
            query: AudienceSchema.speed,
            detail: {
                summary: "Get first-reply speed KPIs, response buckets, and cohort heatmap"
            }
        })
    .get("/segments",
        async ({user, query, audienceService}) => audienceService.getSegments(user.tenantId, query),
        {
            query: AudienceSchema.segments,
            detail: {
                summary: "Get placement, device, and hour segmentation"
            }
        })
    .get("/pipeline",
        async ({user, query, audienceService}) => audienceService.getPipeline(user.tenantId, query),
        {
            query: AudienceSchema.pipeline,
            detail: {
                summary: "Get the latest applied assessment per lead"
            }
        })
    .get("/conversations",
        async ({user, query, audienceService}) => audienceService.getConversations(user.tenantId, query),
        {
            query: AudienceSchema.conversations,
            detail: {
                summary: "Get reply-type counts, timed insights, and sentiment"
            }
        });

export const LeadController = new Elysia({
    prefix: "/leads",
    detail: {
        tags: ["Leads"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("audienceService", new AudienceService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        // The service validates `page_size` before touching the database, so a bad size is its own
        // 400 INVALID_PAGE_SIZE rather than a generic validation error.
        async ({user, query, audienceService}) => audienceService.listLeads(user.tenantId, query),
        {
            query: AudienceSchema.leadList,
            detail: {
                summary: "List leads of an account with filters, sorting, and pagination"
            }
        })
    .get("/:id",
        async ({user, params: {id}, audienceService}) =>
            audienceService.getLeadDetail(user.tenantId, Number(id)),
        {
            params: AudienceSchema.leadParams,
            detail: {
                summary: "Get one lead with attribution, metrics, level timeline, and message trail"
            }
        })
    // VIEWER may retag a lead, so it is registered before the ADMIN-only delete below.
    .patch("/:id",
        async ({user, params: {id}, body, audienceService}) =>
            audienceService.updateLead(user.tenantId, Number(id), body),
        {
            params: AudienceSchema.leadParams,
            body: AudienceSchema.leadUpdate,
            detail: {
                summary: "Update a lead stage, temperature, or deal value"
            }
        })
    .use(requireAdmin)
    .delete("/:id",
        async ({user, params: {id}, query, audienceService}) =>
            audienceService.deleteLead(user.tenantId, Number(id), {
                userId: user.iss,
                reason: query.reason,
            }),
        {
            params: AudienceSchema.leadParams,
            query: AudienceSchema.leadDelete,
            detail: {
                summary: "Delete a lead and its conversations, assessments, and milestones (ADMIN)"
            }
        });
