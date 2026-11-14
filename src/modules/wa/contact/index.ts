import {Elysia} from "elysia";
import {JwtUtil} from "@/utils/jwt";
import {WaContactService} from "@/modules/wa/contact/service";

export const WaContactController = new Elysia({
    prefix: "/contact",
    detail: {
        tags: ["Wa Contact"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("contactService", new WaContactService())
    .use(JwtUtil.isAuthenticated)
    .get(
        "/",
        async ({user, contactService, query}) => contactService.getAll(user.tenantId, query.sessionId),
        {
            detail: {
                summary: "List all contacts in same tenant",
                parameters: [
                    {
                        name: "sessionId",
                        in: "query",
                        required: false,
                        description: "Filter contacts by WhatsApp session ID",
                        schema: {
                            type: "string"
                        }
                    }
                ]
            }
        }
    ).get("/stats", ({user, contactService}) => contactService.stats(user.tenantId), {
        detail: {
            summary: "Stats contact for tenant"
        }
    });

