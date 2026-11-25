import {QueueManager, type JobsOptions} from "@infra/queue";

export const WA_CLOUD_QUEUE_NAME = "wa-cloud";

export type WaCloudJobName = "ingest";

/** The verified raw body is queued untouched; parsing and DB writes happen in the worker. */
export interface WaCloudIngestJobData {
    raw: string;
    receivedAt: string;
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

export class WaCloudQueue extends QueueManager<WaCloudIngestJobData, void, WaCloudJobName> {
    constructor() {
        super(WA_CLOUD_QUEUE_NAME, defaultJobOptions);
    }
}
