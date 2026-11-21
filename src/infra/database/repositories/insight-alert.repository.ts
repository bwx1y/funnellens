import {DatabaseRepository} from "./base.repository";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {and, desc, eq} from "drizzle-orm";

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
}
