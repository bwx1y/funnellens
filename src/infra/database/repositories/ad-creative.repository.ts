import {DatabaseRepository} from "./base.repository";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {eq} from "drizzle-orm";

export class AdCreativeRepository extends DatabaseRepository {
    async upsertBatch(creatives: (typeof AdCreativeEntity.$inferInsert)[]): Promise<void> {
        if (creatives.length === 0) return;

        await this.database.insert(AdCreativeEntity)
            .values(creatives)
            .onConflictDoUpdate({
                target: AdCreativeEntity.id,
                set: {
                    name: AdCreativeEntity.name,
                    objectType: AdCreativeEntity.objectType,
                    status: AdCreativeEntity.status,
                    videoId: AdCreativeEntity.videoId,
                    videoLengthSeconds: AdCreativeEntity.videoLengthSeconds,
                    videoPermalinkUrl: AdCreativeEntity.videoPermalinkUrl,
                    imageUrl: AdCreativeEntity.imageUrl,
                    thumbnailUrl: AdCreativeEntity.thumbnailUrl,
                    objectStoryId: AdCreativeEntity.objectStoryId,
                    body: AdCreativeEntity.body,
                    title: AdCreativeEntity.title,
                    callToActionType: AdCreativeEntity.callToActionType,
                    urlTags: AdCreativeEntity.urlTags,
                    createdTime: AdCreativeEntity.createdTime,
                    updatedTime: AdCreativeEntity.updatedTime,
                    raw: AdCreativeEntity.raw,
                },
            });
    }

    async findByAccountId(accountId: string): Promise<(typeof AdCreativeEntity.$inferSelect)[]> {
        return this.database.select()
            .from(AdCreativeEntity)
            .where(eq(AdCreativeEntity.accountId, accountId));
    }
}
