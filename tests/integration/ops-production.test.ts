import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {redisConnection} from "@infra/redis";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {UserRepository} from "@db/repositories/user.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {SyncRunEntity} from "@db/schema/ads/sync-run.entity";
import {AdInsightDailyEntity} from "@db/schema/ads/ad-insight-daily.entity";
import {AdInsightBreakdownDailyEntity} from "@db/schema/ads/ad-insight-breakdown-daily.entity";
import {AdInsightActionEntity} from "@db/schema/ads/ad-insight-action.entity";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";
import {AggregationCache} from "@infra/cache";
import {AnalyticsService} from "@/modules/analytics/service";
import {RetentionService} from "@/modules/retention/service";
import {MetaSyncDeadLetter} from "@/modules/meta/dead-letter";
import {MetaSyncWorkerProcessor} from "@/modules/meta/worker";
import {HealthService} from "@/modules/health/service";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {QueueManager, WorkerManager} from "@infra/queue";
import {JwtUtil} from "@shared/jwt";
import {and, eq} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

describe("Production operations", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();
    const insightRepo = new AdInsightDailyRepository();

    const u = Date.now().toString();
    const accountId = `act_ops_${u}`;

    let tenantId: string;
    let token: {key: string};

    const request = (path: string, init: RequestInit = {}, bearer?: {key: string}) => app.handle(new Request(
        `http://localhost${path}`,
        {
            ...init,
            headers: {
                ...(init.headers as Record<string, string> | undefined),
                ...(bearer === undefined ? {} : {authorization: `Bearer ${bearer.key}`}),
            },
        }
    ));

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `ops-${u}`});
        tenantId = tenant.id;
        const user = await userRepo.create({
            fullName: "Ops Admin",
            email: `ops-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });
        token = await new JwtUtil().register({id: user.id, tenant: tenantId, role: "ADMIN"});

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Ops Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
            isSelected: true,
        });
        await insightRepo.upsertBatch([{
            accountId,
            level: "ad",
            entityId: `ad_ops_${u}`,
            date: "2026-11-18",
            currency: "IDR",
            currencyOffset: 100,
            spendMinor: 100000,
            impressions: 5000,
            clicks: 100,
            inlineLinkClicks: 80,
            actions: [{actionType: "lead", count: "5", valueMinor: null, costPerActionMinor: null}],
        }]);
        await db.insert(SyncRunEntity).values({
            accountId,
            resource: "insights",
            status: "SUCCESS",
            startedAt: new Date(),
            finishedAt: new Date(),
        });
    });

    afterAll(async () => {
        await redisConnection.del(`rl:${(await db.select().from(UserEntity).where(eq(UserEntity.tenantId, tenantId)))[0]?.id}:0`);
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("answers the liveness probe without touching a dependency", async () => {
        const response = await request("/api/healthz");

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({status: true});
    });

    it("reports readiness with database, redis, and sync freshness", async () => {
        const response = await request("/api/readyz");
        const body = await response.json() as {
            status: boolean;
            checks: {database: boolean; redis: boolean; sync: {lastSuccessAt: string | null; overdue: boolean}};
        };

        expect(response.status).toBe(200);
        expect(body.status).toBe(true);
        expect(body.checks.database).toBe(true);
        expect(body.checks.redis).toBe(true);
        expect(body.checks.sync.lastSuccessAt).not.toBeNull();
        expect(body.checks.sync.overdue).toBe(false);
    });

    it("marks readiness unready with a message when a check fails, never throwing", async () => {
        const original = redisConnection.ping.bind(redisConnection);
        // Reason: a failing PING is the only way to exercise the timeout path without killing Redis.
        redisConnection.ping = (async () => {
            throw new Error("connection refused");
        }) as unknown as typeof redisConnection.ping;

        try {
            const response = await request("/api/readyz");
            const body = await response.json() as {
                status: boolean;
                message?: string;
                checks: {database: boolean; redis: boolean};
            };

            expect(response.status).toBe(503);
            expect(body.status).toBe(false);
            expect(body.checks.redis).toBe(false);
            expect(body.checks.database).toBe(true);
            expect(body.message).toContain("redis");
        } finally {
            redisConnection.ping = original;
        }
    });

    it("returns the same summary twice, the second time from cache", async () => {
        const cache = new AggregationCache();
        await cache.invalidateAccount(accountId);
        const service = new AnalyticsService();
        const query = {accountId, since: "2026-11-12", until: "2026-11-18"};

        const first = await service.getSummary(tenantId, query);
        const key = cache.key({endpoint: "summary", tenantId, ...query});
        expect(await cache.get(key)).not.toBeNull();

        // A cached value that differs from the computed one proves the second call read Redis, not Postgres.
        await cache.set(key, {...first, currency: "CACHED"});
        const second = await service.getSummary(tenantId, query);
        expect(second.currency).toBe("CACHED");

        await cache.invalidateAccount(accountId);
        const third = await service.getSummary(tenantId, query);
        expect(third.currency).toBe(first.currency);
        expect(JSON.stringify(third)).toBe(JSON.stringify(first));
    });

    it("drops every cached aggregation of the account on invalidation", async () => {
        const cache = new AggregationCache();
        const summaryKey = cache.key({endpoint: "summary", tenantId, accountId, since: "2026-11-12", until: "2026-11-18"});
        const funnelKey = cache.key({endpoint: "funnel", tenantId, accountId, days: 7});

        await cache.set(summaryKey, {a: 1});
        await cache.set(funnelKey, {b: 2});
        expect(await cache.get(summaryKey)).not.toBeNull();

        const deleted = await cache.invalidateAccount(accountId);

        expect(deleted).toBe(2);
        expect(await cache.get(summaryKey)).toBeNull();
        expect(await cache.get(funnelKey)).toBeNull();
    });

    it("keeps days=7 and days=30 in different cache entries", async () => {
        const cache = new AggregationCache();

        expect(cache.key({endpoint: "summary", tenantId, accountId, days: 7}))
            .not.toBe(cache.key({endpoint: "summary", tenantId, accountId, days: 30}));
        expect(cache.key({endpoint: "summary", tenantId, accountId, days: 7}))
            .not.toBe(cache.key({endpoint: "funnel", tenantId, accountId, days: 7}));
    });

    it("stamps every response with an x-request-id and echoes a supplied one", async () => {
        const generated = await request("/api/healthz");
        expect(generated.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

        const echoed = await request("/api/healthz", {headers: {"x-request-id": "req-abc-123"}});
        expect(echoed.headers.get("x-request-id")).toBe("req-abc-123");

        const failed = await request("/api/leads/999999", {}, token);
        expect(failed.status).toBe(404);
        expect(failed.headers.get("x-request-id")).not.toBeNull();
    });

    it("exposes Prometheus metrics with route patterns, not concrete paths", async () => {
        await request("/api/leads/1", {}, token);
        await request("/api/leads/2", {}, token);

        const response = await request("/api/metrics/", {}, token);
        const text = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/plain");
        expect(text).toContain("http_requests_total{");
        expect(text).toContain('route="/api/leads/:id"');
        expect(text).not.toContain('route="/api/leads/1"');
        expect(text).toContain("http_request_duration_seconds_bucket{");
        expect(text).toContain("http_request_duration_seconds_count{");
        expect(text).toContain("http_request_duration_seconds_sum{");
        expect(text).toContain('quantile="0.95"');
    });

    it("rate limits a user at 120 requests per minute and exempts the probes", async () => {
        // A fresh user id means a fresh rate-limit bucket: the earlier tests already spent part of
        // this one, and the assertion is about the 121st request of a clean window.
        const burstUser = await userRepo.create({
            fullName: "Burst User",
            email: `ops-burst-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });
        const limited = await new JwtUtil().register({id: burstUser.id, tenant: tenantId, role: "ADMIN"});

        let last: Response | undefined;
        for (let index = 0; index < 121; index += 1) {
            last = await request("/api/settings", {}, limited);
        }

        expect(last?.status).toBe(429);
        expect(last?.headers.get("retry-after")).toMatch(/^\d+$/);
        expect(await last?.json()).toEqual({
            status: false,
            message: "Batas 120 permintaan per menit terlampaui",
            code: "RATE_LIMITED",
        });

        // The probe must still answer while the budget is spent.
        expect((await request("/api/healthz", {}, limited)).status).toBe(200);
    });

    it("replays a PATCH with the same Idempotency-Key and rejects a changed body", async () => {
        const [lead] = await db.insert(LeadEntity).values({
            accountId,
            name: "Lead Idempotent",
            stage: "CHAT_STARTED",
        }).returning();
        const key = `idem-test-${u}`;

        const first = await request(`/api/leads/${lead.id}`, {
            method: "PATCH",
            headers: {"content-type": "application/json", "idempotency-key": key},
            body: JSON.stringify({temperature: "HOT"}),
        }, token);
        expect(first.status).toBe(200);
        const firstBody = await first.text();

        const replay = await request(`/api/leads/${lead.id}`, {
            method: "PATCH",
            headers: {"content-type": "application/json", "idempotency-key": key},
            body: JSON.stringify({temperature: "HOT"}),
        }, token);
        expect(replay.status).toBe(200);
        expect(await replay.text()).toBe(firstBody);

        const conflict = await request(`/api/leads/${lead.id}`, {
            method: "PATCH",
            headers: {"content-type": "application/json", "idempotency-key": key},
            body: JSON.stringify({temperature: "COLD"}),
        }, token);
        expect(conflict.status).toBe(409);
        expect(await conflict.json()).toEqual({
            status: false,
            message: "Idempotency-Key dipakai dengan body berbeda",
            code: "IDEMPOTENCY_CONFLICT",
        });

        // The rejected body never reached the handler, so the stored write is still the first one.
        const [stored] = await db.select().from(LeadEntity).where(eq(LeadEntity.id, lead.id));
        expect(stored.temperature).toBe("HOT");
    });

    it("deletes expired insights and nulls old message bodies while keeping newer rows", async () => {
        const policy = {insightDays: 400, messageBodyDays: 180, syncRunDays: 90};
        const service = new RetentionService(policy);

        await insightRepo.upsertBatch([
            {
                accountId,
                level: "ad",
                entityId: `ad_ops_old_${u}`,
                date: "2024-01-01",
                currency: "IDR",
                currencyOffset: 100,
                spendMinor: 1000,
                impressions: 10,
                clicks: 1,
                inlineLinkClicks: 1,
            },
            {
                accountId,
                level: "ad",
                entityId: `ad_ops_new_${u}`,
                date: "2026-11-18",
                currency: "IDR",
                currencyOffset: 100,
                spendMinor: 2000,
                impressions: 20,
                clicks: 2,
                inlineLinkClicks: 2,
            },
        ]);
        const [oldInsight] = await db.select().from(AdInsightDailyEntity)
            .where(eq(AdInsightDailyEntity.entityId, `ad_ops_old_${u}`));
        await db.insert(AdInsightActionEntity).values({
            insightDailyId: oldInsight.id,
            actionType: "lead",
            count: "1",
        });

        const [lead] = await db.insert(LeadEntity).values({
            accountId,
            name: "Lead Retensi",
            stage: "CHAT_STARTED",
        }).returning();
        await db.insert(ConversationMessageEntity).values([
            {
                leadId: lead.id,
                direction: "INBOUND",
                body: "pesan lama",
                sentAt: new Date("2024-01-01T02:00:00.000Z"),
                responseSeconds: 300,
            },
            {
                leadId: lead.id,
                direction: "INBOUND",
                body: "pesan baru",
                sentAt: new Date(),
            },
        ]);

        const results = await service.run();
        const own = results.find((row) => row.accountId === accountId);
        if (own === undefined) throw new Error("retention did not run for the test account");

        expect(own.insightRows).toBe(1);
        expect(own.actionRows).toBe(1);

        const remaining = await db.select().from(AdInsightDailyEntity)
            .where(eq(AdInsightDailyEntity.accountId, accountId));
        expect(remaining.map((row) => row.date).sort()).toEqual(["2026-11-18", "2026-11-18"]);

        const messages = await db.select().from(ConversationMessageEntity)
            .where(eq(ConversationMessageEntity.leadId, lead.id));
        const old = messages.find((row) => row.sentAt < new Date("2025-01-01"));
        const fresh = messages.find((row) => row.sentAt >= new Date("2025-01-01"));
        // The row survives with its statistics; only the text is gone.
        expect(old?.body).toBeNull();
        expect(old?.responseSeconds).toBe(300);
        expect(fresh?.body).toBe("pesan baru");

        const runs = await db.select().from(SyncRunEntity)
            .where(eq(SyncRunEntity.accountId, accountId));
        expect(runs.some((row) => row.resource === "retention" && row.status === "SUCCESS")).toBe(true);
    });

    it("refreshes the cache and clears the failure alert after a successful sync", async () => {
        const cache = new AggregationCache();
        const key = cache.key({endpoint: "summary", tenantId, accountId, days: 7});
        await cache.set(key, {stale: true});

        const deadLetter = new MetaSyncDeadLetter();
        await deadLetter.record("sync-daily", {accountId, tenantId}, "timeout", 5);
        const [before] = await db.select().from(InsightAlertEntity)
            .where(and(eq(InsightAlertEntity.accountId, accountId), eq(InsightAlertEntity.ruleKey, "sync_failed")));
        expect(before.status).toBe("ACTIVE");

        await new MetaSyncWorkerProcessor().refreshAfterSync(accountId);

        expect(await cache.get(key)).toBeNull();
        const [after] = await db.select().from(InsightAlertEntity)
            .where(and(eq(InsightAlertEntity.accountId, accountId), eq(InsightAlertEntity.ruleKey, "sync_failed")));
        expect(after.status).toBe("DONE");
    });

    it("marks the database check false when the probe cannot connect", async () => {
        const service = new HealthService(
            // Reason: the only way to fail `select 1` is to replace the probe, not the real connection.
            {ping: async () => {
                throw new Error("ECONNREFUSED");
            }} as never
        );

        const result = await service.readiness();

        expect(result.status).toBe(false);
        expect(result.checks.database).toBe(false);
        expect(result.message).toContain("database");
    });

    it("moves an exhausted job to the dead-letter queue and raises sync_failed", async () => {
        const account = {id: accountId};
        const deadLetter = new MetaSyncDeadLetter();

        const entry = await deadLetter.record(
            "sync-daily",
            {accountId: account.id, tenantId, userId: "u-1"},
            "Rate limit reached",
            5
        );

        expect(entry.attemptsMade).toBe(5);
        const listed = await request("/api/meta/queue/dlq", {}, token);
        const rows = await listed.json() as {id: string; jobName: string; error: string; attemptsMade: number}[];

        expect(listed.status).toBe(200);
        const stored = rows.find((row) => row.jobName === "sync-daily" && row.error === "Rate limit reached");
        expect(stored?.attemptsMade).toBe(5);

        const alerts = await db.select().from(InsightAlertEntity)
            .where(and(eq(InsightAlertEntity.accountId, accountId), eq(InsightAlertEntity.ruleKey, "sync_failed")));
        expect(alerts.length).toBe(1);
        expect(alerts[0].status).toBe("ACTIVE");
        expect(alerts[0].evidence).toEqual({jobName: "sync-daily", attemptsMade: 5, error: "Rate limit reached"});

        const removed = await request(`/api/meta/queue/dlq/${stored?.id}`, {method: "DELETE"}, token);
        expect(removed.status).toBe(200);
        expect(await removed.json()).toEqual({deleted: true, id: stored?.id});

        const again = await request(`/api/meta/queue/dlq/${stored?.id}`, {method: "DELETE"}, token);
        expect(again.status).toBe(404);

        // A later successful sync of the account closes the alert the dead letter opened.
        await deadLetter.clearAlert(account.id);
        const [closed] = await db.select().from(InsightAlertEntity)
            .where(and(eq(InsightAlertEntity.accountId, accountId), eq(InsightAlertEntity.ruleKey, "sync_failed")));
        expect(closed.status).toBe("DONE");
    });

    it("only calls the dead-letter hook after the last attempt", async () => {
        const queueName = `ops-exhaust-${u}`;
        const calls: number[] = [];
        const manager = new WorkerManager<{fail: boolean}, void, "probe">(
            queueName,
            async () => {
                throw new Error("boom");
            },
            undefined,
            async (job) => {
                calls.push(job.attemptsMade);
            }
        );
        const queue = new QueueManager<{fail: boolean}, void, "probe">(queueName);
        await queue.add("probe", {fail: true});

        const deadline = Date.now() + 10_000;
        while (calls.length === 0 && Date.now() < deadline) {
            await Bun.sleep(50);
        }

        expect(calls).toEqual([1]);

        await manager.close(true);
        await queue.close();
        await queue.instance.obliterate({force: true}).catch(() => {});
    });

    it("keeps the breakdown table trimmed to the same window", async () => {
        await db.insert(AdInsightBreakdownDailyEntity).values([
            {
                accountId,
                level: "ad",
                entityId: `ad_ops_old_${u}`,
                date: "2024-01-01",
                attributionWindow: "7d_click",
                breakdownHash: `old-${u}`,
            },
            {
                accountId,
                level: "ad",
                entityId: `ad_ops_new_${u}`,
                date: "2026-11-18",
                attributionWindow: "7d_click",
                breakdownHash: `new-${u}`,
            },
        ]);

        await new RetentionService({insightDays: 400, messageBodyDays: 180, syncRunDays: 90}).run();

        const rows = await db.select().from(AdInsightBreakdownDailyEntity)
            .where(eq(AdInsightBreakdownDailyEntity.accountId, accountId));
        expect(rows.map((row) => row.date)).toEqual(["2026-11-18"]);
    });
});
