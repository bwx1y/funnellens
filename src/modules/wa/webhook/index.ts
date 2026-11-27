import {Elysia} from "elysia";
import {BadRequestError} from "@shared/errors";
import {logger} from "@shared/logger";
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
    .post("/", async ({body, waWebhookService}) => {
        const payload = body as WebhookDelivery;

        if (!payload || typeof payload !== "object") {
            throw new BadRequestError("Invalid JSON body");
        }

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
            const messageData = payload.data as MessageReceived;
            if (!messageData.isGroup && !messageData.isStatusBroadcast) {
                await waWebhookService.messageReceived(payload.sessionId, messageData);
            }
        }

        return {status: true};
    }, {
        detail: {
            summary: "Handle OpenWA webhook event delivery",
            description: "Receives and processes incoming OpenWA events (session.authenticated, session.disconnected, message.received)."
        }
    });