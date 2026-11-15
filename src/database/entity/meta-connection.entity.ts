import {pgTable, text, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {UserEntity} from "@/database/entity/user.entity";
import {TenantEntity} from "@/database/entity/tenant.entity";

// ponytail: access_token stored plaintext; encrypt when key-management exists.
export const MetaConnectionEntity = pgTable("meta_connection", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => UserEntity.id, {onDelete: "cascade"}).notNull().unique(),
    tenantId: uuid("tenant_id").references(() => TenantEntity.id, {onDelete: "cascade"}).notNull(),
    metaUserId: varchar("meta_user_id", {length: 64}).notNull(),
    metaUserName: varchar("meta_user_name", {length: 200}),
    accessToken: text("access_token").notNull(),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", {withTimezone: true}),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
})

export const MetaConnectionRelationship = relations(MetaConnectionEntity, ({one}) => ({
    user: one(UserEntity, {
        fields: [MetaConnectionEntity.userId],
        references: [UserEntity.id]
    }),
    tenant: one(TenantEntity, {
        fields: [MetaConnectionEntity.tenantId],
        references: [TenantEntity.id]
    })
}))
