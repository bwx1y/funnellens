import {WorkerManager, type Job} from "@infra/queue";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {logger} from "@shared/logger";
import {
    ALERTS_QUEUE_NAME,
    type AlertsEvaluateJobData,
    type AlertsJobName,
} from "@/modules/alerts/queue";
import {AlertEvaluateService} from "@/modules/alerts/evaluate.service";

export interface AlertTarget {
    tenantId: string;
    accountId: string;
}

/** Evaluates the alert rules; an account that is gone is a warning, not a retry. */
export class AlertsWorkerProcessor {
    constructor(
        private readonly evaluateService = new AlertEvaluateService(),
        private readonly adAccountRepo = new AdAccountRepository()
    ) {}

    async process(job: Job<AlertsEvaluateJobData, void, AlertsJobName>): Promise<void> {
        logger.info({jobId: job.id, jobName: job.name, data: job.data}, "Processing alert evaluation job");

        for (const target of await this.resolveTargets(job.data)) {
            await this.evaluateService.run(target.tenantId, target.accountId);
        }
    }

    private async resolveTargets(data: AlertsEvaluateJobData): Promise<AlertTarget[]> {
        if (data.accountId !== undefined) {
            const account = await this.adAccountRepo.findById(data.accountId, data.tenantId);
            if (account === null) {
                logger.warn({accountId: data.accountId}, "Alert evaluation skipped: account not found");
                return [];
            }

            return [{tenantId: account.tenantId, accountId: account.id}];
        }

        const accounts = await this.adAccountRepo.findSelected();

        return accounts.map((account) => ({tenantId: account.tenantId, accountId: account.id}));
    }
}

const processor = new AlertsWorkerProcessor();

export const alertsWorker = new WorkerManager<AlertsEvaluateJobData, void, AlertsJobName>(
    ALERTS_QUEUE_NAME,
    async (job) => processor.process(job)
);
