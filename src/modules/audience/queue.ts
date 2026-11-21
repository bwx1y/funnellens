import {QueueManager, type JobsOptions} from "@infra/queue";

export const LEAD_ASSESSMENT_QUEUE_NAME = "lead-assessment";

export type LeadAssessmentJobName = "assess";

/** One job per new inbound message: the AI classifies it and writes a `lead_assessments` row. */
export interface AssessJobData {
    leadId: number;
    messageId: number;
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

export class LeadAssessmentQueue extends QueueManager<AssessJobData, void, LeadAssessmentJobName> {
    constructor() {
        super(LEAD_ASSESSMENT_QUEUE_NAME, defaultJobOptions);
    }
}
