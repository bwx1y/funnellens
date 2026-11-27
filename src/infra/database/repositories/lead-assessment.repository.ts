import {DatabaseRepository, type DatabaseTransaction} from "./base.repository";
import {LeadAssessmentEntity} from "@db/schema/wa/lead-assessment.entity";
import {LeadMilestoneEntity} from "@db/schema/wa/lead-milestone.entity";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {LeadMilestoneRepository} from "./lead-milestone.repository";
import {and, desc, eq, sql} from "drizzle-orm";

export type LeadAssessment = typeof LeadAssessmentEntity.$inferSelect;
export type InsertLeadAssessment = typeof LeadAssessmentEntity.$inferInsert;

export interface AppendAssessmentResult {
    assessment: LeadAssessment;
    applied: boolean;
}

/** Availability marker: the row records that no decision could be made, never a level. */
export interface UnavailableAssessmentInput {
    leadId: number;
    level: LeadAssessment["level"];
    reason: string;
    error: string;
    eventAt: Date;
    ruleVersion: string;
    model: string | null;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

/**
 * Append-only assessment log. `applied` marks the row that actually moved the lead's state:
 * a row whose `event_at` predates the newest stored event is persisted but not applied.
 */
export class LeadAssessmentRepository extends DatabaseRepository {
    private readonly milestones = new LeadMilestoneRepository();

