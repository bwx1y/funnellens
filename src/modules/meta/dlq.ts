import {QueueManager, type JobsOptions} from "@infra/queue";

export const META_SYNC_DLQ_NAME = "meta-sync-dlq";

/** One dead letter: the job that exhausted its retries, why, and how many attempts it burned. */
export interface MetaSyncDlqEntry {
    jobName: string;
    data: unknown;
    error: string;
    failedAt: string;
    attemptsMade: number;
}

/** Dead letters are kept for inspection, not replay; the count is small because they are exceptional. */
const defaultJobOptions: JobsOptions = {
    removeOnComplete: 500,
    removeOnFail: 500,
};

export class MetaSyncDlq extends QueueManager<MetaSyncDlqEntry, void, "dead-letter"> {
    constructor() {
        super(META_SYNC_DLQ_NAME, defaultJobOptions);
    }

    async record(entry: MetaSyncDlqEntry) {
        return this.add("dead-letter", entry, {
            jobId: `dlq:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
        });
    }

    /** Newest first: the last failure is the one an operator opens the list for. */
    async list(limit: number = 50): Promise<MetaSyncDlqRow[]> {
        const jobs = await this.instance.getJobs(["waiting", "delayed", "failed"], 0, limit - 1, false);

        return jobs
            .filter((job) => job !== undefined)
            .map((job) => ({
                id: String(job.id),
                jobName: job.data.jobName,
                data: job.data.data,
                error: job.data.error,
                failedAt: job.data.failedAt,
                attemptsMade: job.data.attemptsMade,
            }))
            .sort((left, right) => (left.failedAt < right.failedAt ? 1 : left.failedAt > right.failedAt ? -1 : 0));
    }

    /** Removes one handled entry; `false` when the id is unknown or already gone. */
    async remove(id: string): Promise<boolean> {
        const job = await this.instance.getJob(id);
        if (job === undefined) return false;

        await job.remove();
        return true;
    }
}

export interface MetaSyncDlqRow extends MetaSyncDlqEntry {
    id: string;
}
