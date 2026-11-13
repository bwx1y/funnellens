import {pgEnum, pgTable, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {TenantEntity} from "@/database/entity/tenant.entity";
import {UserTokenEntity} from "@/database/entity/user-token.entity";

export const roleEnum = pgEnum("role", ["ADMIN", "MANAGER"])

export const UserEntity = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey(),
    fullName: varchar("full_name", {length: 150}).notNull(),
    email: varchar("email", {length: 200}).notNull(),
    hashPassword: varchar("hash_password").notNull(),
    role: roleEnum("role").default("ADMIN"),
    isVerified: timestamp("is_verified", { withTimezone: true }),
    tenantId: uuid("tenant_id").references(() => TenantEntity.id).notNull(),
})

export const UserRelationship = relations(UserEntity, ({one, many}) => ({
    tenant: one(TenantEntity, {
        fields: [UserEntity.tenantId],
        references: [TenantEntity.id]
    }),
    tokens: many(UserTokenEntity)
}))