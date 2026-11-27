import {DatabaseRepository} from "./base.repository";
import {PixelSourceEntity} from "@db/schema/ads/pixel-source.entity";
import {eq, sql} from "drizzle-orm";

export type PixelSource = typeof PixelSourceEntity.$inferSelect;

export class PixelSourceRepository extends DatabaseRepository {
    /**
     * Idempotent on `(account_id, pixel_id)`. The set block reads `excluded.*`: referencing the
     * table's own columns would leave the existing row untouched on conflict.
     */
    async upsert(source: typeof PixelSourceEntity.$inferInsert): Promise<PixelSource> {
        const [entity] = await this.database.insert(PixelSourceEntity)
            .values(source)
            .onConflictDoUpdate({
                target: [PixelSourceEntity.accountId, PixelSourceEntity.pixelId],
                set: {
                    name: sql`excluded.name`,
                    capiConfigured: sql`excluded.capi_configured`,
                    lastEventAt: sql`excluded.last_event_at`,
                    emqAvg: sql`excluded.emq_avg`,
                    lastSyncedAt: sql`excluded.last_synced_at`,
                    raw: sql`excluded.raw`,
                },
            })
            .returning();

        return entity;
    }

    async findByAccountId(accountId: string): Promise<PixelSource[]> {
        return this.database.select()
            .from(PixelSourceEntity)
            .where(eq(PixelSourceEntity.accountId, accountId))
            .orderBy(PixelSourceEntity.pixelId);
    }
}
