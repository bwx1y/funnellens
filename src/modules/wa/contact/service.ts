import {WaPhoneRepository} from "@/database/repository/wa-phone.repository";

export class WaContactService {
    private readonly waPhoneRepository = new WaPhoneRepository();

    async getAll(tenantId: string, sessionId?: string) {
        return this.waPhoneRepository.findAllByTenantId(tenantId, sessionId);
    }

    async stats(tenantId: string) {
        return this.waPhoneRepository.getAudienceLevelStats(tenantId);
    }
}
