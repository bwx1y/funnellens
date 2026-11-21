import {bigint, bigserial, date, pgTable, text, timestamp} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {syncRunStatusEnum} from "@db/schema/enums";

export const SyncRunEntity = pgTable("sync_runs", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "cascade"}).notNull(),
    resource: text("resource").notNull(),
    startedAt: timestamp("started_at", {withTimezone: true}).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", {withTimezone: true}),
    status: syncRunStatusEnum("status").notNull().default("RUNNING"),
    rowsUpserted: bigint("rows_upserted", {mode: "number"}),
    rangeSince: date("range_since"),
    rangeUntil: date("range_until"),
    error: text("error"),
});

export const SyncRunRelationship = relations(SyncRunEntity, ({one}) => ({
    adAccount: one(AdAccountEntity, {
        fields: [SyncRunEntity.accountId],
        references: [AdAccountEntity.id],
    }),
}));
