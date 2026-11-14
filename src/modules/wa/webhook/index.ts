import {Elysia} from "elysia";
import {BadRequestError} from "@/utils/error";
import {logger} from "@/utils/logger";
import type {WebhookDelivery} from "@rmyndharis/openwa";
import {WaWebhookService} from "@/modules/wa/webhook/service";
import {MessageReceived} from "@/modules/wa/webhook/schema";

export const WaWebhookController = new Elysia({
    prefix: "/wa/webhook",
    detail: {
        tags: ["Wa Webhook"]
    }
})
    .decorate("waWebhookService", new WaWebhookService())
    .post("/", async ({request, waWebhookService}) => {
        const raw = await request.text();

        let payload: WebhookDelivery;
        try {
            payload = JSON.parse(raw) as WebhookDelivery;

            if (payload.event == "session.authenticated") {
                await waWebhookService.authenticated(payload.data as {
                    sessionId: string,
                    phone: string,
                    pushName: string
                });
            }

            if (payload.event == "session.disconnected") {
                await waWebhookService.disconnected({
                    sessionId: payload.sessionId,
                    reason: (payload.data as { reason?: string } | undefined)?.reason,
                    idempotencyKey: payload.idempotencyKey,
                });
            }

            if (payload.event == "message.received") {
                await waWebhookService.messageReceived(payload.sessionId, payload.data as MessageReceived);
            }
        } catch {
            logger.warn({raw: raw.slice(0, 500)}, "OpenWA webhook: invalid JSON body");
            throw new BadRequestError("Invalid JSON body");
        }

        // logger.info({payload}, "OpenWA webhook received");

        return {status: true};
    }, {
        detail: {
            summary: "Handle OpenWA webhook event delivery",
            description: "Receives and processes incoming OpenWA events (session.authenticated, session.disconnected, message.received)."
        }
    });