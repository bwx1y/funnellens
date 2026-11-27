import {index, jsonb, numeric, pgTable, text, timestamp} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";

export const AdCreativeEntity = pgTable("ad_creatives", {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    name: text("name"),
    objectType: text("object_type"),
    status: text("status"),
    videoId: text("video_id"),
    videoLengthSeconds: numeric("video_length_seconds", {precision: 10, scale: 2}),
    videoPermalinkUrl: text("video_permalink_url"),
    imageUrl: text("image_url"),
    thumbnailUrl: text("thumbnail_url"),
    objectStoryId: text("object_story_id"),
    body: text("body"),
    title: text("title"),
    callToActionType: text("call_to_action_type"),
    urlTags: text("url_tags"),
    createdTime: timestamp("created_time", {withTimezone: true}),
    updatedTime: timestamp("updated_time", {withTimezone: true}),
    raw: jsonb("raw"),
}, (t) => ({
    idxAccountId: index("idx_ad_creatives_account_id").on(t.accountId),
}));

export const AdCreativeRelationship = relations(AdCreativeEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [AdCreativeEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
