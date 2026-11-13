import { describe, expect, it } from "bun:test";
import { QueueManager } from "@/utils/queue";
import { redisConnection } from "@/utils/redis";

describe("QueueManager", () => {
    it("adds job with correct jobName and closes gracefully", async () => {
        const qm = new QueueManager<{ test: boolean }>("test-queue");
        const job = await qm.add("custom-job-name", { test: true });

        expect(job.name).toBe("custom-job-name");
        expect(job.data).toEqual({ test: true });

        await qm.close();
        await redisConnection.quit();
    });
});
