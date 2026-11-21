import {createHash} from "node:crypto";
import {round2} from "@shared/numbers";
import {EXPLANATION_CONTEXTS} from "@/modules/explanations/contexts";

/**
 * The 13 narrative contexts of an insight block. One context = one sentence shape = one fallback
 * template; the UI reads them by name, so the union is the contract.
 */
export type ExplanationContext =
    | "summary"
    | "funnel_leak"
    | "velocity"
    | "tracking_health"
    | "lead_detail"
    | "conversation_types"
    | "conversation_timing"
    | "creative_dimensions"
    | "creative_fatigue"
    | "creative_pattern"
    | "lead_quality"
    | "comparison"
    | "alert";

/** Which way the measured number moved; decides which fallback wording is honest. */
export type ExplainDirection = "up" | "down";

/** Every value is already a formatted string: the model never sees a raw number to restate. */
export interface ExplanationFacts {
    [key: string]: string;
}

const UP_WORDS = ["naik", "meningkat", "tumbuh", "lebih tinggi"];
const DOWN_WORDS = ["turun", "menurun", "menyusut", "lebih rendah"];

const PLACEHOLDER = /\{([^{}]+)\}/g;

const CURRENCY_PREFIX: Record<string, string> = {IDR: "Rp", USD: "US$"};

/** JSON with object keys sorted at every depth; arrays keep their order. Stable input for a hash. */
export function stableJson(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value !== null && typeof value === "object") {
        const source = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) {
            sorted[key] = sortValue(source[key]);
        }
        return sorted;
    }

    return value;
}

/** sha256 of {@link stableJson}: the same facts in a different key order hash identically. */
export function hashJson(value: unknown): string {
    return createHash("sha256").update(stableJson(value)).digest("hex");
}

/** Every `{...}` body of the template, in order of appearance. */
export function extractPlaceholders(template: string): string[] {
    const matches = template.match(PLACEHOLDER);
    if (matches === null) return [];

    return matches.map((match) => match.slice(1, -1));
}

/**
 * Runs on the template, never on the rendered text: the rendered text must contain digits (they come
 * from the facts), the template must not. Returns the first problem, or `null` when the template is
 * usable.
 */
export function validateNarrative(
    context: ExplanationContext,
    template: string,
    facts: ExplanationFacts & {__direction?: ExplainDirection}
): string | null {
    if (/\d/.test(template)) return "template mengandung angka";

    for (const name of extractPlaceholders(template)) {
        if (name === "__direction") continue;
        if (!(name in facts)) return `placeholder ${name} tidak dikenal`;
    }

    const definition = EXPLANATION_CONTEXTS[context];
    for (const name of definition.required) {
        if (!extractPlaceholders(template).includes(name)) return `placeholder wajib ${name} tidak ada`;
    }

    const direction = facts.__direction;
    const lower = template.toLowerCase();
    if (direction === "down" && UP_WORDS.some((word) => lower.includes(word))) {
        return "arah narasi bertentangan dengan fakta";
    }
    if (direction === "up" && DOWN_WORDS.some((word) => lower.includes(word))) {
        return "arah narasi bertentangan dengan fakta";
    }

    if (template.trim() === "") return "template kosong";

    return null;
}

/**
 * Substitutes the facts into a validated template. A missing key throws: validation runs first, so a
 * throw here is a programming error, never model input.
 */
export function render(template: string, facts: ExplanationFacts): string {
    return template.replace(PLACEHOLDER, (_match, name: string) => {
        const value = facts[name];
        if (value === undefined) throw new Error(`placeholder ${name} tidak ada pada fakta`);

        return value;
    });
}

/** Deterministic text used when the model is unavailable or produced an unusable template. */
export function fallbackText(
    context: ExplanationContext,
    facts: ExplanationFacts & {__direction?: ExplainDirection}
): string {
    const definition = EXPLANATION_CONTEXTS[context];
    const template = facts.__direction === "down" && definition.fallbackDown !== undefined
        ? definition.fallbackDown
        : definition.fallback;

    return render(template, facts);
}

/** Meta reports money in minor units; the text keeps the account currency instead of guessing one. */
export function formatMoney(minor: number | null, currency: string): string {
    if (minor === null) return "belum tersedia";

    const prefix = CURRENCY_PREFIX[currency] ?? currency;
    const amount = new Intl.NumberFormat("id-ID", {maximumFractionDigits: 0}).format(minor / 100);

    return `${prefix} ${amount}`;
}

/** Ratios print as percentages with the Indonesian decimal comma. */
export function formatPercent(ratio: number | null): string {
    if (ratio === null) return "belum terukur";

    return `${String(round2(ratio * 100)).replace(".", ",")}%`;
}

export function formatNumber(value: number | null): string {
    if (value === null) return "belum tersedia";

    return new Intl.NumberFormat("id-ID").format(value);
}

export function formatDuration(seconds: number | null): string {
    if (seconds === null) return "belum terukur";

    const s = Math.round(seconds);
    if (s < 60) return `${s} detik`;
    if (s < 3600) return `${Math.round(s / 60)} menit`;

    const hours = Math.floor(s / 3600);
    const minutes = Math.round((s % 3600) / 60);
    if (minutes === 60) return `${hours + 1} jam`;

    return minutes === 0 ? `${hours} jam` : `${hours} jam ${minutes} menit`;
}
