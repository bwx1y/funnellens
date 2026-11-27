import { describe, expect, it } from "bun:test";
import { QueueManager } from "@infra/queue";

describe("QueueManager", () => {
    it("adds job with correct jobName and closes gracefully", async () => {
        const qm = new QueueManager<{ test: boolean }>("test-queue");
        const job = await qm.add("custom-job-name", { test: true });

        expect(job.name).toBe("custom-job-name");
        expect(job.data).toEqual({ test: true });

        // Only this queue closes: `redisConnection` is the suite-wide singleton, and quitting it here
        // would break every later file that enqueues a job.
        await qm.close();
    });
});
