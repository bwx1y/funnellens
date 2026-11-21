import {DatabaseRepository} from "./base.repository";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {and, eq} from "drizzle-orm";

export class AdAccountRepository extends DatabaseRepository {
    async findByTenantId(tenantId: string): Promise<(typeof AdAccountEntity.$inferSelect)[]> {
        return this.database.select()
            .from(AdAccountEntity)
            .where(eq(AdAccountEntity.tenantId, tenantId))
            .orderBy(AdAccountEntity.name);
    }

    async findById(id: string, tenantId?: string): Promise<typeof AdAccountEntity.$inferSelect | null> {
        const conditions = [eq(AdAccountEntity.id, id)];
        if (tenantId) {
            conditions.push(eq(AdAccountEntity.tenantId, tenantId));
        }

        const [entity] = await this.database.select()
            .from(AdAccountEntity)
            .where(and(...conditions))
            .limit(1);

        return entity ?? null;
    }

    async findSelectedByTenantId(tenantId: string): Promise<typeof AdAccountEntity.$inferSelect | null> {
        const [entity] = await this.database.select()
            .from(AdAccountEntity)
            .where(and(
                eq(AdAccountEntity.tenantId, tenantId),
                eq(AdAccountEntity.isSelected, true)
            ))
            .limit(1);

        return entity ?? null;
    }

    async upsert(account: typeof AdAccountEntity.$inferInsert): Promise<typeof AdAccountEntity.$inferSelect> {
        const [entity] = await this.database.insert(AdAccountEntity)
            .values(account)
            .onConflictDoUpdate({
                target: AdAccountEntity.id,
                set: {
                    name: account.name,
                    currency: account.currency,
                    currencyOffset: account.currencyOffset,
                    timezoneName: account.timezoneName,
                    accountStatus: account.accountStatus,
                    businessId: account.businessId,
                    updatedAt: new Date(),
                },
            })
            .returning();

        return entity;
    }

    async upsertBatch(accounts: (typeof AdAccountEntity.$inferInsert)[]): Promise<(typeof AdAccountEntity.$inferSelect)[]> {
        if (accounts.length === 0) return [];

        return this.database.insert(AdAccountEntity)
            .values(accounts)
            .onConflictDoUpdate({
                target: AdAccountEntity.id,
                set: {
                    name: AdAccountEntity.name,
                    currency: AdAccountEntity.currency,
                    currencyOffset: AdAccountEntity.currencyOffset,
                    timezoneName: AdAccountEntity.timezoneName,
                    accountStatus: AdAccountEntity.accountStatus,
                    businessId: AdAccountEntity.businessId,
                    updatedAt: new Date(),
                },
            })
            .returning();
    }

    async selectAccount(tenantId: string, accountId: string): Promise<typeof AdAccountEntity.$inferSelect | null> {
        return this.database.transaction(async (tx) => {
            await tx.update(AdAccountEntity)
                .set({isSelected: false, updatedAt: new Date()})
                .where(eq(AdAccountEntity.tenantId, tenantId));

            const [selected] = await tx.update(AdAccountEntity)
                .set({isSelected: true, updatedAt: new Date()})
                .where(and(
                    eq(AdAccountEntity.tenantId, tenantId),
                    eq(AdAccountEntity.id, accountId)
                ))
                .returning();

            return selected ?? null;
        });
    }
}
