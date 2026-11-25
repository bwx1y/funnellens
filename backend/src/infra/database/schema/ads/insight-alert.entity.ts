import {bigint, bigserial, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {UserEntity} from "@db/schema/core/user.entity";
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
    entityId: text("entity_id").notNull().default(""),
    impactMinor: bigint("impact_minor", {mode: "number"}),
    impactCaption: text("impact_caption"),
    confidence: text("confidence"),
    sampleSize: bigint("sample_size", {mode: "number"}),
    route: text("route"),
    evidence: jsonb("evidence"),
    status: alertStatusEnum("status").notNull().default("ACTIVE"),
    snoozedUntil: timestamp("snoozed_until", {withTimezone: true}),
    resolvedAt: timestamp("resolved_at", {withTimezone: true}),
    resolvedBy: uuid("resolved_by").references(() => UserEntity.id, {onDelete: "set null"}),
    detectedAt: timestamp("detected_at", {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqAlertRule: uniqueIndex("uq_insight_alerts_rule").on(t.accountId, t.ruleKey, t.entityId),
    idxAlertStatus: index("idx_insight_alerts_account_status").on(t.accountId, t.status),
}));

export const InsightAlertRelationship = relations(InsightAlertEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [InsightAlertEntity.accountId],
        references: [AdAccountEntity.id],
    }),
    resolvedByUser: one(UserEntity, {
        fields: [InsightAlertEntity.resolvedBy],
        references: [UserEntity.id],
    }),
}));
