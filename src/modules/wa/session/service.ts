import {WaSessionSchema} from "@/modules/wa/session/schema";
import {OpenWAClient} from "@rmyndharis/openwa";
import {Config} from "@/config";

import {WaSessionRepository} from "@/database/repository/wa-session.repository";
import {NotFoundError} from "@/utils/error";
import {logger} from "@/utils/logger";
import {QueueManager} from "@/utils/queue";

export class WaSessionService {
    static readonly QUEUE_NAME = "queue-session-wa";

    private readonly waSessionRepository = new WaSessionRepository();
    private readonly openWa = new OpenWAClient({
        baseUrl: Config.openWa.url,
        apiKey: Config.openWa.appKey
    });
    private readonly setupSessionQueue = new QueueManager<{ code: string }>(WaSessionService.QUEUE_NAME)

    async findAll(tenantId: string) {
        return this.waSessionRepository.findAllByTenantId(tenantId);
    }

    async findOne(tenantId: string, id: string) {
        const entity = await this.waSessionRepository.findById(id);
        if (entity == null || entity.tenantId !== tenantId) {
            throw new NotFoundError("Session not found");
        }

        return entity;
    }

    async findQrCode(tenantId: string, id: string) {
        // ponytail: tenant ownership check only; gateway status is the source of truth, since the DB row is not synced after start.
        const result = await this.findOne(tenantId, id);

        if (result.status == "created") {
            await this.openWa.sessions.start(id);
            await this.waSessionRepository.update(id, {
                status: "ready"
            });
        }

        const qr = await this.openWa.sessions.getQrCode(id);

        return {
            code: qr.qrCode
        };
    }

    async create(tenantId: string, body: WaSessionSchema["create"]) {
        const request = await this.openWa.sessions.create({
            name: `${tenantId}-${body.name}`
        })

        await this.setupSessionQueue.add("create", {code: request.id})

        return this.waSessionRepository.create({
            id: request.id,
            tenantId: tenantId,
            name: body.name,
            status: request.status,
            phoneName: null,
            phoneNumber: null
        });
    }

    async update(tenantId: string, id: string, body: WaSessionSchema["update"]) {
        await this.findOne(tenantId, id);

        const entity = await this.waSessionRepository.update(id, body);
        if (entity == null) {
            throw new NotFoundError("Session not found");
        }

        return entity;
    }

    async delete(tenantId: string, id: string) {
        await this.findOne(tenantId, id);

        // ponytail: gateway delete is best-effort; a session already gone upstream must not block local cleanup.
        try {
            await this.openWa.sessions.delete(id);
        } catch (error) {
            logger.warn({error, id}, "Failed to delete session on WhatsApp gateway");
        }

        const entity = await this.waSessionRepository.delete(id);
        if (entity == null) {
            throw new NotFoundError("Session not found");
        }

        return entity;
    }
}