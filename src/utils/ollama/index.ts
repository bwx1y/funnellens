import {Ollama} from "ollama";
import {Config} from "@/config";

export { default as responseSchema } from "./prompt/response-schema.json";
export { default as leadRules } from "./prompt/lead-rules.json";
export { default as fewShot } from "./prompt/few-shot.json";

export interface LeadAiResponse {
    lead_type: "HOT" | "WARM" | "COLD";
    confidence_score: number;
    detected_product: string | null;
    reasoning: string;
    reply_message: string;
}

export const OllamaUtils = new Ollama({
    host: Config.ollama.baseUrl,
})