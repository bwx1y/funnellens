import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {InsightAlertRepository, type InsightAlert} from "@db/repositories/insight-alert.repository";
import {InsightReviewRepository} from "@db/repositories/insight-review.repository";
import {NotFoundError} from "@shared/errors";
import {
    insightKey,
    parseInsightKey,
    REVIEW_HISTORY_LIMIT,
    type ReviewStatus,
} from "@shared/alerts";
import {toRow, type AlertRow} from "@/modules/alerts/service";
import {ExplanationService, type ExplanationRef} from "@/modules/explanations/service";
import {formatNumber} from "@/modules/explanations/rules";

export type InsightTab = "active" | "done";

export interface InsightListQuery {
    accountId: string;
    tab?: InsightTab;
}

export interface InsightListResponse {
    tab: InsightTab;
    items: AlertRow[];
    explanation: ExplanationRef | null;
}

export interface InsightReviewInput {
    status: ReviewStatus;
    reason?: string;
}

export interface InsightReviewResponse {
    key: string;
    status: ReviewStatus;
    updatedAt: string;
    unreadCount: number;
}

export interface InsightHistoryItem {
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    changedAt: string;
}

export interface InsightHistoryResponse {
    items: InsightHistoryItem[];
}

/**
 * The per-user view of an account's alerts: two tabs, an unread badge, and the review write path.
 * Everything here is scoped to the caller — the alert's status is shared, the review is not.
 */
export class InsightService {
    constructor(
        private readonly alertRepo = new InsightAlertRepository(),
        private readonly reviewRepo = new InsightReviewRepository(),
        private readonly explanations = new ExplanationService()
    ) {}

    /**
     * `active` = the evaluator still considers the alert open and this user has not marked it done;
     * `done` = this user marked it done, or the evaluator closed it and the user never weighed in.
     */
    async list(tenantId: string, userId: string, query: InsightListQuery): Promise<InsightListResponse> {
        await requireAccountScope(tenantId, query.accountId);

        const tab = query.tab ?? "active";
        const open = await this.alertRepo.findByAccountIdForReview(query.accountId, "open");
        const closed = tab === "done"
            ? await this.alertRepo.findByAccountIdForReview(query.accountId, "done")
            : [];

        // A `done` review on an alert the evaluator still calls open belongs in the done tab too,
        // so the done tab looks at both sets; the active tab only ever looks at the open ones.
        const candidates = tab === "done"
            ? [...closed, ...open].sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
            : open;

        const reviews = await this.reviewRepo.listForUser(
            tenantId,
            userId,
            candidates.map((alert) => alert.id)
        );

        const items = candidates
            .map(toRow)
            .map((row) => ({...row, review: reviews.get(row.id) ?? null}))
            .filter((row) => tab === "done"
                ? row.review?.status === "done" || (row.status === "DONE" && row.review === null)
                : row.review?.status !== "done");

        const ruleCounts = new Map<string, number>();
        for (const row of items) ruleCounts.set(row.ruleKey, (ruleCounts.get(row.ruleKey) ?? 0) + 1);
        let rule = "belum ada";
        let ruleCount = 0;
        for (const [ruleKey, count] of ruleCounts) {
            if (count > ruleCount) {
                rule = ruleKey;
                ruleCount = count;
            }
        }

        const explanation = await this.explanations.ensure({
            tenantId,
            accountId: query.accountId,
            context: "alert",
            entityType: "account",
            entityId: query.accountId,
            filter: {tab},
            snapshotId: tab,
            facts: {
                active: formatNumber(items.length),
                critical: formatNumber(items.filter((row) => row.level === "CRITICAL").length),
                warning: formatNumber(items.filter((row) => row.level === "WARNING").length),
                rule,
            },
            evidenceIds: items.map((row) => String(row.id)),
        });

        return {tab, items, explanation};
    }

    /** Unread = still in the active tab and this user has neither read nor closed it. */
    async unreadCount(
        tenantId: string,
        userId: string,
        query: {accountId: string}
    ): Promise<{count: number}> {
        await requireAccountScope(tenantId, query.accountId);

        return {count: await this.countUnread(tenantId, userId, query.accountId)};
    }

    /**
     * Applies one user's verdict on one insight. The key addresses the alert across accounts of the
     * tenant; whether the row may be written was already decided by the account check when listing.
     */
    async review(
        tenantId: string,
        userId: string,
        key: string,
        input: InsightReviewInput
    ): Promise<InsightReviewResponse> {
        const alert = await this.resolveAlert(tenantId, key);
        if (alert === null) throw new NotFoundError("Insight tidak ditemukan");

        const {review} = await this.reviewRepo.upsertStatus({
            tenantId,
            userId,
            alertId: alert.id,
            status: input.status,
            reason: input.reason ?? null,
        });

        return {
            key: insightKey(alert),
            status: review.status as ReviewStatus,
            updatedAt: review.updatedAt.toISOString(),
            unreadCount: await this.countUnread(tenantId, userId, alert.accountId),
        };
    }

    /** The caller's own trail; an unknown (or another tenant's) key reads as an empty list. */
    async history(tenantId: string, userId: string, key: string): Promise<InsightHistoryResponse> {
        const alert = await this.resolveAlert(tenantId, key);
        if (alert === null) return {items: []};

        const rows = await this.reviewRepo.history(userId, alert.id, REVIEW_HISTORY_LIMIT);

        return {
            items: rows.map((row) => ({
                fromStatus: row.fromStatus,
                toStatus: row.toStatus,
                reason: row.reason,
                changedAt: row.changedAt.toISOString(),
            })),
        };
    }

    private async resolveAlert(tenantId: string, key: string): Promise<InsightAlert | null> {
        const parsed = parseInsightKey(key);
        if (parsed === null) return null;

        return this.alertRepo.findByRuleKeyAndEntityIdForTenant(tenantId, parsed.ruleKey, parsed.entityId);
    }

    private async countUnread(tenantId: string, userId: string, accountId: string): Promise<number> {
        const open = await this.alertRepo.findByAccountIdForReview(accountId, "open");
        const reviews = await this.reviewRepo.listForUser(
            tenantId,
            userId,
            open.map((alert) => alert.id)
        );

        return open.filter((alert) => {
            const status = reviews.get(alert.id)?.status;
            return status !== "read" && status !== "done";
        }).length;
    }
}
