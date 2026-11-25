import {describe, expect, it} from "bun:test";
import {createHmac} from "node:crypto";
import {maskPhone, maskText, normalizePhone} from "@shared/phone";
import {CloudIngestService} from "@/modules/wa/cloud/service";

function sign(raw: string, secret: string): string {
    return "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
}

describe("phone helpers", () => {
    it("normalizes Indonesian mobile numbers to E.164", () => {
        expect(normalizePhone("6281234567890")).toBe("+6281234567890");
        expect(normalizePhone("081234567890")).toBe("+6281234567890");
        expect(normalizePhone("81234567890")).toBe("+6281234567890");
        expect(normalizePhone("6281234567890@s.whatsapp.net")).toBe("+6281234567890");
        expect(normalizePhone("")).toBe("");
    });

    it("masks the middle of a phone number", () => {
        expect(maskPhone("+6281234567890")).toBe("+628****7890");
        expect(maskPhone("+6281")).toBe("****");
    });

    it("masks every run of six or more digits", () => {
        expect(maskText("Transfer 1234567890 sekarang")).toBe("Transfer #### sekarang");
        expect(maskText("kode 12345")).toBe("kode 12345");
    });
});

describe("CloudIngestService.isValidSignature", () => {
    const raw = JSON.stringify({object: "whatsapp_business_account", entry: []});

    it("accepts the HMAC-SHA256 of the raw body", () => {
        const service = new CloudIngestService(undefined, undefined, undefined, undefined, undefined, undefined, "s3cret");

        expect(service.signatureConfigured).toBe(true);
        expect(service.isValidSignature(raw, sign(raw, "s3cret"))).toBe(true);
        expect(service.isValidSignature(raw + " ", sign(raw, "s3cret"))).toBe(false);
    });

    it("rejects a tampered signature and a missing header", () => {
        const service = new CloudIngestService(undefined, undefined, undefined, undefined, undefined, undefined, "s3cret");
        const header = sign(raw, "s3cret");
        const tampered = header.slice(0, -1) + (header.endsWith("0") ? "1" : "0");

        expect(service.isValidSignature(raw, tampered)).toBe(false);
        expect(service.isValidSignature(raw, null)).toBe(false);
        expect(service.isValidSignature(raw, "deadbeef")).toBe(false);
        expect(service.isValidSignature(raw, "sha256=zzzz")).toBe(false);
    });

    it("rejects every request when the app secret is empty or the placeholder", () => {
        for (const secret of ["", "APP_SECRET"]) {
            const service = new CloudIngestService(undefined, undefined, undefined, undefined, undefined, undefined, secret);

            expect(service.signatureConfigured).toBe(false);
            expect(service.isValidSignature(raw, sign(raw, secret))).toBe(false);
        }
    });
});
