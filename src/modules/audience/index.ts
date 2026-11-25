import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {AudienceService, resolveLeadPageSize} from "@/modules/audience/service";
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
        async ({user, query, audienceService}) => {
            // Validated here so a bad page size is a 422 with its own code, not a generic validation error.
            resolveLeadPageSize(query.pageSize ?? query.limit);
            return audienceService.listLeads(user.tenantId, query);
        },
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
    .patch("/:id",
        async ({user, params: {id}, body, audienceService}) =>
            audienceService.updateLead(user.tenantId, Number(id), body),
        {
            params: AudienceSchema.leadParams,
            body: AudienceSchema.leadUpdate,
            detail: {
                summary: "Update a lead stage, temperature, or deal value"
            }
        });
