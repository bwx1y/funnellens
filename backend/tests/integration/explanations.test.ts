import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {ExplanationRepository} from "@db/repositories/explanation.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {ExplanationEntity} from "@db/schema/ads/explanation.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {QueueManager} from "@infra/queue";
import type {AIGenerateOptions, AIMessage, AIResponse} from "@infra/ai/types";
import {JwtUtil} from "@shared/jwt";
import {ExplanationService, type EnsureExplanationInput} from "@/modules/explanations/service";
import {ExplainWorkerProcessor, type ExplainModel} from "@/modules/explanations/worker";
import type {ExplainJobData, ExplainJobName} from "@/modules/explanations/queue";
import type {Job} from "@infra/queue";
import {and, eq} from "drizzle-orm";
import {readData, readError} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

/** Records the job the way BullMQ does: a repeated `jobId` is the same job, not a second one. */
const jobs = new Map<string, {name: string; data: ExplainJobData; jobId: string | undefined}>();
const enqueues: {name: string; data: ExplainJobData; jobId: string | undefined}[] = [];

function job(id: string) {
    return {data: {id}} as unknown as Job<ExplainJobData, void, ExplainJobName>;
}

describe("Explanations", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const repo = new ExplanationRepository();
    const service = new ExplanationService();
    const originalAdd = QueueManager.prototype.add;

    const u = Date.now().toString();
    const accountId = `act_explain_${u}`;

    let tenantId: string;
    let otherTenantId: string;

    beforeAll(async () => {
        tenantId = (await tenantRepo.create({name: `explain-test-${u}`})).id;
        otherTenantId = (await tenantRepo.create({name: `explain-other-${u}`})).id;

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Explain Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });

        // Reason: only the enqueue is under test; the fake never touches BullMQ's Job wrapper.
        QueueManager.prototype.add = (async (
            name: string,
            data: ExplainJobData,
            options?: {jobId?: string}
        ) => {
            const record = {name, data, jobId: options?.jobId};
            enqueues.push(record);
            jobs.set(record.jobId ?? String(jobs.size), record);
            return {};
        }) as unknown as typeof QueueManager.prototype.add;
    });

    afterAll(async () => {
        QueueManager.prototype.add = originalAdd;
        await cleanupRepo.cleanup(tenantId);
        await cleanupRepo.cleanup(otherTenantId);
    });

    function leakInput(snapshotId: string): EnsureExplanationInput {
        return {
            tenantId,
            accountId,
            context: "funnel_leak",
            entityType: "account",
            entityId: accountId,
            filter: {since: "2026-03-01", until: "2026-03-02"},
            snapshotId,
            facts: {
                previous: "30%",
                current: "25%",
                transition: "klik ke chat",
                gap: "12",
                __direction: "down",
            },
            evidenceIds: [],
        };
    }

    it("reuses one row and one job for two identical requests", async () => {
        jobs.clear();
        enqueues.length = 0;
        const input = leakInput(`once-${u}`);

        const first = await service.ensure(input);
        const second = await service.ensure(input);

        expect(second.id).toBe(first.id);
        expect(first.state).toBe("PENDING");
        expect(first.source).toBeNull();
        expect(first.text).toBeNull();

        const rows = await db.select()
            .from(ExplanationEntity)
            .where(and(
                eq(ExplanationEntity.accountId, accountId),
                eq(ExplanationEntity.context, "funnel_leak"),
                eq(ExplanationEntity.snapshotId, `once-${u}`)
            ));
        expect(rows.length).toBe(1);

        expect(jobs.size).toBe(1);
        expect(enqueues.length).toBeGreaterThan(0);
        expect(enqueues.every((call) => call.name === "explain" && call.jobId === first.id)).toBe(true);
        expect([...jobs.values()][0].data.id).toBe(first.id);
    });

    it("replaces a template that writes its own numbers with the block's own fallback", async () => {
        const row = await service.ensure(leakInput(`rejected-${u}`));

        const model: ExplainModel = {
            async generateObject<T>(): Promise<AIResponse<T>> {
                return {
                    data: {template: "Konversi naik 25%", nextCheck: "campaign"} as unknown as T,
                    provider: "test",
                    model: "test",
                };
            },
        };
        await new ExplainWorkerProcessor(repo, model, ["test-key"]).process(job(row.id));

        const stored = await repo.findById(row.id, tenantId);
        expect(stored?.state).toBe("FALLBACK");
        expect(stored?.source).toBe("template");
        expect(stored?.text).toBe("Konversi klik ke chat turun dari 30% ke 25%. Periksa campaign yang menyumbang penurunan terbesar.");
        expect(stored?.nextCheck).toBe("campaign");
        expect(stored?.error).toBe("template mengandung angka");
    });

    it("keeps two contexts of the same creative apart", async () => {
        const common = {
            tenantId,
            accountId,
            entityType: "creative",
            entityId: `cr_${u}`,
            snapshotId: `apart-${u}`,
            evidenceIds: [`cr_${u}`],
        };
        const quality = await service.ensure({
            ...common,
            context: "lead_quality",
            filter: {since: "2026-03-01", until: "2026-03-02"},
            facts: {creatives: "3", hotRate: "25%", best: "Kreatif A"},
        });
        const comparison = await service.ensure({
            ...common,
            context: "comparison",
            filter: {creativeIds: [`cr_${u}`], goal: "wa"},
            facts: {left: "Kreatif A", right: "Kreatif B", metric: "biaya per percakapan", delta: "10%"},
        });

        expect(quality.id).not.toBe(comparison.id);

        const model: ExplainModel = {
            async generateObject<T>(messages: AIMessage[]): Promise<AIResponse<T>> {
                const template = messages[0].content.includes("Kualitas lead per kreatif")
                    ? "Dari {creatives} kreatif, rasio lead HOT tertinggi {hotRate} pada {best}."
                    : "Pada {metric}, {left} dan {right} berbeda {delta}.";

                return {
                    data: {template, nextCheck: "sample_size"} as unknown as T,
                    provider: "test",
                    model: "test",
                };
            },
        };
        const processor = new ExplainWorkerProcessor(repo, model, ["test-key"]);
        await processor.process(job(quality.id));
        await processor.process(job(comparison.id));

        const qualityRow = await repo.findById(quality.id, tenantId);
        const comparisonRow = await repo.findById(comparison.id, tenantId);
        expect(qualityRow?.state).toBe("READY");
        expect(qualityRow?.text).toBe("Dari 3 kreatif, rasio lead HOT tertinggi 25% pada Kreatif A.");
        expect(qualityRow?.nextCheck).toBeNull();
        expect(comparisonRow?.text).toBe("Pada biaya per percakapan, Kreatif A dan Kreatif B berbeda 10%.");
        expect(comparisonRow?.nextCheck).toBe("sample_size");
        expect(qualityRow?.text).not.toBe(comparisonRow?.text);
    });

    it("falls back without calling the model when no API key is configured", async () => {
        const row = await service.ensure(leakInput(`nokey-${u}`));

        let called = false;
        const model: ExplainModel = {
            async generateObject<T>(_messages: AIMessage[], _schema?: Record<string, any>, _options?: AIGenerateOptions): Promise<AIResponse<T>> {
                called = true;
                throw new Error("model harus dilewati");
            },
        };
        await new ExplainWorkerProcessor(repo, model, []).process(job(row.id));

        const stored = await repo.findById(row.id, tenantId);
        expect(called).toBe(false);
        expect(stored?.state).toBe("FALLBACK");
        expect(stored?.text).toBe("Konversi klik ke chat turun dari 30% ke 25%. Periksa campaign yang menyumbang penurunan terbesar.");
        expect(stored?.error).toBeNull();
    });

    it("never regenerates a finished row", async () => {
        const row = await service.ensure(leakInput(`done-${u}`));
        await repo.markReady(row.id, {text: "sudah jadi", source: "model", nextCheck: null});

        let called = false;
        const model: ExplainModel = {
            async generateObject<T>(): Promise<AIResponse<T>> {
                called = true;
                throw new Error("model harus dilewati");
            },
        };
        await new ExplainWorkerProcessor(repo, model, ["test-key"]).process(job(row.id));

        expect(called).toBe(false);
        expect((await repo.findById(row.id, tenantId))?.text).toBe("sudah jadi");
    });

    it("serves one explanation to its own tenant only", async () => {
        const row = await service.ensure(leakInput(`route-${u}`));
        const jwt = new JwtUtil();
        const own = await jwt.register({id: `user-explain-${u}`, tenant: tenantId, role: "ADMIN"});
        const other = await jwt.register({id: `user-explain-other-${u}`, tenant: otherTenantId, role: "ADMIN"});

        const ownResponse = await app.handle(new Request(
            `http://localhost/api/insights/explanations/${row.id}`,
            {headers: {authorization: `Bearer ${own.key}`}}
        ));
        expect(ownResponse.status).toBe(200);
        const body = await readData<{id: string; context: string; nextCheck: string | null}>(ownResponse);
        expect(body.id).toBe(row.id);
        expect(body.context).toBe("funnel_leak");
        expect(body.nextCheck).toBeNull();

        const otherResponse = await app.handle(new Request(
            `http://localhost/api/insights/explanations/${row.id}`,
            {headers: {authorization: `Bearer ${other.key}`}}
        ));
        expect(otherResponse.status).toBe(404);
        expect(await readError(otherResponse)).toEqual({
            code: "NOT_FOUND",
            message: "Penjelasan tidak ditemukan",
            details: null,
        });
    });
});
