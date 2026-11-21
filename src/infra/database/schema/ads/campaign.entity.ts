import {bigint, index, jsonb, pgTable, text, timestamp} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";

export const CampaignEntity = pgTable("campaigns", {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    name: text("name").notNull(),
    objective: text("objective"),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    buyingType: text("buying_type"),
    dailyBudgetMinor: bigint("daily_budget_minor", {mode: "number"}),
    lifetimeBudgetMinor: bigint("lifetime_budget_minor", {mode: "number"}),
    budgetRemainingMinor: bigint("budget_remaining_minor", {mode: "number"}),
    startTime: timestamp("start_time", {withTimezone: true}),
    stopTime: timestamp("stop_time", {withTimezone: true}),
    createdTime: timestamp("created_time", {withTimezone: true}),
    updatedTime: timestamp("updated_time", {withTimezone: true}),
    raw: jsonb("raw"),
}, (t) => ({
    idxAccountId: index("idx_campaigns_account_id").on(t.accountId),
}));

export const CampaignRelationship = relations(CampaignEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [CampaignEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
