import {QueueManager, type JobsOptions} from "@infra/queue";

export interface MetaSyncDailyJobPayload {
    tenantId?: string;
    accountId?: string;
    userId?: string;
}

export interface MetaSyncTrailingJobPayload {
    tenantId?: string;
    accountId?: string;
    userId?: string;
    daysBack?: number;
}

export interface MetaSyncMasterJobPayload {
    tenantId?: string;
    accountId?: string;
    userId?: string;
}

export interface MetaSyncHourlyBreakdownsJobPayload {
    tenantId?: string;
    accountId?: string;
    userId?: string;
    since?: string;
    until?: string;
}

export type MetaSyncJobData =
    | MetaSyncDailyJobPayload
    | MetaSyncTrailingJobPayload
    | MetaSyncMasterJobPayload
    | MetaSyncHourlyBreakdownsJobPayload;

export type MetaSyncJobName = "sync-daily" | "re-sync-trailing" | "sync-master" | "sync-hourly-breakdowns";

export const META_SYNC_QUEUE_NAME = "meta-sync";

const defaultJobOptions: JobsOptions = {
    attempts: 5,
    backoff: {
        type: "exponential",
        delay: 10000, // 10s initial backoff on rate-limit / network issues
    },
    removeOnComplete: 100,
    removeOnFail: 200,
};

export class MetaSyncQueue extends QueueManager<MetaSyncJobData, void, MetaSyncJobName> {
    constructor() {
        super(META_SYNC_QUEUE_NAME, defaultJobOptions);
    }

    async scheduleCronJobs(): Promise<void> {
        // Daily sync: run every hour at minute 15
        await this.instance.upsertJobScheduler("sync-daily", {
            pattern: "15 * * * *",
        }, {
            name: "sync-daily",
            data: {},
        });

        // Hourly breakdowns: run every hour at minute 45 (offset from the daily entry to avoid overlap)
        await this.instance.upsertJobScheduler("sync-hourly-breakdowns", {
            pattern: "45 * * * *",
        }, {
            name: "sync-hourly-breakdowns",
            data: {},
        });

        // Re-sync trailing: run once every night at 02:00 AM UTC (28 days window)
        await this.instance.upsertJobScheduler("re-sync-trailing", {
            pattern: "0 2 * * *",
        }, {
            name: "re-sync-trailing",
            data: {daysBack: 28},
        });
    }
}
