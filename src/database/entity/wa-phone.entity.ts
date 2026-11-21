import {pgEnum, pgTable, uuid, varchar} from "drizzle-orm/pg-core";
import {WaSessionEntity} from "@/database/entity/wa-session.entity";
import {relations} from "drizzle-orm";
import {WaMessageEntity, WaMessageStatusEnum} from "@/database/entity/wa-message.entity";

export const WaPhoneEntity = pgTable("wa_phone", {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").references(() => WaSessionEntity.id),
    phone: varchar("phone").unique().notNull(),
    phoneName: varchar("phone_name"),
    status: WaMessageStatusEnum("status"),
});

export const WaPhoneRelation = relations(WaPhoneEntity, ({one, many}) => ({
    session: one(WaSessionEntity, {
        fields: [WaPhoneEntity.sessionId],
        references: [WaSessionEntity.id],
    }),
    messages: many(WaMessageEntity),
}));
