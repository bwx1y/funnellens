import {describe, expect, it, afterAll} from "bun:test";
import {WaWebhookService} from "@/modules/wa/webhook/service";
import {WaSessionRepository} from "@db/repositories/wa-session.repository";
import {UserRepository} from "@db/repositories/user.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {QueueManager} from "@infra/queue";
import {MailUtil} from "@infra/mail";
import type {SendSessionDisconnectedJob} from "@/modules/auth/worker";
import {WaSessionEntity} from "@db/schema/wa/wa-session.entity";
import {TenantEntity} from "@db/schema/core/tenant.entity";

const session: typeof WaSessionEntity.$inferSelect = {
    id: "s1", tenantId: "t1", name: "Sales",
    phoneNumber: null, phoneName: null, status: "ready",
};
const tenant: typeof TenantEntity.$inferSelect = {id: "t1", name: "Acme", address: null};

describe("WaWebhookService.disconnected", () => {
    const original = {
        findById: WaSessionRepository.prototype.findById,
        update: WaSessionRepository.prototype.update,
        findAllByTenantId: UserRepository.prototype.findAllByTenantId,
        findOneById: TenantRepository.prototype.findOneById,
        add: QueueManager.prototype.add,
    };
    afterAll(() => {
        WaSessionRepository.prototype.findById = original.findById;
        WaSessionRepository.prototype.update = original.update;
        UserRepository.prototype.findAllByTenantId = original.findAllByTenantId;
        TenantRepository.prototype.findOneById = original.findOneById;
        QueueManager.prototype.add = original.add;
    });

    it("queues email only to tenant ADMIN users", async () => {
        const service = new WaWebhookService();
        const jobs: SendSessionDisconnectedJob[] = [];

        WaSessionRepository.prototype.findById = async () => session;
        WaSessionRepository.prototype.update = async () => session;
        UserRepository.prototype.findAllByTenantId = async () => ([
            {id: "u1", fullName: "Admin", email: "admin@example.com", role: "ADMIN", verifiedAt: new Date(), tenantId: "t1"},
            {id: "u2", fullName: "Viewer", email: "viewer@example.com", role: "VIEWER", verifiedAt: new Date(), tenantId: "t1"},
        ]);
        TenantRepository.prototype.findOneById = async () => tenant;
        // Reason: only `queue.add` is exercised; the fake never touches BullMQ's Job wrapper.
        QueueManager.prototype.add = (async (_name: string, data: SendSessionDisconnectedJob) => {
            jobs.push(data);
            return {};
        }) as unknown as typeof QueueManager.prototype.add;

        await service.disconnected({sessionId: "s1", reason: "logged out", idempotencyKey: "delivery-1"});

        expect(jobs.length).toBe(1);
        expect(jobs[0].type).toBe("session-disconnected");
        expect(jobs[0].to).toBe("admin@example.com");
        expect(jobs[0].sessionName).toBe("Sales");
        expect(jobs[0].tenantName).toBe("Acme");
        expect(jobs[0].reason).toBe("logged out");
    });

    it("does not queue when session is unknown", async () => {
        const service = new WaWebhookService();
        let queued = false;
        WaSessionRepository.prototype.findById = (async () => null) as unknown as typeof WaSessionRepository.prototype.findById;
        // Reason: assertion-only spy; return value is never read by the service.
        QueueManager.prototype.add = (async () => {
            queued = true;
            return {};
        }) as unknown as typeof QueueManager.prototype.add;

        await service.disconnected({sessionId: "missing"});
        expect(queued).toBe(false);
    });

    it("renders session-disconnected template", async () => {
        const html = await MailUtil.renderFile("session-disconnected.html", {
            tenantName: "Acme", sessionName: "Sales", reason: "logged out", disconnectedAt: "2026-11-14T00:00:00.000Z",
        });
        expect(html).toContain("Acme");
        expect(html).toContain("Sales");
        expect(html).toContain("logged out");
        expect(html).toContain("Sesi WhatsApp Terputus");
    });
});