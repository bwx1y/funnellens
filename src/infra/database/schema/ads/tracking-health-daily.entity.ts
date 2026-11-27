import {bigint, bigserial, date, jsonb, numeric, pgTable, text, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";

export const TrackingHealthDailyEntity = pgTable("tracking_health_daily", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    date: date("date").notNull(),
    eventName: text("event_name").notNull(),
    browserCount: bigint("browser_count", {mode: "number"}),
    serverCount: bigint("server_count", {mode: "number"}),
    dedupRate: numeric("dedup_rate", {precision: 14, scale: 6}),
    matchQuality: numeric("match_quality", {precision: 5, scale: 2}),
    status: text("status"),
    raw: jsonb("raw"),
}, (t) => ({
    uqTrackingHealth: uniqueIndex("uq_tracking_health_daily_event").on(t.accountId, t.date, t.eventName),
}));

export const TrackingHealthDailyRelationship = relations(TrackingHealthDailyEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [TrackingHealthDailyEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
