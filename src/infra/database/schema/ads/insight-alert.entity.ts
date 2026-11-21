import {bigint, bigserial, pgTable, text, timestamp} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {alertLevelEnum, alertStatusEnum} from "@db/schema/enums";

export const InsightAlertEntity = pgTable("insight_alerts", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    ruleKey: text("rule_key").notNull(),
    level: alertLevelEnum("level").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    metric: text("metric"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    impactMinor: bigint("impact_minor", {mode: "number"}),
    impactCaption: text("impact_caption"),
    confidence: text("confidence"),
    sampleSize: bigint("sample_size", {mode: "number"}),
    route: text("route"),
    status: alertStatusEnum("status").notNull().default("ACTIVE"),
    detectedAt: timestamp("detected_at", {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
});

export const InsightAlertRelationship = relations(InsightAlertEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [InsightAlertEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
