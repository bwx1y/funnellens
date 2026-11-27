import {pgTable, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {UserEntity} from "@db/schema/core/user.entity";
import {userTokenTypeEnum} from "@db/schema/enums";

export {userTokenTypeEnum as tokenTypeEnum};

export const UserTokenEntity = pgTable("user_tokens", {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", {length: 6}).notNull(),
    type: userTokenTypeEnum("type").notNull().default("EMAIL_VERIFICATION"),
    expiresAt: timestamp("expires_at", {withTimezone: true}).notNull(),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
    usedAt: timestamp("used_at", {withTimezone: true}),

    userId: uuid("user_id").references(() => UserEntity.id, {
        onDelete: "cascade"
    }).notNull()
});

export const UserTokenRelationship = relations(UserTokenEntity, ({one}) => ({
    user: one(UserEntity, {
        fields: [UserTokenEntity.userId],
        references: [UserEntity.id]
    })
}));
