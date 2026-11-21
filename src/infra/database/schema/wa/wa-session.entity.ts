import {relations} from "drizzle-orm";
import {pgTable, uuid, varchar} from "drizzle-orm/pg-core";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {WaPhoneEntity} from "@db/schema/wa/wa-phone.entity";
import {waSessionStatusEnum} from "@db/schema/enums";

export {waSessionStatusEnum as WaSessionStatusEnum};

export const WaSessionEntity = pgTable("wa_session", {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").references(() => TenantEntity.id, {onDelete: "cascade"}).notNull(),
    name: varchar("name", {
        length: 150
    }).notNull(),
    phoneNumber: varchar("phone_number"),
    phoneName: varchar("phone_name"),
    status: waSessionStatusEnum("status").notNull().default("created"),
});

export const WaSessionRelationship = relations(WaSessionEntity, ({one, many}) => ({
    tenant: one(TenantEntity, {
        fields: [WaSessionEntity.tenantId],
        references: [TenantEntity.id]
    }),
    phones: many(WaPhoneEntity)
}));
