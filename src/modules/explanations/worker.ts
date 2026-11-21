import {WorkerManager, type Job} from "@infra/queue";
import {GeminiAdapter} from "@infra/ai/adapters/gemini.adapter";
import type {AIGenerateOptions, AIMessage, AIResponse} from "@infra/ai/types";
import {ExplanationRepository} from "@db/repositories/explanation.repository";
import {logger} from "@shared/logger";
import {Config} from "@/config";
import {EXPLANATION_CONTEXTS, outputSchemaFor, systemPromptFor} from "@/modules/explanations/contexts";
import {
    fallbackText,
    render,
    validateNarrative,
    type ExplanationContext,
    type ExplanationFacts,
} from "@/modules/explanations/rules";
import {EXPLAIN_QUEUE_NAME, type ExplainJobData, type ExplainJobName} from "@/modules/explanations/queue";

export interface ExplainModel {
    generateObject<T>(
        messages: AIMessage[],
        schema?: Record<string, any>,
        options?: AIGenerateOptions
    ): Promise<AIResponse<T>>;
}

interface Narrative {
    template: string;
    nextCheck: string;
}

const ATTEMPTS = 2;

/**
 * Fills one `PENDING` row. A finished row is never regenerated; a template with digits, an unknown
 * placeholder, or a direction that contradicts the facts is rejected and replaced by the block's own
 * deterministic sentence, which still carries the block's numbers.
 */
export class ExplainWorkerProcessor {
    constructor(
        private readonly repo = new ExplanationRepository(),
        private readonly model: ExplainModel = new GeminiAdapter(),
        private readonly apiKeys: string[] = Config.ai.gemini.apiKeys
    ) {}

    async process(job: Job<ExplainJobData, void, ExplainJobName>): Promise<void> {
        const row = await this.repo.findByIdForWorker(job.data.id);
        if (row === null) {
            logger.warn(`[Explain] Penjelasan ${job.data.id} tidak ditemukan.`);
            return;
        }
        if (row.state !== "PENDING") return;

        const context = row.context as ExplanationContext;
        const definition = EXPLANATION_CONTEXTS[context];
        if (definition === undefined) {
            await this.repo.markUnavailable(row.id, `konteks ${row.context} tidak dikenal`);
            return;
        }

        const facts = (typeof row.facts === "object" && row.facts !== null
            ? row.facts
            : {}) as ExplanationFacts & {__direction?: "up" | "down"};

        if (this.apiKeys.length === 0) {
            await this.repo.markFallback(row.id, {
                text: fallbackText(context, facts),
                nextCheck: definition.nextChecks[0],
            });
            return;
        }

        const messages: AIMessage[] = [
            {role: "system", content: systemPromptFor(context, facts)},
            {role: "user", content: JSON.stringify(facts)},
        ];

        let lastProblem = "model tidak tersedia";
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            try {
                const response = await this.model.generateObject<Narrative>(
                    messages,
                    outputSchemaFor(context),
                    {temperature: 0}
                );
                const template = response?.data?.template;
                if (typeof template !== "string") {
                    lastProblem = "template bukan teks";
                    messages.push({role: "user", content: `Jawaban ditolak: ${lastProblem}. Ulangi.`});
                    continue;
                }

                const problem = validateNarrative(context, template, facts);
                if (problem !== null) {
                    lastProblem = problem;
                    // The retry carries the reason: the same prompt would usually drop it again.
                    messages.push({role: "user", content: `Jawaban ditolak: ${problem}. Ulangi.`});
                    continue;
                }

                const nextCheck = response.data.nextCheck;
                await this.repo.markReady(row.id, {
                    text: render(template, facts),
                    source: "model",
                    nextCheck: typeof nextCheck === "string" && definition.nextChecks.includes(nextCheck)
                        ? nextCheck
                        : null,
                });
                return;
            } catch (error) {
                lastProblem = error instanceof Error ? error.message : String(error);
            }
        }

        await this.repo.markFallback(row.id, {
            text: fallbackText(context, facts),
            nextCheck: definition.nextChecks[0],
            error: lastProblem,
        });
    }
}

export const explainWorker = new WorkerManager<ExplainJobData, void, ExplainJobName>(
    EXPLAIN_QUEUE_NAME,
    async (job) => new ExplainWorkerProcessor().process(job)
);
