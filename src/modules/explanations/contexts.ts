import type {ExplanationContext, ExplanationFacts} from "@/modules/explanations/rules";

export const EXPLAIN_PROMPT_VERSION = "ex-v1";
export const EXPLAIN_RULE_VERSION = "ex-r1";

export interface ContextDefinition {
    /** Human label used in the system prompt. */
    label: string;
    /** Placeholders that must appear in a usable template. */
    required: string[];
    /** Closed enum of follow-up checks offered to the model. */
    nextChecks: readonly string[];
    /** Deterministic template, digit-free, used when the model is unavailable or unusable. */
    fallback: string;
    /** Variant used when `facts.__direction === "down"`. */
    fallbackDown?: string;
}

/**
 * The narrative contract per block: label, required placeholders, closed `nextCheck` enum, and the
 * digit-free fallback sentence. The fallbacks carry the block's own numbers through placeholders, so
 * a rejected model answer still ships a correct sentence.
 */
export const EXPLANATION_CONTEXTS: Record<ExplanationContext, ContextDefinition> = {
    summary: {
        label: "Ringkasan akun",
        required: ["spend", "leads"],
        nextChecks: ["campaign", "lead_quality", "reply_speed", "tracking"],
        fallback: "Belanja {spend} menghasilkan {leads} lead dengan biaya per lead qualified {cpl}. Skor kesehatan funnel {health} ({badge}); {hot} chat HOT belum dibalas. Periksa campaign dengan biaya per lead tertinggi.",
    },
    funnel_leak: {
        label: "Kebocoran funnel",
        required: ["previous", "current"],
        nextChecks: ["campaign", "adset", "creative", "landing_page", "reply_speed"],
        fallback: "Konversi {transition} bergerak dari {previous} ke {current}. Periksa campaign yang menyumbang perubahan terbesar.",
        fallbackDown: "Konversi {transition} turun dari {previous} ke {current}. Periksa campaign yang menyumbang penurunan terbesar.",
    },
    velocity: {
        label: "Kecepatan balas CS",
        required: ["avg"],
        nextChecks: ["cs_schedule", "lead_assignment", "reply_template", "chat_volume"],
        fallback: "Rata-rata balasan pertama {avg} dengan tunggu terpanjang {longest}; {stuck} lead masih menunggu lebih dari satu hari. Periksa jadwal CS pada jam sibuk.",
    },
    tracking_health: {
        label: "Kesehatan tracking",
        required: ["emq", "dedup"],
        nextChecks: ["pixel_events", "capi_dedup", "match_quality", "event_mapping"],
        fallback: "EMQ rata-rata {emq} dengan rasio deduplikasi {dedup}; pixel {pixel} dan CAPI {capi}. Periksa pemetaan event dan deduplikasi CAPI.",
    },
    lead_detail: {
        label: "Detail lead",
        required: ["level", "confidence"],
        nextChecks: ["reply_now", "qualify", "follow_up", "close"],
        fallback: "Lead berlevel {level} dengan keyakinan {confidence} pada tahap {stage}, {replied}. Periksa jawaban terakhir dan kelengkapan kualifikasi.",
    },
    conversation_types: {
        label: "Jenis jawaban lead",
        required: ["classified", "dominant"],
        nextChecks: ["objection_handling", "offer_clarity", "reply_template", "audience_targeting"],
        fallback: "Dari {classified} chat terklasifikasi, jenis terbanyak adalah {dominant} sebanyak {dominantCount}. Periksa penanganan keberatan dan kejelasan penawaran.",
    },
    conversation_timing: {
        label: "Jeda balas CS",
        required: ["median", "measured", "observed"],
        nextChecks: ["cs_schedule", "lead_assignment", "chat_volume", "reply_template"],
        fallback: "Median jeda CS ke lead {median} dari {measured} lead terukur (dari {observed} lead teramati). Periksa jam operasional CS dan pembagian lead.",
    },
    creative_dimensions: {
        label: "Dimensi kreatif",
        required: ["creatives"],
        nextChecks: ["creative_refresh", "hook", "offer", "audience"],
        fallback: "Dari {creatives} kreatif pada periode ini, {fatigued} berstatus jenuh dan {weak} di bawah ambang. Periksa kreatif dengan biaya per hasil tertinggi.",
    },
    creative_fatigue: {
        label: "Kejenuhan kreatif",
        required: ["fatigued"],
        nextChecks: ["creative_refresh", "frequency_cap", "audience_expansion", "placement"],
        fallback: "Sebanyak {fatigued} kreatif menunjukkan penurunan CTR {drop} dengan frekuensi {frequency}. Periksa kreatif yang penurunannya konsisten tiga hari.",
    },
    creative_pattern: {
        label: "Pola kreatif",
        required: ["tested"],
        nextChecks: ["creative_brief", "tag_review", "sample_size", "budget_shift"],
        fallback: "Dari {tested} atribut yang diuji, {significant} berbeda nyata; atribut terkuat {attribute}. Periksa kreatif dengan pola tersebut sebelum mengubah anggaran.",
    },
    lead_quality: {
        label: "Kualitas lead per kreatif",
        required: ["creatives"],
        nextChecks: ["creative_message", "offer_match", "qualification", "landing_page"],
        fallback: "Dari {creatives} kreatif, rasio lead HOT tertinggi {hotRate} pada {best}. Periksa kesesuaian pesan kreatif dengan kualifikasi lead.",
    },
    comparison: {
        label: "Perbandingan kreatif",
        required: ["left", "right", "metric"],
        nextChecks: ["sample_size", "maturity", "creative_refresh", "budget_shift"],
        fallback: "Pada {metric}, {left} dan {right} berbeda {delta}. Periksa jumlah hasil dan kelengkapan data sebelum menyimpulkan.",
    },
    alert: {
        label: "Alert aktif",
        required: ["active"],
        nextChecks: ["leak_review", "hot_lead_reply", "tracking_check", "creative_review"],
        fallback: "Ada {active} alert aktif, {critical} kritis dan {warning} peringatan; aturan terbanyak {rule}. Periksa lead HOT yang belum dibalas dan kebocoran funnel.",
    },
};

