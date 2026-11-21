import {DatabaseRepository} from "./base.repository";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {eq} from "drizzle-orm";

export class AdRepository extends DatabaseRepository {
    async upsertBatch(ads: (typeof AdEntity.$inferInsert)[]): Promise<void> {
        if (ads.length === 0) return;

        await this.database.insert(AdEntity)
            .values(ads)
            .onConflictDoUpdate({
                target: AdEntity.id,
                set: {
                    name: AdEntity.name,
                    campaignId: AdEntity.campaignId,
                    adsetId: AdEntity.adsetId,
                    creativeId: AdEntity.creativeId,
                    status: AdEntity.status,
                    effectiveStatus: AdEntity.effectiveStatus,
                    createdTime: AdEntity.createdTime,
                    updatedTime: AdEntity.updatedTime,
                    raw: AdEntity.raw,
                },
            });
    }

    async findByAdSetId(adsetId: string): Promise<(typeof AdEntity.$inferSelect)[]> {
        return this.database.select()
            .from(AdEntity)
            .where(eq(AdEntity.adsetId, adsetId))
            .orderBy(AdEntity.name);
    }
}
