import {DatabaseRepository} from "./base.repository";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {eq} from "drizzle-orm";

export class CampaignRepository extends DatabaseRepository {
    async upsertBatch(campaigns: (typeof CampaignEntity.$inferInsert)[]): Promise<void> {
        if (campaigns.length === 0) return;

        await this.database.insert(CampaignEntity)
            .values(campaigns)
            .onConflictDoUpdate({
                target: CampaignEntity.id,
                set: {
                    name: CampaignEntity.name,
                    objective: CampaignEntity.objective,
                    status: CampaignEntity.status,
                    effectiveStatus: CampaignEntity.effectiveStatus,
                    buyingType: CampaignEntity.buyingType,
                    dailyBudgetMinor: CampaignEntity.dailyBudgetMinor,
                    lifetimeBudgetMinor: CampaignEntity.lifetimeBudgetMinor,
                    budgetRemainingMinor: CampaignEntity.budgetRemainingMinor,
                    startTime: CampaignEntity.startTime,
                    stopTime: CampaignEntity.stopTime,
                    createdTime: CampaignEntity.createdTime,
                    updatedTime: CampaignEntity.updatedTime,
                    raw: CampaignEntity.raw,
                },
            });
    }

    async findByAccountId(accountId: string): Promise<(typeof CampaignEntity.$inferSelect)[]> {
        return this.database.select()
            .from(CampaignEntity)
            .where(eq(CampaignEntity.accountId, accountId))
            .orderBy(CampaignEntity.name);
    }
}
