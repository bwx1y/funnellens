import {WorkerManager, type Job} from "@infra/queue";
import {
    META_SYNC_QUEUE_NAME,
    type MetaSyncJobData,
    type MetaSyncHourlyBreakdownsJobPayload,
    type MetaSyncJobName,
    type MetaSyncTrailingJobPayload,
} from "./queue";
import {MetaService} from "./service";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {logger} from "@shared/logger";

export class MetaSyncWorkerProcessor {
    constructor(
        private readonly metaService = new MetaService(),
        private readonly metaConnectionRepo = new MetaConnectionRepository(),
        private readonly adAccountRepo = new AdAccountRepository()
    ) {}

    async process(job: Job<MetaSyncJobData, void, MetaSyncJobName>): Promise<void> {
        logger.info({jobId: job.id, jobName: job.name, data: job.data}, "Processing Meta sync job");

        try {
            if (job.name === "sync-daily") {
                await this.handleDailySync(job.data);
            } else if (job.name === "re-sync-trailing") {
                await this.handleTrailingSync(job.data as MetaSyncTrailingJobPayload);
            } else if (job.name === "sync-master") {
                await this.handleMasterSync(job.data);
            } else if (job.name === "sync-hourly-breakdowns") {
                await this.handleHourlyBreakdownSync(job.data as MetaSyncHourlyBreakdownsJobPayload);
            } else {
                logger.warn({jobName: job.name}, "Unknown Meta sync job name");
            }
        } catch (error: unknown) {
            // Check for rate limit error codes from Meta Graph API
            const err = error as { code?: number; status?: number; message?: string };
            const isRateLimit =
                err.code === 17 ||
                err.code === 32 ||
                err.code === 613 ||
                err.status === 429 ||
                (err.message && err.message.toLowerCase().includes("rate limit"));

            if (isRateLimit) {
                logger.warn({jobId: job.id, error}, "Meta API rate limit encountered. Triggering BullMQ retry backoff.");
            } else {
                logger.error({jobId: job.id, error}, "Meta sync job failed");
            }

            throw error;
        }
    }

    private async handleDailySync(data: MetaSyncJobData): Promise<void> {
        const targets = await this.resolveSyncTargets(data);
        const today = new Date();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const since = yesterday.toISOString().slice(0, 10);
        const until = today.toISOString().slice(0, 10);

        for (const target of targets) {
            await this.metaService.syncInsights(
                {iss: target.userId, tenantId: target.tenantId},
                {accountId: target.accountId, since, until, includeBreakdowns: true}
            );
        }
    }

    private async handleTrailingSync(data: MetaSyncTrailingJobPayload): Promise<void> {
        const targets = await this.resolveSyncTargets(data);
        const daysBack = data.daysBack ?? 28;
        const today = new Date();
        const trailingDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
        const since = trailingDate.toISOString().slice(0, 10);
        const until = today.toISOString().slice(0, 10);

        for (const target of targets) {
            await this.metaService.syncInsights(
                {iss: target.userId, tenantId: target.tenantId},
                {accountId: target.accountId, since, until, includeBreakdowns: true}
            );
        }
    }

    private async handleHourlyBreakdownSync(data: MetaSyncHourlyBreakdownsJobPayload): Promise<void> {
        const targets = await this.resolveSyncTargets(data);
        const until = data.until ?? new Date().toISOString().slice(0, 10);
        const since = data.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        for (const target of targets) {
            await this.metaService.syncHourlyBreakdowns(
                {iss: target.userId, tenantId: target.tenantId},
                {accountId: target.accountId, since, until}
            );
        }
    }

    private async handleMasterSync(data: MetaSyncJobData): Promise<void> {
        const targets = await this.resolveSyncTargets(data);
        for (const target of targets) {
            await this.metaService.syncMaster(
                {iss: target.userId, tenantId: target.tenantId},
                {accountId: target.accountId}
            );
        }
    }

    private async resolveSyncTargets(data: MetaSyncJobData): Promise<{ userId: string; tenantId: string; accountId: string }[]> {
        // If specific tenant/account/user is provided in job payload
        if (data.userId && data.tenantId && data.accountId) {
            return [{userId: data.userId, tenantId: data.tenantId, accountId: data.accountId}];
        }

        // Otherwise resolve all active selected accounts across all connections
        const connections = await this.metaConnectionRepo.findActiveConnections();
        const targets: { userId: string; tenantId: string; accountId: string }[] = [];

        for (const conn of connections) {
            if (data.tenantId && conn.tenantId !== data.tenantId) continue;
            if (data.userId && conn.userId !== data.userId) continue;

            const selectedAcc = await this.adAccountRepo.findSelectedByTenantId(conn.tenantId);
            if (selectedAcc) {
                targets.push({
                    userId: conn.userId,
                    tenantId: conn.tenantId,
                    accountId: selectedAcc.id,
                });
            }
        }

        return targets;
    }
}

const processor = new MetaSyncWorkerProcessor();

export const metaSyncWorker = new WorkerManager<MetaSyncJobData, void, MetaSyncJobName>(
    META_SYNC_QUEUE_NAME,
    async (job) => processor.process(job)
);
