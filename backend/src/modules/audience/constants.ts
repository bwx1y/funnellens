import {t, type UnwrapSchema} from "elysia";
import {
    CONFIDENCE_LEVELS,
    REPLY_TYPES,
    SENTIMENTS,
    TEMPERATURE_LEVELS,
} from "@shared/audience";

/** Bumped whenever the rubric or the two-level prompt changes: part of the assessment dedupe key. */
export const ASSESS_PROMPT_VERSION = "a2-v2";

/** Marker rows that record an unavailable assessment; a later successful run may still insert. */
export const UNAVAILABLE_RULE_VERSION = `${ASSESS_PROMPT_VERSION}-unavailable`;

/** Context window sent to both levels; newest message included. */
export const ASSESS_MESSAGE_LIMIT = 30;

/** Retries after the first attempt before the assessment is stored as unavailable. */
export const ASSESS_RETRIES = 2;

/**
 * Gemini rejects TypeBox literal unions (`anyOf` of `const`), so every closed vocabulary becomes a
 * string with an `enum` — the shape its `responseSchema` accepts.
 */
const enumOf = <const T extends readonly string[]>(values: T) =>
    t.Unsafe<T[number]>({type: "string", enum: [...values]});

const URGENCY = ["rendah", "sedang", "tinggi"] as const;

/** Level 1: per-message signals, one entry per `wamid` in the window. */
export const SIGNAL_SCHEMA = t.Object({
    signals: t.Array(t.Object({
        wamid: t.String(),
        intent: t.String(),
        product: t.String(),
        budget: t.String(),
        urgency: enumOf(URGENCY),
        objection: t.String(),
        sentiment: enumOf(SENTIMENTS),
    })),
});

/** Level 2: the single decision that may move `leads.temperature`. */
export const DECISION_SCHEMA = t.Object({
    level: enumOf(TEMPERATURE_LEVELS),
    confidence: enumOf(CONFIDENCE_LEVELS),
    reason: t.String(),
    evidenceWamid: t.String(),
    responseType: enumOf(REPLY_TYPES),
    sentiment: enumOf(SENTIMENTS),
    /** Short phrase for what the conversation was about; empty string when there is none. */
    topic: t.Optional(t.String()),
    /** Verbatim short quote from a LEAD message; empty string when there is none. */
    quote: t.Optional(t.String()),
});

export type Signals = UnwrapSchema<typeof SIGNAL_SCHEMA>;
export type Signal = Signals["signals"][number];
export type Decision = UnwrapSchema<typeof DECISION_SCHEMA>;

export const DEFAULT_RUBRIC = `RUBRIK PENILAIAN LEAD (WhatsApp):
- HOT: lead menyatakan niat beli/kirim barang, menyebut jumlah, meminta invoice atau pembayaran, atau meminta langkah pengiriman konkret.
- WARM: lead menanyakan harga, stok, atau detail produk tanpa komitmen; berminat tetapi masih menggali informasi.
- COLD: lead hanya menyapa, menjawab singkat, menolak, menunda tanpa alasan, atau berbicara di luar topik produk.

ATURAN:
- Nilai lead, bukan pesan terakhir saja: baca seluruh percakapan.
- Jangan menaikkan level karena basa-basi, sapaan, atau emoji.
- Keberatan harga, ragu, dan "nanti saya pikir" bukan HOT.
- Satu lead hanya punya satu level; sebutkan alasan yang merujuk bukti.
- Setiap keputusan wajib menyertakan evidenceWamid milik salah satu pesan pada input.`;

const REPLY_TYPE_RUBRIC = `JENIS JAWABAN LEAD:
- Komitmen: setuju membeli, transfer, atau meminta diproses.
- Tanya lanjut: bertanya harga, stok, pengiriman, atau detail lain.
- Keberatan: menolak harga/klaim dengan alasan.
- Menunda: menunda tanpa menolak ("nanti saya kabari").
- Menolak: menyatakan tidak berminat atau berhenti.
- Pengakuan netral: menjawab singkat tanpa arah ("oke", "hmm").
- Di luar topik: tidak berkaitan dengan produk atau transaksi.`;

const SENTIMENT_RUBRIC = `SENTIMEN: positif (tertarik/setuju), netral (informatif), negatif (kecewa/menolak).
KEYAKINAN: rendah (bukti tipis), sedang (bukti jelas), tinggi (bukti eksplisit seperti jumlah atau permintaan invoice).`;

/** Tenant offer context when present; the default rubric alone when the tenant has none. */
export function rubricFor(tenant: {name: string; address: string | null} | null): string {
    const offer: string[] = [];
    if (tenant !== null && tenant.name.trim() !== "") {
        offer.push(`Nama penjual: ${tenant.name.trim()}`);
    }
    if (tenant !== null && (tenant.address ?? "").trim() !== "") {
        offer.push(`Lokasi/penawaran: ${(tenant.address ?? "").trim()}`);
    }

    return [
        ...(offer.length === 0 ? ["Konteks penawaran: belum diisi, gunakan rubrik default."] : offer),
        DEFAULT_RUBRIC,
        REPLY_TYPE_RUBRIC,
        SENTIMENT_RUBRIC,
    ].join("\n");
}

export const SIGNAL_INSTRUCTION = `TUGAS TINGKAT 1: ekstrak sinyal per pesan lead.
Balas JSON {signals: [{wamid, intent, product, budget, urgency, objection, sentiment}]}.
Satu entri untuk setiap pesan dengan sender "LEAD" pada input; jangan mengarang wamid.
Gunakan string kosong bila informasi tidak disebut.`;

export const DECISION_INSTRUCTION = `TUGAS TINGKAT 2: tentukan level lead dari sinyal dan percakapan.
Balas JSON {level, confidence, reason, evidenceWamid, responseType, sentiment, topic, quote}.
evidenceWamid wajib salah satu wamid pada input; responseType hanya untuk pesan lead terakhir.
topic: frasa pendek tentang hal yang dibahas percakapan; string kosong bila tidak ada.
quote: kutipan pendek persis (verbatim) dari salah satu pesan "LEAD"; string kosong bila tidak ada.
Jangan mengarang topic atau quote; jangan memakai skor angka.`;
