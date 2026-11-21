import {DatabaseRepository} from "./base.repository";
import {ExplanationEntity} from "@db/schema/ads/explanation.entity";
import {and, eq} from "drizzle-orm";

export type Explanation = typeof ExplanationEntity.$inferSelect;
export type InsertExplanation = typeof ExplanationEntity.$inferInsert;

/** Natural key of one explanation: same inputs, same row (and therefore the same cached text). */
export type ExplanationKey = Pick<
    InsertExplanation,
    | "accountId"
    | "context"
    | "entityType"
    | "entityId"
    | "filterHash"
    | "snapshotId"
    | "evidenceHash"
    | "ruleVersion"
    | "promptVersion"
    | "model"
>;

export class ExplanationRepository extends DatabaseRepository {
    /**
     * Idempotent on the natural key. A repeated insert returns the stored row so the caller's
     * `ensure` sees its `PENDING` state and enqueues exactly one generation job.
     */
    async insertPending(row: InsertExplanation): Promise<Explanation> {
        const [inserted] = await this.database.insert(ExplanationEntity)
            .values(row)
            .onConflictDoNothing({
                target: [
                    ExplanationEntity.accountId,
                    ExplanationEntity.context,
                    ExplanationEntity.entityType,
                    ExplanationEntity.entityId,
                    ExplanationEntity.filterHash,
                    ExplanationEntity.snapshotId,
                    ExplanationEntity.evidenceHash,
                    ExplanationEntity.ruleVersion,
                    ExplanationEntity.promptVersion,
                    ExplanationEntity.model,
                ],
            })
            .returning();

        if (inserted !== undefined) return inserted;

        const existing = await this.findByKey(row);
        if (existing === null) {
            throw new Error("explanation row missing after insert");
        }

        return existing;
    }

    async findByKey(key: ExplanationKey): Promise<Explanation | null> {
        const [entity] = await this.database.select()
            .from(ExplanationEntity)
            .where(
                and(
                    eq(ExplanationEntity.accountId, key.accountId),
                    eq(ExplanationEntity.context, key.context),
                    eq(ExplanationEntity.entityType, key.entityType ?? ""),
                    eq(ExplanationEntity.entityId, key.entityId ?? ""),
                    eq(ExplanationEntity.filterHash, key.filterHash),
                    eq(ExplanationEntity.snapshotId, key.snapshotId),
                    eq(ExplanationEntity.evidenceHash, key.evidenceHash),
                    eq(ExplanationEntity.ruleVersion, key.ruleVersion),
                    eq(ExplanationEntity.promptVersion, key.promptVersion),
                    eq(ExplanationEntity.model, key.model)
                )
            )
            .limit(1);

        return entity ?? null;
    }

    /** Tenant-scoped: the service turns `null` into `NotFoundError` without leaking other tenants' rows. */
    async findById(id: string, tenantId: string): Promise<Explanation | null> {
        const [entity] = await this.database.select()
            .from(ExplanationEntity)
            .where(
                and(
                    eq(ExplanationEntity.id, id),
                    eq(ExplanationEntity.tenantId, tenantId)
                )
            )
            .limit(1);

        return entity ?? null;
    }

    async markReady(id: string, patch: {text: string; source: "model"; nextCheck: string | null}): Promise<void> {
        await this.database.update(ExplanationEntity)
            .set({
                state: "READY",
                source: patch.source,
                text: patch.text,
                nextCheck: patch.nextCheck,
                error: null,
                updatedAt: new Date(),
            })
            .where(eq(ExplanationEntity.id, id));
    }

    async markFallback(id: string, patch: {text: string; nextCheck: string | null}): Promise<void> {
        await this.database.update(ExplanationEntity)
            .set({
                state: "FALLBACK",
                source: "template",
                text: patch.text,
                nextCheck: patch.nextCheck,
                error: null,
                updatedAt: new Date(),
            })
            .where(eq(ExplanationEntity.id, id));
    }

    async markUnavailable(id: string, error: string): Promise<void> {
        await this.database.update(ExplanationEntity)
            .set({
                state: "UNAVAILABLE",
                error,
                updatedAt: new Date(),
            })
            .where(eq(ExplanationEntity.id, id));
    }
}
