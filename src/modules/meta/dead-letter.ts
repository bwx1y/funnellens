import {MetaSyncDlq, type MetaSyncDlqEntry} from "@/modules/meta/dlq";
import {InsightAlertRepository} from "@db/repositories/insight-alert.repository";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {logger} from "@shared/logger";
import type {MetaSyncJobData} from "@/modules/meta/queue";

export const SYNC_FAILED_RULE = "sync_failed";

/**
 * What happens to a `meta-sync` job that burned every retry: it becomes one dead letter plus one
 * active alert, so the failure is visible in the queue and on the Insight page instead of only in
 * the log file.
 *
 * The alert needs an account to attach to; a job that carries no account (the cron payloads) is
 * recorded in the DLQ only, because an account-less alert would be invisible to every workspace.
 */
export class MetaSyncDeadLetter {
    constructor(
        private readonly dlq = new MetaSyncDlq(),
        private readonly alertRepo = new InsightAlertRepository(),
        private readonly adAccountRepo = new AdAccountRepository()
    ) {}

    async record(jobName: string, data: MetaSyncJobData, error: string, attemptsMade: number): Promise<MetaSyncDlqEntry> {
        const entry: MetaSyncDlqEntry = {
            jobName,
            data,
            error,
            failedAt: new Date().toISOString(),
            attemptsMade,
        };

        await this.dlq.record(entry);
        logger.error({jobName, attemptsMade, error}, "meta-sync job moved to the dead-letter queue");

        await this.raiseAlert(jobName, data, error, attemptsMade);

        return entry;
    }

    private async raiseAlert(
        jobName: string,
        data: MetaSyncJobData,
        error: string,
        attemptsMade: number
    ): Promise<void> {
        if (data.accountId === undefined) return;

        const account = await this.adAccountRepo.findById(data.accountId);
        if (account === null) return;

        try {
            await this.alertRepo.upsert({
                accountId: account.id,
                ruleKey: SYNC_FAILED_RULE,
                level: "CRITICAL",
                entityType: "job",
                entityId: jobName,
                status: "ACTIVE",
                title: "Sinkronisasi Meta gagal",
                body: `Job ${jobName} berhenti setelah ${attemptsMade} percobaan: ${error}`,
                metric: "attemptsMade",
                impactMinor: null,
                impactCaption: `${attemptsMade} percobaan`,
                confidence: null,
                sampleSize: null,
                route: "/app/insights",
                evidence: {jobName, attemptsMade, error},
            });
        } catch (alertError) {
            logger.error({err: alertError, jobName}, "failed to raise sync_failed alert");
        }
    }

    /** A successful sync of the account clears the alert the dead letter opened. */
    async clearAlert(accountId: string): Promise<void> {
        try {
            await this.alertRepo.resolveByRuleKey(accountId, SYNC_FAILED_RULE);
        } catch (error) {
            logger.warn({err: error, accountId}, "failed to clear sync_failed alert");
        }
    }
}
