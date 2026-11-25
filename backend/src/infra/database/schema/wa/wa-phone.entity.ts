import {pgTable, text, uniqueIndex, uuid, varchar} from "drizzle-orm/pg-core";
import {WaSessionEntity} from "@db/schema/wa/wa-session.entity";
import {relations} from "drizzle-orm";
import {WaMessageEntity, WaMessageStatusEnum} from "@db/schema/wa/wa-message.entity";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {waChannelEnum} from "@db/schema/enums";

export const WaPhoneEntity = pgTable("wa_phone", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").references(() => TenantEntity.id, {onDelete: "cascade"}).notNull(),
    accountId: text("account_id").references(() => AdAccountEntity.id, {onDelete: "set null"}),
    sessionId: uuid("session_id").references(() => WaSessionEntity.id),
    channel: waChannelEnum("channel").notNull().default("OPENWA"),
    wabaId: text("waba_id"),
    phoneNumberId: text("phone_number_id"),
    phone: varchar("phone").unique().notNull(),
    phoneName: varchar("phone_name"),
    status: WaMessageStatusEnum("status"),
}, (t) => ({
    uqPhoneNumberId: uniqueIndex("uq_wa_phone_number_id").on(t.phoneNumberId),
}));

export const WaPhoneRelation = relations(WaPhoneEntity, ({one, many}) => ({
    tenant: one(TenantEntity, {
        fields: [WaPhoneEntity.tenantId],
        references: [TenantEntity.id],
    }),
    account: one(AdAccountEntity, {
        fields: [WaPhoneEntity.accountId],
        references: [AdAccountEntity.id],
    }),
    session: one(WaSessionEntity, {
        fields: [WaPhoneEntity.sessionId],
        references: [WaSessionEntity.id],
    }),
    messages: many(WaMessageEntity),
}));
