import {jsonb, pgTable, text, timestamp, uniqueIndex, uuid} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {explanationStateEnum} from "@db/schema/enums";

export const ExplanationEntity = pgTable("explanations", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").references(() => TenantEntity.id, {onDelete: "cascade"}).notNull(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    context: text("context").notNull(),
    entityType: text("entity_type").notNull().default(""),
    entityId: text("entity_id").notNull().default(""),
    filterHash: text("filter_hash").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    ruleVersion: text("rule_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    state: explanationStateEnum("state").notNull().default("PENDING"),
    source: text("source"),
    text: text("text"),
    nextCheck: text("next_check"),
    facts: jsonb("facts"),
    evidenceIds: jsonb("evidence_ids"),
    error: text("error"),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqExplanationKey: uniqueIndex("uq_explanations_key").on(
        t.accountId,
        t.context,
        t.entityType,
        t.entityId,
        t.filterHash,
        t.snapshotId,
        t.evidenceHash,
        t.ruleVersion,
        t.promptVersion,
        t.model
    ),
}));

export const ExplanationRelationship = relations(ExplanationEntity, ({one}) => ({
    tenant: one(TenantEntity, {
        fields: [ExplanationEntity.tenantId],
        references: [TenantEntity.id],
    }),
    adAccount: one(AdAccountEntity, {
        fields: [ExplanationEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
