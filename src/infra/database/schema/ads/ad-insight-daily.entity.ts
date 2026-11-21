import {bigint, bigserial, boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {insightLevelEnum} from "@db/schema/enums";

export const AdInsightDailyEntity = pgTable("ad_insights_daily", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    level: insightLevelEnum("level").notNull(),
    entityId: text("entity_id").notNull(),
    campaignId: text("campaign_id").references(() => CampaignEntity.id),
    adsetId: text("adset_id").references(() => AdSetEntity.id),
    adId: text("ad_id").references(() => AdEntity.id),
    date: date("date").notNull(),
    attributionWindow: text("attribution_window").notNull().default("7d_click"),
    currency: varchar("currency", {length: 3}).notNull(),
    currencyOffset: integer("currency_offset").notNull().default(100),
    spendMinor: bigint("spend_minor", {mode: "number"}).notNull().default(0),
    impressions: bigint("impressions", {mode: "number"}).notNull().default(0),
    reach: bigint("reach", {mode: "number"}),
    frequency: numeric("frequency", {precision: 14, scale: 6}),
    clicks: bigint("clicks", {mode: "number"}).notNull().default(0),
    inlineLinkClicks: bigint("inline_link_clicks", {mode: "number"}),
    uniqueClicks: bigint("unique_clicks", {mode: "number"}),
    ctr: numeric("ctr", {precision: 14, scale: 8}),
    cpcMinor: bigint("cpc_minor", {mode: "number"}),
    cpmMinor: bigint("cpm_minor", {mode: "number"}),
    actions: jsonb("actions"),
    actionValues: jsonb("action_values"),
    costPerActionType: jsonb("cost_per_action_type"),
    videoPlayActions: bigint("video_play_actions", {mode: "number"}),
    video30SecWatchedActions: bigint("video_30_sec_watched_actions", {mode: "number"}),
    videoThruplayWatchedActions: bigint("video_thruplay_watched_actions", {mode: "number"}),
    videoP25WatchedActions: bigint("video_p25_watched_actions", {mode: "number"}),
    videoP50WatchedActions: bigint("video_p50_watched_actions", {mode: "number"}),
    videoP75WatchedActions: bigint("video_p75_watched_actions", {mode: "number"}),
    videoP100WatchedActions: bigint("video_p100_watched_actions", {mode: "number"}),
    videoAvgTimeWatchedSeconds: numeric("video_avg_time_watched_seconds", {precision: 14, scale: 4}),
    graphVersion: text("graph_version"),
    actionReportTime: text("action_report_time").notNull().default("impression"),
    video3SecWatchedActions: bigint("video_3_sec_watched_actions", {mode: "number"}),
    fetchedAt: timestamp("fetched_at", {withTimezone: true}).defaultNow().notNull(),
    isFinal: boolean("is_final").notNull().default(false),
}, (t) => ({
    uqInsightsDaily: uniqueIndex("uq_ad_insights_daily").on(
        t.accountId,
        t.level,
        t.entityId,
        t.date,
        t.attributionWindow
    ),
    idxAccountDate: index("idx_insights_daily_account_date").on(t.accountId, t.date),
    idxCampaignDate: index("idx_insights_daily_campaign_date").on(t.campaignId, t.date),
    idxAdDate: index("idx_insights_daily_ad_date").on(t.adId, t.date),
}));

export const AdInsightDailyRelationship = relations(AdInsightDailyEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [AdInsightDailyEntity.accountId],
        references: [AdAccountEntity.id],
    }),
    campaign: one(CampaignEntity, {
        fields: [AdInsightDailyEntity.campaignId],
        references: [CampaignEntity.id],
    }),
    adSet: one(AdSetEntity, {
        fields: [AdInsightDailyEntity.adsetId],
        references: [AdSetEntity.id],
    }),
    ad: one(AdEntity, {
        fields: [AdInsightDailyEntity.adId],
        references: [AdEntity.id],
    }),
}));
