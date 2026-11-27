import {createCipheriv, createDecipheriv, createHash, randomBytes} from "node:crypto";
import {Config} from "@/config";

const PREFIX = "v1";
const IV_BYTES = 12;

/** AES-256-GCM needs a 32-byte key; the app secret is arbitrary text, so it is hashed once. */
function key(): Buffer {
    return createHash("sha256").update(Config.application.secret).digest();
}

/**
 * Authenticated encryption for values that must not sit in the database as plaintext (Meta tokens,
 * message bodies). The version prefix makes a future algorithm change detectable instead of silently
 * corrupting rows, and the GCM tag makes tampering a thrown error rather than garbage output.
 */
export function encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);

    return [
        PREFIX,
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        ciphertext.toString("base64"),
    ].join(":");
}

/** Throws on a tampered payload or a wrong key; callers decide whether that is fatal. */
export function decrypt(payload: string): string {
    const [version, ivB64, tagB64, cipherB64] = payload.split(":");
    if (version !== PREFIX || ivB64 === undefined || tagB64 === undefined || cipherB64 === undefined) {
        throw new Error("Nilai terenkripsi tidak dikenali");
    }

    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    return Buffer.concat([
        decipher.update(Buffer.from(cipherB64, "base64")),
        decipher.final(),
    ]).toString("utf8");
}

/** `true` for a value this module already produced; used by the one-off backfill. */
export function isEncrypted(value: string): boolean {
    return value.startsWith(`${PREFIX}:`);
}
