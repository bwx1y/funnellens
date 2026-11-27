import {GoogleGenAI} from "@google/genai";
import {BaseAIProvider} from "../base.ai";
import {AIGenerateOptions, AIMessage, AIResponse} from "../types";
import {Config} from "@/config";
import {logger} from "@shared/logger";

export class GeminiAdapter extends BaseAIProvider {
    protected readonly defaultModel: string = Config.ai.gemini.model || "gemini-2.5-flash";
    protected readonly providerName: string = "gemini";
    private readonly apiKeys: string[];

    constructor(apiKeys?: string[]) {
        super();
        this.apiKeys = apiKeys && apiKeys.length > 0 ? apiKeys : Config.ai.gemini.apiKeys;
    }

    async generateText(messages: AIMessage[], options?: AIGenerateOptions): Promise<AIResponse<string>> {
        return this.executeWithFailover(async (ai, model) => {
            const {systemInstruction, contents} = this.formatMessages(messages);

            const response = await ai.models.generateContent({
                model,
                contents,
                config: {
                    ...(systemInstruction ? {systemInstruction} : {}),
                    ...(options?.temperature !== undefined ? {temperature: options.temperature} : {}),
                    ...(options?.maxTokens !== undefined ? {maxOutputTokens: options.maxTokens} : {}),
                },
            });

            return {
                data: response.text ?? "",
                provider: this.providerName,
                model,
                usage: this.extractUsage(response),
            };
        }, options?.model);
    }

    async generateObject<T>(
        messages: AIMessage[],
        schema?: Record<string, any>,
        options?: AIGenerateOptions
    ): Promise<AIResponse<T>> {
        return this.executeWithFailover(async (ai, model) => {
            const {systemInstruction, contents} = this.formatMessages(messages);

            const config: Record<string, any> = {
                responseMimeType: "application/json",
                ...(systemInstruction ? {systemInstruction} : {}),
                ...(options?.temperature !== undefined ? {temperature: options.temperature} : {}),
                ...(options?.maxTokens !== undefined ? {maxOutputTokens: options.maxTokens} : {}),
            };

            if (schema) {
                config.responseSchema = schema;
            }

            const response = await ai.models.generateContent({
                model,
                contents,
                config,
            });

            const rawText = response.text ?? "";
            const data = this.parseJsonSafely<T>(rawText);

            return {
                data,
                provider: this.providerName,
                model,
                usage: this.extractUsage(response),
            };
        }, options?.model);
    }

    private async executeWithFailover<T>(
        operation: (client: GoogleGenAI, model: string) => Promise<T>,
        modelOverride?: string
    ): Promise<T> {
        if (!this.apiKeys || this.apiKeys.length === 0) {
            throw new Error("[GeminiAdapter] No Gemini API keys found. Please set GEMINI_API_KEYS in your environment.");
        }

        const model = modelOverride || this.defaultModel;
        let lastQuotaError: unknown;

        for (let i = 0; i < this.apiKeys.length; i++) {
            const apiKey = this.apiKeys[i];
            try {
                const client = new GoogleGenAI({apiKey});
                return await operation(client, model);
            } catch (error) {
                if (this.isQuotaExhaustedError(error)) {
                    logger.warn(
                        `[GeminiAdapter] Key #${i + 1} quota exhausted. Falling back to next key...`
                    );
                    lastQuotaError = error;
                    continue;
                }
                throw error;
            }
        }

        throw new Error(
            `[GeminiAdapter] All ${this.apiKeys.length} Gemini API keys quota exhausted. Last error: ${
                lastQuotaError instanceof Error ? lastQuotaError.message : String(lastQuotaError)
            }`
        );
    }

    private isQuotaExhaustedError(error: unknown): boolean {
        if (!error) return false;

        if (typeof error === "object") {
            const errObj = error as Record<string, any>;
            if (errObj.status === 429 || errObj.status === "RESOURCE_EXHAUSTED") return true;
            if (errObj.code === 429 || errObj.code === "RESOURCE_EXHAUSTED") return true;
            if (errObj.response && (errObj.response.status === 429 || errObj.response.statusCode === 429)) {
                return true;
            }
        }

        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        return (
            lower.includes("429") ||
            lower.includes("resource_exhausted") ||
            lower.includes("quota") ||
            lower.includes("rate limit") ||
            lower.includes("too many requests")
        );
    }

    private formatMessages(messages: AIMessage[]) {
        const systemParts: string[] = [];
        const contents: Array<{role: "user" | "model"; parts: Array<{text: string}>}> = [];

        for (const msg of messages) {
            if (msg.role === "system") {
                systemParts.push(msg.content);
            } else {
                contents.push({
                    role: msg.role === "assistant" ? "model" : "user",
                    parts: [{text: msg.content}],
                });
            }
        }

        if (contents.length === 0 && systemParts.length > 0) {
            contents.push({
                role: "user",
                parts: [{text: "Proceed."}],
            });
        }

        return {
            systemInstruction: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
            contents,
        };
    }

    private extractUsage(response: any): AIResponse["usage"] {
        if (!response?.usageMetadata) return undefined;
        return {
            promptTokens: response.usageMetadata.promptTokenCount ?? 0,
            completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: response.usageMetadata.totalTokenCount ?? 0,
        };
    }
}
