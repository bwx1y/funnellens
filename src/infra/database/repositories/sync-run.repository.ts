import {DatabaseRepository} from "./base.repository";
import {SyncRunEntity} from "@db/schema/ads/sync-run.entity";
import {and, desc, eq} from "drizzle-orm";

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
