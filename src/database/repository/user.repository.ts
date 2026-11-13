import {DatabaseRepository} from "@/database/repository/repository";
import {UserEntity} from "@/database/entity/user.entity";
import {TenantEntity} from "@/database/entity/tenant.entity";
import {and, eq} from "drizzle-orm";

export class UserRepository extends DatabaseRepository {
    async findOneByEmail(email: string) {
        const [entity] = await this.database.select({
            user: UserEntity,
            tenant: TenantEntity
        })
            .from(UserEntity)
            .innerJoin(TenantEntity, eq(UserEntity.tenantId, TenantEntity.id))
            .where(eq(UserEntity.email, email))
            .limit(1);

        return entity ?? null;
    }

    async findOneById(id: string) {
        const [entity] = await this.database.select({
            user: UserEntity,
            tenant: TenantEntity
        })
            .from(UserEntity)
            .innerJoin(TenantEntity, eq(UserEntity.tenantId, TenantEntity.id))
            .where(eq(UserEntity.id, id))
            .limit(1);

        return entity ?? null;
    }

    async create(user: typeof UserEntity.$inferInsert) {
        const [entity] = await this.database.insert(UserEntity)
            .values(user)
            .returning()

        return entity;
    }

    async update(id: string, user: Partial<typeof UserEntity.$inferInsert>) {
        const [entity] = await this.database.update(UserEntity)
            .set(user)
            .where(eq(UserEntity.id, id))
            .returning();

        return entity ?? null;
    }

    async findAllByTenantId(tenantId: string) {
        return this.database.select({
            id: UserEntity.id,
            fullName: UserEntity.fullName,
            email: UserEntity.email,
            role: UserEntity.role,
            isVerified: UserEntity.isVerified,
            tenantId: UserEntity.tenantId,
        })
            .from(UserEntity)
            .where(eq(UserEntity.tenantId, tenantId));
    }

    async findByIdAndTenantId(id: string, tenantId: string) {
        const [entity] = await this.database.select({
            id: UserEntity.id,
            fullName: UserEntity.fullName,
            email: UserEntity.email,
            role: UserEntity.role,
            isVerified: UserEntity.isVerified,
            tenantId: UserEntity.tenantId,
        })
            .from(UserEntity)
            .where(and(eq(UserEntity.id, id), eq(UserEntity.tenantId, tenantId)))
            .limit(1);

        return entity ?? null;
    }

    async updateByTenantId(id: string, tenantId: string, user: Partial<typeof UserEntity.$inferInsert>) {
        const [entity] = await this.database.update(UserEntity)
            .set(user)
            .where(and(eq(UserEntity.id, id), eq(UserEntity.tenantId, tenantId)))
            .returning({
                id: UserEntity.id,
                fullName: UserEntity.fullName,
                email: UserEntity.email,
                role: UserEntity.role,
                isVerified: UserEntity.isVerified,
                tenantId: UserEntity.tenantId,
            });

        return entity ?? null;
    }

    async deleteByTenantId(id: string, tenantId: string) {
        const [entity] = await this.database.delete(UserEntity)
            .where(and(eq(UserEntity.id, id), eq(UserEntity.tenantId, tenantId)))
            .returning({
                id: UserEntity.id,
            });

        return entity ?? null;
    }
}