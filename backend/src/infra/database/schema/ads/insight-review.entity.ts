import {bigint, bigserial, check, index, pgTable, text, timestamp, uniqueIndex, uuid} from "drizzle-orm/pg-core";
import {relations, sql} from "drizzle-orm";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";

/**
 * One user's view of one alert. The alert's own `status` stays the system truth (what the evaluator
 * decided); this row is what the person did with it, so two colleagues never share a `done`.
 */
export const InsightReviewEntity = pgTable("insight_reviews", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    tenantId: uuid("tenant_id")
        .references(() => TenantEntity.id, {onDelete: "cascade"})
        .notNull(),
    userId: uuid("user_id")
        .references(() => UserEntity.id, {onDelete: "cascade"})
        .notNull(),
    alertId: bigint("alert_id", {mode: "number"})
        .references(() => InsightAlertEntity.id, {onDelete: "cascade"})
        .notNull(),
    status: text("status").notNull().default("active"),
    reason: text("reason"),
    updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    uqUserAlert: uniqueIndex("uq_insight_reviews_user_alert").on(t.userId, t.alertId),
    idxAlert: index("idx_insight_reviews_alert").on(t.alertId),
    statusCheck: check("chk_insight_reviews_status", sql`${t.status} in ('read', 'done', 'active')`),
}));

/** Append-only trail of one person's review transitions; the current state lives on the review row. */
export const InsightReviewHistoryEntity = pgTable("insight_review_history", {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    insightReviewId: bigint("insight_review_id", {mode: "number"})
        .references(() => InsightReviewEntity.id, {onDelete: "cascade"})
        .notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by").references(() => UserEntity.id, {onDelete: "set null"}),
    changedAt: timestamp("changed_at", {withTimezone: true}).defaultNow().notNull(),
}, (t) => ({
    idxReviewChanged: index("idx_insight_review_history_review_changed").on(t.insightReviewId, t.changedAt.desc()),
    fromStatusCheck: check(
        "chk_insight_review_history_from_status",
        sql`${t.fromStatus} is null or ${t.fromStatus} in ('read', 'done', 'active')`
    ),
    toStatusCheck: check(
        "chk_insight_review_history_to_status",
        sql`${t.toStatus} in ('read', 'done', 'active')`
    ),
}));

export const InsightReviewRelationship = relations(InsightReviewEntity, ({one, many}) => ({
    tenant: one(TenantEntity, {
        fields: [InsightReviewEntity.tenantId],
        references: [TenantEntity.id],
    }),
    user: one(UserEntity, {
        fields: [InsightReviewEntity.userId],
        references: [UserEntity.id],
    }),
    alert: one(InsightAlertEntity, {
        fields: [InsightReviewEntity.alertId],
        references: [InsightAlertEntity.id],
    }),
    history: many(InsightReviewHistoryEntity),
}));

export const InsightReviewHistoryRelationship = relations(InsightReviewHistoryEntity, ({one}) => ({
    review: one(InsightReviewEntity, {
        fields: [InsightReviewHistoryEntity.insightReviewId],
        references: [InsightReviewEntity.id],
    }),
}));
