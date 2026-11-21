import {DatabaseRepository} from "./base.repository";
import {LeadMilestoneEntity} from "@db/schema/wa/lead-milestone.entity";

export type LeadMilestone = typeof LeadMilestoneEntity.$inferSelect;

/**
 * First-observation log per temperature level: the first call wins and later calls are no-ops,
 * so `first_at` is the moment the lead first reached that level, not the latest one.
 */
export class LeadMilestoneRepository extends DatabaseRepository {
    async recordFirst(leadId: number, level: "COLD" | "WARM" | "HOT", firstAt: Date): Promise<void> {
        await this.database.insert(LeadMilestoneEntity)
            .values({leadId, level, firstAt})
            .onConflictDoNothing({
                target: [LeadMilestoneEntity.leadId, LeadMilestoneEntity.level],
            });
    }
}
