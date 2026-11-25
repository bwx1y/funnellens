import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {Config} from "@/config";
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
import {readData, readEnvelope, readError} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

/**
 * F-01.2/F-01.3: the wire contract — `{data, meta}` on success, `{error:{code,message,details}}` on
 * failure, and the ADMIN/VIEWER split. Behaviour of each endpoint lives in its own suite; this one
 * pins the envelope and the role matrix.
 */
describe("API envelope and role contract", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();

    const u = Date.now().toString();
    const accountId = `act_contract_${u}`;

    let tenantId: string;
    let adminToken: {key: string};
    let viewerToken: {key: string};

    const request = (
        path: string,
        init: RequestInit = {},
        token: {key: string} = adminToken
    ) => app.handle(new Request(`http://localhost${path}`, {
        ...init,
        headers: {
            ...(init.headers as Record<string, string> | undefined),
            authorization: `Bearer ${token.key}`,
        },
    }));

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `contract-${u}`});
        tenantId = tenant.id;

        const admin = await userRepo.create({
            fullName: "Contract Admin",
            email: `contract-admin-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });
        const viewer = await userRepo.create({
            fullName: "Contract Viewer",
            email: `contract-viewer-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "VIEWER",
            tenantId,
        });

        adminToken = await new JwtUtil().register({id: admin.id, tenant: tenantId, role: "ADMIN"});
        viewerToken = await new JwtUtil().register({id: viewer.id, tenant: tenantId, role: "VIEWER"});

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Contract Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("wraps a successful payload in {data, meta.requestId}", async () => {
        const response = await request(`/api/analytics/summary?accountId=${accountId}&since=2026-03-01&until=2026-03-07`);
        expect(response.status).toBe(200);

        const body = await readEnvelope<{cards: {spend: {value: number}}}>(response);
        expect(body.data.cards.spend.value).toBe(0);
        expect(typeof body.meta.requestId).toBe("string");
        expect(body.meta.requestId.length).toBeGreaterThan(0);
    });

    it("marks a cache hit in meta.cached on the repeat call", async () => {
        const path = `/api/analytics/summary?accountId=${accountId}&since=2026-03-02&until=2026-03-08`;

        const first = await readEnvelope<unknown>(await request(path));
        expect(first.meta.cached).toBeUndefined();

        const second = await readEnvelope<unknown>(await request(path));
        expect(second.meta.cached).toBe(true);
        expect(second.data).toEqual(first.data);
    });

    it("answers an invalid query with 400 VALIDATION_ERROR and a details array", async () => {
        // `page` is `^[1-9]\d*$`: "0" is a schema violation, not a service-level clamp.
        const response = await request(`/api/leads?accountId=${accountId}&page=0`);
        expect(response.status).toBe(400);

        const error = await readError(response);
        expect(error.code).toBe("VALIDATION_ERROR");
        expect(error.message).toBe("Validation Error");
        expect(Array.isArray(error.details)).toBe(true);
        expect(error.details?.[0]?.path).toBe("/page");
        expect(typeof error.details?.[0]?.message).toBe("string");
    });

    it("answers unknown routes with 404 NOT_FOUND in the error envelope", async () => {
        const response = await request(`/api/no-such-route-${u}`);
        expect(response.status).toBe(404);
        expect(await readError(response)).toEqual({
            code: "NOT_FOUND",
            message: "Route not found",
            details: null,
        });
    });

    it("answers a malformed JSON body with 400 PARSE_ERROR", async () => {
        const response = await request(`/api/leads/1`, {
            method: "PATCH",
            headers: {"content-type": "application/json"},
            body: "{not json",
        });
        expect(response.status).toBe(400);
        expect(await readError(response)).toEqual({
            code: "PARSE_ERROR",
            message: "Invalid JSON format",
            details: null,
        });
    });

    it("echoes hub.challenge as plain text, never as an envelope", async () => {
        const original = Config.whatsapp.verifyToken;
        Config.whatsapp.verifyToken = `verify-${u}`;

        try {
            const response = await app.handle(new Request(
                "http://localhost/api/wa/cloud/webhook?hub.mode=subscribe"
                + `&hub.verify_token=verify-${u}&hub.challenge=challenge-${u}`
            ));

            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain("text/plain");
            expect(await response.text()).toBe(`challenge-${u}`);

            const rejected = await app.handle(new Request(
                "http://localhost/api/wa/cloud/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc"
            ));
            expect(rejected.status).toBe(401);
            expect(await readError(rejected)).toEqual({
                code: "UNAUTHORIZED",
                message: "Verifikasi webhook gagal",
                details: null,
            });
        } finally {
            Config.whatsapp.verifyToken = original;
        }
    });

    it("pages the lead list with page_size and rejects a size outside the allowed set", async () => {
        const page = await request(`/api/leads?accountId=${accountId}&page_size=20`);
        expect(page.status).toBe(200);

        const body = await readData<{items: unknown[]; meta: {page: number; page_size: number; total: number; pages: number}}>(page);
        expect(body.meta.page).toBe(1);
        expect(body.meta.page_size).toBe(20);
        expect(body.meta.pages).toBe(Math.max(1, Math.ceil(body.meta.total / 20)));

        const rejected = await request(`/api/leads?accountId=${accountId}&page_size=7`);
        expect(rejected.status).toBe(400);
        expect(await readError(rejected)).toEqual({
            code: "INVALID_PAGE_SIZE",
            message: "page_size tidak valid",
            details: null,
        });
    });

    it("rejects a VIEWER's admin call with 403 FORBIDDEN but allows the review routes", async () => {
        const sync = await request("/api/meta/sync/master", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({}),
        }, viewerToken);
        expect(sync.status).toBe(403);
        expect(await readError(sync)).toEqual({
            code: "FORBIDDEN",
            message: "Butuh role ADMIN",
            details: null,
        });

        const [alert] = await db.insert(InsightAlertEntity).values({
            accountId,
            ruleKey: "contract_viewer",
            level: "WARNING",
            title: "Contract alert",
            entityType: "account",
            entityId: "",
            status: "ACTIVE",
        }).returning();

        const resolve = await request(`/api/alerts/${alert.id}/resolve`, {method: "PATCH"}, viewerToken);
        expect(resolve.status).toBe(200);
        expect(await readData<{id: number; status: string}>(resolve)).toMatchObject({
            id: alert.id,
            status: "DONE",
        });

        const reads = await request(`/api/leads?accountId=${accountId}`, {}, viewerToken);
        expect(reads.status).toBe(200);
    });

    it("lets an ADMIN through the same routes", async () => {
        // No Meta connection in this workspace, so the sync itself answers 401; the guard let it pass.
        const sync = await request("/api/meta/sync/master", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({}),
        });
        expect(sync.status).not.toBe(403);

        const [alert] = await db.insert(InsightAlertEntity).values({
            accountId,
            ruleKey: "contract_admin",
            level: "WARNING",
            title: "Contract alert admin",
            entityType: "account",
            entityId: "",
            status: "ACTIVE",
        }).returning();

        const resolve = await request(`/api/alerts/${alert.id}/resolve`, {method: "PATCH"});
        expect(resolve.status).toBe(200);
    });

    it("registers the tenant's first user as ADMIN", async () => {
        const tenantName = `contract-register-${u}`;
        const response = await app.handle(new Request("http://localhost/api/auth/register", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({
                fullName: "First User",
                email: `contract-register-${u}@funnellens.test`,
                password: "password123",
                confirmPassword: "password123",
                tenant: {name: tenantName, address: null},
            }),
        }));
        expect(response.status).toBe(200);

        const body = await readData<{role: string; tenant: {id: string; name: string}}>(response);
        expect(body.role).toBe("ADMIN");
        expect(body.tenant.name).toBe(tenantName);

        // Registration owns a fresh workspace, so the cleanup is keyed on the tenant it just created.
        await db.delete(UserEntity).where(eq(UserEntity.tenantId, body.tenant.id));
        await db.delete(TenantEntity).where(eq(TenantEntity.id, body.tenant.id));
    });

    it("creates a workspace user without an explicit role as VIEWER", async () => {
        const response = await request("/api/users", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({
                fullName: "Default Role",
                email: `contract-default-${u}@funnellens.test`,
                password: "password123",
            }),
        });
        expect(response.status).toBe(201);

        const created = await readData<{role: string; tenantId: string}>(response);
        expect(created.role).toBe("VIEWER");
        expect(created.tenantId).toBe(tenantId);
    });
});
