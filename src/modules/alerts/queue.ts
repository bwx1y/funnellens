import {QueueManager, type JobsOptions} from "@infra/queue";

export const ALERTS_QUEUE_NAME = "alerts-evaluate";

export type AlertsJobName = "evaluate";

export interface AlertsEvaluateJobData {
    tenantId?: string;
    accountId?: string;
}

const defaultJobOptions: JobsOptions = {
    attempts: 3,
    backoff: {
        type: "exponential",
        delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
};

/** One job per evaluation; without `accountId` the worker covers every selected account. */
export class AlertsQueue extends QueueManager<AlertsEvaluateJobData, void, AlertsJobName> {
    constructor() {
        super(ALERTS_QUEUE_NAME, defaultJobOptions);
    }

    async scheduleCronJobs(): Promise<void> {
        await this.instance.upsertJobScheduler("evaluate", {
            pattern: "0 * * * *",
        }, {
            name: "evaluate",
            data: {},
        });
    }
}
