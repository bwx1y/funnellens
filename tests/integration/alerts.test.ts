import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {UserRepository} from "@db/repositories/user.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {JwtUtil} from "@shared/jwt";
import {eq} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

interface AlertRow {
    id: number;
    status: "ACTIVE" | "SNOOZED" | "DONE";
    snoozedUntil: string | null;
    resolvedAt: string | null;
}

interface AlertListResponse {
    status: string;
    alerts: AlertRow[];
}

describe("Alerts management API", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();

    const u = Date.now().toString();
    const accountId = `act_alerts_${u}`;
    const otherAccountId = `act_alerts_other_${u}`;

    let tenantId: string;
    let otherTenantId: string;
    let userId: string;
    let otherAlertId: number;
    let alertId: number;
    let headers: {authorization: string};

    const list = async (status: string, account = accountId) => {
        const response = await app.handle(new Request(
            `http://localhost/api/alerts?accountId=${account}&status=${status}`,
            {headers}
        ));
        expect(response.status).toBe(200);

        return await response.json() as AlertListResponse;
    };

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `alerts-test-${u}`});
        tenantId = tenant.id;
        const otherTenant = await tenantRepo.create({name: `alerts-other-${u}`});
        otherTenantId = otherTenant.id;

        const user = await userRepo.create({
            fullName: "Alert Admin",
            email: `alerts_${u}@test.com`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });
        userId = user.id;

        await db.insert(AdAccountEntity).values([
            {
                id: accountId,
                tenantId,
                name: `Alerts Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: otherAccountId,
                tenantId: otherTenantId,
                name: `Alerts Other ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
        ]);

        const [alert] = await db.insert(InsightAlertEntity).values({
            accountId,
            ruleKey: "tracking_emq",
            level: "WARNING",
            title: "Event Match Quality perlu perhatian",
            entityType: "account",
            entityId: "",
            status: "ACTIVE",
            evidence: {emqAvg: 5.2, dedupRate: 0.91},
            confidence: "sedang",
        }).returning();
        alertId = alert.id;

        const [otherAlert] = await db.insert(InsightAlertEntity).values({
            accountId: otherAccountId,
            ruleKey: "tracking_emq",
            level: "WARNING",
            title: "Event Match Quality perlu perhatian",
            entityType: "account",
            entityId: "",
            status: "ACTIVE",
        }).returning();
        otherAlertId = otherAlert.id;

        const token = await new JwtUtil().register({id: userId, tenant: tenantId, role: "ADMIN"});
        headers = {authorization: `Bearer ${token.key}`};
    });

    afterAll(async () => {
        await cleanupRepo.cleanup(tenantId);
        await cleanupRepo.cleanup(otherTenantId);
    });

    it("snoozes for 24 hours, moving the alert out of active and into snoozed", async () => {
        const before = await list("active");
        expect(before.alerts.map((alert) => alert.id)).toEqual([alertId]);
        expect(before.alerts[0].snoozedUntil).toBeNull();

        const badgeBefore = await app.handle(new Request(
            `http://localhost/api/alerts/badge?accountId=${accountId}`,
            {headers}
        ));
        expect(await badgeBefore.json()).toEqual({count: 1});

        const startedAt = Date.now();
        const response = await app.handle(new Request(
            `http://localhost/api/alerts/${alertId}/snooze`,
            {
                method: "PATCH",
                headers: {...headers, "content-type": "application/json"},
                body: JSON.stringify({hours: 24}),
            }
        ));
        expect(response.status).toBe(200);
        const body = await response.json() as {id: number; status: string; snoozedUntil: string};
        expect(body).toMatchObject({id: alertId, status: "SNOOZED"});
        const until = Date.parse(body.snoozedUntil);
        expect(until - startedAt).toBeGreaterThanOrEqual(24 * 3_600_000 - 5_000);
        expect(until - startedAt).toBeLessThanOrEqual(24 * 3_600_000 + 5_000);

        expect((await list("active")).alerts).toEqual([]);

        const snoozed = await list("snoozed");
        expect(snoozed.alerts.map((alert) => alert.id)).toEqual([alertId]);
        expect(snoozed.alerts[0].snoozedUntil).toBe(body.snoozedUntil);

        const badgeAfter = await app.handle(new Request(
            `http://localhost/api/alerts/badge?accountId=${accountId}`,
            {headers}
        ));
        expect(await badgeAfter.json()).toEqual({count: 0});
    });

    it("resolves with resolvedAt and the caller's user id", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/alerts/${alertId}/resolve`,
            {method: "PATCH", headers}
        ));
        expect(response.status).toBe(200);
        const body = await response.json() as {id: number; status: string; resolvedAt: string};
        expect(body).toMatchObject({id: alertId, status: "DONE"});
        expect(Number.isNaN(Date.parse(body.resolvedAt))).toBe(false);

        const [stored] = await db.select()
            .from(InsightAlertEntity)
            .where(eq(InsightAlertEntity.id, alertId));
        expect(stored.status).toBe("DONE");
        expect(stored.resolvedBy).toBe(userId);
        expect(stored.resolvedAt).not.toBeNull();

        expect((await list("snoozed")).alerts).toEqual([]);
        expect((await list("active")).alerts).toEqual([]);
        const resolved = await list("resolved");
        expect(resolved.alerts.map((alert) => alert.id)).toEqual([alertId]);
        expect(resolved.alerts[0].resolvedAt).toBe(stored.resolvedAt?.toISOString() ?? null);
    });

    // An expired snooze is neither pending nor resolved, so it returns to `active` instead of vanishing.
    it("brings an expired snooze back into the active list", async () => {
        const [expired] = await db.insert(InsightAlertEntity).values({
            accountId,
            ruleKey: "leak_chat_to_reply",
            level: "WARNING",
            title: "Chat masuk belum dibalas",
            entityType: "account",
            entityId: "",
            status: "SNOOZED",
            snoozedUntil: new Date(Date.now() - 60_000),
        }).returning();

        const active = await list("active");
        expect(active.alerts.map((alert) => alert.id)).toEqual([expired.id]);
        expect((await list("snoozed")).alerts).toEqual([]);
        expect((await list("resolved")).alerts.map((alert) => alert.id)).toEqual([alertId]);
    it("returns 404 for another tenant's account and alert", async () => {
        const forbiddenList = await app.handle(new Request(
            `http://localhost/api/alerts?accountId=${otherAccountId}`,
            {headers}
        ));
        expect(forbiddenList.status).toBe(404);
        expect(await forbiddenList.json()).toEqual({status: false, message: "Akun iklan tidak ditemukan"});

        await db.delete(InsightAlertEntity).where(eq(InsightAlertEntity.id, expired.id));
    });

    it("returns 404 for another tenant's account and alert", async () => {
        const forbiddenList = await app.handle(new Request(
            `http://localhost/api/alerts?accountId=${otherAccountId}`,
            {headers}
        ));
        expect(forbiddenList.status).toBe(404);
        expect(await forbiddenList.json()).toEqual({status: false, message: "Akun iklan tidak ditemukan"});

        const forbiddenSnooze = await app.handle(new Request(
            `http://localhost/api/alerts/${otherAlertId}/snooze`,
            {
                method: "PATCH",
                headers: {...headers, "content-type": "application/json"},
                body: JSON.stringify({hours: 24}),
            }
        ));
        expect(forbiddenSnooze.status).toBe(404);
        expect(await forbiddenSnooze.json()).toEqual({status: false, message: "Alert tidak ditemukan"});

        const forbiddenResolve = await app.handle(new Request(
            `http://localhost/api/alerts/${otherAlertId}/resolve`,
            {method: "PATCH", headers}
        ));
        expect(forbiddenResolve.status).toBe(404);

        const [untouched] = await db.select()
            .from(InsightAlertEntity)
            .where(eq(InsightAlertEntity.id, otherAlertId));
        expect(untouched.status).toBe("ACTIVE");
    });
});
