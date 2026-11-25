import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdInsightBreakdownRepository} from "@db/repositories/ad-insight-breakdown.repository";
import {LeadRepository, type Lead} from "@db/repositories/lead.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {LeadMilestoneRepository} from "@db/repositories/lead-milestone.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";
import {LeadAssessmentEntity} from "@db/schema/wa/lead-assessment.entity";
import {JwtUtil} from "@shared/jwt";
import {and, eq} from "drizzle-orm";
import {AudienceService} from "@/modules/audience/service";
import {readData, readError} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

const SINCE = "2026-03-01";
const UNTIL = "2026-03-01";

describe("Audience intelligence", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const breakdownRepo = new AdInsightBreakdownRepository();
    const leadRepo = new LeadRepository();
    const assessmentRepo = new LeadAssessmentRepository();
    const milestoneRepo = new LeadMilestoneRepository();
    const service = new AudienceService();

    const u = Date.now().toString();
    const accountId = `act_aud_${u}`;
    const medianAccountId = `act_aud_median_${u}`;
    const otherAccountId = `act_aud_other_${u}`;
    const campaignId = `camp_aud_${u}`;
    const medianCampaignId = `camp_median_${u}`;
    const adsetId = `adset_aud_${u}`;
    const creativeId = `cr_aud_${u}`;
    const ad1 = `ad1_aud_${u}`;
    const ad2 = `ad2_aud_${u}`;
    const ad3 = `ad3_aud_${u}`;
    const ad4 = `ad4_aud_${u}`;

    let tenantId: string;
    let otherTenantId: string;
    let l1: Lead;
    let l3: Lead;
    let l7: Lead;
    let l8: Lead;

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `audience-test-${u}`});
        tenantId = tenant.id;
        const otherTenant = await tenantRepo.create({name: `audience-other-${u}`});
        otherTenantId = otherTenant.id;

        await db.insert(AdAccountEntity).values([
            {
                id: accountId,
                tenantId,
                name: `Audience Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: medianAccountId,
                tenantId,
                name: `Audience Median Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: otherAccountId,
                tenantId: otherTenantId,
                name: `Audience Other Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
        ]);
        await db.insert(CampaignEntity).values([
            {id: campaignId, accountId, name: `Audience Campaign ${u}`, status: "ACTIVE"},
            {id: medianCampaignId, accountId: medianAccountId, name: `Median Campaign ${u}`, status: "ACTIVE"},
        ]);
        await db.insert(AdSetEntity).values({
            id: adsetId,
            accountId,
            campaignId,
            name: `Audience AdSet ${u}`,
            objectiveGroup: "wa",
        });
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: `Audience Creative ${u}`});
        await db.insert(AdEntity).values([
            {id: ad1, accountId, campaignId, adsetId, creativeId, name: `Audience Ad 1 ${u}`},
            {id: ad2, accountId, campaignId, adsetId, creativeId, name: `Audience Ad 2 ${u}`},
            {id: ad3, accountId, campaignId, adsetId, creativeId, name: `Audience Ad 3 ${u}`},
            {id: ad4, accountId, campaignId, adsetId, creativeId, name: `Audience Ad 4 ${u}`},
        ]);

        const breakdownRow = (
            ad: string,
            hash: string,
            values: {
                publisherPlatform?: string;
                platformPosition?: string;
                impressionDevice?: string;
                hourOfDay?: number;
                spendMinor: number;
                impressions: number;
            }
        ) => ({
            accountId,
            level: "ad" as const,
            entityId: ad,
            campaignId,
            adsetId,
            adId: ad,
            date: SINCE,
            attributionWindow: "7d_click",
            breakdownHash: hash,
            clicks: 0,
            inlineLinkClicks: 0,
            ...values,
        });

        await breakdownRepo.upsertBatch([
            breakdownRow(ad1, "h1", {
                publisherPlatform: "facebook",
                platformPosition: "feed",
                impressionDevice: "iphone",
                spendMinor: 60000,
                impressions: 600,
            }),
            breakdownRow(ad2, "h2", {
                publisherPlatform: "instagram",
                platformPosition: "reels",
                impressionDevice: "android",
                spendMinor: 40000,
                impressions: 400,
            }),
            breakdownRow(ad3, "h3", {
                publisherPlatform: "instagram",
                platformPosition: "reels",
                impressionDevice: "iphone",
                spendMinor: 20000,
                impressions: 200,
            }),
            breakdownRow(ad4, "h4", {
                publisherPlatform: "facebook",
                platformPosition: "feed",
                impressionDevice: "android",
                spendMinor: 0,
                impressions: 0,
            }),
            breakdownRow(ad4, "h5", {
                publisherPlatform: "messenger",
                platformPosition: "story",
                impressionDevice: "android",
                spendMinor: 0,
                impressions: 0,
            }),
            breakdownRow(ad1, "h6", {hourOfDay: 9, spendMinor: 30000, impressions: 300}),
            breakdownRow(ad1, "h7", {hourOfDay: 14, spendMinor: 20000, impressions: 200}),
        ]);

        const lead = (values: {
            externalId: string;
            name: string;
            adId?: string;
            campaignId?: string;
            temperature?: "COLD" | "WARM" | "HOT";
            firstSeenAt: string;
            firstRepliedAt?: string;
        }): Promise<Lead> => leadRepo.upsert({
            accountId,
            externalId: values.externalId,
            name: values.name,
            phoneMasked: `+62812****${values.externalId}`,
            campaignId: values.campaignId,
            adId: values.adId,
            creativeId: values.adId === undefined ? undefined : creativeId,
            temperature: values.temperature,
            stage: "CHAT_STARTED",
            firstSeenAt: new Date(values.firstSeenAt),
            firstRepliedAt: values.firstRepliedAt === undefined ? null : new Date(values.firstRepliedAt),
        });

        l1 = await lead({
            externalId: "l1",
            name: "Lead 1",
            adId: ad1,
            campaignId,
            temperature: "HOT",
            firstSeenAt: "2026-03-01T02:00:00.000Z",
            firstRepliedAt: "2026-03-01T02:10:00.000Z",
        });
        const l2 = await lead({
            externalId: "l2",
            name: "Lead 2",
            adId: ad1,
            campaignId,
            temperature: "HOT",
            firstSeenAt: "2026-03-01T02:30:00.000Z",
            firstRepliedAt: "2026-03-01T03:00:00.000Z",
        });
        l3 = await lead({
            externalId: "l3",
            name: "Lead 3",
            adId: ad1,
            campaignId,
            temperature: "WARM",
            firstSeenAt: "2026-03-01T03:00:00.000Z",
        });
        const l4 = await lead({
            externalId: "l4",
            name: "Lead 4",
            adId: ad2,
            campaignId,
            temperature: "COLD",
            firstSeenAt: "2026-03-01T07:00:00.000Z",
            firstRepliedAt: "2026-03-01T07:05:00.000Z",
        });
        const l5 = await lead({
            externalId: "l5",
            name: "Lead 5",
            adId: ad3,
            campaignId,
            temperature: "HOT",
            firstSeenAt: "2026-03-01T08:00:00.000Z",
            firstRepliedAt: "2026-03-01T10:00:00.000Z",
        });
        const l6 = await lead({
            externalId: "l6",
            name: "Lead 6",
            adId: ad3,
            campaignId,
            temperature: "WARM",
            firstSeenAt: "2026-03-01T09:00:00.000Z",
        });
        l7 = await lead({
            externalId: "l7",
            name: "Lead 7",
            temperature: "WARM",
            firstSeenAt: "2026-03-01T10:00:00.000Z",
        });
        l8 = await lead({
            externalId: "l8",
            name: "Lead 8",
            firstSeenAt: "2026-03-01T11:00:00.000Z",
        });

        await db.insert(ConversationMessageEntity).values([
            {
                leadId: l1.id,
                wamid: `w-${u}-1`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T02:00:00.000Z"),
                pairMethod: "sequence",
                responseSeconds: 600,
                responseType: "Komitmen",
                sentiment: "positif",
            },
            {
                leadId: l2.id,
                wamid: `w-${u}-2`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T02:30:00.000Z"),
                pairMethod: "sequence",
                responseSeconds: 1800,
                responseType: "Tanya lanjut",
                sentiment: "netral",
            },
            {
                leadId: l3.id,
                wamid: `w-${u}-3`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T03:00:00.000Z"),
                pairMethod: "sequence",
                responseSeconds: null,
                responseType: null,
                sentiment: null,
            },
            {
                leadId: l4.id,
                wamid: `w-${u}-4`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T07:00:00.000Z"),
                pairMethod: "sequence",
                responseSeconds: 300,
                responseType: "Tanya lanjut",
                sentiment: "netral",
            },
            {
                leadId: l5.id,
                wamid: `w-${u}-5a`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T07:30:00.000Z"),
                pairMethod: "sequence",
                responseSeconds: 3600,
                responseType: "Tanya lanjut",
                sentiment: "netral",
            },
            {
                leadId: l5.id,
                wamid: `w-${u}-5b`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T08:00:00.000Z"),
                pairMethod: "sequence",
                responseSeconds: 7200,
                responseType: "Menolak",
                sentiment: "negatif",
            },
            {
                leadId: l6.id,
                wamid: `w-${u}-6`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T09:00:00.000Z"),
                pairMethod: "sequence",
                responseSeconds: 14400,
                responseType: "Menunda",
                sentiment: "netral",
            },
        ]);

        const evidence = (wamid: string, responseType: string, sentiment: string) =>
            ({wamid, responseType, sentiment});

        await assessmentRepo.appendIfCurrent({
            leadId: l1.id,
            level: "WARM",
            confidence: "sedang",
            eventAt: new Date("2026-03-01T02:05:00.000Z"),
            ruleVersion: "a2-v1",
            evidence: evidence("w1", "Pengakuan netral", "netral"),
        });
        await assessmentRepo.appendIfCurrent({
            leadId: l1.id,
            level: "HOT",
            confidence: "tinggi",
            reason: "Siap order",
            eventAt: new Date("2026-03-01T02:10:00.000Z"),
            ruleVersion: "a2-v1",
            evidence: evidence("w2", "Komitmen", "positif"),
        });
        await assessmentRepo.appendIfCurrent({
            leadId: l2.id,
            level: "HOT",
            confidence: "tinggi",
            eventAt: new Date("2026-03-01T02:30:00.000Z"),
            ruleVersion: "a2-v1",
            evidence: evidence("w3", "Tanya lanjut", "netral"),
        });
        await assessmentRepo.appendIfCurrent({
            leadId: l4.id,
            level: "WARM",
            confidence: "sedang",
            eventAt: new Date("2026-03-01T06:59:00.000Z"),
            ruleVersion: "a2-v1",
            evidence: evidence("w4a", "Pengakuan netral", "netral"),
        });
        await assessmentRepo.appendIfCurrent({
            leadId: l4.id,
            level: "COLD",
            confidence: "rendah",
            eventAt: new Date("2026-03-01T07:00:00.000Z"),
            ruleVersion: "a2-v1",
            evidence: evidence("w4", "Menolak", "negatif"),
        });

        await milestoneRepo.recordFirst(l1.id, "WARM", new Date("2026-03-01T02:05:00.000Z"));
        await milestoneRepo.recordFirst(l1.id, "HOT", new Date("2026-03-01T02:10:00.000Z"));
        await milestoneRepo.recordFirst(l2.id, "HOT", new Date("2026-03-01T02:30:00.000Z"));
        await milestoneRepo.recordFirst(l5.id, "HOT", new Date("2026-03-01T08:00:00.000Z"));

        const medianLeads = await Promise.all([
            leadRepo.upsert({
                accountId: medianAccountId,
                externalId: "m1",
                campaignId: medianCampaignId,
                name: "Median 1",
                temperature: "HOT",
                stage: "CHAT_STARTED",
                firstSeenAt: new Date("2026-03-01T01:00:00.000Z"),
                firstRepliedAt: new Date("2026-03-01T01:10:00.000Z"),
            }),
            leadRepo.upsert({
                accountId: medianAccountId,
                externalId: "m2",
                campaignId: medianCampaignId,
                name: "Median 2",
                temperature: "WARM",
                stage: "CHAT_STARTED",
                firstSeenAt: new Date("2026-03-01T02:00:00.000Z"),
                firstRepliedAt: new Date("2026-03-01T02:30:00.000Z"),
            }),
            leadRepo.upsert({
                accountId: medianAccountId,
                externalId: "m3",
                campaignId: medianCampaignId,
                name: "Median 3",
                temperature: "WARM",
                stage: "CHAT_STARTED",
                firstSeenAt: new Date("2026-03-01T03:00:00.000Z"),
                firstRepliedAt: null,
            }),
            leadRepo.upsert({
                accountId: medianAccountId,
                externalId: "m4",
                campaignId: medianCampaignId,
                name: "Median 4",
                stage: "CHAT_STARTED",
                firstSeenAt: new Date("2026-03-01T04:00:00.000Z"),
                firstRepliedAt: null,
            }),
        ]);

        await db.insert(ConversationMessageEntity).values([
            {
                leadId: medianLeads[0].id,
                wamid: `wm-${u}-1`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T01:00:00.000Z"),
                responseSeconds: 600,
                responseType: "Komitmen",
                sentiment: "positif",
            },
            {
                leadId: medianLeads[1].id,
                wamid: `wm-${u}-2`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T02:00:00.000Z"),
                responseSeconds: 1800,
                responseType: "Tanya lanjut",
                sentiment: "netral",
            },
            {
                leadId: medianLeads[2].id,
                wamid: `wm-${u}-3`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T03:00:00.000Z"),
                responseSeconds: null,
            },
            {
                leadId: medianLeads[3].id,
                wamid: `wm-${u}-4`,
                direction: "INBOUND",
                sentAt: new Date("2026-03-01T04:00:00.000Z"),
                responseSeconds: null,
            },
        ]);
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
        if (otherTenantId !== undefined) await cleanupRepo.cleanup(otherTenantId);
    });

    it("splits the audience by temperature with deltas and cohort flow", async () => {
        const result = await service.getAudience(tenantId, {accountId, since: SINCE, until: UNTIL});

        expect(result.distribution).toEqual([
            {temperature: "hot", count: 3, share: 0.4286, delta: 3, deltaPp: null},
            {temperature: "warm", count: 3, share: 0.4286, delta: 3, deltaPp: null},
            {temperature: "cold", count: 1, share: 0.1429, delta: 1, deltaPp: null},
        ]);
        expect(result.total).toBe(7);
        expect(result.unassessed).toBe(1);
        expect(result.sankey.nodes).toEqual(["COLD", "WARM", "HOT"]);
        expect(result.sankey.links).toEqual([
            {from: "WARM", to: "COLD", value: 1},
            {from: "WARM", to: "HOT", value: 1},
        ]);
        expect(result.campaigns[0]).toEqual({
            campaignId,
            name: `Audience Campaign ${u}`,
            leads: 6,
            hotLeads: 3,
            hotLeadRate: 0.5,
        });
        expect(result.sample).toEqual({n: 7, denominator: 30, eligible: false, gate: "≥ 30 lead"});
        expect(result.note).toBe("1 lead belum dinilai sehingga tidak masuk distribusi.");
        expect(result.period).toEqual({
            since: SINCE,
            until: UNTIL,
            days: 1,
            label: "1–1 Mar 2026",
            isPartial: false,
        });
        expect(result.previousPeriod).toEqual({
            since: "2026-02-28",
            until: "2026-02-28",
            label: "28–28 Feb 2026",
        });
    });

    it("reports first-reply speed, response buckets, and the gated heatmap", async () => {
        const result = await service.getSpeed(tenantId, {accountId, since: SINCE, until: UNTIL});

        expect(result.avgFirstReplySeconds).toBe(2475);
        expect(result.longestWaitMinutes).toBe(120);
        expect(result.stuckLeads).toBe(4);
        expect(result.buckets).toEqual([
            {label: "< 15 menit", count: 2},
            {label: "15–60 menit", count: 1},
            {label: "1–4 jam", count: 1},
            {label: "> 4 jam", count: 1},
        ]);
        expect(result.cohortHeatmap).toBeNull();
        expect(result.heatmapNote).toBe("Setiap bucket butuh ≥ 10 lead; bucket terkecil berisi 1 lead.");
        expect(result.sample).toEqual({
            n: 1,
            denominator: 10,
            eligible: false,
            gate: "≥ 10 lead per bucket",
        });
        expect(result.note).toBeUndefined();
    });

    it("segments placements, devices, and hours with attribution guards", async () => {
        const result = await service.getSegments(tenantId, {accountId, since: SINCE, until: UNTIL});

        const placement = (platform: string, position: string) => result.placements.find(
            (row) => row.publisherPlatform === platform && row.platformPosition === position
        );

        expect(placement("facebook", "feed")).toEqual({
            publisherPlatform: "facebook",
            platformPosition: "feed",
            spendMinor: 60000,
            leads: 3,
            hotLeads: null,
            hotRate: null,
            costPerHotLeadMinor: null,
            note: "atribusi placement tidak tunggal",
        });
        expect(placement("instagram", "reels")).toEqual({
            publisherPlatform: "instagram",
            platformPosition: "reels",
            spendMinor: 60000,
            leads: 3,
            hotLeads: 1,
            hotRate: 0.3333,
            costPerHotLeadMinor: 60000,
        });
        expect(placement("messenger", "story")).toEqual({
            publisherPlatform: "messenger",
            platformPosition: "story",
            spendMinor: 0,
            leads: 0,
            hotLeads: null,
            hotRate: null,
            costPerHotLeadMinor: null,
            note: "atribusi placement tidak tunggal",
        });

        const device = (name: string) => result.devices.find((row) => row.impressionDevice === name);
        expect(device("iphone")).toEqual({impressionDevice: "iphone", spendMinor: 80000, leads: 5});
        expect(device("android")).toEqual({impressionDevice: "android", spendMinor: 40000, leads: 1});

        expect(result.hours.length).toBe(24);
        expect(result.hours[9]).toEqual({hour: 9, spendMinor: 30000, leads: 2});
        expect(result.hours[14]).toEqual({hour: 14, spendMinor: 20000, leads: 1});
        expect(result.hours[0]).toEqual({hour: 0, spendMinor: 0, leads: 0});

        expect(result.unattributedLeads).toBe(2);
        expect(result.note).toBe("2 lead tanpa atribusi iklan tidak masuk baris placement/device.");
        expect(result.sample).toEqual({
            n: 1200,
            denominator: 100,
            eligible: true,
            gate: "≥ 100 tayangan",
        });
    });

    it("lists the latest applied assessment per lead", async () => {
        const result = await service.getPipeline(tenantId, {accountId, since: SINCE, until: UNTIL});

        expect(result.rows.length).toBe(3);
        const row = result.rows.find((entry) => entry.leadId === l1.id);
        expect(row).toEqual({
            leadId: l1.id,
            name: "Lead 1",
            phoneMasked: "+62812****l1",
            level: "HOT",
            confidence: "tinggi",
            reason: "Siap order",
            evidenceWamid: "w2",
            stage: "CHAT_STARTED",
            adId: ad1,
            creativeId,
            firstSeenAt: "2026-03-01T02:00:00.000Z",
            firstRepliedAt: "2026-03-01T02:10:00.000Z",
            milestoneAt: {
                warm: "2026-03-01T02:05:00.000Z",
                hot: "2026-03-01T02:10:00.000Z",
            },
            // Leads inserted straight into the table carry no attribution evidence.
            attribution: {method: null, confidence: null},
            explanation: {
                id: expect.any(String),
                context: "lead_detail",
                state: "PENDING",
                source: null,
                text: null,
                simulated: expect.any(Boolean),
                evidenceIds: ["w2"],
                snapshotId: `${SINCE}..${UNTIL}`,
            },
        });

        const second = result.rows.find((entry) => entry.level === "HOT" && entry.leadId !== l1.id);
        expect(second?.milestoneAt.warm).toBeNull();
        expect(result.rows.some((entry) => entry.leadId === l7.id)).toBe(false);
        expect(result.sample).toEqual({n: 3, denominator: 30, eligible: false, gate: "≥ 30 lead"});
    });

    it("filters pipeline rows by q without changing the lane counts", async () => {
        const all = await service.getPipeline(tenantId, {accountId, since: SINCE, until: UNTIL});
        const filtered = await service.getPipeline(tenantId, {
            accountId,
            since: SINCE,
            until: UNTIL,
            q: "lead 1",
        });

        expect(all.lanes.map((lane) => [lane.level, lane.count])).toEqual([["HOT", 2], ["COLD", 1]]);
        expect(filtered.lanes.length).toBe(1);
        expect(filtered.lanes[0].level).toBe("HOT");
        expect(filtered.lanes[0].count).toBe(2);
        expect(filtered.lanes[0].rows.map((row) => row.leadId)).toEqual([l1.id]);
        expect(filtered.rows.map((row) => row.leadId)).toEqual([l1.id]);
        expect(filtered.sample.n).toBe(1);
    });

    it("counts last classified answers, timed insights, and sentiment", async () => {
        const result = await service.getConversations(tenantId, {accountId, since: SINCE, until: UNTIL});

        expect(result.counts).toEqual([
            {responseType: "Komitmen", count: 1},
            {responseType: "Tanya lanjut", count: 2},
            {responseType: "Keberatan", count: 0},
            {responseType: "Menunda", count: 1},
            {responseType: "Menolak", count: 1},
            {responseType: "Pengakuan netral", count: 0},
            {responseType: "Di luar topik", count: 0},
        ]);
        expect(result.classifiedLeads).toBe(5);
        expect(result.sentiment).toEqual({positif: 1, netral: 3, negatif: 1});
        expect(result.timed).toEqual({medianSeconds: 1800, measuredLeads: 5, observedLeads: 6});
        expect(result.sample).toEqual({n: 5, denominator: 30, eligible: false, gate: "≥ 30 chat"});
        expect(result.note).toBe("Sampel terklasifikasi belum mencapai 30 chat.");
    });

    it("computes the median reply time from the first measured response per lead", async () => {
        const result = await service.getConversations(
            tenantId,
            {accountId: medianAccountId, since: SINCE, until: UNTIL}
        );

        expect(result.timed).toEqual({medianSeconds: 1200, measuredLeads: 2, observedLeads: 4});
    });

    it("lists leads with campaign names, confidence, and waiting minutes", async () => {
        const hot = await service.listLeads(tenantId, {accountId, temperature: "HOT"});

        expect(hot.total).toBe(3);
        expect(hot.items.every((row) => row.campaignName === `Audience Campaign ${u}`)).toBe(true);
        expect(hot.items.some((row) => row.confidence === "tinggi")).toBe(true);
        expect(hot.items.every((row) => row.waitingMinutes === null)).toBe(true);

        const all = await service.listLeads(tenantId, {accountId, pageSize: "15"});
        expect(all.total).toBe(8);
        expect(all.items.find((row) => row.id === l3.id)?.waitingMinutes).toBeGreaterThan(0);
        expect(all.items.find((row) => row.id === l1.id)?.waitingMinutes).toBeNull();
        const unassessed = all.items.find((row) => row.id === l8.id);
        expect(unassessed?.temperature).toBeNull();
        expect(unassessed?.confidence).toBeNull();
        expect(unassessed?.campaignName).toBeNull();
    });

    it("paginates the lead list with pageSize, clamped pages, and period counts", async () => {
        const first = await service.listLeads(tenantId, {accountId, pageSize: "5", since: SINCE, until: UNTIL});

        expect(first.page).toBe(1);
        expect(first.pageSize).toBe(5);
        expect(first.total).toBe(8);
        expect(first.pages).toBe(2);
        expect(first.items.length).toBe(5);
        expect(first.counts).toEqual({cold: 1, warm: 3, hot: 3, total: 7});
        expect(first.counts.cold + first.counts.warm + first.counts.hot).toBe(first.counts.total);

        const clamped = await service.listLeads(tenantId, {
            accountId,
            pageSize: "5",
            page: "9",
            since: SINCE,
            until: UNTIL,
        });
        expect(clamped.page).toBe(2);
        expect(clamped.items.length).toBe(3);

        // `search` narrows the page, never the level counts.
        const searched = await service.listLeads(tenantId, {
            accountId,
            search: "Lead 1",
            since: SINCE,
            until: UNTIL,
        });
        expect(searched.total).toBe(1);
        expect(searched.counts.total).toBe(7);

        const legacy = await service.listLeads(tenantId, {accountId, limit: "5"});
        expect(legacy.pageSize).toBe(5);
    });

    it("sorts by temperature with null levels last", async () => {
        const result = await service.listLeads(tenantId, {
            accountId,
            pageSize: "15",
            sortBy: "temperature",
            dir: "asc",
        });

        expect(result.items.map((row) => row.temperature)).toEqual([
            "COLD", "WARM", "WARM", "WARM", "HOT", "HOT", "HOT", null,
        ]);
        expect(result.items[result.items.length - 1].id).toBe(l8.id);
    });

    it("rejects a page size outside the allowed set with 400", async () => {
        const token = await new JwtUtil().register({id: "user-audience", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/leads?accountId=${accountId}&page_size=7`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(400);
        expect(await readError(response)).toEqual({
            code: "INVALID_PAGE_SIZE",
            message: "page_size tidak valid",
            details: null,
        });
    });

    it("appends a manual assessment when the temperature changes", async () => {
        const patched = await service.updateLead(tenantId, l3.id, {temperature: "HOT"});

        expect(patched.temperature).toBe("HOT");
        expect(patched.manualAssessmentId).not.toBeNull();

        const hot = await service.listLeads(tenantId, {accountId, temperature: "HOT"});
        expect(hot.total).toBe(4);

        const manual = await db.select()
            .from(LeadAssessmentEntity)
            .where(and(
                eq(LeadAssessmentEntity.leadId, l3.id),
                eq(LeadAssessmentEntity.ruleVersion, "manual-r1")
            ));
        expect(manual.length).toBe(1);
        expect(manual[0].confidence).toBe("tinggi");
        expect(manual[0].reason).toBe("Diubah manual oleh pengguna");
        expect(manual[0].applied).toBe(true);

        const staged = await service.updateLead(tenantId, l3.id, {stage: "CLOSED"});
        expect(staged.stage).toBe("CLOSED");
        expect(staged.manualAssessmentId).toBeNull();
    });

    it("serves the audience and lead routes for the authenticated tenant", async () => {
        const token = await new JwtUtil().register({id: "user-audience", tenant: tenantId, role: "ADMIN"});
        const headers = {authorization: `Bearer ${token.key}`};
        const query = `accountId=${accountId}&since=${SINCE}&until=${UNTIL}`;

        for (const path of [
            "audience",
            "audience/speed",
            "audience/segments",
            "audience/pipeline",
            "audience/conversations",
        ]) {
            const response = await app.handle(new Request(
                `http://localhost/api/analytics/${path}?${query}`,
                {headers}
            ));
            expect(response.status).toBe(200);
        }

        const pipelineResponse = await app.handle(new Request(
            `http://localhost/api/analytics/audience/pipeline?${query}&q=lead`,
            {headers}
        ));
        expect(pipelineResponse.status).toBe(200);
        const pipelineBody = await readData<{
            lanes: {level: string; count: number; rows: unknown[]}[];
        }>(pipelineResponse);
        expect(pipelineBody.lanes.length).toBe(2);
        expect(pipelineBody.lanes.every((lane) => lane.rows.length > 0 && lane.count >= lane.rows.length)).toBe(true);

        const listResponse = await app.handle(new Request(
            `http://localhost/api/leads?accountId=${accountId}&pageSize=15&since=${SINCE}&until=${UNTIL}`,
            {headers}
        ));
        expect(listResponse.status).toBe(200);
        const listBody = await readData<{
            items: unknown[];
            meta: {page_size: number; pages: number};
            counts: {total: number};
        }>(listResponse);
        expect(listBody.meta.page_size).toBe(15);
        expect(listBody.meta.pages).toBe(1);
        expect(listBody.counts.total).toBe(7);

        const patchResponse = await app.handle(new Request(
            `http://localhost/api/leads/${l8.id}`,
            {
                method: "PATCH",
                headers: {...headers, "content-type": "application/json"},
                body: JSON.stringify({stage: "REPLIED"}),
            }
        ));
        expect(patchResponse.status).toBe(200);
        const patchBody = await readData<{stage: string; manualAssessmentId: string | null}>(patchResponse);
        expect(patchBody.stage).toBe("REPLIED");
        expect(patchBody.manualAssessmentId).toBeNull();
    });

    it("hides accounts and leads owned by another tenant", async () => {
        const token = await new JwtUtil().register({id: "user-audience", tenant: tenantId, role: "ADMIN"});
        const otherToken = await new JwtUtil().register({
            id: "user-audience-other",
            tenant: otherTenantId,
            role: "ADMIN",
        });

        const audienceResponse = await app.handle(new Request(
            `http://localhost/api/analytics/audience?accountId=${otherAccountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));
        expect(audienceResponse.status).toBe(404);
        expect(await readError(audienceResponse)).toEqual({
            code: "NOT_FOUND",
            message: "Akun iklan tidak ditemukan",
            details: null,
        });

        const patchResponse = await app.handle(new Request(
            `http://localhost/api/leads/${l1.id}`,
            {
                method: "PATCH",
                headers: {
                    authorization: `Bearer ${otherToken.key}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({temperature: "WARM"}),
            }
        ));
        expect(patchResponse.status).toBe(404);
        expect(await readError(patchResponse)).toEqual({
            code: "NOT_FOUND",
            message: "Lead tidak ditemukan",
            details: null,
        });
    });
});
