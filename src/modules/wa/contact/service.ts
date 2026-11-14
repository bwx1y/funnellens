import {WaMessageRepository} from "@/database/repository/wa-message.repository";

export class WaContactService {
    private readonly waMessageRepository = new WaMessageRepository()

    async getAll(tenantId: string, sessionId?: string) {
        return this.waMessageRepository.findAllByTenantIdAndGrubByPhone(tenantId, sessionId)
    }

    async stats(tenantId: string) {
        return this.waMessageRepository.getAudienceLevelStats(tenantId)
    }
}