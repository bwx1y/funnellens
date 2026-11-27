import {DatabaseRepository} from "./base.repository";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {LeadAssessmentEntity} from "@db/schema/wa/lead-assessment.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";
import {LeadMilestoneEntity} from "@db/schema/wa/lead-milestone.entity";
import {DeletionAuditEntity} from "@db/schema/ads/deletion-audit.entity";
import {and, asc, desc, eq, gte, ilike, isNull, lte, or, sql} from "drizzle-orm";
import {DEFAULT_PAGE_SIZE} from "@shared/pagination";

export type Lead = typeof LeadEntity.$inferSelect;
export type InsertLead = typeof LeadEntity.$inferInsert;

/** Sort keys the list endpoint exposes; every one of them is nulls-last on both directions. */
export type LeadSortBy =
    | "createdAt"
    | "firstSeenAt"
    | "name"
    | "response"
    | "temperature"
    | "analysis"
    | "campaign";

export interface LeadFilterParams {
    temperature?: "COLD" | "WARM" | "HOT";
    stage?: "CHAT_STARTED" | "REPLIED" | "QUALIFIED" | "CLOSING" | "CLOSED";
    campaignId?: string;
    /** Matches `name` OR `phone_masked`, case-insensitive. */
    search?: string;
    page?: number;
    pageSize?: number;
    /** Deprecated alias of `pageSize`; ignored when `pageSize` is set. */
    limit?: number;
    sortBy?: LeadSortBy;
    sortDir?: "asc" | "desc";
}

export interface LeadPage {
    leads: Lead[];
    total: number;
    /** Requested page clamped to `pages`, so an out-of-range page returns the last one. */
    page: number;
    pages: number;
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

const MAX_PAGE_SIZE = 100;

/**
 * `temperature` uses the enum order COLD < WARM < HOT; `analysis` is the newest applied assessment
 * and `campaign` the campaign name. Both are scalar subqueries, so the page stays one statement.
 */
const SORT_EXPRESSIONS = {
    createdAt: LeadEntity.createdAt,
    firstSeenAt: LeadEntity.firstSeenAt,
    name: LeadEntity.name,
    response: LeadEntity.firstRepliedAt,
    temperature: sql`case ${LeadEntity.temperature}
        when 'HOT' then 3
        when 'WARM' then 2
        when 'COLD' then 1
    end`,
    analysis: sql`(select max(a.event_at) from lead_assessments a
        where a.lead_id = ${LeadEntity.id} and a.applied = true)`,
    campaign: sql`(select c.name from campaigns c where c.id = ${LeadEntity.campaignId})`,
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

    async countByTemperature(
        accountId: string,
        since: Date,
        until: Date,
        campaignId?: string
    ): Promise<TemperatureCounts> {
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
                    lte(LeadEntity.firstSeenAt, until),
                    campaignId === undefined ? undefined : eq(LeadEntity.campaignId, campaignId)
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

    /**
     * One page of the account's leads. `page` is clamped to the real page count instead of rejected,
     * and `null` sort keys always land last regardless of `sortDir`.
     */
    async getLeadList(accountId: string, filter: LeadFilterParams): Promise<LeadPage> {
        const pageSize = Math.min(
            Math.max(filter.pageSize ?? filter.limit ?? DEFAULT_PAGE_SIZE, 1),
            MAX_PAGE_SIZE
        );
        const conditions = this.listConditions(accountId, filter);

        const [counted] = await this.database.select({total: sql<string>`count(*)`})
            .from(LeadEntity)
            .where(and(...conditions));

        const total = Number(counted.total);
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(Math.max(filter.page ?? 1, 1), pages);
        const direction = sql.raw(filter.sortDir ?? "desc");
        const sortExpression = SORT_EXPRESSIONS[filter.sortBy ?? "createdAt"];

        const leads = await this.database.select()
            .from(LeadEntity)
            .where(and(...conditions))
            .orderBy(sql`${sortExpression} ${direction} nulls last`, desc(LeadEntity.id))
            .limit(pageSize)
            .offset((page - 1) * pageSize);

        return {leads, total, page, pages};
    }

    private listConditions(accountId: string, filter: LeadFilterParams) {
        const conditions = [eq(LeadEntity.accountId, accountId)];
        if (filter.temperature !== undefined) {
            conditions.push(eq(LeadEntity.temperature, filter.temperature));
        }
        if (filter.stage !== undefined) {
            conditions.push(eq(LeadEntity.stage, filter.stage));
        }
        if (filter.campaignId !== undefined) {
            conditions.push(eq(LeadEntity.campaignId, filter.campaignId));
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

        return conditions;
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

    /**
     * Deletes one lead with everything hanging off it, and records who asked. The audit row survives the
     * lead on purpose: an erasure request needs a receipt, not a cascade.
     */
    async deleteForTenant(
        tenantId: string,
        id: number,
        actor: {userId: string; reason: string | null}
    ): Promise<boolean> {
        return this.database.transaction(async (tx) => {
            const [lead] = await tx.select({id: LeadEntity.id})
                .from(LeadEntity)
                .innerJoin(AdAccountEntity, eq(AdAccountEntity.id, LeadEntity.accountId))
                .where(and(eq(LeadEntity.id, id), eq(AdAccountEntity.tenantId, tenantId)))
                .limit(1);

            if (lead === undefined) return false;

            await tx.delete(ConversationMessageEntity).where(eq(ConversationMessageEntity.leadId, id));
            await tx.delete(LeadAssessmentEntity).where(eq(LeadAssessmentEntity.leadId, id));
            await tx.delete(LeadMilestoneEntity).where(eq(LeadMilestoneEntity.leadId, id));
            await tx.delete(LeadEntity).where(eq(LeadEntity.id, id));

            await tx.insert(DeletionAuditEntity).values({
                tenantId,
                userId: actor.userId,
                leadId: id,
                reason: actor.reason,
            });

            return true;
        });
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
     * Names behind the lead's attribution ids plus its message counts. Missing parents stay `null`
     * instead of dropping the row: an ad can be deleted while its leads remain.
     */
    async getDetailExtras(leadId: number): Promise<{
        campaignName: string | null;
        adName: string | null;
        creativeName: string | null;
        messagesInbound: number;
        messagesOutbound: number;
    }> {
        const [row] = await this.database.execute(sql`
            select c.name                as campaign_name,
                   a.name                as ad_name,
                   cr.name               as creative_name,
                   coalesce(m.inbound, 0)  as messages_inbound,
                   coalesce(m.outbound, 0) as messages_outbound
            from leads l
            left join campaigns c on c.id = l.campaign_id
            left join ads a on a.id = l.ad_id
            left join ad_creatives cr on cr.id = l.creative_id
            left join lateral (
                select count(*) filter (where cm.direction = 'INBOUND')  as inbound,
                       count(*) filter (where cm.direction = 'OUTBOUND') as outbound
                from conversation_messages cm
                where cm.lead_id = l.id
            ) m on true
            where l.id = ${leadId}
        `) as unknown as {
            campaign_name: string | null;
            ad_name: string | null;
            creative_name: string | null;
            messages_inbound: string;
            messages_outbound: string;
        }[];

        return {
            campaignName: row?.campaign_name ?? null,
            adName: row?.ad_name ?? null,
            creativeName: row?.creative_name ?? null,
            messagesInbound: Number(row?.messages_inbound ?? 0),
            messagesOutbound: Number(row?.messages_outbound ?? 0),
        };
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
