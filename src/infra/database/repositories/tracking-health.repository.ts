import {DatabaseRepository} from "./base.repository";
import {TrackingHealthDailyEntity} from "@db/schema/ads/tracking-health-daily.entity";
import {eq, sql} from "drizzle-orm";

export type TrackingHealthEvent = typeof TrackingHealthDailyEntity.$inferSelect;

export interface TrackingHealthSummary {
    /** Latest snapshot date for the account. */
    date: string | null;
    /** All event rows for that date. */
    events: TrackingHealthEvent[];
    browserCount: number;
    serverCount: number;
    dedupRate: number | null;
    matchQuality: number | null;
    status: "Sehat" | "Perlu Optimalisasi" | "Bermasalah" | null;
}

const STATUS_RANK = {
    "Sehat": 1,
    "Perlu Optimalisasi": 2,
    "Bermasalah": 3,
} as const;

const STATUS_BY_RANK = {
    1: "Sehat",
    2: "Perlu Optimalisasi",
    3: "Bermasalah",
} as const;

const EMPTY_SUMMARY: TrackingHealthSummary = {
    date: null,
    events: [],
    browserCount: 0,
    serverCount: 0,
    dedupRate: null,
    matchQuality: null,
    status: null,
};

function mean(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class TrackingHealthRepository extends DatabaseRepository {
    async upsertDaily(health: typeof TrackingHealthDailyEntity.$inferInsert): Promise<void> {
        await this.database.insert(TrackingHealthDailyEntity)
            .values(health)
            .onConflictDoUpdate({
                target: [
                    TrackingHealthDailyEntity.accountId,
                    TrackingHealthDailyEntity.date,
                    TrackingHealthDailyEntity.eventName,
                ],
                set: {
                    browserCount: sql`excluded.browser_count`,
                    serverCount: sql`excluded.server_count`,
                    dedupRate: sql`excluded.dedup_rate`,
                    matchQuality: sql`excluded.match_quality`,
                    status: sql`excluded.status`,
                    raw: sql`excluded.raw`,
                },
            });
    }

    async getLatestStatus(accountId: string): Promise<TrackingHealthSummary> {
        const [latest] = await this.database.select({
            date: sql<string | null>`max(${TrackingHealthDailyEntity.date})`,
        })
            .from(TrackingHealthDailyEntity)
            .where(eq(TrackingHealthDailyEntity.accountId, accountId));

        if (latest?.date == null) return {...EMPTY_SUMMARY};

        const events = await this.database.select()
            .from(TrackingHealthDailyEntity)
            .where(
                sql`${TrackingHealthDailyEntity.accountId} = ${accountId}
                    and ${TrackingHealthDailyEntity.date} = ${latest.date}`
            );

        let worstRank = 0;
        for (const event of events) {
            const rank = STATUS_RANK[event.status as keyof typeof STATUS_RANK];
            if (rank !== undefined && rank > worstRank) {
                worstRank = rank;
            }
        }

        return {
            date: latest.date,
            events,
            browserCount: events.reduce((sum, event) => sum + (event.browserCount ?? 0), 0),
            serverCount: events.reduce((sum, event) => sum + (event.serverCount ?? 0), 0),
            dedupRate: mean(
                events
                    .filter((event) => event.dedupRate !== null)
                    .map((event) => Number(event.dedupRate))
            ),
            matchQuality: mean(
                events
                    .filter((event) => event.matchQuality !== null)
                    .map((event) => Number(event.matchQuality))
            ),
            status: worstRank === 0 ? null : STATUS_BY_RANK[worstRank as keyof typeof STATUS_BY_RANK],
        };
    }
}
