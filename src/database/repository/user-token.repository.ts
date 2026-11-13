import {DatabaseRepository} from "@/database/repository/repository";
import {UserTokenEntity, tokenTypeEnum} from "@/database/entity/user-token.entity";
import {and, eq, gt} from "drizzle-orm";

export class UserTokenRepository extends DatabaseRepository {
    async create(token: typeof UserTokenEntity.$inferInsert) {
        const [entity] = await this.database.insert(UserTokenEntity)
            .values(token)
            .returning();

        return entity;
    }

    async findValid(code: string, type: typeof tokenTypeEnum.enumValues[number], userId?: string) {
        const conditions = [
            eq(UserTokenEntity.code, code),
            eq(UserTokenEntity.type, type),
            eq(UserTokenEntity.isUsed, false),
            gt(UserTokenEntity.expiresAt, new Date())
        ];

        if (userId) {
            conditions.push(eq(UserTokenEntity.userId, userId));
        }

        const [entity] = await this.database.select()
            .from(UserTokenEntity)
            .where(and(...conditions))
            .limit(1);

        return entity ?? null;
    }

    async markAsUsed(id: string) {
        const [entity] = await this.database.update(UserTokenEntity)
            .set({
                isUsed: true,
                usedAt: new Date()
            })
            .where(eq(UserTokenEntity.id, id))
            .returning();

        return entity ?? null;
    }
}
