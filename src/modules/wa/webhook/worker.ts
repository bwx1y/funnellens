import {WorkerManager} from "@infra/queue";
import {WaWebhookService} from "@/modules/wa/webhook/service";
import type {LeadAiResponse, MessageReceived} from "@/modules/wa/webhook/schema";
import {logger} from "@shared/logger";
import {Config} from "@/config";
import {OpenWAClient} from "@rmyndharis/openwa";
import {WaMessageRepository} from "@db/repositories/wa-message.repository";
import {WaPhoneRepository} from "@db/repositories/wa-phone.repository";
import {encode, decode} from "@toon-format/toon";
import {GeminiAdapter} from "@infra/ai/adapters/gemini.adapter";
import type {AIMessage} from "@infra/ai/types";
import {redisConnection} from "@infra/redis";
import leadRules from "./prompts/lead-rules.json";
import fewShot from "./prompts/few-shot.json";

export type ProcessMessageJob = MessageReceived & {
    session: string;
};

const TOON_SCHEMA = {
    lead_type: "HOT | WARM | COLD",
    confidence_score: "number (0.0 hingga 1.0)",
    detected_product: "string atau null",
    reasoning: "string penjelasan klasifikasi",
};

const SYSTEM_PROMPT = `
Kamu adalah asisten CS & Sales untuk BWX1Y.
Klasifikasikan chat pelanggan ke HOT, WARM, atau COLD.

KATALOG PRODUK:
1. Bulpoint - Harga: Rp 5.000 | Stok: Ready

ATURAN KLASIFIKASI:
${encode(leadRules)}

FORMAT OUTPUT:
Wajib balas HANYA dalam format TOON yang valid mengikuti schema berikut tanpa markdown atau teks tambahan:
${encode(TOON_SCHEMA)}
`.trim();

const TOON_FEW_SHOT: AIMessage[] = fewShot.map((item) => {
    if (item.role === "assistant") {
        try {
            const parsed = JSON.parse(item.content);
            return {
                role: "assistant",
                content: encode(parsed),
            };
        } catch {
            return item as AIMessage;
        }
    }
    return {
        role: "user",
        content: encode({message: item.content}),
    };
});

const openWa = new OpenWAClient({
    baseUrl: Config.openWa.url,
    apiKey: Config.openWa.appKey,
});

const messageRepository = new WaMessageRepository();
const phoneRepository = new WaPhoneRepository();
const gemini = new GeminiAdapter();

const parseToonSafely = <T>(rawText: string): T => {
    const cleaned = rawText
        .replace(/^```(?:toon)?\s*/i, "")
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

    try {
        return decode(cleaned) as T;
    } catch {
        return JSON.parse(cleaned) as T;
    }
};

export const WaWebhookWorker = new WorkerManager<ProcessMessageJob>(
    WaWebhookService.QUEUE_NAME,
    async ({data}) => {
        const bufferKey = `wa:buffer:${data.session}:${data.from}`;

        // Masukkan pesan ke buffer Redis
        await redisConnection.rpush(bufferKey, JSON.stringify(data));
        await redisConnection.expire(bufferKey, 120);

        // Tunggu window buffer 10 detik
        await Bun.sleep(10000);

        // Ambil semua pesan yang terkumpul untuk session & pengirim ini
        const bufferedRaw = await redisConnection.lrange(bufferKey, 0, -1);
        if (!bufferedRaw || bufferedRaw.length === 0) {
            return;
        }

        // Hapus buffer agar tidak diproses berulang oleh job lain dalam batch yang sama
        await redisConnection.del(bufferKey);

        const messages: ProcessMessageJob[] = bufferedRaw
            .map((raw) => {
                try {
                    return JSON.parse(raw) as ProcessMessageJob;
                } catch {
                    return null;
                }
            })
            .filter((msg): msg is ProcessMessageJob => Boolean(msg));

        if (messages.length === 0) {
            return;
        }

        logger.info(
            {sessionId: data.session, from: data.from, count: messages.length},
            "[AI] Processing buffered messages start"
        );

        try {
            // Encode input chat pelanggan ke format TOON (bisa tunggal atau gabungan batch)
            const chatPayload =
                messages.length === 1
                    ? encode({message: messages[0].body})
                    : encode({
                          messages: messages.map((m) => ({
                              time: m.timestamp,
                              body: m.body,
                          })),
                      });

            const aiResponse = await gemini.generateText([
                {role: "system", content: SYSTEM_PROMPT},
                ...TOON_FEW_SHOT,
                {role: "user", content: chatPayload},
            ], {
                temperature: 0.2,
            });

            const content = parseToonSafely<LeadAiResponse>(aiResponse.data);
            logger.info({aiResponse: content}, "[AI] Processing message result");

            let phone = data.from;
            if (phone.endsWith("@lid")) {
                const result = await openWa.contacts.get(data.session, phone);
                phone = result.number || phone;
            }

            const phoneName = messages.find(m => m.contact?.pushName)?.contact?.pushName ?? data.contact?.pushName;

            const phoneRecord = await phoneRepository.upsert({
                sessionId: data.session,
                phone,
                phoneName,
                status: content.lead_type,
            });

            // Simpan setiap pesan yang terkumpul ke repository
            for (const msg of messages) {
                await messageRepository.create({
                    phoneId: phoneRecord.id,
                    status: content.lead_type,
                    content: msg.body,
                    score: content.confidence_score,
                });
            }

            logger.info(
                {sessionId: data.session, status: content.lead_type, savedMessages: messages.length},
                "[AI] Processing message done"
            );
        } catch (error) {
            logger.error({error, sessionId: data.session}, "[AI] Failed to process message");
            throw error;
        }
    }
);
