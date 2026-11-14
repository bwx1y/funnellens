import {isNull, relations} from "drizzle-orm";
import {pgEnum, pgTable, uuid, varchar} from "drizzle-orm/pg-core";
import {UserTokenRelationship} from "@/database/entity/user-token.entity";
import {TenantEntity} from "@/database/entity/tenant.entity";
import {WaMessageEntity} from "@/database/entity/wa-message.entity";

export const WaSessionStatusEnum = pgEnum("session-status", ["created", "initializing", "qr_ready", "authenticating", "ready", "disconnected", "action_required", "failed"])

export const WaSessionEntity = pgTable("wa_session", {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id"),
    name: varchar("name", {
        length: 150
    }).notNull(),
    phoneNumber: varchar("phone_number"),
    phoneName: varchar("phone_name"),
    status: WaSessionStatusEnum()
})

export const WaSessionRelationship = relations(WaSessionEntity, ({one, many}) => ({
    tenant: one(TenantEntity, {
        fields: [WaSessionEntity.tenantId],
        references: [TenantEntity.id]
    }),
    message: many(WaMessageEntity)
}))