import {DatabaseRepository} from "./base.repository";
import {MetaConnectionEntity} from "@db/schema/ads/meta-connection.entity";
import {desc, eq} from "drizzle-orm";

export class MetaConnectionRepository extends DatabaseRepository {
    async findByUserId(userId: string) {
        const [entity] = await this.database.select()
            .from(MetaConnectionEntity)
            .where(eq(MetaConnectionEntity.userId, userId))
            .limit(1);

        return entity ?? null;
    }

    async upsert(connection: typeof MetaConnectionEntity.$inferInsert) {
        const [entity] = await this.database.insert(MetaConnectionEntity)
            .values(connection)
            .onConflictDoUpdate({
                target: [MetaConnectionEntity.tenantId, MetaConnectionEntity.metaUserId],
                set: {
                    userId: connection.userId,
                    metaUserName: connection.metaUserName,
                    accessToken: connection.accessToken,
                    scopes: connection.scopes,
                    expiresAt: connection.expiresAt,
                    updatedAt: new Date()
                }
            })
            .returning();

        return entity;
    }

    async deleteByUserId(userId: string) {
        const [entity] = await this.database.delete(MetaConnectionEntity)
            .where(eq(MetaConnectionEntity.userId, userId))
            .returning({id: MetaConnectionEntity.id});

        return entity ?? null;
    }

    async findActiveConnections() {
        return this.database.select()
            .from(MetaConnectionEntity);
    }

    /** The newest connection of a tenant: one token drives the Graph calls for that tenant. */
    async findByTenantId(tenantId: string) {
        const [entity] = await this.database.select()
            .from(MetaConnectionEntity)
            .where(eq(MetaConnectionEntity.tenantId, tenantId))
            .orderBy(desc(MetaConnectionEntity.updatedAt))
            .limit(1);

        return entity ?? null;
    }
}
