import {bigint, bigserial, date, jsonb, pgTable, text, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {insightLevelEnum} from "@db/schema/enums";

export const AdInsightBreakdownDailyEntity = pgTable("ad_insights_breakdown_daily", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    level: insightLevelEnum("level").notNull(),
    entityId: text("entity_id").notNull(),
    campaignId: text("campaign_id").references(() => CampaignEntity.id),
    adsetId: text("adset_id").references(() => AdSetEntity.id),
    adId: text("ad_id").references(() => AdEntity.id),
    date: date("date").notNull(),
    attributionWindow: text("attribution_window").notNull(),
    publisherPlatform: text("publisher_platform"),
    platformPosition: text("platform_position"),
    impressionDevice: text("impression_device"),
    age: text("age"),
    gender: text("gender"),
    country: text("country"),
    region: text("region"),
    breakdownHash: text("breakdown_hash").notNull(),
    spendMinor: bigint("spend_minor", {mode: "number"}).notNull().default(0),
    impressions: bigint("impressions", {mode: "number"}).notNull().default(0),
    reach: bigint("reach", {mode: "number"}),
    clicks: bigint("clicks", {mode: "number"}).notNull().default(0),
    inlineLinkClicks: bigint("inline_link_clicks", {mode: "number"}),
    actions: jsonb("actions"),
    actionValues: jsonb("action_values"),
}, (t) => ({
    uqBreakdownDaily: uniqueIndex("uq_ad_insights_breakdown_daily").on(
        t.accountId,
        t.level,
        t.entityId,
        t.date,
        t.attributionWindow,
        t.breakdownHash
    ),
}));

export const AdInsightBreakdownDailyRelationship = relations(AdInsightBreakdownDailyEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [AdInsightBreakdownDailyEntity.accountId],
        references: [AdAccountEntity.id],
    }),
    campaign: one(CampaignEntity, {
        fields: [AdInsightBreakdownDailyEntity.campaignId],
        references: [CampaignEntity.id],
    }),
    adSet: one(AdSetEntity, {
        fields: [AdInsightBreakdownDailyEntity.adsetId],
        references: [AdSetEntity.id],
    }),
    ad: one(AdEntity, {
        fields: [AdInsightBreakdownDailyEntity.adId],
        references: [AdEntity.id],
    }),
}));
