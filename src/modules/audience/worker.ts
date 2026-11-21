import {WorkerManager, type Job} from "@infra/queue";
import {LeadAssessmentService} from "@/modules/audience/assess.service";
import {
    LEAD_ASSESSMENT_QUEUE_NAME,
    type AssessJobData,
    type LeadAssessmentJobData,
    type LeadAssessmentJobName,
    type ReassessJobData,
} from "@/modules/audience/queue";

export class LeadAssessmentWorkerProcessor {
    constructor(private readonly service = new LeadAssessmentService()) {}

    /**
     * No try/catch: an unavailable assessment is stored inside the service (the lead level stays), so
     * only an unexpected failure — a broken database write — reaches BullMQ and gets retried.
     */
    async process(job: Job<LeadAssessmentJobData, void, LeadAssessmentJobName>): Promise<void> {
        if (job.name === "reassess") {
            await this.service.reassess(job.data as ReassessJobData);
            return;
        }

        await this.service.assess(job.data as AssessJobData);
    }
}

export const leadAssessmentWorker = new WorkerManager<LeadAssessmentJobData, void, LeadAssessmentJobName>(
    LEAD_ASSESSMENT_QUEUE_NAME,
    async (job) => new LeadAssessmentWorkerProcessor().process(job)
);
