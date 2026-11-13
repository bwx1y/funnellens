import {WorkerManager} from "@/utils/queue";
import {AuthService} from "@/modules/auth/service";
import {MailUtil} from "@/utils/mail";

export interface SendEmailTokenJob {
    type: "verification" | "reset-password";
    to: string;
    name: string;
    code: string;
}

export const emailWorker = new WorkerManager<SendEmailTokenJob>(AuthService.QUEUE_NAME, async (job) => {
    const {type, to, name, code} = job.data;
    const isVerification = type === "verification";
    const template = isVerification ? "verification.html" : "reset-password.html";
    const subject = isVerification ? "Verifikasi Email" : "Reset Password";

    const html = await MailUtil.renderFile(template, {name, code});
    await MailUtil.send({to, subject, html});
});