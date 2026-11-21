import {boolean, index, integer, pgTable, text, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {TenantEntity} from "@db/schema/core/tenant.entity";

export const AdAccountEntity = pgTable("ad_accounts", {
    id: text("id").primaryKey(), // act_<id>
    tenantId: uuid("tenant_id").references(() => TenantEntity.id, {onDelete: "cascade"}).notNull(),
    name: text("name").notNull(),
    currency: varchar("currency", {length: 3}).notNull(),
    currencyOffset: integer("currency_offset").notNull().default(100),
    timezoneName: text("timezone_name").notNull(),
    accountStatus: integer("account_status"),
    businessId: text("business_id"),
    isSelected: boolean("is_selected").notNull().default(false),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    idxTenantId: index("idx_ad_accounts_tenant_id").on(t.tenantId),
}));

export const AdAccountRelationship = relations(AdAccountEntity, ({one}) => ({
    tenant: one(TenantEntity, {
        fields: [AdAccountEntity.tenantId],
        references: [TenantEntity.id],
    }),
}));
