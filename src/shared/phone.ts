import {createHash} from "node:crypto";
import {Config} from "@/config";

/**
 * Canonical E.164 form of a WhatsApp sender: drops the `@s.whatsapp.net` / `@lid` suffix, keeps the
 * digits only, and rewrites the Indonesian mobile prefix (`0…` / `8…`) to `62…`.
 * Returns `""` when nothing numeric is left.
 */
export function normalizePhone(raw: string): string {
    const digits = raw.trim().split("@")[0].replace(/\D/g, "");
    if (digits === "") return "";

    if (digits.startsWith("0")) return "+62" + digits.slice(1);
    if (digits.startsWith("8")) return "+62" + digits;
    return "+" + digits;
}

/** Raw numbers are never stored: `external_id` / `phone_hash` are this salted SHA-256. */
export function phoneHash(phoneE164: string): string {
    return createHash("sha256").update(phoneE164 + Config.application.secret).digest("hex");
}

/** `+6281234567890` → `+628****7890`; short numbers collapse to `****`. */
export function maskPhone(phoneE164: string): string {
    if (phoneE164.length <= 8) return "****";
    return phoneE164.slice(0, 4) + "****" + phoneE164.slice(-4);
}

/** Every run of 6+ digits (card numbers, transfer amounts) collapses to `####`. */
export function maskText(body: string): string {
    return body.replace(/\d{6,}/g, "####");
}
