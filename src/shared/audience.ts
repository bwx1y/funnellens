export const REPLY_TYPES = [
    "Komitmen",
    "Tanya lanjut",
    "Keberatan",
    "Menunda",
    "Menolak",
    "Pengakuan netral",
    "Di luar topik",
] as const;
export type ReplyType = typeof REPLY_TYPES[number];

export const SENTIMENTS = ["positif", "netral", "negatif"] as const;
export type Sentiment = typeof SENTIMENTS[number];

export const CONFIDENCE_LEVELS = ["rendah", "sedang", "tinggi"] as const;

export const RESPONSE_BUCKETS = ["< 15 menit", "15–60 menit", "1–4 jam", "> 4 jam"] as const;
export type ResponseBucket = typeof RESPONSE_BUCKETS[number];

export const HEATMAP_MIN_LEADS_PER_BUCKET = 10;

export const TEMPERATURE_LEVELS = ["COLD", "WARM", "HOT"] as const;
export type TemperatureLevel = typeof TEMPERATURE_LEVELS[number];

export interface SankeyLink {
    from: TemperatureLevel;
    to: TemperatureLevel;
    value: number;
}

export interface Sankey {
    nodes: ["COLD", "WARM", "HOT"];
    links: {from: string; to: string; value: number}[];
}

/** `< 900` → "< 15 menit"; `900..3599` → "15–60 menit"; `3600..14399` → "1–4 jam"; `>= 14400` → "> 4 jam". */
export function responseBucket(seconds: number): ResponseBucket {
    if (seconds < 900) return RESPONSE_BUCKETS[0];
    if (seconds < 3600) return RESPONSE_BUCKETS[1];
    if (seconds < 14400) return RESPONSE_BUCKETS[2];
    return RESPONSE_BUCKETS[3];
}

/** `true` only when all four buckets hold at least `HEATMAP_MIN_LEADS_PER_BUCKET` leads. */
export function heatmapEligible(leadsPerBucket: number[]): boolean {
    return leadsPerBucket.length === RESPONSE_BUCKETS.length
        && leadsPerBucket.every((count) => count >= HEATMAP_MIN_LEADS_PER_BUCKET);
}

/** Consecutive assessment pairs; a pair with the same level is not a flow and is dropped. */
export function buildSankey(rows: SankeyLink[]): Sankey {
    const links = rows
        .filter((row) => row.from !== row.to)
        .map((row) => ({from: row.from as string, to: row.to as string, value: row.value}))
        .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));

    return {nodes: ["COLD", "WARM", "HOT"], links};
}
