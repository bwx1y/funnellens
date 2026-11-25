import {AIGenerateOptions, AIMessage, AIResponse} from "./types";

export abstract class BaseAIProvider {
    protected abstract readonly providerName: string;
    protected abstract readonly defaultModel: string;

    abstract generateText(messages: AIMessage[], options?: AIGenerateOptions): Promise<AIResponse<string>>;

    abstract generateObject<T>(messages: AIMessage[], schema?: Record<string, any>, options?: AIGenerateOptions): Promise<AIResponse<T>>;

    /**
     * Shared helper: Automatically used by all SDKs (Gemini, Ollama, OpenAI)
     * to clean up the ```json Markdown before parsing
     */
    protected parseJsonSafely<T>(rawText: string): T {
        const cleaned = rawText
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();
        return JSON.parse(cleaned) as T;
    }
}