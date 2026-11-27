import {QueueManager, type JobsOptions} from "@infra/queue";

export const LEAD_ASSESSMENT_QUEUE_NAME = "lead-assessment";

export type LeadAssessmentJobName = "assess" | "reassess";

/** One job per new inbound message: the AI classifies it and writes a `lead_assessments` row. */
export interface AssessJobData {
    leadId: number;
    messageId: number;
}

/** Replays the lead chronologically from `from` so the newest assessment wins again. */
export interface ReassessJobData {
    leadId: number;
    from: string;
}

export type LeadAssessmentJobData = AssessJobData | ReassessJobData;

const defaultJobOptions: JobsOptions = {
    attempts: 3,
    backoff: {
        type: "exponential",
        delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
};

/** Job ids must stay free of `:` — BullMQ rejects a custom id containing one. */
export function assessJobId(wamid: string): string {
    return `assess-${wamid}`;
}

export function reassessJobId(leadId: number, from: Date): string {
    return `reassess-${leadId}-${from.getTime()}`;
}

export class LeadAssessmentQueue extends QueueManager<LeadAssessmentJobData, void, LeadAssessmentJobName> {
    constructor() {
        super(LEAD_ASSESSMENT_QUEUE_NAME, defaultJobOptions);
    }
}
