import {DatabaseRepository} from "./base.repository";
import {SyncRunEntity} from "@db/schema/ads/sync-run.entity";
import {and, desc, eq, isNotNull} from "drizzle-orm";

export interface SyncRunFailure {
    error: string | null;
    finishedAt: Date | null;
}

export class SyncRunRepository extends DatabaseRepository {
    async create(run: typeof SyncRunEntity.$inferInsert): Promise<typeof SyncRunEntity.$inferSelect> {
        const [entity] = await this.database.insert(SyncRunEntity)
            .values(run)
            .returning();

        return entity;
    }

    async complete(id: number, rowsSynced: number): Promise<void> {
        await this.database.update(SyncRunEntity)
            .set({
                status: "SUCCESS",
                finishedAt: new Date(),
                rowsUpserted: rowsSynced,
            })
            .where(eq(SyncRunEntity.id, id));
    }

    async fail(id: number, error: string): Promise<void> {
        await this.database.update(SyncRunEntity)
            .set({
                status: "FAILED",
                finishedAt: new Date(),
                error,
            })
            .where(eq(SyncRunEntity.id, id));
    }

    async findById(id: number): Promise<typeof SyncRunEntity.$inferSelect | null> {
        const [entity] = await this.database.select()
            .from(SyncRunEntity)
            .where(eq(SyncRunEntity.id, id))
            .limit(1);

        return entity ?? null;
    }

    /** `finished_at` of the newest successful run: the stored proof that a sync completed. */
    async findLatestSuccessAt(accountId: string): Promise<Date | null> {
        const [entity] = await this.database.select({finishedAt: SyncRunEntity.finishedAt})
            .from(SyncRunEntity)
            .where(and(
                eq(SyncRunEntity.accountId, accountId),
                eq(SyncRunEntity.status, "SUCCESS"),
                isNotNull(SyncRunEntity.finishedAt)
            ))
            .orderBy(desc(SyncRunEntity.finishedAt))
            .limit(1);

        return entity?.finishedAt ?? null;
    }

    /**
     * Newest failed run, with its finish time: the caller needs the timestamp to tell a current error
     * from one a later successful run already cleared.
     */
    async findLatestFailure(accountId: string): Promise<SyncRunFailure | null> {
        const [entity] = await this.database.select({
            error: SyncRunEntity.error,
            finishedAt: SyncRunEntity.finishedAt,
        })
            .from(SyncRunEntity)
            .where(and(
                eq(SyncRunEntity.accountId, accountId),
                eq(SyncRunEntity.status, "FAILED"),
                isNotNull(SyncRunEntity.error)
            ))
            .orderBy(desc(SyncRunEntity.finishedAt), desc(SyncRunEntity.id))
            .limit(1);

        if (entity === undefined) return null;

        return {error: entity.error, finishedAt: entity.finishedAt};
    }

    /** Newest successful insight sync across every account: the readiness probe has no account context. */
    async findLatestSuccessAnyAccount(): Promise<Date | null> {
        const [entity] = await this.database.select({finishedAt: SyncRunEntity.finishedAt})
            .from(SyncRunEntity)
            .where(and(
                eq(SyncRunEntity.status, "SUCCESS"),
                isNotNull(SyncRunEntity.finishedAt)
            ))
            .orderBy(desc(SyncRunEntity.finishedAt))
            .limit(1);

        return entity?.finishedAt ?? null;
    }

    async getLatestByAccountId(accountId: string, resource?: string): Promise<typeof SyncRunEntity.$inferSelect | null> {
        const conditions = [eq(SyncRunEntity.accountId, accountId)];
        if (resource) {
            conditions.push(eq(SyncRunEntity.resource, resource));
        }

        const [entity] = await this.database.select()
            .from(SyncRunEntity)
            .where(and(...conditions))
            .orderBy(desc(SyncRunEntity.startedAt))
            .limit(1);

        return entity ?? null;
    }
}
