import {bigint, bigserial, numeric, pgTable, text, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdInsightDailyEntity} from "@db/schema/ads/ad-insight-daily.entity";

export const AdInsightActionEntity = pgTable("ad_insight_actions", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    insightDailyId: bigint("insight_daily_id", {mode: "number"})
        .references(() => AdInsightDailyEntity.id, {onDelete: "cascade"})
        .notNull(),
    actionType: text("action_type").notNull(),
    count: numeric("count", {precision: 20, scale: 4}).notNull().default("0"),
    valueMinor: bigint("value_minor", {mode: "number"}),
    costPerActionMinor: bigint("cost_per_action_minor", {mode: "number"}),
}, (t) => ({
    uqInsightAction: uniqueIndex("uq_ad_insight_actions_type").on(t.insightDailyId, t.actionType),
}));

export const AdInsightActionRelationship = relations(AdInsightActionEntity, ({one}) => ({
    insightDaily: one(AdInsightDailyEntity, {
        fields: [AdInsightActionEntity.insightDailyId],
        references: [AdInsightDailyEntity.id],
    }),
}));
