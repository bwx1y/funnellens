import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {SearchService} from "@/modules/search/service";
import {SearchSchema} from "@/modules/search/schema";

export const SearchController = new Elysia({
    prefix: "/search",
    detail: {
        tags: ["Search"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("searchService", new SearchService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        async ({user, query, searchService}) => searchService.search(user.tenantId, query),
        {
            query: SearchSchema.search,
            detail: {
                summary: "Search app pages and the account's leads"
            }
        });
