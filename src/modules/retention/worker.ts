import {WorkerManager} from "@infra/queue";
import {RETENTION_QUEUE_NAME, type RetentionJobName} from "@/modules/retention/queue";
import {RetentionService} from "@/modules/retention/service";
import {logger} from "@shared/logger";

const processor = new RetentionService();

export const retentionWorker = new WorkerManager<Record<string, never>, void, RetentionJobName>(
    RETENTION_QUEUE_NAME,
    async () => {
        const results = await processor.run();
        logger.info({accounts: results.length}, "retention job finished");
    }
);
