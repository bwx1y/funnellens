import {and, desc, eq, gte, lte, sql} from "drizzle-orm";
import {DatabaseRepository} from "./base.repository";
import {RecordedOrderEntity} from "@db/schema/ads/recorded-orders.entity";
import {PurchaseReconciliationEntity} from "@db/schema/ads/purchase-reconciliation.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";

export type RecordedOrder = typeof RecordedOrderEntity.$inferSelect;
export type PurchaseReconciliation = typeof PurchaseReconciliationEntity.$inferSelect;

export interface RecordedOrderInput {
    date: string;
    orders: number;
    revenueMinor: number;
}

/** `null` means "Meta reported nothing", which is different from "Meta reported zero". */
export interface ReconciliationRow {
    date: string;
    metaPurchases: number;
    recordedOrders: number;
    difference: number;
    reason: string | null;
}

/**
 * Both sides of the purchase count: Meta's attributed purchases from the view, and the orders the
 * business recorded by hand. The comparison is written down per day so a shift in attribution shows up
 * as a trend instead of a one-off surprise.
 */
export class PurchaseReconciliationRepository extends DatabaseRepository {
    async upsertRecordedOrders(accountId: string, input: RecordedOrderInput): Promise<RecordedOrder> {
        const [entity] = await this.database.insert(RecordedOrderEntity)
            .values({
                accountId,
                date: input.date,
                orders: input.orders,
                revenueMinor: input.revenueMinor,
            })
            .onConflictDoUpdate({
                target: [RecordedOrderEntity.accountId, RecordedOrderEntity.date],
                set: {
                    orders: input.orders,
                    revenueMinor: input.revenueMinor,
                    updatedAt: new Date(),
                },
            })
            .returning();

        return entity;
    }

    async findRecordedOrders(accountId: string, since: string): Promise<RecordedOrder[]> {
        return this.database.select()
            .from(RecordedOrderEntity)
            .where(and(
                eq(RecordedOrderEntity.accountId, accountId),
                gte(RecordedOrderEntity.date, since)
            ))
            .orderBy(desc(RecordedOrderEntity.date));
    }

    /** Meta's purchase count per day for the same window; a day with no row is absent, not zero. */
    async getMetaPurchasesByDate(accountId: string, since: string, until: string): Promise<Map<string, number>> {
        const rows = await this.database.execute(sql`
            select i.date::text              as date,
                   coalesce(sum(i.purchases), 0) as purchases
            from ad_insight_metrics i
            where i.account_id = ${accountId}
              and i.level = 'ad'
              and i.date >= ${since}
              and i.date <= ${until}
            group by i.date
        `) as unknown as {date: string; purchases: string}[];

        return new Map(rows.map((row) => [row.date, Number(row.purchases)]));
    }

    async upsertReconciliation(row: {
        accountId: string;
        date: string;
        metaPurchases: number;
        recordedOrders: number;
        difference: number;
        reason: string | null;
    }): Promise<PurchaseReconciliation> {
        const [entity] = await this.database.insert(PurchaseReconciliationEntity)
            .values(row)
            .onConflictDoUpdate({
                target: [PurchaseReconciliationEntity.accountId, PurchaseReconciliationEntity.date],
                set: {
                    metaPurchases: row.metaPurchases,
                    recordedOrders: row.recordedOrders,
                    difference: row.difference,
                    reason: row.reason,
                    createdAt: new Date(),
                },
            })
            .returning();

        return entity;
    }

    /** The last `days` days, newest first; days with neither side are absent rather than empty rows. */
    async findRecent(accountId: string, days: number): Promise<ReconciliationRow[]> {
        const rows = await this.database.select()
            .from(PurchaseReconciliationEntity)
            .where(eq(PurchaseReconciliationEntity.accountId, accountId))
            .orderBy(desc(PurchaseReconciliationEntity.date))
            .limit(days);

        return rows.map((row) => ({
            date: row.date,
            metaPurchases: row.metaPurchases,
            recordedOrders: row.recordedOrders,
            difference: row.difference,
            reason: row.reason,
        }));
    }

    /** Accounts that have recorded orders at all: only those can be reconciled. */
    async findAccountsWithRecordedOrders(): Promise<string[]> {
        const rows = await this.database.selectDistinct({accountId: RecordedOrderEntity.accountId})
            .from(RecordedOrderEntity)
            .innerJoin(AdAccountEntity, eq(AdAccountEntity.id, RecordedOrderEntity.accountId));

        return rows.map((row) => row.accountId);
    }

    async findRecordedOrdersBetween(accountId: string, since: string, until: string): Promise<RecordedOrder[]> {
        return this.database.select()
            .from(RecordedOrderEntity)
            .where(and(
                eq(RecordedOrderEntity.accountId, accountId),
                gte(RecordedOrderEntity.date, since),
                lte(RecordedOrderEntity.date, until)
            ))
            .orderBy(desc(RecordedOrderEntity.date));
    }
}
