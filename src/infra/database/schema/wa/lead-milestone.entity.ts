import {bigint, pgTable, timestamp, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {leadTemperatureEnum} from "@db/schema/enums";

export const LeadMilestoneEntity = pgTable("lead_milestones", {
    id: bigint("id", {mode: "number"}).primaryKey().generatedByDefaultAsIdentity(),
    leadId: bigint("lead_id", {mode: "number"})
        .references(() => LeadEntity.id, {onDelete: "cascade"})
        .notNull(),
    level: leadTemperatureEnum("level").notNull(),
    firstAt: timestamp("first_at", {withTimezone: true}).notNull(),
}, (t) => ({
    uqMilestoneLevel: uniqueIndex("uq_lead_milestones_level").on(t.leadId, t.level),
}));

export const LeadMilestoneRelationship = relations(LeadMilestoneEntity, ({one}) => ({
    lead: one(LeadEntity, {
        fields: [LeadMilestoneEntity.leadId],
        references: [LeadEntity.id],
    }),
}));
