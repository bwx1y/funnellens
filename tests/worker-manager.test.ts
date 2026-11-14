import { describe, it, expect } from "bun:test";
import { WorkerManager } from "@/utils/queue";

describe("WorkerManager registry and shutdown", () => {
    it("tracks instances and closes all cleanly", async () => {
        const dummyWorker = new WorkerManager("test-shutdown-queue", async () => ({ ok: true }));

        expect(dummyWorker.instance).toBeDefined();

        await WorkerManager.closeAll(true);

        const workerState: unknown = dummyWorker.instance;
        const isClosed = workerState && typeof workerState === "object" && "closed" in workerState && workerState.closed === true;
        expect(isClosed).toBe(true);
    });
});
