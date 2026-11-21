import {DatabaseRepository} from "./base.repository";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {LeadAssessmentEntity} from "@db/schema/wa/lead-assessment.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {and, asc, desc, eq, gte, ilike, isNull, lte, or, sql} from "drizzle-orm";

export type Lead = typeof LeadEntity.$inferSelect;
export type InsertLead = typeof LeadEntity.$inferInsert;

export interface LeadFilterParams {
    temperature?: "COLD" | "WARM" | "HOT";
    stage?: "CHAT_STARTED" | "REPLIED" | "QUALIFIED" | "CLOSING" | "CLOSED";
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
    /** Longest answered wait in the period, in whole minutes; `null` when nothing was answered. */
    longestWaitMinutes: number | null;
}

export interface LeadTemperatureDistribution {
    hot: number;
    warm: number;
    cold: number;
    unassessed: number;
}

export interface LeadAdCounts {
    adId: string;
    leads: number;
    hotLeads: number;
}

export interface LeadHourCounts {
    hour: number;
    leads: number;
}

export interface ManualLeadChanges {
    stage?: Lead["stage"];
    temperature?: "COLD" | "WARM" | "HOT";
    dealValueMinor?: number | null;
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
     * `avgFirstReplySeconds` and `longestWaitMinutes` are period-scoped (answered leads only);
     * `stuckLeads` is the live account-wide backlog (unanswered for more than 24h) and intentionally
     * ignores `since`/`until`.
     */
    async getSpeedMetrics(accountId: string, since: Date, until: Date): Promise<SpeedMetrics> {
        const [average] = await this.database.select({
            avgSeconds: sql<string | null>`avg(extract(epoch from (${LeadEntity.firstRepliedAt} - ${LeadEntity.firstSeenAt})))`,
            longestSeconds: sql<string | null>`max(extract(epoch from (${LeadEntity.firstRepliedAt} - ${LeadEntity.firstSeenAt})))`,
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
            longestWaitMinutes: average.longestSeconds === null
                ? null
                : Math.round(Number(average.longestSeconds) / 60),
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

    async findById(id: number): Promise<Lead | null> {
        const [entity] = await this.database.select()
            .from(LeadEntity)
            .where(eq(LeadEntity.id, id))
            .limit(1);

        return entity ?? null;
    }

    /** Joined to the account's tenant, so a foreign lead is indistinguishable from a missing one. */
    async getByIdForTenant(tenantId: string, id: number): Promise<Lead | null> {
        const [row] = await this.database.select({lead: LeadEntity})
            .from(LeadEntity)
            .innerJoin(AdAccountEntity, eq(AdAccountEntity.id, LeadEntity.accountId))
            .where(and(eq(LeadEntity.id, id), eq(AdAccountEntity.tenantId, tenantId)))
            .limit(1);

        return row?.lead ?? null;
    }

    /** Current temperature split of the period's leads; `unassessed` counts rows without a level. */
    async getTemperatureDistribution(
        accountId: string,
        since: Date,
        until: Date,
        campaignId?: string
    ): Promise<LeadTemperatureDistribution> {
        const rows = await this.database.execute(sql`
            select count(*) filter (where l.temperature = 'HOT')  as hot,
                   count(*) filter (where l.temperature = 'WARM') as warm,
                   count(*) filter (where l.temperature = 'COLD') as cold,
                   count(*) filter (where l.temperature is null)  as unassessed
            from leads l
            where l.account_id = ${accountId}
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
              ${campaignId === undefined ? sql`` : sql`and l.campaign_id = ${campaignId}`}
        `) as unknown as {hot: string; warm: string; cold: string; unassessed: string}[];

        const [row] = rows;
        return {
            hot: Number(row.hot),
            warm: Number(row.warm),
            cold: Number(row.cold),
            unassessed: Number(row.unassessed),
        };
    }

    /**
     * Leads per `ad_id` in the period; rows without `ad_id` are not returned. `hotLeads` uses the HOT
     * milestone so it matches `AnalyticsRepository.getCampaignLeadMetrics`.
     */
    async getLeadCountsByAd(accountId: string, since: Date, until: Date): Promise<LeadAdCounts[]> {
        const rows = await this.database.execute(sql`
            select l.ad_id as ad_id,
                   count(*) as leads,
                   count(*) filter (where m.lead_id is not null) as hot_leads
            from leads l
            left join lead_milestones m
                   on m.lead_id = l.id
                  and m.level = 'HOT'
            where l.account_id = ${accountId}
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
              and l.ad_id is not null
            group by l.ad_id
        `) as unknown as {ad_id: string; leads: string; hot_leads: string}[];

        return rows.map((row) => ({
            adId: row.ad_id,
            leads: Number(row.leads),
            hotLeads: Number(row.hot_leads),
        }));
    }

    /** Leads per local hour of `first_seen_at`; `timeZone` must already be `safeTimeZone`-validated. */
    async getLeadCountsByHour(
        accountId: string,
        since: Date,
        until: Date,
        timeZone: string
    ): Promise<LeadHourCounts[]> {
        const rows = await this.database.execute(sql`
            select extract(hour from (l.first_seen_at at time zone ${timeZone}))::int as hour,
                   count(*) as leads
            from leads l
            where l.account_id = ${accountId}
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
            group by 1
            order by 1 asc
        `) as unknown as {hour: number; leads: string}[];

        return rows.map((row) => ({hour: Number(row.hour), leads: Number(row.leads)}));
    }

    /**
     * One transaction: update the lead, then append a manual assessment row only when `temperature`
     * actually changes. `manualAssessmentId` is `null` when no row was written.
     */
    async updateManual(
        leadId: number,
        changes: ManualLeadChanges
    ): Promise<{lead: Lead; manualAssessmentId: string | null}> {
        return this.database.transaction(async (tx) => {
            const [current] = await tx.select({temperature: LeadEntity.temperature})
                .from(LeadEntity)
                .where(eq(LeadEntity.id, leadId))
                .limit(1);

            const [updated] = await tx.update(LeadEntity)
                .set({...changes, updatedAt: new Date()})
                .where(eq(LeadEntity.id, leadId))
                .returning();

            let manualAssessmentId: string | null = null;
            if (changes.temperature !== undefined && changes.temperature !== (current?.temperature ?? null)) {
                const [assessment] = await tx.insert(LeadAssessmentEntity)
                    .values({
                        leadId,
                        level: changes.temperature,
                        confidence: "tinggi",
                        reason: "Diubah manual oleh pengguna",
                        eventAt: new Date(),
                        applied: true,
                        ruleVersion: "manual-r1",
                        evidence: null,
                    })
                    .returning({id: LeadAssessmentEntity.id});

                manualAssessmentId = assessment.id;
            }

            return {lead: updated, manualAssessmentId};
        });
    }
}
