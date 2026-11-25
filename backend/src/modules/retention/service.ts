import {and, eq, lt, sql} from "drizzle-orm";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdInsightDailyEntity} from "@db/schema/ads/ad-insight-daily.entity";
import {AdInsightBreakdownDailyEntity} from "@db/schema/ads/ad-insight-breakdown-daily.entity";
import {AdInsightActionEntity} from "@db/schema/ads/ad-insight-action.entity";
import {SyncRunEntity} from "@db/schema/ads/sync-run.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {Config} from "@/config";
import {addDays} from "@shared/dates";
import {logger} from "@shared/logger";

export interface RetentionPolicy {
    insightDays: number;
    messageBodyDays: number;
    syncRunDays: number;
}

export interface RetentionResult {
    accountId: string;
    insightRows: number;
    actionRows: number;
    breakdownRows: number;
    messageBodies: number;
    syncRuns: number;
}

/**
 * Deletes what the product no longer needs, per account, and leaves an audit trail in `sync_runs`.
 *
 * Two rules shape the deletes:
 * - `ad_insight_actions` has no date of its own; it is selected through its parent insight row, so the
 *   actions of an expired day go first and the parent delete does not have to rely on the cascade.
 * - message bodies are *nulled*, not deleted: the row still carries `response_seconds`, sentiment, and
 *   topic, which the response-time and lead-quality statistics are computed from.
 */
export class RetentionService extends DatabaseRepository {
    constructor(private readonly policy: RetentionPolicy = Config.retention) {
        super();
    }

    async run(): Promise<RetentionResult[]> {
        const accounts = await this.database.select({id: AdAccountEntity.id}).from(AdAccountEntity);
        const results: RetentionResult[] = [];

        for (const account of accounts) {
            const [run] = await this.database.insert(SyncRunEntity)
                .values({accountId: account.id, resource: "retention"})
                .returning({id: SyncRunEntity.id});

            try {
                const result = await this.retain(account.id);
                results.push(result);
                await this.database.update(SyncRunEntity)
                    .set({
                        status: "SUCCESS",
                        finishedAt: new Date(),
                        rowsUpserted: result.insightRows + result.breakdownRows + result.actionRows
                            + result.messageBodies + result.syncRuns,
                    })
                    .where(eq(SyncRunEntity.id, run.id));
            } catch (error) {
                logger.error({err: error, accountId: account.id}, "retention run failed");
                await this.database.update(SyncRunEntity)
                    .set({
                        status: "FAILED",
                        finishedAt: new Date(),
                        error: error instanceof Error ? error.message : String(error),
                    })
                    .where(eq(SyncRunEntity.id, run.id));
            }
        }

        return results;
    }

    private async retain(accountId: string): Promise<RetentionResult> {
        const insightCutoff = addDays(new Date().toISOString().slice(0, 10), -this.policy.insightDays);
        const bodyCutoff = new Date(`${addDays(new Date().toISOString().slice(0, 10), -this.policy.messageBodyDays)}T00:00:00.000Z`);
        const syncCutoff = new Date(`${addDays(new Date().toISOString().slice(0, 10), -this.policy.syncRunDays)}T00:00:00.000Z`);

        const [insightRows, actionRows, breakdownRows, messageBodies, syncRuns] = await this.database.transaction(
            async (tx) => {
                const expiredInsights = tx.select({id: AdInsightDailyEntity.id})
                    .from(AdInsightDailyEntity)
                    .where(and(
                        eq(AdInsightDailyEntity.accountId, accountId),
                        lt(AdInsightDailyEntity.date, insightCutoff)
                    ));

                const removedActions = await tx.delete(AdInsightActionEntity)
                    .where(sql`${AdInsightActionEntity.insightDailyId} in (${expiredInsights})`)
                    .returning({id: AdInsightActionEntity.id});

                const removedInsights = await tx.delete(AdInsightDailyEntity)
                    .where(and(
                        eq(AdInsightDailyEntity.accountId, accountId),
                        lt(AdInsightDailyEntity.date, insightCutoff)
                    ))
                    .returning({id: AdInsightDailyEntity.id});

                const removedBreakdowns = await tx.delete(AdInsightBreakdownDailyEntity)
                    .where(and(
                        eq(AdInsightBreakdownDailyEntity.accountId, accountId),
                        lt(AdInsightBreakdownDailyEntity.date, insightCutoff)
                    ))
                    .returning({id: AdInsightBreakdownDailyEntity.id});

                const nulledBodies = await tx.execute(sql`
                    update conversation_messages m
                    set body = null
                    from leads l
                    where l.id = m.lead_id
                      and l.account_id = ${accountId}
                      and m.body is not null
                      and m.sent_at < ${bodyCutoff.toISOString()}::timestamptz
                    returning m.id
                `) as unknown as {id: number}[];

                const removedRuns = await tx.delete(SyncRunEntity)
                    .where(and(
                        eq(SyncRunEntity.accountId, accountId),
                        sql`${SyncRunEntity.startedAt} < ${syncCutoff.toISOString()}::timestamptz`,
                        // The audit rows of the retention job itself are the last thing to go.
                        sql`${SyncRunEntity.resource} <> 'retention'`
                    ))
                    .returning({id: SyncRunEntity.id});

                return [
                    removedInsights.length,
                    removedActions.length,
                    removedBreakdowns.length,
                    nulledBodies.length,
                    removedRuns.length,
                ] as const;
            }
        );

        logger.info({accountId, insightRows, actionRows, breakdownRows, messageBodies, syncRuns}, "retention run finished");

        return {accountId, insightRows, actionRows, breakdownRows, messageBodies, syncRuns};
    }
}
