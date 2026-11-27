import {bigserial, numeric, pgTable, text, timestamp, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";

export const CreativeTagEntity = pgTable("creative_tags", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    creativeId: text("creative_id").references(() => AdCreativeEntity.id, {onDelete: "cascade"}).notNull(),
    tagType: text("tag_type").notNull(),
    tagValue: text("tag_value").notNull(),
    source: text("source").notNull(),
    confidence: numeric("confidence", {precision: 5, scale: 4}),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqCreativeTag: uniqueIndex("uq_creative_tags_item").on(t.creativeId, t.tagType, t.tagValue, t.source),
}));

export const CreativeTagRelationship = relations(CreativeTagEntity, ({one}) => ({
    creative: one(AdCreativeEntity, {
        fields: [CreativeTagEntity.creativeId],
        references: [AdCreativeEntity.id],
    }),
}));
