import {DatabaseRepository} from "./base.repository";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {and, desc, eq, ne} from "drizzle-orm";

export type InsightAlert = typeof InsightAlertEntity.$inferSelect;

export class InsightAlertRepository extends DatabaseRepository {
    async findActiveByAccountId(accountId: string): Promise<InsightAlert[]> {
        return this.database.select()
            .from(InsightAlertEntity)
            .where(
                and(
                    eq(InsightAlertEntity.accountId, accountId),
                    eq(InsightAlertEntity.status, "ACTIVE")
                )
            )
            .orderBy(desc(InsightAlertEntity.detectedAt));
    }

    async updateStatus(id: number, status: "snoozed" | "resolved"): Promise<void> {
        await this.database.update(InsightAlertEntity)
            .set({
                status: status === "snoozed" ? "SNOOZED" : "DONE",
                updatedAt: new Date(),
            })
            .where(eq(InsightAlertEntity.id, id));
    }

    /**
     * Idempotent on `(account_id, rule_key, entity_id)`: a rule that fires again updates its row
     * instead of stacking duplicates, and a re-opened alert drops its snooze/resolution.
     */
    async upsert(alert: typeof InsightAlertEntity.$inferInsert): Promise<InsightAlert> {
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

    /** Closes the alerts of a rule whose condition no longer holds; returns how many rows it closed. */
    async resolveByRuleKey(accountId: string, ruleKey: string): Promise<number> {
        const rows = await this.database.update(InsightAlertEntity)
            .set({
                status: "DONE",
                resolvedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(InsightAlertEntity.accountId, accountId),
                    eq(InsightAlertEntity.ruleKey, ruleKey),
                    ne(InsightAlertEntity.status, "DONE")
                )
            )
            .returning({id: InsightAlertEntity.id});

        return rows.length;
    }
}
