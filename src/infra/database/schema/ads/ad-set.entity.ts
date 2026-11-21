import {bigint, index, jsonb, pgTable, text, timestamp} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";

export const AdSetEntity = pgTable("ad_sets", {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    campaignId: text("campaign_id").references(() => CampaignEntity.id, {onDelete: "cascade"}).notNull(),
    name: text("name").notNull(),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    optimizationGoal: text("optimization_goal"),
    billingEvent: text("billing_event"),
    bidStrategy: text("bid_strategy"),
    bidAmountMinor: bigint("bid_amount_minor", {mode: "number"}),
    dailyBudgetMinor: bigint("daily_budget_minor", {mode: "number"}),
    lifetimeBudgetMinor: bigint("lifetime_budget_minor", {mode: "number"}),
    targeting: jsonb("targeting"),
    startTime: timestamp("start_time", {withTimezone: true}),
    endTime: timestamp("end_time", {withTimezone: true}),
    createdTime: timestamp("created_time", {withTimezone: true}),
    updatedTime: timestamp("updated_time", {withTimezone: true}),
    raw: jsonb("raw"),
}, (t) => ({
    idxAccountId: index("idx_ad_sets_account_id").on(t.accountId),
}));

export const AdSetRelationship = relations(AdSetEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [AdSetEntity.accountId],
        references: [AdAccountEntity.id],
    }),
    campaign: one(CampaignEntity, {
        fields: [AdSetEntity.campaignId],
        references: [CampaignEntity.id],
    }),
}));
