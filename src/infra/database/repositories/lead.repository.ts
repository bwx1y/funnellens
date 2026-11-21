import {DatabaseRepository} from "./base.repository";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {and, asc, desc, eq, gte, ilike, isNull, lte, or, sql} from "drizzle-orm";

export type Lead = typeof LeadEntity.$inferSelect;
export type InsertLead = typeof LeadEntity.$inferInsert;

export interface LeadFilterParams {
    temperature?: "COLD" | "WARM" | "HOT";
    stage?: "CHAT_STARTED" | "REPLIED" | "QUALIFIED" | "CLOSED";
    /** Matches `name` OR `phone_masked`, case-insensitive. */
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: "createdAt" | "firstSeenAt";
    sortDir?: "asc" | "desc";
}

export interface TemperatureCounts {
    hot: number;
    warm: number;
    cold: number;
}

export interface SpeedMetrics {
    avgFirstReplySeconds: number | null;
    stuckLeads: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const SORT_COLUMNS = {
    createdAt: LeadEntity.createdAt,
    firstSeenAt: LeadEntity.firstSeenAt,
} as const;

export class LeadRepository extends DatabaseRepository {
    /**
     * Idempotent on `(account_id, external_id)`. A NULL `external_id` never conflicts
     * (the unique index allows multiple NULLs), so callers needing idempotency must supply one.
     */
    async upsert(lead: InsertLead): Promise<Lead> {
        const [entity] = await this.database.insert(LeadEntity)
            .values(lead)
            .onConflictDoUpdate({
                target: [LeadEntity.accountId, LeadEntity.externalId],
                set: {
                    name: lead.name,
                    phoneHash: lead.phoneHash,
                    phoneMasked: lead.phoneMasked,
                    emailHash: lead.emailHash,
                    campaignId: lead.campaignId,
                    adsetId: lead.adsetId,
                    adId: lead.adId,
                    creativeId: lead.creativeId,
                    sourcePlatform: lead.sourcePlatform,
                    sourcePosition: lead.sourcePosition,
                    attributionNote: lead.attributionNote,
                    temperature: lead.temperature,
                    stage: lead.stage,
                    sentiment: lead.sentiment,
                    signals: lead.signals,
                    firstMessage: lead.firstMessage,
                    firstSeenAt: lead.firstSeenAt,
                    firstRepliedAt: lead.firstRepliedAt,
                    qualifiedAt: lead.qualifiedAt,
                    closedAt: lead.closedAt,
                    dealValueMinor: lead.dealValueMinor,
                    currency: lead.currency,
                    updatedAt: new Date(),
                },
            })
            .returning();

        return entity;
    }

    async countByTemperature(accountId: string, since: Date, until: Date): Promise<TemperatureCounts> {
        const [row] = await this.database.select({
            hot: sql<string>`count(*) filter (where ${LeadEntity.temperature} = 'HOT')`,
            warm: sql<string>`count(*) filter (where ${LeadEntity.temperature} = 'WARM')`,
            cold: sql<string>`count(*) filter (where ${LeadEntity.temperature} = 'COLD')`,
        })
            .from(LeadEntity)
            .where(
                and(
                    eq(LeadEntity.accountId, accountId),
                    gte(LeadEntity.firstSeenAt, since),
                    lte(LeadEntity.firstSeenAt, until)
                )
            );

        return {
            hot: Number(row.hot),
            warm: Number(row.warm),
            cold: Number(row.cold),
        };
    }

    async getUnrepliedHotLeads(accountId: string, limit = 10): Promise<Lead[]> {
        return this.database.select()
            .from(LeadEntity)
            .where(
                and(
                    eq(LeadEntity.accountId, accountId),
                    eq(LeadEntity.temperature, "HOT"),
                    isNull(LeadEntity.firstRepliedAt)
                )
            )
            .orderBy(asc(LeadEntity.firstSeenAt))
            .limit(Math.min(Math.max(limit, 1), MAX_PAGE_SIZE));
    }

