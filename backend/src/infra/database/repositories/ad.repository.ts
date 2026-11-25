import {DatabaseRepository} from "./base.repository";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {eq, sql} from "drizzle-orm";

export interface AdAtTimeResult {
    ad: (typeof AdEntity.$inferSelect);
    /** `false` when the ad's creative was not live at `at` (changed after attribution). */
    timeMatched: boolean;
}

interface AdAtTimeRow {
    id: string;
    account_id: string;
    campaign_id: string;
    adset_id: string;
    creative_id: string | null;
    name: string;
    status: string | null;
    effective_status: string | null;
    created_time: Date | string | null;
    updated_time: Date | string | null;
    raw: unknown;
    time_matched: boolean;
}

export class AdRepository extends DatabaseRepository {
    async upsertBatch(ads: (typeof AdEntity.$inferInsert)[]): Promise<void> {
        if (ads.length === 0) return;

        await this.database.insert(AdEntity)
            .values(ads)
            .onConflictDoUpdate({
                target: AdEntity.id,
                set: {
                    name: AdEntity.name,
                    campaignId: AdEntity.campaignId,
                    adsetId: AdEntity.adsetId,
                    creativeId: AdEntity.creativeId,
                    status: AdEntity.status,
                    effectiveStatus: AdEntity.effectiveStatus,
                    createdTime: AdEntity.createdTime,
                    updatedTime: AdEntity.updatedTime,
                    raw: AdEntity.raw,
                },
            });
    }

    async findByAdSetId(adsetId: string): Promise<(typeof AdEntity.$inferSelect)[]> {
        return this.database.select()
            .from(AdEntity)
            .where(eq(AdEntity.adsetId, adsetId))
            .orderBy(AdEntity.name);
    }

    /**
     * The ad row plus whether its creative was live at `at`. When the creative changed after `at` the
     * same row is returned with `timeMatched: false`; the caller marks `leads.attribution_note` instead
     * of a second lookup.
     */
    async findAtTime(accountId: string, adId: string, at: Date): Promise<AdAtTimeResult | null> {
        const [row] = await this.database.execute(sql`
            select a.*,
                   (c.created_time is not null
                    and c.created_time <= ${at.toISOString()}::timestamptz
                    and (c.updated_time is null or c.updated_time >= ${at.toISOString()}::timestamptz)) as time_matched
            from ads a
            left join ad_creatives c on c.id = a.creative_id
            where a.id = ${adId}
              and a.account_id = ${accountId}
            limit 1
        `) as unknown as AdAtTimeRow[];

        if (row === undefined) return null;

        return {
            ad: {
                id: row.id,
                accountId: row.account_id,
                campaignId: row.campaign_id,
                adsetId: row.adset_id,
                creativeId: row.creative_id,
                name: row.name,
                status: row.status,
                effectiveStatus: row.effective_status,
                createdTime: row.created_time === null ? null : new Date(row.created_time),
                updatedTime: row.updated_time === null ? null : new Date(row.updated_time),
                raw: row.raw as (typeof AdEntity.$inferSelect)["raw"],
            },
            timeMatched: row.time_matched === true,
        };
    }
}
