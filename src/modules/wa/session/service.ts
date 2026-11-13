import {WaSessionSchema} from "@/modules/wa/session/schema";
import {OpenWAClient} from "@rmyndharis/openwa";
import {Config} from "@/config";

import {WaSessionRepository} from "@/database/repository/wa-session.repository";
import {NotFoundError} from "@/utils/error";
import {logger} from "@/utils/logger";

export class WaSessionService {
    private readonly waSessionRepository = new WaSessionRepository();
    private readonly openWa = new OpenWAClient({
        baseUrl: Config.openWa.url,
        apiKey: Config.openWa.appKey
    });

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
        await this.findOne(tenantId, id);

        const qr = await this.openWa.sessions.getQrCode(id);

        return {
            code: qr.qrCode
        };
    }

    async create(tenantId: string, body: WaSessionSchema["create"]) {
        const request = await this.openWa.sessions.create({
            name: `${tenantId}-${body.name}`
        })

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