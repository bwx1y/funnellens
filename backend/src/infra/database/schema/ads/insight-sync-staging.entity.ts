import {bigint, integer, jsonb, pgTable, text, uniqueIndex} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {SyncRunEntity} from "@db/schema/ads/sync-run.entity";

export const InsightSyncStagingEntity = pgTable("insight_sync_staging", {
    id: bigint("id", {mode: "number"}).primaryKey().generatedByDefaultAsIdentity(),
    runId: bigint("run_id", {mode: "number"})
        .references(() => SyncRunEntity.id, {onDelete: "cascade"})
        .notNull(),
    rowIndex: integer("row_index").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
}, (t) => ({
    uqStaging: uniqueIndex("uq_insight_staging").on(t.runId, t.rowIndex, t.kind),
}));

export const InsightSyncStagingRelationship = relations(InsightSyncStagingEntity, ({one}) => ({
    syncRun: one(SyncRunEntity, {
        fields: [InsightSyncStagingEntity.runId],
        references: [SyncRunEntity.id],
    }),
}));
