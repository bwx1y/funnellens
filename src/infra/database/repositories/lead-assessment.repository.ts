import {DatabaseRepository} from "./base.repository";
import {LeadAssessmentEntity} from "@db/schema/wa/lead-assessment.entity";
import {and, desc, eq, sql} from "drizzle-orm";

export type LeadAssessment = typeof LeadAssessmentEntity.$inferSelect;
export type InsertLeadAssessment = typeof LeadAssessmentEntity.$inferInsert;

export interface AppendAssessmentResult {
    assessment: LeadAssessment;
    applied: boolean;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

/**
 * Append-only assessment log. `applied` marks the row that actually moved the lead's state:
 * a row whose `event_at` predates the newest stored event is persisted but not applied.
 */
export class LeadAssessmentRepository extends DatabaseRepository {
    /**
     * Runs inside the caller's transaction (the assessment writer owns the transaction):
     * a replayed `(leadId, eventAt, ruleVersion)` returns the stored row instead of duplicating it.
     */
    async appendIfCurrent(assessment: InsertLeadAssessment): Promise<AppendAssessmentResult> {
        const [latest] = await this.database.execute(sql`
            select max(event_at) as max_event_at
            from lead_assessments
            where lead_id = ${assessment.leadId}
        `) as unknown as {max_event_at: Date | string | null}[];

        const maxEventAt = latest?.max_event_at ?? null;
        const applied = maxEventAt === null || assessment.eventAt >= new Date(maxEventAt);

        const [inserted] = await this.database.insert(LeadAssessmentEntity)
            .values({...assessment, applied})
            .onConflictDoNothing({
                target: [
                    LeadAssessmentEntity.leadId,
                    LeadAssessmentEntity.eventAt,
                    LeadAssessmentEntity.ruleVersion,
                ],
            })
            .returning();

        if (inserted !== undefined) {
            return {assessment: inserted, applied: inserted.applied};
        }

        const [existing] = await this.database.select()
            .from(LeadAssessmentEntity)
            .where(
                and(
                    eq(LeadAssessmentEntity.leadId, assessment.leadId),
                    eq(LeadAssessmentEntity.eventAt, assessment.eventAt),
                    eq(LeadAssessmentEntity.ruleVersion, assessment.ruleVersion)
                )
            )
            .limit(1);

        return {assessment: existing, applied: existing.applied};
    }

    async latestByLead(leadId: number): Promise<LeadAssessment | null> {
        const [entity] = await this.database.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, leadId))
            .orderBy(desc(LeadAssessmentEntity.eventAt), desc(LeadAssessmentEntity.createdAt))
            .limit(1);

        return entity ?? null;
    }

    async history(leadId: number, limit = DEFAULT_HISTORY_LIMIT): Promise<LeadAssessment[]> {
        return this.database.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, leadId))
            .orderBy(desc(LeadAssessmentEntity.eventAt), desc(LeadAssessmentEntity.createdAt))
            .limit(Math.min(Math.max(limit, 1), MAX_HISTORY_LIMIT));
    }

    /** Consecutive assessment pairs per lead in the period cohort; `value` is the lead count. */
    async getLevelTransitions(
        accountId: string,
        since: Date,
        until: Date,
        campaignId?: string
    ): Promise<{from: "COLD" | "WARM" | "HOT"; to: "COLD" | "WARM" | "HOT"; value: number}[]> {
        const rows = await this.database.execute(sql`
            with ordered as (
                select a.level,
                       lag(a.level) over (partition by a.lead_id order by a.event_at asc, a.created_at asc) as prev_level
                from lead_assessments a
                join leads l on l.id = a.lead_id
                where l.account_id = ${accountId}
                  and l.first_seen_at >= ${since.toISOString()}::timestamptz
                  and l.first_seen_at <= ${until.toISOString()}::timestamptz
                  ${campaignId === undefined ? sql`` : sql`and l.campaign_id = ${campaignId}`}
            )
            select prev_level as from_level, level as to_level, count(*) as value
            from ordered
            where prev_level is not null and prev_level <> level
            group by 1, 2
            order by 1 asc, 2 asc
        `) as unknown as {from_level: "COLD" | "WARM" | "HOT"; to_level: "COLD" | "WARM" | "HOT"; value: string}[];

        return rows.map((row) => ({
            from: row.from_level,
            to: row.to_level,
            value: Number(row.value),
        }));
    }

    /**
     * One row per lead with an applied assessment in the period cohort: the newest applied row wins.
     * The cohort itself is the page — the period bound is the only filter, so no pagination is applied.
     */
    async getEffectivePipeline(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{
        leadId: number;
        name: string | null;
        phoneMasked: string | null;
        level: "COLD" | "WARM" | "HOT";
        confidence: string;
        reason: string | null;
        evidenceWamid: string | null;
        stage: string;
        adId: string | null;
        creativeId: string | null;
        firstSeenAt: Date | null;
        firstRepliedAt: Date | null;
        warmAt: Date | null;
        hotAt: Date | null;
    }[]> {
        const rows = await this.database.execute(sql`
            select l.id as lead_id, l.name, l.phone_masked,
                   a.level, a.confidence, a.reason,
                   a.evidence->>'wamid' as evidence_wamid,
                   l.stage, l.ad_id, l.creative_id, l.first_seen_at, l.first_replied_at,
                   mw.first_at as warm_at, mh.first_at as hot_at
            from leads l
            join lateral (
                select x.level, x.confidence, x.reason, x.evidence, x.event_at
                from lead_assessments x
                where x.lead_id = l.id and x.applied = true
                order by x.event_at desc, x.created_at desc
                limit 1
            ) a on true
            left join lead_milestones mw on mw.lead_id = l.id and mw.level = 'WARM'
            left join lead_milestones mh on mh.lead_id = l.id and mh.level = 'HOT'
            where l.account_id = ${accountId}
              and l.first_seen_at >= ${since.toISOString()}::timestamptz
              and l.first_seen_at <= ${until.toISOString()}::timestamptz
            order by a.event_at desc
        `) as unknown as {
            lead_id: string;
            name: string | null;
            phone_masked: string | null;
            level: "COLD" | "WARM" | "HOT";
            confidence: string;
            reason: string | null;
            evidence_wamid: string | null;
            stage: string;
            ad_id: string | null;
            creative_id: string | null;
            first_seen_at: Date | string | null;
            first_replied_at: Date | string | null;
            warm_at: Date | string | null;
            hot_at: Date | string | null;
        }[];

        return rows.map((row) => ({
            leadId: Number(row.lead_id),
            name: row.name,
            phoneMasked: row.phone_masked,
            level: row.level,
            confidence: row.confidence,
            reason: row.reason,
            evidenceWamid: row.evidence_wamid,
            stage: row.stage,
            adId: row.ad_id,
            creativeId: row.creative_id,
            firstSeenAt: row.first_seen_at === null ? null : new Date(row.first_seen_at),
            firstRepliedAt: row.first_replied_at === null ? null : new Date(row.first_replied_at),
            warmAt: row.warm_at === null ? null : new Date(row.warm_at),
            hotAt: row.hot_at === null ? null : new Date(row.hot_at),
        }));
    }
}
