import {WorkerManager} from "@/utils/queue";
import {WaWebhookService} from "@/modules/wa/webhook/service";
import type {MessageReceived} from "@/modules/wa/webhook/schema";
import {logger} from "@/utils/logger";
import {
    OllamaUtils,
    responseSchema,
    leadRules,
    fewShot,
    type LeadAiResponse,
} from "@/utils/ollama";
import {Config} from "@/config";
import {OpenWAClient} from "@rmyndharis/openwa";
import {WaMessageRepository} from "@/database/repository/wa-message.repository";
import {encode} from "@toon-format/toon"

export type ProcessMessageJob = MessageReceived & {
    session: string;
};

const SYSTEM_PROMPT = `
Kamu adalah asisten CS & Sales untuk BWX1Y
Klasifikasikan chat pelanggan ke HOT, WARM, atau COLD dan buat balasan sesuai aturan.

KATALOG PRODUK:
1. Bulpoint - Harga: Rp 5.000 | Stok: Ready

ATURAN KLASIFIKASI:
${JSON.stringify(leadRules)}
`.trim();

const openWa = new OpenWAClient({
    baseUrl: Config.openWa.url,
    apiKey: Config.openWa.appKey,
});

const messageRepository = new WaMessageRepository();

export const WaWebhookWorker = new WorkerManager<ProcessMessageJob>(
    WaWebhookService.QUEUE_NAME,
    async ({data}) => {
        logger.info({sessionId: data.session}, "[AI] Processing message start");

        try {
            logger.info(SYSTEM_PROMPT)
            const aiResponse = await OllamaUtils.chat({
                model: Config.ollama.model,
                format: responseSchema,
                stream: false,
                options: {
                    temperature: 0.2,
                },
                messages: [
                    {role: "system", content: SYSTEM_PROMPT},
                    ...fewShot,
                    {role: "user", content: data.body},
                ],
            });

            const content = JSON.parse(aiResponse.message.content) as LeadAiResponse;

            let phone = data.from;
            if (phone.endsWith("@lid")) {
                const result = await openWa.contacts.get(data.session, phone);
                phone = result.number || phone;
            }

            await messageRepository.create({
                status: content.lead_type,
                phoneName: data.contact.pushName,
                phone,
                content: data.body,
                score: content.confidence_score,
                sessionId: data.session,
            });

            logger.info({sessionId: data.session, status: content.lead_type}, "[AI] Processing message done");
        } catch (error) {
            logger.error({error, sessionId: data.session}, "[AI] Failed to process message");
            throw error;
        }
    }
);