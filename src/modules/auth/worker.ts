import {WorkerManager} from "@/utils/queue";
import {AuthService} from "@/modules/auth/service";
import {MailUtil} from "@/utils/mail";

export interface SendEmailTokenJob {
    type: "verification" | "reset-password";
    to: string;
    name: string;
    code: string;
}

export interface SendSessionDisconnectedJob {
    type: "session-disconnected";
    to: string;
    tenantName: string;
    sessionName: string;
    reason: string;
    disconnectedAt: string;
}

export type SendEmailJob = SendEmailTokenJob | SendSessionDisconnectedJob;

export const emailWorker = new WorkerManager<SendEmailJob>(AuthService.QUEUE_NAME, async (job) => {
    const data = job.data;

    if (data.type === "session-disconnected") {
        const html = await MailUtil.renderFile("session-disconnected.html", {
            tenantName: data.tenantName,
            sessionName: data.sessionName,
            reason: data.reason,
            disconnectedAt: data.disconnectedAt,
        });

        await MailUtil.send({
            to: data.to,
            subject: `Sesi WhatsApp "${data.sessionName}" terputus`,
            html,
        });
        return;
    }

    const isVerification = data.type === "verification";
    const template = isVerification ? "verification.html" : "reset-password.html";
    const subject = isVerification ? "Verifikasi Email" : "Reset Password";

    const html = await MailUtil.renderFile(template, {name: data.name, code: data.code});
    await MailUtil.send({to: data.to, subject, html});
});