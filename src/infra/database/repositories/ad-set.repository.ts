import {DatabaseRepository} from "./base.repository";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {eq} from "drizzle-orm";

export class AdSetRepository extends DatabaseRepository {
    async upsertBatch(adSets: (typeof AdSetEntity.$inferInsert)[]): Promise<void> {
        if (adSets.length === 0) return;

        await this.database.insert(AdSetEntity)
            .values(adSets)
            .onConflictDoUpdate({
                target: AdSetEntity.id,
                set: {
                    name: AdSetEntity.name,
                    campaignId: AdSetEntity.campaignId,
                    status: AdSetEntity.status,
                    effectiveStatus: AdSetEntity.effectiveStatus,
                    optimizationGoal: AdSetEntity.optimizationGoal,
                    billingEvent: AdSetEntity.billingEvent,
                    bidStrategy: AdSetEntity.bidStrategy,
                    bidAmountMinor: AdSetEntity.bidAmountMinor,
                    dailyBudgetMinor: AdSetEntity.dailyBudgetMinor,
                    lifetimeBudgetMinor: AdSetEntity.lifetimeBudgetMinor,
                    targeting: AdSetEntity.targeting,
                    startTime: AdSetEntity.startTime,
                    endTime: AdSetEntity.endTime,
                    createdTime: AdSetEntity.createdTime,
                    updatedTime: AdSetEntity.updatedTime,
                    raw: AdSetEntity.raw,
                },
            });
    }

    async findByCampaignId(campaignId: string): Promise<(typeof AdSetEntity.$inferSelect)[]> {
        return this.database.select()
            .from(AdSetEntity)
            .where(eq(AdSetEntity.campaignId, campaignId))
            .orderBy(AdSetEntity.name);
    }
}
