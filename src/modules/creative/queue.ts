import {QueueManager, type JobsOptions} from "@infra/queue";

export const CREATIVE_TAGGING_QUEUE_NAME = "creative-tagging";

export interface CreativeTaggingJobData {
    creativeId: string;
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

/** One job per creative: the AI writes the four tag types of a single creative copy. */
export class CreativeTaggingQueue extends QueueManager<CreativeTaggingJobData, void, "creative-tagging"> {
    constructor() {
        super(CREATIVE_TAGGING_QUEUE_NAME, defaultJobOptions);
    }
}
