import {bigint, index, jsonb, pgTable, text, timestamp, uuid} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";

/**
 * One row per CSV download: who exported which report with which filter. The write is best-effort —
 * a failed audit insert never blocks the file.
 */
export const ExportAuditEntity = pgTable("export_audit", {
    id: bigint("id", {mode: "number"}).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: uuid("tenant_id")
        .references(() => TenantEntity.id, {onDelete: "cascade"})
        .notNull(),
    userId: uuid("user_id")
        .references(() => UserEntity.id)
        .notNull(),
    report: text("report").notNull(),
    filter: jsonb("filter").notNull().default({}),
    rowCount: bigint("row_count", {mode: "number"}).notNull(),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    idxTenantCreated: index("idx_export_audit_tenant_created").on(t.tenantId, t.createdAt.desc()),
}));

export const ExportAuditRelationship = relations(ExportAuditEntity, ({one}) => ({
    tenant: one(TenantEntity, {
        fields: [ExportAuditEntity.tenantId],
        references: [TenantEntity.id],
    }),
    user: one(UserEntity, {
        fields: [ExportAuditEntity.userId],
        references: [UserEntity.id],
    }),
}));
