import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app } from "@/index";
import { JwtUtil } from "@/utils/jwt";
import { TenantRepository } from "@/database/repository/tenant.repository";
import { UserRepository } from "@/database/repository/user.repository";
import { DatabaseRepository } from "@/database/repository/repository";
import { eq } from "drizzle-orm";
import { UserEntity } from "@/database/entity/user.entity";
import { TenantEntity } from "@/database/entity/tenant.entity";

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
    role: "ADMIN" | "MANAGER";
    isVerified: string | null;
    tenantId: string;
    hashPassword?: string;
}

interface ErrorResponse {
    status: boolean;
    message: string;
}

describe("User CRUD & Multi-Tenant Authorization", () => {
    const jwtUtil = new JwtUtil();
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();
    const cleanupRepo = new TestCleanupRepository();

    let tenantA: { id: string; name: string };
    let tenantB: { id: string; name: string };
    let adminA: { id: string; email: string };
    let managerA: { id: string; email: string };
    let adminB: { id: string; email: string };

    let tokenAdminA: string;
    let tokenManagerA: string;
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

        managerA = await userRepo.create({
            fullName: "Manager A",
            email: `managerA_${unique}@test.com`,
            hashPassword: "hash",
            role: "MANAGER",
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

        const resTokenMgr = await jwtUtil.register({
            id: managerA.id,
            tenant: tenantA.id,
            role: "MANAGER",
        });
        tokenManagerA = resTokenMgr.key;

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

    it("should reject non-ADMIN role (e.g. MANAGER)", async () => {
        const res = await app.handle(new Request("http://localhost/api/users", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenManagerA}`,
            },
        }));
        expect(res.status).toBe(403);
        const data = (await res.json()) as ErrorResponse;
        expect(data.status).toBe(false);
        expect(data.message).toBe("Only ADMIN can access this resource");
    });

    it("should create a user scoped to same tenant", async () => {
        const newUserPayload = {
            fullName: "Staff A1",
            email: `staffA1_${Date.now()}@test.com`,
            password: "password123",
            role: "MANAGER",
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
        const created = (await res.json()) as UserResponse;
        expect(created.fullName).toBe("Staff A1");
        expect(created.email).toBe(newUserPayload.email);
        expect(created.role).toBe("MANAGER");
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
        const listA = (await resA.json()) as UserResponse[];
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
        const listB = (await resB.json()) as UserResponse[];
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
        const detail = (await resOk.json()) as UserResponse;
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
            fullName: "Manager A Updated",
        };

        const resOk = await app.handle(new Request(`http://localhost/api/users/${managerA.id}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenAdminA}`,
            },
            body: JSON.stringify(updatePayload),
        }));
        expect(resOk.status).toBe(200);
        const updated = (await resOk.json()) as UserResponse;
        expect(updated.fullName).toBe("Manager A Updated");

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
        const data = (await res.json()) as ErrorResponse;
        expect(data.message).toBe("Cannot delete your own account");
    });

    it("should delete user in same tenant, and fail for user in other tenant", async () => {
        const resCross = await app.handle(new Request(`http://localhost/api/users/${adminB.id}`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(resCross.status).toBe(404);

        const resDelete = await app.handle(new Request(`http://localhost/api/users/${managerA.id}`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(resDelete.status).toBe(200);
        const resCheck = await app.handle(new Request(`http://localhost/api/users/${managerA.id}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenAdminA}`,
            },
        }));
        expect(resCheck.status).toBe(404);
    });
});
