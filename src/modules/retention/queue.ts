import {QueueManager, type JobsOptions} from "@infra/queue";

export const RETENTION_QUEUE_NAME = "retention";

export type RetentionJobName = "run";

/** No retries: the job runs nightly, so the next night is a better retry than a tight loop now. */
const defaultJobOptions: JobsOptions = {
    attempts: 1,
    removeOnComplete: 30,
    removeOnFail: 30,
};

export class RetentionQueue extends QueueManager<Record<string, never>, void, RetentionJobName> {
    constructor() {
        super(RETENTION_QUEUE_NAME, defaultJobOptions);
    }

    async scheduleCronJobs(): Promise<void> {
        await this.instance.upsertJobScheduler("run", {
            pattern: "0 3 * * *",
        }, {
            name: "run",
            data: {},
        });
    }
}
