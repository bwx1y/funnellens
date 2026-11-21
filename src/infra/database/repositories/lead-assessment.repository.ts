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
}
