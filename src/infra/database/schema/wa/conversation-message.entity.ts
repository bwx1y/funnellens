import {bigint, bigserial, integer, pgTable, text, timestamp, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {messageDirectionEnum} from "@db/schema/enums";

export const ConversationMessageEntity = pgTable("conversation_messages", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    leadId: bigint("lead_id", {mode: "number"})
        .references(() => LeadEntity.id, {onDelete: "cascade"})
        .notNull(),
    wamid: text("wamid"),
    contextWamid: text("context_wamid"),
    direction: messageDirectionEnum("direction").notNull(),
    senderRole: text("sender_role"),
    body: text("body"),
    sentAt: timestamp("sent_at", {withTimezone: true}).notNull(),
    /** Waktu kirim pesan CS yang dipasangkan; `responseSeconds = sentAt - repliedAt`. */
    repliedAt: timestamp("replied_at", {withTimezone: true}),
    pairMethod: text("pair_method"),
    responseSeconds: integer("response_seconds"),
    responseType: text("response_type"),
    topic: text("topic"),
    sentiment: text("sentiment"),
    adId: text("ad_id").references(() => AdEntity.id),
    creativeId: text("creative_id").references(() => AdCreativeEntity.id),
}, (t) => ({
    uqLeadWamid: uniqueIndex("uq_conversation_messages_lead_wamid").on(t.leadId, t.wamid),
}));

export const ConversationMessageRelationship = relations(ConversationMessageEntity, ({one}) => ({
    lead: one(LeadEntity, {
        fields: [ConversationMessageEntity.leadId],
        references: [LeadEntity.id],
    }),
    ad: one(AdEntity, {
        fields: [ConversationMessageEntity.adId],
        references: [AdEntity.id],
    }),
    creative: one(AdCreativeEntity, {
        fields: [ConversationMessageEntity.creativeId],
        references: [AdCreativeEntity.id],
    }),
}));
