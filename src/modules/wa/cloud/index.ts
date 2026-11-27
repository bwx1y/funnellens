import {Elysia} from "elysia";
import {Config} from "@/config";
import {UnauthorizedError} from "@shared/errors";
import {CloudIngestService} from "@/modules/wa/cloud/service";

/**
 * Meta calls both routes directly: no bearer token, no `security` entry. The POST answers with
 * `{status: true}` before any parsing so a slow ingest can never trip Meta's delivery timeout.
 */
export const WaCloudController = new Elysia({
    prefix: "/wa/cloud",
    detail: {
        tags: ["Wa Cloud"]
    }
})
    .decorate("cloudIngestService", new CloudIngestService())
    .get("/webhook", ({request}) => {
        // Dotted keys (`hub.mode`) are read from the raw URL: a TypeBox query object would need escaping.
        const query = new URL(request.url).searchParams;
        const mode = query.get("hub.mode");
        const token = query.get("hub.verify_token");
        const challenge = query.get("hub.challenge");

        if (mode === "subscribe" && token === Config.whatsapp.verifyToken && challenge) {
            return new Response(challenge, {
                status: 200,
                headers: {"content-type": "text/plain"},
            });
        }

        throw new UnauthorizedError("Verifikasi webhook gagal");
    }, {
        detail: {
            summary: "Verify the WhatsApp Cloud API webhook subscription",
            description: "Echoes `hub.challenge` when `hub.mode` is `subscribe` and `hub.verify_token` matches WA_VERIFY_TOKEN."
        }
    })
    .post("/webhook", async ({body, request, cloudIngestService}) => {
        const raw = typeof body === "string" ? body : JSON.stringify(body);

        if (!cloudIngestService.signatureConfigured) {
            throw new UnauthorizedError("Webhook signature tidak dapat diverifikasi");
        }

        if (!cloudIngestService.isValidSignature(raw, request.headers.get("x-hub-signature-256"))) {
            throw new UnauthorizedError("Webhook signature tidak valid");
        }

        await cloudIngestService.enqueue(raw, new Date());

        return {status: true};
    }, {
        parse: "text",
        detail: {
            summary: "Receive a WhatsApp Cloud API webhook delivery",
            description: "Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body) and queues the payload for ingestion."
        }
    });