    /**
     * Share of the period's leads answered within 15 minutes. Unreplied leads stay in `totalLeads`
     * (they are late, not excluded), so the ratio is directly comparable to a target.
     */
    async getReplyTimeliness(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{totalLeads: number; onTimeReplies: number}> {
        const rows = await this.database.execute(sql`
            select count(*) as total_leads,
                   count(*) filter (
                       where l.first_replied_at is not null
                         and l.first_replied_at - l.first_seen_at <= interval '15 minutes'
                   ) as on_time_replies
            from leads l
            where l.account_id = ${accountId}
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
        `) as unknown as {total_leads: string; on_time_replies: string}[];

        const row = rows[0];
        return {
            totalLeads: Number(row.total_leads),
            onTimeReplies: Number(row.on_time_replies),
        };
    }

    /** Account-wide backlog count; `getUnrepliedHotLeads` is capped at a page and cannot be counted on. */
    async countUnrepliedHotLeads(accountId: string): Promise<number> {
        const [row] = await this.database.select({total: sql<string>`count(*)`})
            .from(LeadEntity)
            .where(
                and(
                    eq(LeadEntity.accountId, accountId),
                    eq(LeadEntity.temperature, "HOT"),
                    isNull(LeadEntity.firstRepliedAt)
                )
            );

        return Number(row.total);
    }

    /**
     * `avgFirstReplySeconds` is period-scoped; `stuckLeads` is the live account-wide backlog
     * (unanswered for more than 24h) and intentionally ignores `since`/`until`.
     */
    async getSpeedMetrics(accountId: string, since: Date, until: Date): Promise<SpeedMetrics> {
        const [average] = await this.database.select({
            avgSeconds: sql<string | null>`avg(extract(epoch from (${LeadEntity.firstRepliedAt} - ${LeadEntity.firstSeenAt})))`,
        })
            .from(LeadEntity)
            .where(
                and(
                    eq(LeadEntity.accountId, accountId),
                    gte(LeadEntity.firstSeenAt, since),
                    lte(LeadEntity.firstSeenAt, until),
                    sql`${LeadEntity.firstRepliedAt} is not null`
                )
            );

        const [stuck] = await this.database.select({
            stuckLeads: sql<string>`count(*) filter (where first_replied_at is null and first_seen_at is not null and first_seen_at < now() - interval '24 hours')`,
        })
            .from(LeadEntity)
            .where(eq(LeadEntity.accountId, accountId));

        return {
            avgFirstReplySeconds: average.avgSeconds === null ? null : Number(average.avgSeconds),
            stuckLeads: Number(stuck.stuckLeads),
        };
    }

    async getLeadList(
        accountId: string,
        filter: LeadFilterParams
    ): Promise<{ leads: Lead[]; total: number }> {
        const page = Math.max(filter.page ?? 1, 1);
        const limit = Math.min(Math.max(filter.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
        const offset = (page - 1) * limit;

        const conditions = [eq(LeadEntity.accountId, accountId)];
        if (filter.temperature !== undefined) {
            conditions.push(eq(LeadEntity.temperature, filter.temperature));
        }
        if (filter.stage !== undefined) {
            conditions.push(eq(LeadEntity.stage, filter.stage));
        }
        if (filter.search !== undefined && filter.search.length > 0) {
            const pattern = `%${filter.search.replace(/[\\%_]/g, "\\$&")}%`;
            const searchCondition = or(
                ilike(LeadEntity.name, pattern),
                ilike(LeadEntity.phoneMasked, pattern)
            );
            if (searchCondition !== undefined) {
                conditions.push(searchCondition);
            }
        }

        const sortColumn = SORT_COLUMNS[filter.sortBy ?? "createdAt"];
        const order = (filter.sortDir ?? "desc") === "asc" ? asc(sortColumn) : desc(sortColumn);

        const [leads, [counted]] = await Promise.all([
            this.database.select()
                .from(LeadEntity)
                .where(and(...conditions))
                .orderBy(order)
                .limit(limit)
                .offset(offset),
            this.database.select({total: sql<string>`count(*)`})
                .from(LeadEntity)
                .where(and(...conditions)),
        ]);

        return {leads, total: Number(counted.total)};
    }
}
