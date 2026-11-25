import {bigint, index, pgTable, text, timestamp, uuid} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";

/**
 * Proof that a lead and its conversations were deleted on request. The lead row is gone, so the id is
 * stored as a plain bigint rather than a foreign key: an audit trail that cascades away with its
 * subject would be useless.
 */
export const DeletionAuditEntity = pgTable("deletion_audit", {
    id: bigint("id", {mode: "number"}).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: uuid("tenant_id")
        .references(() => TenantEntity.id, {onDelete: "cascade"})
        .notNull(),
    userId: uuid("user_id")
        .references(() => UserEntity.id)
        .notNull(),
    leadId: bigint("lead_id", {mode: "number"}).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    idxTenantCreated: index("idx_deletion_audit_tenant_created").on(t.tenantId, t.createdAt.desc()),
}));

export const DeletionAuditRelationship = relations(DeletionAuditEntity, ({one}) => ({
    tenant: one(TenantEntity, {
        fields: [DeletionAuditEntity.tenantId],
        references: [TenantEntity.id],
    }),
    user: one(UserEntity, {
        fields: [DeletionAuditEntity.userId],
        references: [UserEntity.id],
    }),
}));
