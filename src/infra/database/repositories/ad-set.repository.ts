import {DatabaseRepository} from "./base.repository";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {and, eq, inArray, sql} from "drizzle-orm";

export class AdSetRepository extends DatabaseRepository {
    async upsertBatch(adSets: (typeof AdSetEntity.$inferInsert)[]): Promise<void> {
        if (adSets.length === 0) return;

        // `set` entries must reference `excluded.*`: a column reference renders as `"col" = "ad_sets"."col"`,
        // which is a no-op on conflict and would never refresh existing rows.
        await this.database.insert(AdSetEntity)
            .values(adSets)
            .onConflictDoUpdate({
                target: AdSetEntity.id,
                set: {
                    name: sql`excluded.name`,
                    campaignId: sql`excluded.campaign_id`,
                    status: sql`excluded.status`,
                    effectiveStatus: sql`excluded.effective_status`,
                    optimizationGoal: sql`excluded.optimization_goal`,
                    objectiveGroup: sql`excluded.objective_group`,
                    billingEvent: sql`excluded.billing_event`,
                    bidStrategy: sql`excluded.bid_strategy`,
                    bidAmountMinor: sql`excluded.bid_amount_minor`,
                    dailyBudgetMinor: sql`excluded.daily_budget_minor`,
                    lifetimeBudgetMinor: sql`excluded.lifetime_budget_minor`,
                    targeting: sql`excluded.targeting`,
                    startTime: sql`excluded.start_time`,
                    endTime: sql`excluded.end_time`,
                    createdTime: sql`excluded.created_time`,
                    updatedTime: sql`excluded.updated_time`,
                    raw: sql`excluded.raw`,
                },
            });
    }

    async findByCampaignId(campaignId: string): Promise<(typeof AdSetEntity.$inferSelect)[]> {
        return this.database.select()
            .from(AdSetEntity)
            .where(eq(AdSetEntity.campaignId, campaignId))
            .orderBy(AdSetEntity.name);
    }

    /**
     * Whether any ad set of these accounts targets the given channel. This is the scope gate for the
     * WhatsApp source: a tenant whose ad sets are all `web` has no WhatsApp funnel to report on.
     */
    async hasObjectiveGroup(accountIds: string[], objectiveGroup: "wa" | "web"): Promise<boolean> {
        if (accountIds.length === 0) return false;

        const [entity] = await this.database.select({id: AdSetEntity.id})
            .from(AdSetEntity)
            .where(and(
                inArray(AdSetEntity.accountId, accountIds),
                eq(AdSetEntity.objectiveGroup, objectiveGroup)
            ))
            .limit(1);

        return entity !== undefined;
    }
}
