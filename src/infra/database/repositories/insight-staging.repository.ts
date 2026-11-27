import {DatabaseRepository} from "./base.repository";
import {InsightSyncStagingEntity} from "@db/schema/ads/insight-sync-staging.entity";
import {SyncRunEntity} from "@db/schema/ads/sync-run.entity";
import {AdInsightDailyRepository, type UpsertInsightDailyParams} from "./ad-insight-daily.repository";
import {AdInsightBreakdownRepository, type InsertAdInsightBreakdownDaily} from "./ad-insight-breakdown.repository";
import {eq, sql} from "drizzle-orm";

export type InsightStagingKind = "insight_daily" | "insight_breakdown" | "insight_breakdown_hourly";

export interface InsightStagingPayloads {
    insight_daily: UpsertInsightDailyParams;
    insight_breakdown: InsertAdInsightBreakdownDaily;
    insight_breakdown_hourly: InsertAdInsightBreakdownDaily;
}

export interface PublishCompleteSliceParams {
    runId: number;
    accountId: string;
    since: string; // YYYY-MM-DD
    until: string; // YYYY-MM-DD
    /** Defaults to the kinds actually staged, so an unstaged slice is never replaced with an empty one. */
    kinds?: InsightStagingKind[];
}

export interface PublishSliceResult {
    dailyInsights: number;
    breakdowns: number;
    total: number;
}

const CHUNK_SIZE = 500;

/**
 * Stages a whole sync run and publishes it in one transaction: readers never observe a half-written slice,
 * and a failed fetch leaves the previously published data untouched.
 */
export class InsightStagingRepository extends DatabaseRepository {
    constructor(
        private readonly adInsightDailyRepository = new AdInsightDailyRepository(),
        private readonly adInsightBreakdownRepository = new AdInsightBreakdownRepository(),
    ) {
        super();
    }

    async write<K extends InsightStagingKind>(runId: number, kind: K, rows: InsightStagingPayloads[K][]): Promise<void> {
        if (rows.length === 0) return;

        for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
            const chunk = rows.slice(offset, offset + CHUNK_SIZE);
            await this.database.insert(InsightSyncStagingEntity).values(
                chunk.map((payload, index) => ({
                    runId,
                    rowIndex: offset + index,
                    kind,
                    payload: payload as unknown as Record<string, unknown>,
                }))
            );
        }
    }

    async publishCompleteSlice(params: PublishCompleteSliceParams): Promise<PublishSliceResult> {
        const {runId, accountId, since, until} = params;

        return this.database.transaction(async (tx) => {
            const staged = await tx.select({
                kind: InsightSyncStagingEntity.kind,
                payload: InsightSyncStagingEntity.payload,
            })
                .from(InsightSyncStagingEntity)
                .where(eq(InsightSyncStagingEntity.runId, runId))
                .orderBy(InsightSyncStagingEntity.rowIndex);

            const byKind = new Map<string, Record<string, unknown>[]>();
            for (const row of staged) {
                const bucket = byKind.get(row.kind) ?? [];
                bucket.push(row.payload as Record<string, unknown>);
                byKind.set(row.kind, bucket);
            }

            let dailyInsights = 0;
            let breakdowns = 0;

            const requested = params.kinds
                ?? (["insight_daily", "insight_breakdown", "insight_breakdown_hourly"] as InsightStagingKind[])
                    .filter((kind) => byKind.has(kind));

            if (requested.includes("insight_daily")) {
                const rows = (byKind.get("insight_daily") ?? []) as unknown as UpsertInsightDailyParams[];
                dailyInsights = await this.adInsightDailyRepository.replaceSlice(
                    tx,
                    {accountId, since, until},
                    rows
                );
            }

            if (requested.includes("insight_breakdown")) {
                const rows = (byKind.get("insight_breakdown") ?? []) as unknown as InsertAdInsightBreakdownDaily[];
                breakdowns += await this.adInsightBreakdownRepository.replaceSlice(
                    tx,
                    {accountId, since, until, hourly: false},
                    rows
                );
            }

            if (requested.includes("insight_breakdown_hourly")) {
                const rows = (byKind.get("insight_breakdown_hourly") ?? []) as unknown as InsertAdInsightBreakdownDaily[];
                breakdowns += await this.adInsightBreakdownRepository.replaceSlice(
                    tx,
                    {accountId, since, until, hourly: true},
                    rows
                );
            }

            await tx.delete(InsightSyncStagingEntity).where(eq(InsightSyncStagingEntity.runId, runId));

            const total = dailyInsights + breakdowns;
            await tx.update(SyncRunEntity)
                .set({
                    status: "SUCCESS",
                    finishedAt: new Date(),
                    rowsUpserted: total,
                    rangeSince: since,
                    rangeUntil: until,
                })
                .where(eq(SyncRunEntity.id, runId));

            return {dailyInsights, breakdowns, total};
        });
    }

    async cleanup(runId: number): Promise<void> {
        await this.database.execute(sql`delete from insight_sync_staging where run_id = ${runId}`);
    }
}
