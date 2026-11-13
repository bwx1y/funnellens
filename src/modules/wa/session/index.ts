import {Elysia} from "elysia";
import {JwtUtil} from "@/utils/jwt";
import {WaSessionService} from "@/modules/wa/session/service";
import {WaSessionSchema} from "@/modules/wa/session/schema";

export const WaSessionController = new Elysia({
    prefix: "/wa/session",
    detail: {
        tags: ["Wa Session"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("waSessionService", new WaSessionService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        async ({user, waSessionService}) => waSessionService.findAll(user.tenantId),
        {
            detail: {
                summary: "List all sessions in same tenant"
            }
        })
    .get("/:id",
        async ({user, params: {id}, waSessionService}) => waSessionService.findOne(user.tenantId, id),
        {
            params: WaSessionSchema.params,
            detail: {
                summary: "Detail session in same tenant"
            }
        })
    .get("/:id/qr",
        async ({user, params: {id}, waSessionService}) => waSessionService.findQrCode(user.tenantId, id),
        {
            params: WaSessionSchema.params,
            detail: {
                summary: "Get QR code for session login"
            }
        })
    .post("/",
        async ({user, body, waSessionService, set}) => {
            const result = await waSessionService.create(user.tenantId, body);
            set.status = 201;
            return result;
        },
        {
            body: WaSessionSchema.create,
            detail: {
                summary: "Create session in same tenant"
            }
        })
    .put("/:id",
        async ({user, params: {id}, body, waSessionService}) => waSessionService.update(user.tenantId, id, body),
        {
            params: WaSessionSchema.params,
            body: WaSessionSchema.update,
            detail: {
                summary: "Update session in same tenant"
            }
        })
    .delete("/:id",
        async ({user, params: {id}, waSessionService}) => waSessionService.delete(user.tenantId, id),
        {
            params: WaSessionSchema.params,
            detail: {
                summary: "Delete session in same tenant"
            }
        });