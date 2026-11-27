import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {UserRepository} from "@db/repositories/user.repository";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {UserEntity} from "@db/schema/core/user.entity";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {eq} from "drizzle-orm";
import {readData, readError} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string) {
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

describe("Auth Refresh Token Flow", () => {
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();
    const cleanupRepo = new TestCleanupRepository();

    const u = Date.now().toString();
    let tenantId: string;
    const email = `refresh-user-${u}@test.com`;
    const password = "password123";

    beforeAll(async () => {
        const tenant = await tenantRepo.create({
            name: `Refresh-Tenant-${u}`,
            address: "Jakarta",
        });
        tenantId = tenant.id;

        await userRepo.create({
            fullName: "Refresh Tester",
            email,
            hashPassword: await Bun.password.hash(password),
            role: "ADMIN",
            tenantId,
        });
    });

    afterAll(async () => {
        if (tenantId) await cleanupRepo.cleanup(tenantId);
    });

    it("login returns accessToken and refreshToken", async () => {
        const res = await app.handle(new Request("http://localhost/api/auth/login", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email, password}),
        }));

        expect(res.status).toBe(200);
        const data = await readData<{
            token: {key: string; exp: number; refreshToken: string};
            refreshToken: string;
        }>(res);

        expect(typeof data.token.key).toBe("string");
        expect(typeof data.token.refreshToken).toBe("string");
        expect(data.refreshToken).toBe(data.token.refreshToken);
    });

    it("refreshes access token and rotates refresh token", async () => {
        const loginRes = await app.handle(new Request("http://localhost/api/auth/login", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email, password}),
        }));
        const loginData = await readData<{refreshToken: string}>(loginRes);
        const initialRefreshToken = loginData.refreshToken;

        const refreshRes = await app.handle(new Request("http://localhost/api/auth/refresh", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({refreshToken: initialRefreshToken}),
        }));

        expect(refreshRes.status).toBe(200);
        const refreshData = await readData<{
            token: {key: string; exp: number; refreshToken: string};
            refreshToken: string;
        }>(refreshRes);

        expect(typeof refreshData.token.key).toBe("string");
        expect(typeof refreshData.refreshToken).toBe("string");
        expect(refreshData.refreshToken).not.toBe(initialRefreshToken);

        // Previous token must be revoked (rotation)
        const reuseRes = await app.handle(new Request("http://localhost/api/auth/refresh", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({refreshToken: initialRefreshToken}),
        }));
        expect(reuseRes.status).toBe(401);
        const err = await readError(reuseRes);
        expect(err.message).toBe("Invalid or expired refresh token");
    });

    it("rejects invalid refresh token", async () => {
        const res = await app.handle(new Request("http://localhost/api/auth/refresh", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({refreshToken: "invalid-token-123"}),
        }));
        expect(res.status).toBe(401);
    });

    it("logout revokes refresh token", async () => {
        const loginRes = await app.handle(new Request("http://localhost/api/auth/login", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email, password}),
        }));
        const loginData = await readData<{refreshToken: string}>(loginRes);

        const logoutRes = await app.handle(new Request("http://localhost/api/auth/logout", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({refreshToken: loginData.refreshToken}),
        }));
        expect(logoutRes.status).toBe(200);

        const refreshAfterLogout = await app.handle(new Request("http://localhost/api/auth/refresh", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({refreshToken: loginData.refreshToken}),
        }));
        expect(refreshAfterLogout.status).toBe(401);
    });
});