    /**
     * `tx` is passed by `applyAssessment`, which owns the transaction: a replayed
     * `(leadId, eventAt, ruleVersion)` returns the stored row instead of duplicating it.
     */
    async appendIfCurrent(
        assessment: InsertLeadAssessment,
        tx?: DatabaseTransaction
    ): Promise<AppendAssessmentResult> {
        const db = (tx ?? this.database) as typeof this.database;

        const [latest] = await db.execute(sql`
            select max(event_at) as max_event_at
            from lead_assessments
            where lead_id = ${assessment.leadId}
        `) as unknown as {max_event_at: Date | string | null}[];

        const maxEventAt = latest?.max_event_at ?? null;
        const applied = maxEventAt === null || assessment.eventAt >= new Date(maxEventAt);
        // The predecessor is whichever applied row the lead carried before this one; a replayed
        // (non-applied) row has no position in the timeline, so it records none.
        const priorLevel = applied ? (await this.latestByLead(assessment.leadId, tx))?.level ?? null : null;

        const [inserted] = await db.insert(LeadAssessmentEntity)
            .values({...assessment, applied, priorLevel})
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

        const [existing] = await db.select()
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

    /**
     * The only writer of `leads.temperature`: one transaction for the append-only row, the first-time
     * WARM/HOT milestone, and the lead level — each skipped when the row is not the newest event.
     */
    async applyAssessment(assessment: InsertLeadAssessment): Promise<AppendAssessmentResult> {
        return this.database.transaction(async (tx) => {
            const stored = await this.appendIfCurrent(assessment, tx);
            if (!stored.applied) return stored;

            const {leadId, level, eventAt} = stored.assessment;

            if (level === "WARM" || level === "HOT") {
                await this.milestones.recordFirst(leadId, level, eventAt, tx);
            }

            await tx.update(LeadEntity)
                .set({temperature: level, updatedAt: new Date()})
                .where(eq(LeadEntity.id, leadId));

            return stored;
        });
    }

    /**
     * Records that no decision could be made. The row is never `applied` and carries its own rule
     * version, so it neither moves the lead nor blocks a later successful run at the same `eventAt`.
     * `confidence` is a marker value: `latestByLead` only reads applied rows.
     */
    async appendUnavailable(input: UnavailableAssessmentInput): Promise<void> {
        await this.database.insert(LeadAssessmentEntity)
            .values({
                leadId: input.leadId,
                level: input.level,
                confidence: "tidak tersedia",
                reason: input.reason,
                evidence: {status: "UNAVAILABLE", error: input.error},
                eventAt: input.eventAt,
                applied: false,
                ruleVersion: input.ruleVersion,
                model: input.model,
            })
            .onConflictDoNothing({
                target: [
                    LeadAssessmentEntity.leadId,
                    LeadAssessmentEntity.eventAt,
                    LeadAssessmentEntity.ruleVersion,
                ],
            });
    }

    /** Latest applied row: unavailability markers and replayed rows never surface as a level. */
    async latestByLead(leadId: number, tx?: DatabaseTransaction): Promise<LeadAssessment | null> {
        const db = (tx ?? this.database) as typeof this.database;

        const [entity] = await db.select()
            .from(LeadAssessmentEntity)
            .where(and(
                eq(LeadAssessmentEntity.leadId, leadId),
                eq(LeadAssessmentEntity.applied, true)
            ))
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
                where a.applied = true
                  and l.account_id = ${accountId}
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
     * Every level change the lead ever had, oldest first: assessment rows (applied or not) merged
     * with the first-observation milestones. Milestones carry no confidence of their own, so they
     * report `teramati` — the level was observed, not scored.
     */
    async getMovement(leadId: number): Promise<{
        level: "COLD" | "WARM" | "HOT";
        at: Date;
        reason: string | null;
        confidence: string;
        applied: boolean;
        priorLevel: "COLD" | "WARM" | "HOT" | null;
        topic: string | null;
        responseType: string | null;
    }[]> {
        const rows = await this.database.execute(sql`
            select m.level, m.at, m.reason, m.confidence, m.applied, m.topic, m.response_type,
                   m.prior_level
            from (
                select a.level, a.event_at as at, a.reason, a.confidence, a.applied,
                       a.topic, a.response_type, a.prior_level,
                       0 as kind, a.created_at as tie
                from lead_assessments a
                where a.lead_id = ${leadId}
                union all
                select lm.level, lm.first_at as at, null::text as reason, 'teramati' as confidence,
                       true as applied, null::text as topic, null::text as response_type,
                       null::"lead_temperature" as prior_level, 1 as kind, lm.first_at as tie
                from lead_milestones lm
                where lm.lead_id = ${leadId}
            ) m
            order by m.at asc, m.kind asc, m.tie asc
        `) as unknown as {
            level: "COLD" | "WARM" | "HOT";
            at: Date | string;
            reason: string | null;
            confidence: string;
            applied: boolean;
            topic: string | null;
            response_type: string | null;
            prior_level: "COLD" | "WARM" | "HOT" | null;
        }[];

        return rows.map((row) => ({
            level: row.level,
            at: new Date(row.at),
            reason: row.reason,
            confidence: row.confidence,
            applied: row.applied,
            priorLevel: row.prior_level,
            topic: row.topic,
            responseType: row.response_type,
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
        topic: string | null;
        responseType: string | null;
        stage: string;
        adId: string | null;
        creativeId: string | null;
        firstSeenAt: Date | null;
        firstRepliedAt: Date | null;
        warmAt: Date | null;
        hotAt: Date | null;
        attributionMethod: string | null;
        attributionConfidence: string | null;
    }[]> {
        const rows = await this.database.execute(sql`
            select l.id as lead_id, l.name, l.phone_masked,
                   a.level, a.confidence, a.reason,
                   a.evidence->>'wamid' as evidence_wamid,
                   a.topic, a.response_type, a.prior_level,
                   l.stage, l.ad_id, l.creative_id, l.first_seen_at, l.first_replied_at,
                   l.attribution_method, l.attribution_confidence,
                   mw.first_at as warm_at, mh.first_at as hot_at
            from leads l
            join lateral (
                select x.level, x.confidence, x.reason, x.evidence, x.event_at,
                       x.topic, x.response_type, x.prior_level
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
            topic: string | null;
            response_type: string | null;
            prior_level: "COLD" | "WARM" | "HOT" | null;
            stage: string;
            ad_id: string | null;
            creative_id: string | null;
            first_seen_at: Date | string | null;
            first_replied_at: Date | string | null;
            warm_at: Date | string | null;
            hot_at: Date | string | null;
            attribution_method: string | null;
            attribution_confidence: string | null;
        }[];

        return rows.map((row) => ({
            leadId: Number(row.lead_id),
            name: row.name,
            phoneMasked: row.phone_masked,
            level: row.level,
            confidence: row.confidence,
            reason: row.reason,
            evidenceWamid: row.evidence_wamid,
            topic: row.topic,
            responseType: row.response_type,
            priorLevel: row.prior_level,
            stage: row.stage,
            adId: row.ad_id,
            creativeId: row.creative_id,
            firstSeenAt: row.first_seen_at === null ? null : new Date(row.first_seen_at),
            firstRepliedAt: row.first_replied_at === null ? null : new Date(row.first_replied_at),
            warmAt: row.warm_at === null ? null : new Date(row.warm_at),
            hotAt: row.hot_at === null ? null : new Date(row.hot_at),
            attributionMethod: row.attribution_method,
            attributionConfidence: row.attribution_confidence,
        }));
    }
}
