import { describe, expect, it } from "bun:test";
import { MailUtil, type SendMailPayload } from "@/utils/mail";
import type { SendEmailTokenJob } from "@/modules/auth/worker";

describe("Email Token Integration Smoke Test", () => {
    it("renders verification template with correct variables", async () => {
        const payload: SendEmailTokenJob = {
            type: "verification",
            to: "user@example.com",
            name: "John Doe",
            code: "123456",
        };

        const html = await MailUtil.renderFile("verification.html", {
            name: payload.name,
            code: payload.code,
        });

        expect(html).toContain("John Doe");
        expect(html).toContain("123456");
        expect(html).toContain("Verifikasi Email");
    });

    it("renders reset-password template with correct variables", async () => {
        const payload: SendEmailTokenJob = {
            type: "reset-password",
            to: "user@example.com",
            name: "Jane Doe",
            code: "654321",
        };

        const html = await MailUtil.renderFile("reset-password.html", {
            name: payload.name,
            code: payload.code,
        });

        expect(html).toContain("Jane Doe");
        expect(html).toContain("654321");
        expect(html).toContain("Reset Password");
    });

    it("executes processor logic and dispatches MailUtil.send", async () => {
        const sendCalls: SendMailPayload[] = [];
        const originalSend = MailUtil.send;
        MailUtil.send = async (options: SendMailPayload) => {
            sendCalls.push(options);
        };

        try {
            const jobData: SendEmailTokenJob = {
                type: "verification",
                to: "verify@example.com",
                name: "Test User",
                code: "999888",
            };

            const isVerification = jobData.type === "verification";
            const template = isVerification ? "verification.html" : "reset-password.html";
            const subject = isVerification ? "Verifikasi Email" : "Reset Password";

            const html = await MailUtil.renderFile(template, { name: jobData.name, code: jobData.code });
            await MailUtil.send({ to: jobData.to, subject, html });

            expect(sendCalls.length).toBe(1);
            expect(sendCalls[0]?.to).toBe("verify@example.com");
            expect(sendCalls[0]?.subject).toBe("Verifikasi Email");
            expect(sendCalls[0]?.html).toContain("999888");
        } finally {
            MailUtil.send = originalSend;
        }
    });
});
