import {DatabaseRepository} from "./base.repository";
import {MetaConnectionEntity} from "@db/schema/ads/meta-connection.entity";
import {decrypt, encrypt} from "@shared/crypto";
import {and, desc, eq, isNotNull, lte} from "drizzle-orm";

export type MetaConnection = typeof MetaConnectionEntity.$inferSelect;

/**
 * The only place that touches `access_token`/`refresh_token`. Both are stored as AES-256-GCM
 * ciphertext, so every read decrypts and every write encrypts here; a caller that received a row from
 * this repository always holds a usable plaintext token, and one that reads the table directly never
 * sees one.
 */
export class MetaConnectionRepository extends DatabaseRepository {
    async findByUserId(userId: string): Promise<MetaConnection | null> {
        const [entity] = await this.database.select()
            .from(MetaConnectionEntity)
            .where(eq(MetaConnectionEntity.userId, userId))
            .limit(1);

        return entity === undefined ? null : this.decode(entity);
    }

    async upsert(connection: typeof MetaConnectionEntity.$inferInsert): Promise<MetaConnection> {
        const [entity] = await this.database.insert(MetaConnectionEntity)
            .values(this.encode(connection))
            .onConflictDoUpdate({
                target: [MetaConnectionEntity.tenantId, MetaConnectionEntity.metaUserId],
                set: {
                    userId: connection.userId,
                    metaUserName: connection.metaUserName,
                    accessToken: encrypt(connection.accessToken),
                    refreshToken: connection.refreshToken === undefined || connection.refreshToken === null
                        ? null
                        : encrypt(connection.refreshToken),
                    scopes: connection.scopes,
                    expiresAt: connection.expiresAt,
                    tokenRefreshedAt: new Date(),
                    updatedAt: new Date()
                }
            })
            .returning();

        return this.decode(entity);
    }

    async deleteByUserId(userId: string) {
        const [entity] = await this.database.delete(MetaConnectionEntity)
            .where(eq(MetaConnectionEntity.userId, userId))
            .returning({id: MetaConnectionEntity.id});

        return entity ?? null;
    }

    async findActiveConnections(): Promise<MetaConnection[]> {
        const rows = await this.database.select()
            .from(MetaConnectionEntity);

        return rows.map((row) => this.decode(row));
    }

    /** The newest connection of a tenant: one token drives the Graph calls for that tenant. */
    async findByTenantId(tenantId: string): Promise<MetaConnection | null> {
        const [entity] = await this.database.select()
            .from(MetaConnectionEntity)
            .where(eq(MetaConnectionEntity.tenantId, tenantId))
            .orderBy(desc(MetaConnectionEntity.updatedAt))
            .limit(1);

        return entity === undefined ? null : this.decode(entity);
    }

    /**
     * Stores a renewed token. Separate from `upsert` because a refresh knows nothing about the user,
     * scopes, or tenant: it only replaces the secret and pushes the expiry out.
     */
    async updateTokens(id: string, tokens: {
        accessToken: string;
        refreshToken?: string | null;
        expiresAt: Date | null;
    }): Promise<MetaConnection | null> {
        const [entity] = await this.database.update(MetaConnectionEntity)
            .set({
                accessToken: encrypt(tokens.accessToken),
                ...(tokens.refreshToken === undefined || tokens.refreshToken === null
                    ? {}
                    : {refreshToken: encrypt(tokens.refreshToken)}),
                expiresAt: tokens.expiresAt,
                tokenRefreshedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(MetaConnectionEntity.id, id))
            .returning();

        return entity === undefined ? null : this.decode(entity);
    }

    /** Connections whose stored expiry falls inside the refresh window; a null expiry never refreshes. */
    async findExpiringBefore(threshold: Date): Promise<MetaConnection[]> {
        const rows = await this.database.select()
            .from(MetaConnectionEntity)
            .where(and(
                isNotNull(MetaConnectionEntity.expiresAt),
                lte(MetaConnectionEntity.expiresAt, threshold)
            ));

        return rows.map((row) => this.decode(row));
    }

    private encode(connection: typeof MetaConnectionEntity.$inferInsert): typeof MetaConnectionEntity.$inferInsert {
        return {
            ...connection,
            accessToken: encrypt(connection.accessToken),
            refreshToken: connection.refreshToken === undefined || connection.refreshToken === null
                ? null
                : encrypt(connection.refreshToken),
        };
    }

    private decode(entity: MetaConnection): MetaConnection {
        return {
            ...entity,
            accessToken: decrypt(entity.accessToken),
            refreshToken: entity.refreshToken === null ? null : decrypt(entity.refreshToken),
        };
    }
}
