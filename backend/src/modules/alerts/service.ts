import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {InsightAlertRepository, type InsightAlert} from "@db/repositories/insight-alert.repository";
import {
    InsightReviewRepository,
    type InsightReviewSummary,
} from "@db/repositories/insight-review.repository";
import {NotFoundError} from "@shared/errors";
import {ExplanationService, type ExplanationRef} from "@/modules/explanations/service";
import {formatNumber} from "@/modules/explanations/rules";
import {
    insightKey,
    snoozedUntil,
    type AlertStatusFilter,
    type ReviewStatus,
    type SnoozeHours,
} from "@shared/alerts";
import {pageMeta, resolvePage, type PageMeta} from "@shared/pagination";

export interface AlertListQuery {
    accountId: string;
    status?: AlertStatusFilter;
    page?: string;
    page_size?: string;
}

export interface AlertRow {
    id: number;
    /** Public id derived from (ruleKey, entityId); stable across syncs, never the database row id. */
    key: string;
    ruleKey: string;
    level: "INFO" | "WARNING" | "CRITICAL";
    title: string;
    body: string | null;
    metric: string | null;
    entityType: string | null;
    entityId: string;
    impactMinor: number | null;
    impactCaption: string | null;
    confidence: string | null;
    sampleSize: number | null;
    route: string | null;
    evidence: unknown;
    status: "ACTIVE" | "DONE" | "SNOOZED";
    snoozedUntil: string | null;
    resolvedAt: string | null;
    detectedAt: string;
    /** The caller's own verdict; `null` until they touch the insight, and always `null` in `toRow`. */
    review: InsightReviewSummary | null;
}

export interface AlertListResponse {
    items: AlertRow[];
    meta: PageMeta;
    status: AlertStatusFilter;
    explanation: ExplanationRef | null;
    /** @deprecated the unpaginated list, dropped after one release. */
    alerts: AlertRow[];
    /** @deprecated alias of `meta.page`. */
    page: number;
    /** @deprecated alias of `meta.page_size`. */
    limit: number;
    /** @deprecated alias of `meta.total`. */
    total: number;
}

/**
 * Maps one alert row to the API shape. Pure and review-free on purpose: a caller that has the
 * reviews batch loads them once and attaches them, so mapping a row never costs a query.
 */
export function toRow(alert: InsightAlert): AlertRow {
    return {
        id: alert.id,
        key: insightKey(alert),
        ruleKey: alert.ruleKey,
        level: alert.level,
        title: alert.title,
        body: alert.body,
        metric: alert.metric,
        entityType: alert.entityType,
        entityId: alert.entityId,
        impactMinor: alert.impactMinor,
        impactCaption: alert.impactCaption,
        confidence: alert.confidence,
        sampleSize: alert.sampleSize,
        route: alert.route,
        evidence: alert.evidence,
        status: alert.status,
        snoozedUntil: alert.snoozedUntil === null ? null : alert.snoozedUntil.toISOString(),
        resolvedAt: alert.resolvedAt === null ? null : alert.resolvedAt.toISOString(),
        detectedAt: alert.detectedAt.toISOString(),
        review: null,
    };
}

/** Account-scoped alert management; every method re-checks the tenant before touching a row. */
export class AlertService {
    constructor(
        private readonly alertRepo = new InsightAlertRepository(),
        private readonly reviewRepo = new InsightReviewRepository(),
        private readonly explanations = new ExplanationService()
    ) {}

    /**
     * The (`active`|`snoozed`|`resolved`) list. With a `userId` each row carries that user's review
     * verdict, batch-loaded in one query; without one the field is `null` for every row.
     */
    async list(tenantId: string, query: AlertListQuery, userId?: string): Promise<AlertListResponse> {
        await requireAccountScope(tenantId, query.accountId);

        const filter = query.status ?? "active";
        const rows = await this.alertRepo.findByAccountIdAndStatus(query.accountId, filter);

        const ruleCounts = new Map<string, number>();
        for (const row of rows) ruleCounts.set(row.ruleKey, (ruleCounts.get(row.ruleKey) ?? 0) + 1);
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
            filter: {status: filter},
            snapshotId: filter,
            facts: {
                active: formatNumber(rows.length),
                critical: formatNumber(rows.filter((row) => row.level === "CRITICAL").length),
                warning: formatNumber(rows.filter((row) => row.level === "WARNING").length),
                rule,
            },
            evidenceIds: rows.map((row) => String(row.id)),
        });

        const mapped = rows.map(toRow);
        const reviewed = userId === undefined
            ? mapped
            : await this.withReviews(tenantId, userId, mapped);

        const {page, pageSize} = resolvePage(query.page, query.page_size, reviewed.length);
        const items = reviewed.slice((page - 1) * pageSize, page * pageSize);

        return {
            items,
            meta: pageMeta(page, pageSize, reviewed.length),
            status: filter,
            explanation,
            alerts: reviewed,
            page,
            limit: pageSize,
            total: reviewed.length,
        };
    }

    /** One batch query for the whole page; rows the user never reviewed keep `review: null`. */
    protected async withReviews(
        tenantId: string,
        userId: string,
        rows: AlertRow[]
    ): Promise<AlertRow[]> {
        const reviews = await this.reviewRepo.listForUser(tenantId, userId, rows.map((row) => row.id));

        return rows.map((row) => ({...row, review: reviews.get(row.id) ?? null}));
    }

    async badge(tenantId: string, query: {accountId: string}): Promise<{count: number}> {
        await requireAccountScope(tenantId, query.accountId);

        return {count: await this.alertRepo.countActive(query.accountId)};
    }

    async snooze(
        tenantId: string,
        id: number,
        body: {hours: SnoozeHours}
    ): Promise<{id: number; status: "SNOOZED"; snoozedUntil: string}> {
        const alert = await this.alertRepo.findByIdForTenant(id, tenantId);
        if (alert === null) throw new NotFoundError("Alert tidak ditemukan");

        const until = snoozedUntil(body.hours, new Date());
        await this.alertRepo.snooze(id, until);

        return {id, status: "SNOOZED", snoozedUntil: until.toISOString()};
    }

    async resolve(
        tenantId: string,
        id: number,
        userId: string
    ): Promise<{id: number; status: "DONE"; resolvedAt: string}> {
        const alert = await this.alertRepo.findByIdForTenant(id, tenantId);
        if (alert === null) throw new NotFoundError("Alert tidak ditemukan");

        await this.alertRepo.resolve(id, userId);

        return {id, status: "DONE", resolvedAt: new Date().toISOString()};
    }
}
