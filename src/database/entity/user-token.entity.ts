import {boolean, pgEnum, pgTable, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {UserEntity} from "@/database/entity/user.entity";

export const tokenTypeEnum = pgEnum("token_type", [
    "EMAIL_VERIFICATION",
    "PASSWORD_RESET",
]);

export const UserTokenEntity = pgTable("user_tokens", {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", {length: 6}).notNull(),
    type: tokenTypeEnum("type").notNull().default("EMAIL_VERIFICATION"),
    isUsed: boolean("is_used").notNull().default(false),
    expiresAt: timestamp("expires_at", {withTimezone: true}).notNull(),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
    usedAt: timestamp("used_at", {withTimezone: true}),

    userId: uuid().references(() => UserEntity.id, {
        onDelete: "cascade"
    }).notNull()
})

export const UserTokenRelationship = relations(UserTokenEntity, ({one}) => ({
    user: one(UserEntity, {
        fields: [UserTokenEntity.userId],
        references: [UserEntity.id]
    })
}))