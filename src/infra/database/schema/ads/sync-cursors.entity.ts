import {pgTable, text, timestamp, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";

/**
 * Where an interrupted `fetchAll` stopped. One row per (account, resource) holding the last
 * `paging.next` cursor; the row is deleted when the walk finishes, so "no cursor" means "backfill".
 */
export const SyncCursorEntity = pgTable("sync_cursors", {
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    resource: text("resource").notNull(),
    cursor: text("cursor").notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqAccountResource: uniqueIndex("uq_sync_cursors_account_resource").on(t.accountId, t.resource),
}));

export const SyncCursorRelationship = relations(SyncCursorEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [SyncCursorEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
