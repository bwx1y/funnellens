import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {UserRepository} from "@db/repositories/user.repository";
import {InsightAlertRepository} from "@db/repositories/insight-alert.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {InsightReviewHistoryEntity} from "@db/schema/ads/insight-review.entity";
import {JwtUtil} from "@shared/jwt";
import {insightKey} from "@shared/alerts";
import {eq} from "drizzle-orm";
import {readData, readError} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

interface ReviewBlock {
    status: "read" | "done" | "active";
    reason: string | null;
    updatedAt: string;
}

interface InsightRow {
    id: number;
    key: string;
    ruleKey: string;
    status: string;
    review: ReviewBlock | null;
}

interface InsightListBody {
    tab: string;
    items: InsightRow[];
}

interface ReviewBody {
    key: string;
    status: ReviewBlock["status"];
    updatedAt: string;
    unreadCount: number;
}

interface HistoryBody {
    items: {fromStatus: string | null; toStatus: string; reason: string | null; changedAt: string}[];
}

const ACCOUNT = (u: string) => `act_review_${u}`;
const IDEMPOTENCY = "idempotency-key";

/** F-18.3/F-18.4: per-user review state, tabs, unread count, an audit trail, and idempotent writes. */
describe("Insight review per user", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();
    const alertRepo = new InsightAlertRepository();

    const u = Date.now().toString();
    const accountId = ACCOUNT(u);

    let tenantId: string;
    let adminA: {id: string};
    let adminB: {id: string};
    let tokenA: {key: string};
    let tokenB: {key: string};
    let alertOne: {id: number; ruleKey: string; entityId: string};
    let alertTwo: {id: number; ruleKey: string; entityId: string};

    const request = (path: string, init: RequestInit = {}, token: {key: string} = tokenA) =>
        app.handle(new Request(`http://localhost${path}`, {
            ...init,
            headers: {
                ...(init.headers as Record<string, string> | undefined),
                authorization: `Bearer ${token.key}`,
            },
        }));

    const list = async (tab: "active" | "done", token: {key: string} = tokenA): Promise<InsightListBody> => {
        const response = await request(`/api/insights?accountId=${accountId}&tab=${tab}`, {}, token);
        expect(response.status).toBe(200);

        return await readData<InsightListBody>(response);
    };

    const unread = async (token: {key: string} = tokenA): Promise<number> => {
        const response = await request(`/api/insights/unread-count?accountId=${accountId}`, {}, token);
        expect(response.status).toBe(200);

        return (await readData<{count: number}>(response)).count;
    };

    const review = (
        key: string,
        body: {status: ReviewBlock["status"]; reason?: string},
        idempotencyKey: string,
        token: {key: string} = tokenA
    ) => request(`/api/insights/${encodeURIComponent(key)}/review`, {
        method: "PATCH",
        headers: {"content-type": "application/json", [IDEMPOTENCY]: idempotencyKey},
        body: JSON.stringify(body),
    }, token);

    const historyCount = async (userId: string): Promise<number> => {
        const rows = await db.select({id: InsightReviewHistoryEntity.id})
            .from(InsightReviewHistoryEntity)
            .where(eq(InsightReviewHistoryEntity.changedBy, userId));

        return rows.length;
    };

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `review-${u}`});
        tenantId = tenant.id;

        adminA = await userRepo.create({
            fullName: "Review A",
            email: `review-a-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });
        adminB = await userRepo.create({
            fullName: "Review B",
            email: `review-b-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });

        tokenA = await new JwtUtil().register({id: adminA.id, tenant: tenantId, role: "ADMIN"});
        tokenB = await new JwtUtil().register({id: adminB.id, tenant: tenantId, role: "ADMIN"});

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Review Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });

        const inserted = await db.insert(InsightAlertEntity).values([
            {
                accountId,
                ruleKey: "leak_chat_to_reply",
                level: "WARNING",
                title: "Chat masuk belum dibalas",
                entityType: "account",
                entityId: "",
                status: "ACTIVE",
                metric: "deltaPp",
                evidence: {rate: 0.1},
            },
            {
                accountId,
                ruleKey: "creative_fatigue",
                level: "WARNING",
                title: "Kreatif mulai jenuh",
                entityType: "creative",
                entityId: `cr-${u}`,
                status: "ACTIVE",
                metric: "drop",
            },
        ]).returning();

        alertOne = inserted[0];
        alertTwo = inserted[1];
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("lists both alerts unreviewed and exposes a key without the row id", async () => {
        const active = await list("active");
        expect(active.tab).toBe("active");
        expect(active.items.map((row) => row.id).sort()).toEqual([alertOne.id, alertTwo.id].sort());
        expect(active.items.every((row) => row.review === null)).toBe(true);
        expect(await unread()).toBe(2);

        const again = await list("active");
        const first = active.items.find((row) => row.id === alertOne.id);
        const repeated = again.items.find((row) => row.id === alertOne.id);
        expect(first?.key).toBe(repeated?.key);
        expect(first?.key).toBe(insightKey(alertOne));
        expect(first?.key).not.toContain(String(alertOne.id));
        expect(first?.key).not.toBe(again.items.find((row) => row.id === alertTwo.id)?.key);
    });

    it("clears the badge on read while the alert stays in the active tab", async () => {
        const response = await review(insightKey(alertOne), {status: "read"}, `review-read-${u}`);
        expect(response.status).toBe(200);

        const body = await readData<ReviewBody>(response);
        expect(body.key).toBe(insightKey(alertOne));
        expect(body.status).toBe("read");
        expect(body.unreadCount).toBe(1);

        const active = await list("active");
        const row = active.items.find((item) => item.id === alertOne.id);
        expect(row?.review?.status).toBe("read");
        expect(await unread()).toBe(1);
    });

    it("keeps a done marker out of the caller's tab only", async () => {
        const response = await review(insightKey(alertOne), {status: "done", reason: "sudah ditangani"}, `review-done-${u}`);
        expect(response.status).toBe(200);
        expect((await readData<ReviewBody>(response)).unreadCount).toBe(1);

        const mine = await list("active");
        expect(mine.items.some((row) => row.id === alertOne.id)).toBe(false);

        const theirs = await list("active", tokenB);
        expect(theirs.items.some((row) => row.id === alertOne.id)).toBe(true);
        expect(theirs.items.find((row) => row.id === alertOne.id)?.review).toBeNull();

        const done = await list("done");
        const row = done.items.find((item) => item.id === alertOne.id);
        expect(row?.review).toMatchObject({status: "done", reason: "sudah ditangani"});
    });

    it("returns a done marker to the active tab", async () => {
        const response = await review(insightKey(alertOne), {status: "active"}, `review-active-${u}`);
        expect(response.status).toBe(200);

        const active = await list("active");
        expect(active.items.some((row) => row.id === alertOne.id)).toBe(true);
        expect(await unread()).toBe(2);

        const done = await list("done");
        expect(done.items.some((row) => row.id === alertOne.id)).toBe(false);
    });

    it("writes one history row for an idempotent retry", async () => {
        const key = insightKey(alertTwo);
        const idempotencyKey = `review-idem-${u}`;
        const before = await historyCount(adminA.id);

        const first = await review(key, {status: "done", reason: "duplikat"}, idempotencyKey);
        expect(first.status).toBe(200);
        const firstBody = await readData<ReviewBody>(first);
        expect(await historyCount(adminA.id)).toBe(before + 1);

        const replay = await review(key, {status: "done", reason: "duplikat"}, idempotencyKey);
        expect(replay.status).toBe(200);
        expect(await readData<ReviewBody>(replay)).toEqual(firstBody);
        expect(await historyCount(adminA.id)).toBe(before + 1);

        const response = await request(`/api/insights/${encodeURIComponent(key)}/history`);
        expect(response.status).toBe(200);
        const history = await readData<HistoryBody>(response);
        expect(history.items.length).toBe(1);
        expect(history.items[0]).toMatchObject({fromStatus: "active", toStatus: "done", reason: "duplikat"});
    });

    it("rejects a review without an Idempotency-Key", async () => {
        const response = await request(`/api/insights/${encodeURIComponent(insightKey(alertTwo))}/review`, {
            method: "PATCH",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({status: "read"}),
        });

        expect(response.status).toBe(400);
        expect(await readError(response)).toEqual({
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Header Idempotency-Key wajib diisi",
            details: null,
        });
    });

    it("404s a key that matches no alert of the account", async () => {
        const response = await review("leak_chat_to_reply:tidak-ada", {status: "read"}, `review-missing-${u}`);
        expect(response.status).toBe(404);
        expect((await readError(response)).code).toBe("NOT_FOUND");
    });

    it("shows an alert the evaluator closed without a user review in the done tab", async () => {
        const [closed] = await db.insert(InsightAlertEntity).values({
            accountId,
            ruleKey: "tracking_emq",
            level: "WARNING",
            title: "Event Match Quality perlu perhatian",
            entityType: "account",
            entityId: "",
            status: "ACTIVE",
        }).returning();

        await alertRepo.resolveByRuleKey(accountId, "tracking_emq");

        const done = await list("done");
        const row = done.items.find((item) => item.id === closed.id);
        expect(row?.status).toBe("DONE");
        expect(row?.review).toBeNull();

        const active = await list("active");
        expect(active.items.some((item) => item.id === closed.id)).toBe(false);
    });

    it("never changes the system status because a user reviewed", async () => {
        const [stored] = await db.select()
            .from(InsightAlertEntity)
            .where(eq(InsightAlertEntity.id, alertOne.id));
        expect(stored.status).toBe("ACTIVE");
    });
});
