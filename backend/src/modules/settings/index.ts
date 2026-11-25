import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {SettingsService} from "@/modules/settings/service";

/** The workspace is read from the token, so the endpoint accepts no query and no body. */
export const SettingsController = new Elysia({
    prefix: "/settings",
    detail: {
        tags: ["Settings"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("settingsService", new SettingsService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        async ({user, settingsService}) => settingsService.get(user.tenantId),
        {
            detail: {
                summary: "Get the workspace, read-only mode, source status, and limits"
            }
        });
