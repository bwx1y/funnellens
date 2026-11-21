import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {CreativeService} from "@/modules/creative/service";
import {CreativeSchema} from "@/modules/creative/schema";

/** Static paths are registered before `/:id` so `/fatigue` never resolves as a creative id. */
export const CreativeController = new Elysia({
    prefix: "/analytics/creatives",
    detail: {
        tags: ["Creatives"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("creativeService", new CreativeService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        async ({user, query, creativeService}) => creativeService.listCreatives(user.tenantId, query),
        {
            query: CreativeSchema.list,
            detail: {
                summary: "Rank creatives with four gated dimensions and status"
            }
        })
    .get("/fatigue",
        async ({user, query, creativeService}) => creativeService.getFatigue(user.tenantId, query),
        {
            query: CreativeSchema.range,
            detail: {
                summary: "Get fatigue status per creative with confounder checks"
            }
        })
    .get("/patterns",
        async ({user, query, creativeService}) => creativeService.getPatterns(user.tenantId, query),
        {
            query: CreativeSchema.range,
            detail: {
                summary: "Get tag-attribute cost patterns with Mann-Whitney and BH correction"
            }
        })
    .get("/lead-quality",
        async ({user, query, creativeService}) => creativeService.getLeadQuality(user.tenantId, query),
        {
            query: CreativeSchema.range,
            detail: {
                summary: "Get cost per conversation and lead quality per creative"
            }
        })
    .get("/experiments",
        async ({user, query, creativeService}) => creativeService.getExperiments(user.tenantId, query),
        {
            query: CreativeSchema.experiments,
            detail: {
                summary: "Get Meta A/B study availability"
            }
        })
    .post("/comparisons",
        async ({user, body, creativeService}) => creativeService.compareCreatives(user.tenantId, body),
        {
            body: CreativeSchema.comparison,
            detail: {
                summary: "Compare creatives from one insight snapshot per goal"
            }
        })
    .post("/:id/tags",
        async ({user, params: {id}, body, creativeService}) => creativeService.addTag(user.tenantId, id, body),
        {
            params: CreativeSchema.creativeParams,
            body: CreativeSchema.tagCreate,
            detail: {
                summary: "Add a creative tag"
            }
        })
    .post("/:id/tags/ai",
        async ({user, params: {id}, creativeService}) => creativeService.queueAiTags(user.tenantId, id),
        {
            params: CreativeSchema.creativeParams,
            detail: {
                summary: "Queue AI tagging for a creative"
            }
        })
    .delete("/:id/tags/:tagId",
        async ({user, params: {id, tagId}, creativeService}) =>
            creativeService.removeTag(user.tenantId, id, Number(tagId)),
        {
            params: CreativeSchema.tagParams,
            detail: {
                summary: "Remove a creative tag"
            }
        })
    .get("/:id",
        async ({user, params: {id}, query, creativeService}) =>
            creativeService.getCreativeDetail(user.tenantId, id, query),
        {
            params: CreativeSchema.creativeParams,
            query: CreativeSchema.range,
            detail: {
                summary: "Get creative detail with daily metrics, dimensions, and video metrics"
            }
        });
