import {WorkerManager} from "@infra/queue";
import {GeminiAdapter} from "@infra/ai/adapters/gemini.adapter";
import type {AIGenerateOptions, AIMessage, AIResponse} from "@infra/ai/types";
import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {logger} from "@shared/logger";
import {CREATIVE_TAGGING_QUEUE_NAME, type CreativeTaggingJobData} from "@/modules/creative/queue";
import {TAG_TYPES} from "@/modules/creative/service";

/** The AI surface this worker needs; a plain double is enough to test the mapping without a network. */
export interface TaggingModel {
    generateObject<T>(
        messages: AIMessage[],
        schema?: Record<string, any>,
        options?: AIGenerateOptions
    ): Promise<AIResponse<T>>;
}

export interface TaggingResult {
    hook_type?: {value?: string; confidence?: number};
    format?: {value?: string; confidence?: number};
    tone?: {value?: string; confidence?: number};
    product_theme?: {value?: string; confidence?: number};
}

export const TAGGING_SYSTEM_PROMPT = `Kamu adalah analis kreatif iklan berbahasa Indonesia.
Balas HANYA JSON valid dengan empat kunci: hook_type, format, tone, product_theme.
Setiap kunci berisi {value, confidence} — confidence 0..1.
hook_type: jenis pembuka (question, statistic, offer, story, demo).
format: bentuk kreatif (video, image, carousel, ugc, testimonial).
tone: nada pesan (santai, formal, urgensi, emosional, humor).
product_theme: tema produk yang dijual, satu frasa pendek.
Gunakan string kosong bila atribut tidak dapat disimpulkan dari salinan kreatif.`;

const TAGGING_SCHEMA: Record<string, any> = {
    type: "object",
    properties: Object.fromEntries(TAG_TYPES.map((tagType) => [tagType, {
        type: "object",
        properties: {
            value: {type: "string"},
            confidence: {type: "number"},
        },
        required: ["value", "confidence"],
    }])),
    required: [...TAG_TYPES],
};

/** Writes the four AI tag types of one creative; a missing creative is a no-op, not a retry. */
export class CreativeTaggingWorkerProcessor {
    constructor(
        private readonly gemini: TaggingModel = new GeminiAdapter(),
        private readonly creativeRepo = new AdCreativeRepository()
    ) {}

    async process(job: {data: CreativeTaggingJobData}): Promise<void> {
        const creativeId = job.data.creativeId;
        const creative = await this.creativeRepo.findById(creativeId);
        if (creative === null) {
            logger.warn({creativeId}, "Creative tagging skipped: creative not found");
            return;
        }

        const messages: AIMessage[] = [
            {role: "system", content: TAGGING_SYSTEM_PROMPT},
            {
                role: "user",
                content: JSON.stringify({
                    title: creative.title,
                    body: creative.body,
                    callToActionType: creative.callToActionType,
                    objectType: creative.objectType,
                }),
            },
        ];

        const {data} = await this.gemini.generateObject<TaggingResult>(messages, TAGGING_SCHEMA, {temperature: 0});

        const tags = TAG_TYPES.flatMap((tagType) => {
            const value = data[tagType]?.value?.trim();
            if (value === undefined || value === "") return [];

            const confidence = Math.min(1, Math.max(0, Number(data[tagType]?.confidence ?? 0)));
            return [{tagType, tagValue: value, source: "ai" as const, confidence: confidence.toFixed(4)}];
        });

        if (tags.length > 0) await this.creativeRepo.upsertTags(creativeId, tags);
    }
}

const processor = new CreativeTaggingWorkerProcessor();

export const creativeTaggingWorker = new WorkerManager<CreativeTaggingJobData, void, "creative-tagging">(
    CREATIVE_TAGGING_QUEUE_NAME,
    async (job) => processor.process(job)
);
