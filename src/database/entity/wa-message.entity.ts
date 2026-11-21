import {pgEnum, pgTable, real, text, uuid} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {WaPhoneEntity} from "@/database/entity/wa-phone.entity";

export const WaMessageStatusEnum = pgEnum("message_status", ["COLD", "HOT", "WARM"]);

export const WaMessageEntity = pgTable("wa_message", {
    id: uuid("id").defaultRandom().primaryKey(),
    phoneId: uuid("phone_id").references(() => WaPhoneEntity.id),
    status: WaMessageStatusEnum("status"),
    content: text("context"),
    score: real("score"),
});

export const WaMessageRelation = relations(WaMessageEntity, ({one}) => ({
    phone: one(WaPhoneEntity, {
        fields: [WaMessageEntity.phoneId],
        references: [WaPhoneEntity.id],
    }),
}));
