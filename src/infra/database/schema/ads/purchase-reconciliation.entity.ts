import {bigint, date, index, pgTable, text, timestamp, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";

/**
 * One row per (account, day): Meta's purchase count next to the orders the business recorded, and the
 * gap between them. `reason` explains a non-zero difference; a zero difference needs no explanation.
 */
export const PurchaseReconciliationEntity = pgTable("purchase_reconciliation", {
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    date: date("date").notNull(),
    metaPurchases: bigint("meta_purchases", {mode: "number"}).notNull(),
    recordedOrders: bigint("recorded_orders", {mode: "number"}).notNull(),
    difference: bigint("difference", {mode: "number"}).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqAccountDate: uniqueIndex("uq_purchase_reconciliation_account_date").on(t.accountId, t.date),
    idxAccountDate: index("idx_purchase_reconciliation_account_date").on(t.accountId, t.date.desc()),
}));

export const PurchaseReconciliationRelationship = relations(PurchaseReconciliationEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [PurchaseReconciliationEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
