import {Elysia, t} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {ExplanationService} from "@/modules/explanations/service";

export const ExplanationController = new Elysia({
    prefix: "/insights/explanations",
    detail: {
        tags: ["Explanations"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("explanationService", new ExplanationService())
    .use(JwtUtil.isAuthenticated)
    .get("/:id",
        async ({user, params: {id}, explanationService}) => explanationService.get(id, user.tenantId),
        {
            params: t.Object({id: t.String({format: "uuid"})}),
            detail: {
                summary: "Get one explanation by id (tenant-scoped)"
            }
        });