/** Server-owned instructions: the model writes prose only, every number stays a placeholder. */
export function systemPromptFor(context: ExplanationContext, facts: ExplanationFacts): string {
    const definition = EXPLANATION_CONTEXTS[context];
    const placeholders = Object.keys(facts)
        .filter((key) => key !== "__direction")
        .map((key) => `{${key}}`)
        .join(", ");
    const required = definition.required.map((name) => `{${name}}`).join(", ");
    const nextChecks = definition.nextChecks.map((check) => `"${check}"`).join(", ");

    return [
        "Kamu adalah analis funnel WhatsApp berbahasa Indonesia.",
        `Tulis 1-2 kalimat untuk blok "${definition.label}" berdasarkan fakta yang diberikan.`,
        "Aturan wajib:",
        "- Jangan menulis angka apa pun; gunakan placeholder yang tersedia.",
        "- Jangan menetapkan sebab; sebut pemeriksaan berikutnya.",
        `- Placeholder yang tersedia: ${placeholders}.`,
        // Named explicitly: the model drops an available placeholder often enough to fail the check.
        `- Placeholder yang wajib ada: ${required}.`,
        `- Balas JSON {template, nextCheck}; nextCheck salah satu dari: ${nextChecks}.`,
    ].join("\n");
}

/** Plain JSON Schema: the adapter forwards it verbatim, so no `const`/`anyOf` Gemini rejects. */
export function outputSchemaFor(context: ExplanationContext): Record<string, any> {
    const definition = EXPLANATION_CONTEXTS[context];

    return {
        type: "object",
        properties: {
            template: {type: "string"},
            nextCheck: {type: "string", enum: [...definition.nextChecks]},
        },
        required: ["template", "nextCheck"],
    };
}
