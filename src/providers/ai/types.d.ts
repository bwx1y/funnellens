export interface AIMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface AIGenerateOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface AIResponse<T = string> {
    data: T;
    provider: string;
    model: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
