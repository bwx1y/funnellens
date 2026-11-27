import {pgTable, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";
import {UserEntity} from "@db/schema/core/user.entity";

export const RefreshTokenEntity = pgTable("refresh_tokens", {
    id: uuid("id").defaultRandom().primaryKey(),
    token: varchar("token", {length: 255}).unique().notNull(),
    userId: uuid("user_id").references(() => UserEntity.id, {
        onDelete: "cascade"
    }).notNull(),
    expiresAt: timestamp("expires_at", {withTimezone: true}).notNull(),
    createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", {withTimezone: true}),
});

export const RefreshTokenRelationship = relations(RefreshTokenEntity, ({one}) => ({
    user: one(UserEntity, {
        fields: [RefreshTokenEntity.userId],
        references: [UserEntity.id]
    })
}));
