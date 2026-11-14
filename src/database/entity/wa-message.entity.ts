import {pgEnum, pgTable, text, uuid, varchar, real} from "drizzle-orm/pg-core";
import {WaSessionEntity} from "@/database/entity/wa-session.entity";
import {relations} from "drizzle-orm";

export const WaMessageStatusEnum = pgEnum("message_status", ["COLD", "HOT", "WARM"])

export const WaMessageEntity = pgTable("wa_message", {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").references(() => WaSessionEntity.id),
    status: WaMessageStatusEnum("status"),
    phone: varchar("phone"),
    phoneName: varchar("phone_name"),
    content: text("context"),
    score: real("score"),
})

export const WaMessageRelation = relations(WaMessageEntity, ({one}) => ({
    sessions: one(WaSessionEntity, {
        fields: [WaMessageEntity.sessionId],
        references: [WaSessionEntity.id],
    })
}))