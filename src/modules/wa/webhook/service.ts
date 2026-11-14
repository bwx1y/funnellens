import {WaSessionRepository} from "@/database/repository/wa-session.repository";
import {UserRepository} from "@/database/repository/user.repository";
import {TenantRepository} from "@/database/repository/tenant.repository";
import {QueueManager} from "@/utils/queue";
import {logger} from "@/utils/logger";
import {AuthService} from "@/modules/auth/service";
import type {SendSessionDisconnectedJob} from "@/modules/auth/worker";
import {MessageReceived} from "@/modules/wa/webhook/schema";

export class WaWebhookService {
    static readonly QUEUE_NAME = "WaWebhook-Chat";

    private readonly waSessionRepository = new WaSessionRepository();
    private readonly userRepository = new UserRepository();
    private readonly tenantRepository = new TenantRepository();
    private readonly emailQueue = new QueueManager<SendSessionDisconnectedJob>(AuthService.QUEUE_NAME);
    private readonly chatQueue = new QueueManager<MessageReceived & { session: string }>(WaWebhookService.QUEUE_NAME)

    async authenticated(body: { sessionId: string, phone: string, pushName: string }) {
        await this.waSessionRepository.update(body.sessionId, {
            status: "ready",
            phoneName: body.pushName,
            phoneNumber: body.phone
        });
    }

    async disconnected(body: { sessionId: string, reason?: string, idempotencyKey?: string }) {
        const session = await this.waSessionRepository.findById(body.sessionId);
        if (session == null) {
            logger.warn({sessionId: body.sessionId}, "OpenWA webhook: session not found, skip email");
            return;
        }

        await this.waSessionRepository.update(session.id, {status: "disconnected"});

        if (session.tenantId == null) {
            logger.warn({sessionId: session.id}, "OpenWA webhook: session has no tenant, skip email");
            return;
        }

        const admins = (await this.userRepository.findAllByTenantId(session.tenantId))
            .filter((user) => user.role === "ADMIN");
        if (admins.length === 0) {
            logger.warn({
                sessionId: session.id,
                tenantId: session.tenantId
            }, "OpenWA webhook: tenant has no admin, skip email");
            return;
        }

        const tenant = await this.tenantRepository.findOneById(session.tenantId);

        await this.emailQueue.add("send-session-disconnected", {
            type: "session-disconnected",
            to: admins.map((user) => user.email).join(", "),
            sessionName: session.name,
            tenantName: tenant?.name ?? session.tenantId,
            reason: body.reason?.trim() || "Tidak diketahui",
            disconnectedAt: new Date().toISOString(),
        }, body.idempotencyKey ? {jobId: body.idempotencyKey} : undefined);
    }

    async messageReceived(id: string, body: MessageReceived) {
        await this.chatQueue.add("messageReceived", {
            session: id,
            ...body
        })
    }
}