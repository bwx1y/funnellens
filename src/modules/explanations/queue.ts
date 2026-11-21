import {QueueManager, type JobsOptions} from "@infra/queue";

export const EXPLAIN_QUEUE_NAME = "explanations";

export type ExplainJobName = "explain";

export interface ExplainJobData {
    id: string;
}

const defaultJobOptions: JobsOptions = {
    attempts: 2,
    backoff: {
        type: "exponential",
        delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
};

/** One job per explanation row: the model writes one sentence, never a block of numbers. */
export class ExplainQueue extends QueueManager<ExplainJobData, void, ExplainJobName> {
    constructor() {
        super(EXPLAIN_QUEUE_NAME, defaultJobOptions);
    }
}
