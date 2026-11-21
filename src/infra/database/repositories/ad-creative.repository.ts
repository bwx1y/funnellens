import {DatabaseRepository} from "./base.repository";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {CreativeTagEntity} from "@db/schema/ads/creative-tag.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdInsightDailyEntity} from "@db/schema/ads/ad-insight-daily.entity";
import {and, eq, inArray, sql} from "drizzle-orm";

const CHUNK_SIZE = 500;

export type AdCreativeWithTags = typeof AdCreativeEntity.$inferSelect & {
    tags: (typeof CreativeTagEntity.$inferSelect)[];
};

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

    async findWithTags(accountId: string): Promise<AdCreativeWithTags[]> {
        const creatives = await this.database.select()
            .from(AdCreativeEntity)
            .where(eq(AdCreativeEntity.accountId, accountId))
            .orderBy(AdCreativeEntity.name);

        if (creatives.length === 0) return [];

        const tags = await this.database.select()
            .from(CreativeTagEntity)
            .where(inArray(CreativeTagEntity.creativeId, creatives.map((creative) => creative.id)));

        const tagsByCreativeId = new Map<string, (typeof CreativeTagEntity.$inferSelect)[]>();
        for (const tag of tags) {
            const bucket = tagsByCreativeId.get(tag.creativeId);
            if (bucket === undefined) {
                tagsByCreativeId.set(tag.creativeId, [tag]);
            } else {
                bucket.push(tag);
            }
        }

        return creatives.map((creative) => ({
            ...creative,
            tags: tagsByCreativeId.get(creative.id) ?? [],
        }));
    }

    async upsertTags(
        creativeId: string,
        tags: Omit<typeof CreativeTagEntity.$inferInsert, "creativeId">[]
    ): Promise<void> {
        if (tags.length === 0) return;

        // Deduplicate within the batch: a repeated conflict target in one statement is rejected by Postgres.
        const byKey = new Map<string, typeof CreativeTagEntity.$inferInsert>();
        for (const tag of tags) {
            const row = {...tag, creativeId};
            byKey.set(`${row.tagType}|${row.tagValue}|${row.source}`, row);
        }

        const rows = [...byKey.values()];
        for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
            await this.database.insert(CreativeTagEntity)
                .values(rows.slice(offset, offset + CHUNK_SIZE))
                .onConflictDoUpdate({
                    target: [
                        CreativeTagEntity.creativeId,
                        CreativeTagEntity.tagType,
                        CreativeTagEntity.tagValue,
                        CreativeTagEntity.source,
                    ],
                    set: {confidence: sql`excluded.confidence`},
                });
        }
    }

    /** Scoped by `creativeId` so a caller cannot delete another creative's tag by guessing the id. */
    async deleteTag(creativeId: string, tagId: number): Promise<boolean> {
        const deleted = await this.database.delete(CreativeTagEntity)
            .where(and(eq(CreativeTagEntity.id, tagId), eq(CreativeTagEntity.creativeId, creativeId)))
            .returning({id: CreativeTagEntity.id});

        return deleted.length > 0;
    }

    /**
     * Creatives that actually have insight rows. Order follows `ids` so the caller can map directly;
     * snapshot scoping is the service's job (`ad_insights_daily` carries no snapshot column).
     */
    async eligibleByIds(accountId: string, ids: string[]): Promise<string[]> {
        if (ids.length === 0) return [];

        const rows = await this.database.selectDistinct({creativeId: AdEntity.creativeId})
            .from(AdEntity)
            .innerJoin(AdInsightDailyEntity, eq(AdInsightDailyEntity.adId, AdEntity.id))
            .where(and(eq(AdEntity.accountId, accountId), inArray(AdEntity.creativeId, ids)));

        const eligible = new Set(rows.map((row) => row.creativeId).filter((id): id is string => id !== null));
        return ids.filter((id) => eligible.has(id));
    }
}
