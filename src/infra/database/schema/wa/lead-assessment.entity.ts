import {bigint, boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid} from "drizzle-orm/pg-core";
import {relations, sql} from "drizzle-orm";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {leadTemperatureEnum} from "@db/schema/enums";

export const LeadAssessmentEntity = pgTable("lead_assessments", {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: bigint("lead_id", {mode: "number"})
        .references(() => LeadEntity.id, {onDelete: "cascade"})
        .notNull(),
    level: leadTemperatureEnum("level").notNull(),
    confidence: text("confidence").notNull(),
    reason: text("reason"),
    evidence: jsonb("evidence"),
    eventAt: timestamp("event_at", {withTimezone: true}).notNull(),
    applied: boolean("applied").notNull().default(false),
    ruleVersion: text("rule_version").notNull(),
    model: text("model"),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqAssessmentEvent: uniqueIndex("uq_lead_assessments_event").on(t.leadId, t.eventAt, t.ruleVersion),
    idxLeadEvent: index("idx_lead_assessments_lead_event").on(t.leadId, sql`${t.eventAt} desc`),
}));

export const LeadAssessmentRelationship = relations(LeadAssessmentEntity, ({one}) => ({
    lead: one(LeadEntity, {
        fields: [LeadAssessmentEntity.leadId],
        references: [LeadEntity.id],
    }),
}));
