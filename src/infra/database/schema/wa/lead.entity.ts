import {bigint, bigserial, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar} from "drizzle-orm/pg-core";
import {relations, sql} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {WaPhoneEntity} from "@db/schema/wa/wa-phone.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {leadStageEnum, leadTemperatureEnum} from "@db/schema/enums";

export const LeadEntity = pgTable("leads", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    waPhoneId: uuid("wa_phone_id").references(() => WaPhoneEntity.id),
    externalId: text("external_id"),
    name: text("name"),
    phoneHash: text("phone_hash"),
    phoneMasked: text("phone_masked"),
    emailHash: text("email_hash"),
    campaignId: text("campaign_id").references(() => CampaignEntity.id),
    adsetId: text("adset_id").references(() => AdSetEntity.id),
    adId: text("ad_id").references(() => AdEntity.id),
    creativeId: text("creative_id").references(() => AdCreativeEntity.id),
    sourcePlatform: text("source_platform"),
    sourcePosition: text("source_position"),
    attributionNote: text("attribution_note"),
    temperature: leadTemperatureEnum("temperature"),
    stage: leadStageEnum("stage").notNull().default("CHAT_STARTED"),
    sentiment: text("sentiment"),
    signals: jsonb("signals"),
    firstMessage: text("first_message"),
    firstSeenAt: timestamp("first_seen_at", {withTimezone: true}),
    firstRepliedAt: timestamp("first_replied_at", {withTimezone: true}),
    qualifiedAt: timestamp("qualified_at", {withTimezone: true}),
    closedAt: timestamp("closed_at", {withTimezone: true}),
    dealValueMinor: bigint("deal_value_minor", {mode: "number"}),
    currency: varchar("currency", {length: 3}),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqAccountExternal: uniqueIndex("uq_leads_account_external").on(t.accountId, t.externalId),
    /** Trigram index for the `ilike '%q%'` lead search; requires the `pg_trgm` extension. */
    idxNameTrgm: index("idx_leads_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
}));

export const LeadRelationship = relations(LeadEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [LeadEntity.accountId],
        references: [AdAccountEntity.id],
    }),
    waPhone: one(WaPhoneEntity, {
        fields: [LeadEntity.waPhoneId],
        references: [WaPhoneEntity.id],
    }),
    campaign: one(CampaignEntity, {
        fields: [LeadEntity.campaignId],
        references: [CampaignEntity.id],
    }),
    adSet: one(AdSetEntity, {
        fields: [LeadEntity.adsetId],
        references: [AdSetEntity.id],
    }),
    ad: one(AdEntity, {
        fields: [LeadEntity.adId],
        references: [AdEntity.id],
    }),
    creative: one(AdCreativeEntity, {
        fields: [LeadEntity.creativeId],
        references: [AdCreativeEntity.id],
    }),
}));
