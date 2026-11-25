import {
    ExplanationRepository,
    type Explanation,
    type ExplanationScope,
    type InsertExplanation,
} from "@db/repositories/explanation.repository";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {NotFoundError} from "@shared/errors";
import {Config} from "@/config";
import {EXPLAIN_PROMPT_VERSION, EXPLAIN_RULE_VERSION} from "@/modules/explanations/contexts";
import {ExplainQueue} from "@/modules/explanations/queue";
import {
    hashJson,
    type ExplainDirection,
    type ExplanationContext,
    type ExplanationFacts,
} from "@/modules/explanations/rules";

export interface EnsureExplanationInput {
    tenantId: string;
    accountId: string;
    context: ExplanationContext;
    /** Defaults to `""` so an account-level block and a per-entity block never collide. */
    entityType?: string;
    entityId?: string;
    filter: Record<string, unknown>;
    snapshotId: string;
    /** Already formatted strings: the model only ever sees text, never a number to restate. */
    facts: ExplanationFacts & {__direction?: ExplainDirection};
    evidenceIds: string[];
}

export interface ExplanationRef {
    id: string;
    context: ExplanationContext;
    state: "PENDING" | "READY" | "FALLBACK" | "UNAVAILABLE";
    source: "model" | "template" | null;
    text: string | null;
    evidenceIds: string[];
    snapshotId: string;
    /** True while the workspace cannot reach Meta: the narrative is a rule-based stand-in, not a model answer. */
    simulated: boolean;
}

export type ExplanationDetail = ExplanationRef & {
    nextCheck: string | null;
    /** Age of the cached narrative: when the row was first written. */
    cachedAt: string;
    createdAt: string;
    updatedAt: string;
};

/** The part of the natural key the scope does not carry: what tells two rows of one batch apart. */
interface RowKey {
    entityType: string;
    entityId: string;
    filterHash: string;
    evidenceHash: string;
}

function scopeKey(scope: ExplanationScope): string {
    return `${scope.accountId}|${scope.context}|${scope.snapshotId}|${scope.ruleVersion}|${scope.promptVersion}|${scope.model}`;
}

function rowKey(key: RowKey): string {
    return `${key.entityType}|${key.entityId}|${key.filterHash}|${key.evidenceHash}`;
}

function toRef(row: Explanation, simulated: boolean): ExplanationRef {
    return {
        id: row.id,
        context: row.context as ExplanationContext,
        state: row.state,
        source: row.source === "model" || row.source === "template" ? row.source : null,
        text: row.text,
        evidenceIds: Array.isArray(row.evidenceIds) ? row.evidenceIds.map(String) : [],
        snapshotId: row.snapshotId,
        simulated,
    };
}

/**
 * One writer path for every block narrative: the server derives the natural key from the block's own
 * numbers, stores `PENDING`, and lets the worker fill the text. Identical requests reuse the row and
 * the job, so a repeated page load never pays for a second generation.
 */
export class ExplanationService {
    constructor(
        private readonly repo = new ExplanationRepository(),
        private readonly queue = new ExplainQueue(),
        private readonly model: string = Config.ai.gemini.model,
        private readonly metaConnections = new MetaConnectionRepository()
    ) {}

    async ensure(input: EnsureExplanationInput): Promise<ExplanationRef> {
        const [ref] = await this.ensureMany([input]);

        return ref;
    }

    async ensureMany(inputs: EnsureExplanationInput[]): Promise<ExplanationRef[]> {
        if (inputs.length === 0) return [];

        const rows: InsertExplanation[] = [];
        const keys: {tenantId: string; scope: ExplanationScope; key: RowKey}[] = [];

        for (const input of inputs) {
            const filterHash = hashJson(input.filter);
            const evidenceHash = hashJson(input.facts);

            rows.push({
                tenantId: input.tenantId,
                accountId: input.accountId,
                context: input.context,
                entityType: input.entityType ?? "",
                entityId: input.entityId ?? "",
                filterHash,
                snapshotId: input.snapshotId,
                evidenceHash,
                ruleVersion: EXPLAIN_RULE_VERSION,
                promptVersion: EXPLAIN_PROMPT_VERSION,
                model: this.model,
                state: "PENDING",
                facts: input.facts,
                evidenceIds: input.evidenceIds,
            });

            keys.push({
                tenantId: input.tenantId,
                scope: {
                    accountId: input.accountId,
                    context: input.context,
                    snapshotId: input.snapshotId,
                    ruleVersion: EXPLAIN_RULE_VERSION,
                    promptVersion: EXPLAIN_PROMPT_VERSION,
                    model: this.model,
                },
                key: {
                    entityType: input.entityType ?? "",
                    entityId: input.entityId ?? "",
                    filterHash,
                    evidenceHash,
                },
            });
        }

        const simulatedByTenant = new Map<string, boolean>();
        await Promise.all([
            this.repo.insertPendingBatch(rows),
            // One resolution per distinct tenant for the whole batch; a batch normally shares one.
            ...[...new Set(inputs.map((input) => input.tenantId))].map(async (tenantId) => {
                simulatedByTenant.set(tenantId, await this.resolveSimulated(tenantId));
            }),
        ]);

        const scopes = new Map<string, ExplanationScope>();
        for (const {scope} of keys) scopes.set(scopeKey(scope), scope);

        const stored = new Map<string, Explanation>();
        for (const scope of scopes.values()) {
            for (const entity of await this.repo.findBatch(scope)) {
                stored.set(`${scopeKey(scope)}|${rowKey({
                    entityType: entity.entityType,
                    entityId: entity.entityId,
                    filterHash: entity.filterHash,
                    evidenceHash: entity.evidenceHash,
                })}`, entity);
            }
        }

        const enqueued = new Set<string>();
        const refs: ExplanationRef[] = [];
        for (const {tenantId, scope, key} of keys) {
            const entity = stored.get(`${scopeKey(scope)}|${rowKey(key)}`);
            if (entity === undefined) throw new Error("explanation row missing after insert");

            if (entity.state === "PENDING" && !enqueued.has(entity.id)) {
                enqueued.add(entity.id);
                await this.queue.add("explain", {id: entity.id}, {jobId: entity.id});
            }

            const simulated = simulatedByTenant.get(tenantId);
            if (simulated === undefined) throw new Error("simulated flag missing for tenant");

            refs.push(toRef(entity, simulated));
        }

        return refs;
    }

    async get(id: string, tenantId: string): Promise<ExplanationDetail> {
        const row = await this.repo.findById(id, tenantId);
        if (row === null) throw new NotFoundError("Penjelasan tidak ditemukan");

        return {
            ...toRef(row, await this.resolveSimulated(tenantId)),
            nextCheck: row.nextCheck,
            cachedAt: row.createdAt.toISOString(),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }

    /**
     * No production Meta app configured means no model call can ever reach Meta-backed analysis, and
     * no stored connection means the same for this workspace. Both make every narrative a template
     * stand-in, so the flag is a property of the tenant, not of the row.
     */
    private async resolveSimulated(tenantId: string): Promise<boolean> {
        const appId = (Config.meta.appId ?? "").trim();
        if (appId === "" || appId === "APP_ID") return true;

        return (await this.metaConnections.findByTenantId(tenantId)) === null;
    }
}
