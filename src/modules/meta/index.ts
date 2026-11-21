import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {MetaService} from "@/modules/meta/service";
import {MetaSchema} from "@/modules/meta/schema";

const metaService = new MetaService();

// callback is public: Meta redirects the browser here without our JWT
export const MetaOAuthController = new Elysia({
    prefix: "/meta/oauth",
    detail: {
        tags: ["Meta Ads"]
    }
})
    .get("/callback",
        async ({query}) => metaService.handleCallback(query),
        {
            query: MetaSchema.oauthCallback,
            detail: {
                summary: "Meta OAuth callback"
            }
        })

export const MetaController = new Elysia({
    prefix: "/meta",
    detail: {
        tags: ["Meta Ads"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .use(JwtUtil.isAuthenticated)
    .get("/oauth/url",
        async ({user}) => metaService.authorizationUrl(user),
        {
            detail: {
                summary: "Get Meta OAuth authorization URL"
            }
        })
    .get("/connection",
        async ({user}) => metaService.findConnection(user.iss),
        {
            detail: {
                summary: "Get current user Meta connection"
            }
        })
    .delete("/connection",
        async ({user}) => metaService.disconnect(user.iss),
        {
            detail: {
                summary: "Disconnect Meta connection"
            }
        })
