import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app } from "@/index";
import { JwtUtil } from "@shared/jwt";
import { TenantRepository } from "@db/repositories/tenant.repository";
import { UserRepository } from "@db/repositories/user.repository";
import { DatabaseRepository } from "@db/repositories/base.repository";
import { eq } from "drizzle-orm";
import { UserEntity } from "@db/schema/core/user.entity";
import { TenantEntity } from "@db/schema/core/tenant.entity";
import { readData, readError } from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string) {
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

interface UserResponse {
    id: string;
    fullName: string;
    email: string;
    role: "ADMIN" | "VIEWER";
    verifiedAt: string | null;
    tenantId: string;
    hashPassword?: string;
}

describe("User CRUD & Multi-Tenant Authorization", () => {
    const jwtUtil = new JwtUtil();
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();
    const cleanupRepo = new TestCleanupRepository();

    let tenantA: { id: string; name: string };
    let tenantB: { id: string; name: string };
    let adminA: { id: string; email: string };
    let viewerA: { id: string; email: string };
    let adminB: { id: string; email: string };

    let tokenAdminA: string;
    let tokenViewerA: string;
    let tokenAdminB: string;

    beforeAll(async () => {
        const unique = Date.now();
        tenantA = await tenantRepo.create({
            name: `Tenant-A-${unique}`,
            address: "Address A",
        });
        tenantB = await tenantRepo.create({
            name: `Tenant-B-${unique}`,
            address: "Address B",
        });

        adminA = await userRepo.create({
            fullName: "Admin A",
            email: `adminA_${unique}@test.com`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId: tenantA.id,
        });

        viewerA = await userRepo.create({
            fullName: "Viewer A",
            email: `viewerA_${unique}@test.com`,
            hashPassword: "hash",
            role: "VIEWER",
            tenantId: tenantA.id,
        });

        adminB = await userRepo.create({
            fullName: "Admin B",
            email: `adminB_${unique}@test.com`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId: tenantB.id,
        });

        const resTokenA = await jwtUtil.register({
            id: adminA.id,
            tenant: tenantA.id,
            role: "ADMIN",
        });
        tokenAdminA = resTokenA.key;

        const resTokenViewer = await jwtUtil.register({
            id: viewerA.id,
            tenant: tenantA.id,
            role: "VIEWER",
        });
        tokenViewerA = resTokenViewer.key;

        const resTokenB = await jwtUtil.register({
            id: adminB.id,
            tenant: tenantB.id,
            role: "ADMIN",
        });
        tokenAdminB = resTokenB.key;
    });

    afterAll(async () => {
        await cleanupRepo.cleanup(tenantA.id);
        await cleanupRepo.cleanup(tenantB.id);
    });

    it("should reject unauthenticated request", async () => {
        const res = await app.handle(new Request("http://localhost/api/users", {
            method: "GET",
        }));
        expect(res.status).toBe(401);
    });

    it("rejects a VIEWER with 403 FORBIDDEN", async () => {
        const res = await app.handle(new Request("http://localhost/api/users", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenViewerA}`,
            },
        }));
        expect(res.status).toBe(403);
        expect(await readError(res)).toEqual({
            code: "FORBIDDEN",
            message: "Butuh role ADMIN",
            details: null,
        });
    });

    it("should create a user scoped to same tenant", async () => {
        const newUserPayload = {
            fullName: "Staff A1",
            email: `staffA1_${Date.now()}@test.com`,
            password: "password123",
            role: "VIEWER",
        };

        const res = await app.handle(new Request("http://localhost/api/users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenAdminA}`,
            },
            body: JSON.stringify(newUserPayload),
        }));

        expect(res.status).toBe(201);
        const created = await readData<UserResponse>(res);
        expect(created.fullName).toBe("Staff A1");
        expect(created.email).toBe(newUserPayload.email);
        expect(created.role).toBe("VIEWER");
        expect(created.tenantId).toBe(tenantA.id);
        expect(created.hashPassword).toBeUndefined();
    });

    it("should list only users belonging to the same tenant", async () => {
        const resA = await app.handle(new Request("http://localhost/api/users", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(resA.status).toBe(200);
        const listA = await readData<UserResponse[]>(resA);
        expect(Array.isArray(listA)).toBe(true);
        expect(listA.length).toBeGreaterThanOrEqual(2);
        for (const u of listA) {
            expect(u.tenantId).toBe(tenantA.id);
        }

        const resB = await app.handle(new Request("http://localhost/api/users", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenAdminB}`,
            },
        }));
        expect(resB.status).toBe(200);
        const listB = await readData<UserResponse[]>(resB);
        for (const u of listB) {
            expect(u.tenantId).toBe(tenantB.id);
        }

        const idsA = listA.map((u) => u.id);
        const idsB = listB.map((u) => u.id);
        const overlap = idsA.filter((id) => idsB.includes(id));
        expect(overlap.length).toBe(0);
    });

    it("should get user by id only in same tenant", async () => {
        const resOk = await app.handle(new Request(`http://localhost/api/users/${adminA.id}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(resOk.status).toBe(200);
        const detail = await readData<UserResponse>(resOk);
        expect(detail.id).toBe(adminA.id);
        expect(detail.tenantId).toBe(tenantA.id);

        const resCross = await app.handle(new Request(`http://localhost/api/users/${adminB.id}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(resCross.status).toBe(404);
    });

    it("should update user in same tenant, but fail for user in other tenant", async () => {
        const updatePayload = {
            fullName: "Viewer A Updated",
        };

        const resOk = await app.handle(new Request(`http://localhost/api/users/${viewerA.id}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenAdminA}`,
            },
            body: JSON.stringify(updatePayload),
        }));
        expect(resOk.status).toBe(200);
        const updated = await readData<UserResponse>(resOk);
        expect(updated.fullName).toBe("Viewer A Updated");

        const resCross = await app.handle(new Request(`http://localhost/api/users/${adminB.id}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenAdminA}`,
            },
            body: JSON.stringify({ fullName: "Hacked" }),
        }));
        expect(resCross.status).toBe(404);
    });

    it("should prevent admin from deleting own account", async () => {
        const res = await app.handle(new Request(`http://localhost/api/users/${adminA.id}`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(res.status).toBe(400);
        expect(await readError(res)).toEqual({
            code: "VALIDATION_ERROR",
            message: "Cannot delete your own account",
            details: null,
        });
    });

    it("should delete user in same tenant, and fail for user in other tenant", async () => {
        const resCross = await app.handle(new Request(`http://localhost/api/users/${adminB.id}`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(resCross.status).toBe(404);

        const resDelete = await app.handle(new Request(`http://localhost/api/users/${viewerA.id}`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(resDelete.status).toBe(200);
        const resCheck = await app.handle(new Request(`http://localhost/api/users/${viewerA.id}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(resCheck.status).toBe(404);
    });
});
