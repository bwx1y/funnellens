import {WorkerManager} from "@/utils/queue";
import {WaSessionService} from "@/modules/wa/session/service";
import {OpenWAClient, type WebhookEvent} from "@rmyndharis/openwa";
import {Config} from "@/config";
import {logger} from "@/utils/logger";

const openWa = new OpenWAClient({
    baseUrl: Config.openWa.url,
    apiKey: Config.openWa.appKey
});

// Receiver is the host Elysia route POST /api/wa/webhook; the gateway container addresses the host by name
// (extra_hosts in docker-compose.yml). Every event is subscribed because the receiver only logs the payload.
const WEBHOOK_EVENTS: WebhookEvent[] = ["message.received", "session.disconnected", "session.authenticated"];

export const WaSessionWorker = new WorkerManager<{ code: string }>(WaSessionService.QUEUE_NAME, async (job) => {
    const sessionId = job.data.code;
    const url = Config.openWa.webhookUrl;

    // ponytail: dedupe by URL so a retried job cannot register the same webhook twice; move to an upsert by
    // webhook id if per-session event sets start to differ.
    const existing = (await openWa.webhooks.list(sessionId)).find((hook) => hook.url === url);
    if (existing != null) {
        logger.info({sessionId, webhookId: existing.id, url}, "OpenWA webhook already registered");
        return existing;
    }

    const webhook = await openWa.webhooks.create(sessionId, {
        url,
        events: WEBHOOK_EVENTS
    });

    logger.info({sessionId, webhookId: webhook.id, url}, "OpenWA webhook registered");

    return webhook;
});