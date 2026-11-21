import {index, jsonb, pgTable, text, timestamp} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";

export const AdEntity = pgTable("ads", {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    campaignId: text("campaign_id").references(() => CampaignEntity.id, {onDelete: "cascade"}).notNull(),
    adsetId: text("adset_id").references(() => AdSetEntity.id, {onDelete: "cascade"}).notNull(),
    creativeId: text("creative_id").references(() => AdCreativeEntity.id),
    name: text("name").notNull(),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    createdTime: timestamp("created_time", {withTimezone: true}),
    updatedTime: timestamp("updated_time", {withTimezone: true}),
    raw: jsonb("raw"),
}, (t) => ({
    idxAccountId: index("idx_ads_account_id").on(t.accountId),
}));

export const AdRelationship = relations(AdEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [AdEntity.accountId],
        references: [AdAccountEntity.id],
    }),
    campaign: one(CampaignEntity, {
        fields: [AdEntity.campaignId],
        references: [CampaignEntity.id],
    }),
    adSet: one(AdSetEntity, {
        fields: [AdEntity.adsetId],
        references: [AdSetEntity.id],
    }),
    creative: one(AdCreativeEntity, {
        fields: [AdEntity.creativeId],
        references: [AdCreativeEntity.id],
    }),
}));
