import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {SourcesService} from "@/modules/sources/service";

/** One call for the sources panel; `/api/settings` reads the same service, not a copy. */
export const SourcesController = new Elysia({
    prefix: "/sources",
    detail: {
        tags: ["Sources"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("sourcesService", new SourcesService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        async ({user, sourcesService}) => ({sources: await sourcesService.snapshot(user.tenantId)}),
        {
            detail: {
                summary: "Get connection status, last sync, and errors per data source"
            }
        });
