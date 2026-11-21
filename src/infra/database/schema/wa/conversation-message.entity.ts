import {bigint, bigserial, integer, pgTable, text, timestamp} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {messageDirectionEnum} from "@db/schema/enums";

export const ConversationMessageEntity = pgTable("conversation_messages", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    leadId: bigint("lead_id", {mode: "number"})
        .references(() => LeadEntity.id, {onDelete: "cascade"})
        .notNull(),
    direction: messageDirectionEnum("direction").notNull(),
    body: text("body"),
    sentAt: timestamp("sent_at", {withTimezone: true}).notNull(),
    repliedAt: timestamp("replied_at", {withTimezone: true}),
    responseSeconds: integer("response_seconds"),
    topic: text("topic"),
    sentiment: text("sentiment"),
});

export const ConversationMessageRelationship = relations(ConversationMessageEntity, ({one}) => ({
    lead: one(LeadEntity, {
        fields: [ConversationMessageEntity.leadId],
        references: [LeadEntity.id],
    }),
}));
