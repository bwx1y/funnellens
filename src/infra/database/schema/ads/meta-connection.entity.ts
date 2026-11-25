import {pgTable, text, timestamp, uniqueIndex, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {UserEntity} from "@db/schema/core/user.entity";
import {TenantEntity} from "@db/schema/core/tenant.entity";

export const MetaConnectionEntity = pgTable("meta_connection", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => UserEntity.id, {onDelete: "cascade"}).notNull(),
    tenantId: uuid("tenant_id").references(() => TenantEntity.id, {onDelete: "cascade"}).notNull(),
    metaUserId: varchar("meta_user_id", {length: 64}).notNull(),
    metaUserName: varchar("meta_user_name", {length: 200}),
    /** AES-256-GCM ciphertext from `@shared/crypto`; never written or read in plaintext outside the repository. */
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    tokenRefreshedAt: timestamp("token_refreshed_at", {withTimezone: true}),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", {withTimezone: true}),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqTenantMetaUser: uniqueIndex("uq_meta_connection_tenant_meta_user").on(t.tenantId, t.metaUserId),
}));

export const MetaConnectionRelationship = relations(MetaConnectionEntity, ({one}) => ({
    user: one(UserEntity, {
        fields: [MetaConnectionEntity.userId],
        references: [UserEntity.id]
    }),
    tenant: one(TenantEntity, {
        fields: [MetaConnectionEntity.tenantId],
        references: [TenantEntity.id]
    })
}));
