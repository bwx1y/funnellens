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

/** The ten columns of `uq_explanations_key`, in index order. */
const NATURAL_KEY_COLUMNS = [
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
];

/** Everything the natural key shares between the rows of one `ensureMany` call. */
export interface ExplanationScope {
    accountId: string;
    context: string;
    snapshotId: string;
    ruleVersion: string;
    promptVersion: string;
    model: string;
}

export class ExplanationRepository extends DatabaseRepository {
    /**
     * Idempotent on the natural key. A repeated insert returns the stored row so the caller's
     * `ensure` sees its `PENDING` state and enqueues exactly one generation job.
     */
    async insertPending(row: InsertExplanation): Promise<Explanation> {
        const [inserted] = await this.database.insert(ExplanationEntity)
            .values(row)
            .onConflictDoNothing({target: NATURAL_KEY_COLUMNS})
            .returning();

        if (inserted !== undefined) return inserted;

        const existing = await this.findByKey(row);
        if (existing === null) {
            throw new Error("explanation row missing after insert");
        }

        return existing;
    }

    /**
     * One statement for the whole batch. Rows already stored are skipped, so the caller reads them
     * back with {@link findBatch} and never re-inserts per row.
     */
    async insertPendingBatch(rows: InsertExplanation[]): Promise<Explanation[]> {
        if (rows.length === 0) return [];

        return await this.database.insert(ExplanationEntity)
            .values(rows)
            .onConflictDoNothing({target: NATURAL_KEY_COLUMNS})
            .returning();
    }

    /** Every row sharing a scope; the caller matches them to its inputs by the rest of the key. */
    async findBatch(scope: ExplanationScope): Promise<Explanation[]> {
        return await this.database.select()
            .from(ExplanationEntity)
            .where(
                and(
                    eq(ExplanationEntity.accountId, scope.accountId),
                    eq(ExplanationEntity.context, scope.context),
                    eq(ExplanationEntity.snapshotId, scope.snapshotId),
                    eq(ExplanationEntity.ruleVersion, scope.ruleVersion),
                    eq(ExplanationEntity.promptVersion, scope.promptVersion),
                    eq(ExplanationEntity.model, scope.model)
                )
            );
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

    /** Worker-only read: the job carries an id that was already tenant-checked by `ensure`. */
    async findByIdForWorker(id: string): Promise<Explanation | null> {
        const [entity] = await this.database.select()
            .from(ExplanationEntity)
            .where(eq(ExplanationEntity.id, id))
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

    async markFallback(
        id: string,
        patch: {text: string; nextCheck: string | null; error?: string | null}
    ): Promise<void> {
        await this.database.update(ExplanationEntity)
            .set({
                state: "FALLBACK",
                source: "template",
                text: patch.text,
                nextCheck: patch.nextCheck,
                error: patch.error ?? null,
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
