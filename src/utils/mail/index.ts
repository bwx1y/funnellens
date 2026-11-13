import nodemailer from "nodemailer";
import type {Transporter, SendMailOptions} from "nodemailer";
import {join} from "node:path";
import {Config} from "@/config";

export interface SendMailPayload {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export class MailUtil {
    private static transporter: Transporter | null = null;

    private static getTransporter(): Transporter {
        if (!this.transporter) {
            this.transporter = nodemailer.createTransport({
                host: Config.email.host,
                port: Config.email.port,
                secure: Config.email.secure,
                auth: Config.email.user
                    ? {
                        user: Config.email.user,
                        pass: Config.email.pass,
                    }
                    : undefined,
            });
        }
        return this.transporter;
    }

    static async send(options: SendMailPayload): Promise<void> {
        const mailOptions: SendMailOptions = {
            from: Config.email.from,
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text,
        };

        await this.getTransporter().sendMail(mailOptions);
    }

    static renderTemplate(template: string, variables: Record<string, string | number>): string {
        return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
            return key in variables ? String(variables[key]) : "";
        });
    }

    // Load template file .html dari folder src/utils/mail/template/
    static async renderFile(filename: string, variables: Record<string, string | number>): Promise<string> {
        const templatePath = join(import.meta.dir, "template", filename);
        const content = await Bun.file(templatePath).text();
        return this.renderTemplate(content, variables);
    }
}
