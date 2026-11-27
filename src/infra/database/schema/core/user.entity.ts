import {pgTable, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserTokenEntity} from "@db/schema/core/user-token.entity";
import {RefreshTokenEntity} from "@db/schema/core/refresh-token.entity";
import {userRoleEnum} from "@db/schema/enums";

export {userRoleEnum as roleEnum};

export const UserEntity = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey(),
    fullName: varchar("full_name", {length: 150}).notNull(),
    email: varchar("email", {length: 200}).unique().notNull(),
    hashPassword: varchar("hash_password").notNull(),
    role: userRoleEnum("role").notNull().default("VIEWER"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    tenantId: uuid("tenant_id").references(() => TenantEntity.id).notNull(),
});

export const UserRelationship = relations(UserEntity, ({one, many}) => ({
    tenant: one(TenantEntity, {
        fields: [UserEntity.tenantId],
        references: [TenantEntity.id]
    }),
    tokens: many(UserTokenEntity),
    refreshTokens: many(RefreshTokenEntity)
}));
