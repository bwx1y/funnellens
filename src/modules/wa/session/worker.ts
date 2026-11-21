import {WorkerManager} from "@infra/queue";
import {WaSessionService} from "@/modules/wa/session/service";
import {OpenWAClient, type WebhookEvent, type WebhookFilters} from "@rmyndharis/openwa";
import {Config} from "@/config";
import {logger} from "@shared/logger";

const openWa = new OpenWAClient({
    baseUrl: Config.openWa.url,
    apiKey: Config.openWa.appKey
});

// Receiver is the host Elysia route POST /api/wa/webhook; the gateway container addresses the host by name
// (extra_hosts in docker-compose.yml).
const WEBHOOK_EVENTS: WebhookEvent[] = ["message.received", "session.disconnected", "session.authenticated"];

const WEBHOOK_FILTERS: WebhookFilters = {
    conditions: [
        {
            field: "isGroup",
            operator: "equals",
            value: false,
        },
        {
            field: "isStatusBroadcast",
            operator: "equals",
            value: false,
        },
    ],
};

export const WaSessionWorker = new WorkerManager<{ code: string }>(WaSessionService.QUEUE_NAME, async (job) => {
    const sessionId = job.data.code;
    const url = Config.openWa.webhookUrl;

    const existing = (await openWa.webhooks.list(sessionId)).find((hook) => hook.url === url);
    if (existing != null) {
        const updated = await openWa.webhooks.update(sessionId, existing.id, {
            events: WEBHOOK_EVENTS,
            filters: WEBHOOK_FILTERS,
        });
        logger.info({sessionId, webhookId: existing.id, url}, "OpenWA webhook updated with group filter");
        return updated;
    }

    const webhook = await openWa.webhooks.create(sessionId, {
        url,
        events: WEBHOOK_EVENTS,
        filters: WEBHOOK_FILTERS,
    });

    logger.info({sessionId, webhookId: webhook.id, url}, "OpenWA webhook registered with group filter");

    return webhook;
});
