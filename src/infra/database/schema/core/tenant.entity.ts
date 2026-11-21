import {pgTable, text, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {UserEntity} from "@db/schema/core/user.entity";
import {WaSessionEntity} from "@db/schema/wa/wa-session.entity";

export const TenantEntity = pgTable("tenants", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", {length: 200}).notNull(),
    address: text("address")
})

export const TenantRelationship = relations(TenantEntity, ({many}) => ({
    users: many(UserEntity),
    waSession: many(WaSessionEntity)
}));