import {DatabaseRepository} from "./base.repository";
import {
    InsightReviewEntity,
    InsightReviewHistoryEntity,
} from "@db/schema/ads/insight-review.entity";
import {and, desc, eq, inArray} from "drizzle-orm";
import {REVIEW_HISTORY_LIMIT, type ReviewStatus} from "@shared/alerts";

export type InsightReview = typeof InsightReviewEntity.$inferSelect;
export type InsightReviewHistory = typeof InsightReviewHistoryEntity.$inferSelect;

/** The compact shape a list needs: the person's verdict on one insight, not the whole row. */
export interface InsightReviewSummary {
    status: ReviewStatus;
    reason: string | null;
    updatedAt: string;
}

export interface UpsertReviewInput {
    tenantId: string;
    userId: string;
    alertId: number;
    status: ReviewStatus;
    reason: string | null;
}

/**
 * Per-user review state on the alerts of a tenant. The alert's own status stays the system truth;
 * this repository only records what one person did with it, plus the append-only trail of that.
 */
export class InsightReviewRepository extends DatabaseRepository {
    async findByUserAndAlert(userId: string, alertId: number): Promise<InsightReview | null> {
        const [row] = await this.database.select()
            .from(InsightReviewEntity)
            .where(and(
                eq(InsightReviewEntity.userId, userId),
                eq(InsightReviewEntity.alertId, alertId)
            ))
            .limit(1);

        return row ?? null;
    }

    /** One query for a whole page of alerts; alerts the user never touched are simply absent. */
    async listForUser(
        tenantId: string,
        userId: string,
        alertIds: number[]
    ): Promise<Map<number, InsightReviewSummary>> {
        if (alertIds.length === 0) return new Map();

        const rows = await this.database.select({
            alertId: InsightReviewEntity.alertId,
            status: InsightReviewEntity.status,
            reason: InsightReviewEntity.reason,
            updatedAt: InsightReviewEntity.updatedAt,
        })
            .from(InsightReviewEntity)
            .where(and(
                eq(InsightReviewEntity.tenantId, tenantId),
                eq(InsightReviewEntity.userId, userId),
                inArray(InsightReviewEntity.alertId, alertIds)
            ));

        return new Map(rows.map((row) => [row.alertId, {
            status: row.status as ReviewStatus,
            reason: row.reason,
            updatedAt: row.updatedAt.toISOString(),
        }]));
    }

    /**
     * Writes the current verdict and, when it actually differs from what was stored, one history row.
     * Re-applying the same status with the same reason is a no-op for the trail, so a retried write
     * that slipped past the idempotency layer still leaves a single audit entry.
     *
     * A row with no predecessor starts from `active`, the implicit state of an untouched insight.
     */
    async upsertStatus(input: UpsertReviewInput): Promise<{
        review: InsightReview;
        fromStatus: ReviewStatus;
    }> {
        return this.database.transaction(async (tx) => {
            const [existing] = await tx.select()
                .from(InsightReviewEntity)
                .where(and(
                    eq(InsightReviewEntity.userId, input.userId),
                    eq(InsightReviewEntity.alertId, input.alertId)
                ))
                .limit(1)
                .for("update");

            const now = new Date();
            const reason = input.reason ?? null;
            const [review] = await tx.insert(InsightReviewEntity)
                .values({
                    tenantId: input.tenantId,
                    userId: input.userId,
                    alertId: input.alertId,
                    status: input.status,
                    reason,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: [InsightReviewEntity.userId, InsightReviewEntity.alertId],
                    set: {
                        status: input.status,
                        reason,
                        updatedAt: now,
                    },
                })
                .returning();

            const fromStatus = (existing?.status ?? "active") as ReviewStatus;
            const changed = existing === undefined
                || existing.status !== input.status
                || (existing.reason ?? null) !== reason;

            if (changed) {
                await tx.insert(InsightReviewHistoryEntity).values({
                    insightReviewId: review.id,
                    fromStatus,
                    toStatus: input.status,
                    reason,
                    changedBy: input.userId,
                    changedAt: now,
                });
            }

            return {review, fromStatus};
        });
    }

    /** Newest first; the caller's own trail only, so a colleague's decisions never leak. */
    async history(
        userId: string,
        alertId: number,
        limit: number = REVIEW_HISTORY_LIMIT
    ): Promise<{
        id: number;
        fromStatus: string | null;
        toStatus: string;
        reason: string | null;
        changedAt: Date;
    }[]> {
        return this.database.select({
            id: InsightReviewHistoryEntity.id,
            fromStatus: InsightReviewHistoryEntity.fromStatus,
            toStatus: InsightReviewHistoryEntity.toStatus,
            reason: InsightReviewHistoryEntity.reason,
            changedAt: InsightReviewHistoryEntity.changedAt,
        })
            .from(InsightReviewHistoryEntity)
            .innerJoin(
                InsightReviewEntity,
                eq(InsightReviewEntity.id, InsightReviewHistoryEntity.insightReviewId)
            )
            .where(and(
                eq(InsightReviewEntity.userId, userId),
                eq(InsightReviewEntity.alertId, alertId)
            ))
            .orderBy(desc(InsightReviewHistoryEntity.changedAt), desc(InsightReviewHistoryEntity.id))
            .limit(limit);
    }
}
