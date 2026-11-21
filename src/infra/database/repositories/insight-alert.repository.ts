import {DatabaseRepository} from "./base.repository";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {and, desc, eq, gt, isNull, lte, ne, notInArray, or, sql} from "drizzle-orm";
import type {AlertStatusFilter} from "@shared/alerts";

export type InsightAlert = typeof InsightAlertEntity.$inferSelect;
export type InsightAlertUpsert = typeof InsightAlertEntity.$inferInsert;

export class InsightAlertRepository extends DatabaseRepository {
    async findActiveByAccountId(accountId: string): Promise<InsightAlert[]> {
        return this.findByAccountIdAndStatus(accountId, "active");
    }

    /** `active` = `ACTIVE` with no pending snooze; `snoozed` = `SNOOZED` before its deadline; `resolved` = `DONE`. */
    async findByAccountIdAndStatus(accountId: string, filter: AlertStatusFilter): Promise<InsightAlert[]> {
        const now = new Date();
        const scope = eq(InsightAlertEntity.accountId, accountId);

        const predicate = filter === "active"
            ? and(
                scope,
                eq(InsightAlertEntity.status, "ACTIVE"),
                or(isNull(InsightAlertEntity.snoozedUntil), lte(InsightAlertEntity.snoozedUntil, now))
            )
            : filter === "snoozed"
                ? and(
                    scope,
                    eq(InsightAlertEntity.status, "SNOOZED"),
                    gt(InsightAlertEntity.snoozedUntil, now)
                )
                : and(scope, eq(InsightAlertEntity.status, "DONE"));

        return this.database.select()
            .from(InsightAlertEntity)
            .where(predicate)
            .orderBy(desc(InsightAlertEntity.detectedAt));
    }

    async countActive(accountId: string): Promise<number> {
        const now = new Date();
        const [row] = await this.database.select({total: sql<string>`count(*)`})
            .from(InsightAlertEntity)
            .where(
                and(
                    eq(InsightAlertEntity.accountId, accountId),
                    eq(InsightAlertEntity.status, "ACTIVE"),
                    or(isNull(InsightAlertEntity.snoozedUntil), lte(InsightAlertEntity.snoozedUntil, now))
                )
            );

        return Number(row.total);
    }

    /** An alert owned by another tenant is `null`, which the route maps to 404. */
    async findByIdForTenant(id: number, tenantId: string): Promise<InsightAlert | null> {
        const [row] = await this.database.select({alert: InsightAlertEntity})
            .from(InsightAlertEntity)
            .innerJoin(AdAccountEntity, eq(AdAccountEntity.id, InsightAlertEntity.accountId))
            .where(and(eq(InsightAlertEntity.id, id), eq(AdAccountEntity.tenantId, tenantId)))
            .limit(1);

        return row?.alert ?? null;
    }

    /** Explicit snooze: `SNOOZED` plus its deadline, so expiry stays computable. */
    async snooze(id: number, until: Date): Promise<void> {
        await this.database.update(InsightAlertEntity)
            .set({
                status: "SNOOZED",
                snoozedUntil: until,
                updatedAt: new Date(),
            })
            .where(eq(InsightAlertEntity.id, id));
    }

    /** Closes one alert; `resolvedBy` is the caller's user id (FK `users.id`). */
    async resolve(id: number, resolvedBy: string | null): Promise<void> {
        await this.database.update(InsightAlertEntity)
            .set({
                status: "DONE",
                resolvedAt: new Date(),
                resolvedBy,
                snoozedUntil: null,
                updatedAt: new Date(),
            })
            .where(eq(InsightAlertEntity.id, id));
    }

    /**
     * Idempotent on `(account_id, rule_key, entity_id)`: a rule that fires again updates its row
     * instead of stacking duplicates, and a re-opened alert drops its snooze/resolution.
     */
    async upsert(alert: InsightAlertUpsert): Promise<InsightAlert> {
        const [entity] = await this.database.insert(InsightAlertEntity)
            .values(alert)
            .onConflictDoUpdate({
                target: [
                    InsightAlertEntity.accountId,
                    InsightAlertEntity.ruleKey,
                    InsightAlertEntity.entityId,
                ],
                set: {
                    level: alert.level,
                    title: alert.title,
                    body: alert.body,
                    metric: alert.metric,
                    entityType: alert.entityType,
                    impactMinor: alert.impactMinor,
                    impactCaption: alert.impactCaption,
                    confidence: alert.confidence,
                    sampleSize: alert.sampleSize,
                    route: alert.route,
                    evidence: alert.evidence,
                    status: "ACTIVE",
                    snoozedUntil: null,
                    resolvedAt: null,
                    updatedAt: new Date(),
                },
            })
            .returning();

        return entity;
    }

    /**
     * Closes the alerts of a rule whose condition no longer holds; `keepEntityIds` protects the rows
     * the current evaluation still reports. Returns how many rows it closed.
     */
    async resolveByRuleKey(accountId: string, ruleKey: string, keepEntityIds: string[] = []): Promise<number> {
        const conditions = [
            eq(InsightAlertEntity.accountId, accountId),
            eq(InsightAlertEntity.ruleKey, ruleKey),
            ne(InsightAlertEntity.status, "DONE"),
        ];
        if (keepEntityIds.length > 0) {
            conditions.push(notInArray(InsightAlertEntity.entityId, keepEntityIds));
        }

        const rows = await this.database.update(InsightAlertEntity)
            .set({
                status: "DONE",
                resolvedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(and(...conditions))
            .returning({id: InsightAlertEntity.id});

        return rows.length;
    }
}
