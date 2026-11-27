import {DatabaseRepository} from "./base.repository";
import {RefreshTokenEntity} from "@db/schema/core/refresh-token.entity";
import {and, eq, gt, isNull} from "drizzle-orm";

export class RefreshTokenRepository extends DatabaseRepository {
    async create(data: typeof RefreshTokenEntity.$inferInsert) {
        const [entity] = await this.database.insert(RefreshTokenEntity)
            .values(data)
            .returning();
        return entity;
    }

    async findValid(token: string) {
        const [entity] = await this.database.select()
            .from(RefreshTokenEntity)
            .where(
                and(
                    eq(RefreshTokenEntity.token, token),
                    isNull(RefreshTokenEntity.revokedAt),
                    gt(RefreshTokenEntity.expiresAt, new Date())
                )
            )
            .limit(1);
        return entity ?? null;
    }

    async revoke(token: string) {
        const [entity] = await this.database.update(RefreshTokenEntity)
            .set({revokedAt: new Date()})
            .where(eq(RefreshTokenEntity.token, token))
            .returning();
        return entity ?? null;
    }

    async revokeAllForUser(userId: string) {
        await this.database.update(RefreshTokenEntity)
            .set({revokedAt: new Date()})
            .where(and(eq(RefreshTokenEntity.userId, userId), isNull(RefreshTokenEntity.revokedAt)));
    }
}
