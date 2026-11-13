import {DatabaseRepository} from "@/database/repository/repository";
import {WaSessionEntity} from "@/database/entity/wa-session.entity";
import {eq} from "drizzle-orm";

export class WaSessionRepository extends DatabaseRepository {
    async findAllByTenantId(tenantId: string) {
        return this.database.select()
            .from(WaSessionEntity)
            .where(eq(WaSessionEntity.tenantId, tenantId));
    }

    async findById(id: string) {
        const [entity] = await this.database.select()
            .from(WaSessionEntity)
            .where(eq(WaSessionEntity.id, id))
            .limit(1);

        return entity ?? null;
    }

    async create(session: typeof WaSessionEntity.$inferInsert) {
        const [entity] = await this.database.insert(WaSessionEntity)
            .values(session)
            .returning();

        return entity;
    }

    async update(id: string, session: Partial<typeof WaSessionEntity.$inferInsert>) {
        const [entity] = await this.database.update(WaSessionEntity)
            .set(session)
            .where(eq(WaSessionEntity.id, id))
            .returning();

        return entity ?? null;
    }

    async delete(id: string) {
        const [entity] = await this.database.delete(WaSessionEntity)
            .where(eq(WaSessionEntity.id, id))
            .returning();

        return entity ?? null;
    }
}