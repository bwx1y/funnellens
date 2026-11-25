import {and, eq} from "drizzle-orm";
import {DatabaseRepository} from "./base.repository";
import {SyncCursorEntity} from "@db/schema/ads/sync-cursors.entity";

export type SyncCursor = typeof SyncCursorEntity.$inferSelect;

/**
 * Resumable page position for `fetchAll`. A cursor is written after every page, so a job killed mid-walk
 * resumes at the next page instead of re-downloading everything it already stored; the row is deleted
 * when the walk reaches its end, which is what makes "no cursor" mean "start from the beginning".
 */
export class SyncCursorRepository extends DatabaseRepository {
    async find(accountId: string, resource: string): Promise<SyncCursor | null> {
        const [entity] = await this.database.select()
            .from(SyncCursorEntity)
            .where(and(
                eq(SyncCursorEntity.accountId, accountId),
                eq(SyncCursorEntity.resource, resource)
            ))
            .limit(1);

        return entity ?? null;
    }

    async save(accountId: string, resource: string, cursor: string): Promise<void> {
        await this.database.insert(SyncCursorEntity)
            .values({accountId, resource, cursor})
            .onConflictDoUpdate({
                target: [SyncCursorEntity.accountId, SyncCursorEntity.resource],
                set: {cursor, updatedAt: new Date()},
            });
    }

    async clear(accountId: string, resource: string): Promise<void> {
        await this.database.delete(SyncCursorEntity)
            .where(and(
                eq(SyncCursorEntity.accountId, accountId),
                eq(SyncCursorEntity.resource, resource)
            ));
    }
}
