import {WorkerManager} from "@infra/queue";
import {WaWebhookService} from "@/modules/wa/webhook/service";
import type {MessageReceived} from "@/modules/wa/webhook/schema";
import {Config} from "@/config";
import {OpenWAClient} from "@rmyndharis/openwa";
import {CloudIngestService} from "@/modules/wa/cloud/service";

export type ProcessMessageJob = MessageReceived & {
    session: string;
};

const openWa = new OpenWAClient({
    baseUrl: Config.openWa.url,
    apiKey: Config.openWa.appKey,
});

const cloudService = new CloudIngestService();

/**
 * OpenWA messages go through the same writer as Cloud API deliveries; the only OpenWA-specific step
 * left is resolving a `@lid` sender to a real number.
 */
export const WaWebhookWorker = new WorkerManager<ProcessMessageJob>(
    WaWebhookService.QUEUE_NAME,
    async ({data}) => {
        let phone = data.from;
        if (phone.endsWith("@lid")) {
            const result = await openWa.contacts.get(data.session, phone);
            phone = result.number || phone;
        }

        await cloudService.ingestOpenWa({sessionId: data.session, message: {...data, from: phone}});
    }
);
