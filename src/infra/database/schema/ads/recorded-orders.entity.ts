import {bigint, check, date, pgTable, text, timestamp, uniqueIndex} from "drizzle-orm/pg-core";
import {relations, sql} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";

/**
 * Orders the business actually recorded, entered manually or imported from a CSV. Meta reports
 * purchases from its own attribution; the two never match exactly, and this table is the other side
 * of that comparison.
 */
export const RecordedOrderEntity = pgTable("recorded_orders", {
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    date: date("date").notNull(),
    orders: bigint("orders", {mode: "number"}).notNull(),
    revenueMinor: bigint("revenue_minor", {mode: "number"}).notNull().default(0),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqAccountDate: uniqueIndex("uq_recorded_orders_account_date").on(t.accountId, t.date),
    ordersCheck: check("chk_recorded_orders_orders", sql`${t.orders} >= 0`),
}));

export const RecordedOrderRelationship = relations(RecordedOrderEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [RecordedOrderEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
