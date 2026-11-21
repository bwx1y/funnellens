import {boolean, jsonb, numeric, pgTable, text, timestamp, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";

export const PixelSourceEntity = pgTable("pixel_sources", {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    pixelId: text("pixel_id").notNull(),
    name: text("name"),
    capiConfigured: boolean("capi_configured").notNull().default(false),
    lastEventAt: timestamp("last_event_at", {withTimezone: true}),
    emqAvg: numeric("emq_avg", {precision: 5, scale: 2}),
    lastSyncedAt: timestamp("last_synced_at", {withTimezone: true}),
    raw: jsonb("raw"),
}, (t) => ({
    uqPixelSource: uniqueIndex("uq_pixel_sources").on(t.accountId, t.pixelId),
}));

export const PixelSourceRelationship = relations(PixelSourceEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [PixelSourceEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
