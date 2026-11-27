import {WorkerManager, type Job} from "@infra/queue";
import {CloudIngestService} from "@/modules/wa/cloud/service";
import {WA_CLOUD_QUEUE_NAME, type WaCloudIngestJobData, type WaCloudJobName} from "@/modules/wa/cloud/queue";

export class CloudWorkerProcessor {
    constructor(private readonly service = new CloudIngestService()) {}

    /**
     * No try/catch: malformed JSON and unbound numbers are swallowed inside `ingest`, while a genuine
     * database failure must throw so BullMQ retries the job.
     */
    async process(job: Job<WaCloudIngestJobData, void, WaCloudJobName>): Promise<void> {
        await this.service.ingest(job.data.raw, new Date(job.data.receivedAt));
    }
}

export const waCloudWorker = new WorkerManager<WaCloudIngestJobData, void, WaCloudJobName>(
    WA_CLOUD_QUEUE_NAME,
    async (job) => new CloudWorkerProcessor().process(job)
);
