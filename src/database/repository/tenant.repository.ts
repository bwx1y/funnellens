import {DatabaseRepository} from "@/database/repository/repository";
import {TenantEntity} from "@/database/entity/tenant.entity";
import {eq} from "drizzle-orm";

export class TenantRepository extends DatabaseRepository {
    async findOneByName(name: string) {
        const [entity] = await this.database.select()
            .from(TenantEntity)
            .where(eq(TenantEntity.name, name.trim()))
            .limit(1)


        return entity ?? null;
    }

    async create(tenant: typeof TenantEntity.$inferInsert) {
        const [entity] = await this.database.insert(TenantEntity)
            .values(tenant)
            .returning()

        return entity;
    }
}