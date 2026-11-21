import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {LeadRepository} from "@db/repositories/lead.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {CreativeTagEntity} from "@db/schema/ads/creative-tag.entity";
import {JwtUtil} from "@shared/jwt";
import {BadRequestError, NotFoundError} from "@shared/errors";
import type {IMetaAdStudiesAdapter} from "@infra/meta/base.meta";
import {CreativeService} from "@/modules/creative/service";
import {and, eq} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

const SINCE = "2026-03-01";
const UNTIL = "2026-03-12";

describe("Creative intelligence", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const insightRepo = new AdInsightDailyRepository();
    const creativeRepo = new AdCreativeRepository();
    const leadRepo = new LeadRepository();
    const assessmentRepo = new LeadAssessmentRepository();
    const syncRunRepo = new SyncRunRepository();
    const service = new CreativeService();

    const u = Date.now().toString();
    const accountId = `act_cr_${u}`;
    const otherAccountId = `act_cr_other_${u}`;
    const campaignId = `camp_cr_${u}`;
    const adsetWa = `adset_wa_${u}`;
    const adsetWeb = `adset_web_${u}`;
    const adsetPaused = `adset_paused_${u}`;

    const cr1 = `cr1_${u}`;
    const crf = `crf_${u}`;
    const cr3 = `cr3_${u}`;
    const cr4 = `cr4_${u}`;
    const cr5 = `cr5_${u}`;
    const cr6 = `cr6_${u}`;
    const cr7 = `cr7_${u}`;
    const crw = `crw_${u}`;
    const otherCreative = `cr_other_${u}`;

    let tenantId: string;
    let otherTenantId: string;
    let snapshotId = 0;
    let otherSnapshotId = 0;

    const insight = (values: {
        adId: string;
        adsetId: string;
        date: string;
        impressions: number;
        clicks: number;
        spendMinor: number;
        reach: number;
        action: "lead" | "purchase";
        count: number;
        valueMinor?: number;
    }) => ({
        accountId,
        level: "ad" as const,
        entityId: values.adId,
        campaignId,
        adsetId: values.adsetId,
        adId: values.adId,
        date: values.date,
        attributionWindow: "7d_click",
        currency: "IDR",
        currencyOffset: 100,
        spendMinor: values.spendMinor,
        impressions: values.impressions,
        clicks: values.clicks,
        inlineLinkClicks: values.clicks,
        reach: values.reach,
        actions: [{
            actionType: values.action,
            count: String(values.count),
            valueMinor: values.valueMinor ?? null,
            costPerActionMinor: null,
        }],
    });

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `creative-test-${u}`});
        tenantId = tenant.id;
        const otherTenant = await tenantRepo.create({name: `creative-other-${u}`});
        otherTenantId = otherTenant.id;

        await db.insert(AdAccountEntity).values([
            {
                id: accountId,
                tenantId,
                name: `Creative Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: otherAccountId,
                tenantId: otherTenantId,
                name: `Creative Other Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
        ]);
        await db.insert(CampaignEntity).values({id: campaignId, accountId, name: `Creative Campaign ${u}`, status: "ACTIVE"});
        await db.insert(AdSetEntity).values([
            {id: adsetWa, accountId, campaignId, name: `WA ${u}`, objectiveGroup: "wa", dailyBudgetMinor: 1000000, effectiveStatus: "ACTIVE"},
            {id: adsetWeb, accountId, campaignId, name: `Web ${u}`, objectiveGroup: "web", dailyBudgetMinor: 200000, effectiveStatus: "ACTIVE"},
            {id: adsetPaused, accountId, campaignId, name: `Paused ${u}`, objectiveGroup: "wa", dailyBudgetMinor: 1000000, effectiveStatus: "PAUSED"},
        ]);
        await db.insert(AdCreativeEntity).values([
            {id: cr1, accountId, name: "Kreatif 1", title: "Promo", body: "Promo harga Rp 50.000, chat sekarang", callToActionType: "WHATSAPP_MESSAGE"},
            {id: crf, accountId, name: "Kreatif Fatique", body: "Harga Rp 20.000"},
            {id: cr3, accountId, name: "Kreatif 3", body: "Garansi resmi, hubungi kami"},
            {id: cr4, accountId, name: "Kreatif 4", body: "Untuk ibu rumah tangga"},
            {id: cr5, accountId, name: "Kreatif 5"},
            {id: cr6, accountId, name: "Kreatif 6", body: "Diskon terbatas hari ini, order sekarang"},
            {id: cr7, accountId, name: "Kreatif 7", body: "Solusi ampuh untuk kulit"},
            {id: crw, accountId, name: "Kreatif Web", body: "Beli sekarang"},
            {id: otherCreative, accountId: otherAccountId, name: `Other Creative ${u}`, body: "Beli sekarang"},
        ]);

        const ads: {id: string; creativeId: string; adsetId: string}[] = [
            {id: `ad1a_${u}`, creativeId: cr1, adsetId: adsetWa},
            {id: `ad1b_${u}`, creativeId: cr1, adsetId: adsetWa},
            {id: `ad1c_${u}`, creativeId: cr1, adsetId: adsetWa},
            {id: `adf_${u}`, creativeId: crf, adsetId: adsetWa},
            {id: `ad3_${u}`, creativeId: cr3, adsetId: adsetWa},
            {id: `ad4_${u}`, creativeId: cr4, adsetId: adsetWa},
            {id: `ad5_${u}`, creativeId: cr5, adsetId: adsetPaused},
            {id: `ad6_${u}`, creativeId: cr6, adsetId: adsetWa},
            {id: `ad7_${u}`, creativeId: cr7, adsetId: adsetWa},
            {id: `adw_${u}`, creativeId: crw, adsetId: adsetWeb},
        ];
        await db.insert(AdEntity).values(ads.map((ad) => ({
            id: ad.id,
            accountId,
            campaignId,
            adsetId: ad.adsetId,
            creativeId: ad.creativeId,
            name: ad.id,
        })));

        const adId = (prefix: string) => `${prefix}_${u}`;

        await insightRepo.upsertBatch([
            insight({adId: adId("ad1a"), adsetId: adsetWa, date: "2026-03-01", impressions: 1000, clicks: 30, spendMinor: 30000, reach: 500, action: "lead", count: 5}),
            insight({adId: adId("ad1b"), adsetId: adsetWa, date: "2026-03-01", impressions: 1000, clicks: 20, spendMinor: 20000, reach: 500, action: "lead", count: 5}),
            insight({adId: adId("ad1c"), adsetId: adsetWa, date: "2026-03-01", impressions: 1000, clicks: 10, spendMinor: 10000, reach: 500, action: "lead", count: 4}),
            insight({adId: adId("ad3"), adsetId: adsetWa, date: "2026-03-01", impressions: 2000, clicks: 60, spendMinor: 50000, reach: 1000, action: "lead", count: 10}),
            insight({adId: adId("ad4"), adsetId: adsetWa, date: "2026-03-01", impressions: 2000, clicks: 20, spendMinor: 80000, reach: 1000, action: "lead", count: 10}),
            insight({adId: adId("ad5"), adsetId: adsetPaused, date: "2026-03-01", impressions: 2000, clicks: 100, spendMinor: 30000, reach: 1000, action: "lead", count: 10}),
            insight({adId: adId("ad6"), adsetId: adsetWa, date: "2026-03-01", impressions: 2000, clicks: 30, spendMinor: 60000, reach: 1000, action: "lead", count: 10}),
            insight({adId: adId("ad7"), adsetId: adsetWa, date: "2026-03-01", impressions: 2000, clicks: 50, spendMinor: 70000, reach: 1000, action: "lead", count: 10}),
            insight({adId: adId("adw"), adsetId: adsetWeb, date: "2026-03-01", impressions: 2000, clicks: 40, spendMinor: 100000, reach: 1000, action: "purchase", count: 10, valueMinor: 200000}),
        ]);

        const fatigueRows = [
            ...Array.from({length: 7}, (_, index) => ({
                date: `2026-03-0${index + 1}`,
                clicks: 270,
                spendMinor: 100000,
                reach: 5000,
            })),
            {date: "2026-03-08", clicks: 240, spendMinor: 120000, reach: 4500},
            {date: "2026-03-09", clicks: 210, spendMinor: 130000, reach: 4300},
            {date: "2026-03-10", clicks: 190, spendMinor: 150000, reach: 4000},
            {date: "2026-03-11", clicks: 190, spendMinor: 150000, reach: 4000},
            {date: "2026-03-12", clicks: 190, spendMinor: 150000, reach: 4000},
        ];

        await insightRepo.upsertBatch(fatigueRows.map((row) => insight({
            adId: adId("adf"),
            adsetId: adsetWa,
            date: row.date,
            impressions: 10000,
            clicks: row.clicks,
            spendMinor: row.spendMinor,
            reach: row.reach,
            action: "lead",
            count: 10,
        })));

        const lead = (values: {
            externalId: string;
            creativeId: string;
            temperature: "HOT" | "WARM";
            withAssessment: boolean;
        }) => leadRepo.upsert({
            accountId,
            externalId: values.externalId,
            name: values.externalId,
            phoneMasked: `+62812****${values.externalId}`,
            campaignId,
            creativeId: values.creativeId,
            temperature: values.temperature,
            stage: "CHAT_STARTED",
            firstSeenAt: new Date("2026-03-01T02:00:00.000Z"),
        }).then(async (entity) => {
            if (values.withAssessment) {
                await assessmentRepo.appendIfCurrent({
                    leadId: entity.id,
                    level: values.temperature,
                    confidence: "sedang",
                    eventAt: new Date("2026-03-01T02:05:00.000Z"),
                    ruleVersion: "creative-test-r1",
                });
            }
            return entity;
        });

        await Promise.all(Array.from({length: 12}, (_, index) => lead({
            externalId: `cr1l${index}`,
            creativeId: cr1,
            temperature: index < 3 ? "HOT" : "WARM",
            withAssessment: true,
        })));
        await Promise.all(Array.from({length: 3}, (_, index) => lead({
            externalId: `cr3l${index}`,
            creativeId: cr3,
            temperature: index === 0 ? "HOT" : "WARM",
            withAssessment: true,
        })));

        const tags: Record<string, string[]> = {
            [cr1]: ["hook_type:question", "format:video"],
            [cr6]: ["hook_type:question", "format:video"],
            [cr3]: ["format:video"],
            [cr5]: ["format:video"],
        };
        for (const [creativeId, entries] of Object.entries(tags)) {
            await creativeRepo.upsertTags(creativeId, entries.map((entry) => {
                const [tagType, tagValue] = entry.split(":");
                return {tagType, tagValue, source: "manual", confidence: null};
            }));
        }

        const run = await syncRunRepo.create({
            accountId,
            resource: "insights",
            rangeSince: SINCE,
            rangeUntil: UNTIL,
        });
        await syncRunRepo.complete(run.id, 1);
        snapshotId = run.id;

        const otherRun = await syncRunRepo.create({
            accountId: otherAccountId,
            resource: "insights",
            rangeSince: SINCE,
            rangeUntil: UNTIL,
        });
        await syncRunRepo.complete(otherRun.id, 1);
        otherSnapshotId = otherRun.id;
    });

    afterAll(async () => {
        await cleanupRepo.cleanup(tenantId);
        await cleanupRepo.cleanup(otherTenantId);
    });

    const range = {accountId, since: SINCE, until: UNTIL};

    it("ranks creatives with four gated dimensions and a status", async () => {
        const response = await service.listCreatives(tenantId, range);

        expect(response.creatives.length).toBe(8);
        expect(response.sortBy).toBe("spend");
        expect(response.sample).toEqual({n: 8, denominator: 5, eligible: true, gate: "≥ 5 kreatif"});

        const row = response.creatives.find((entry) => entry.creativeId === cr1);
        expect(row).toBeDefined();
        expect(row).toMatchObject({
            spendMinor: 60000,
            results: 14,
            ctr: 0.02,
            costPerResultMinor: 4286,
            objectiveGroup: "wa",
            mature: true,
        });
        expect(row?.dimensions.cost).toEqual({label: "kuat", certainty: "indikatif"});
        expect(row?.dimensions.attention.label).toBe("rata-rata");
        expect(row?.status).toBe("Pantau");

        const fatigued = response.creatives.find((entry) => entry.creativeId === crf);
        expect(fatigued?.fatigued).toBe(true);
        expect(fatigued?.status).toBe("Pertimbangkan dihentikan");
        expect(response.creatives[0].creativeId).toBe(crf);

        const paused = response.creatives.find((entry) => entry.creativeId === cr5);
        expect(paused?.allocationLimited).toBe(true);
        expect(response.creatives.find((entry) => entry.creativeId === cr1)?.allocationLimited).toBe(false);
    });

    it("sorts creatives by the requested key", async () => {
        const response = await service.listCreatives(tenantId, {...range, sortBy: "costPerResult"});

        expect(response.sortBy).toBe("costPerResult");
        expect(response.creatives[0].costPerResultMinor).toBe(3000);
        expect(response.creatives[0].creativeId).toBe(cr5);
    });

    it("returns creative detail with daily points and a video note", async () => {
        const detail = await service.getCreativeDetail(tenantId, cr1, range);

        expect(detail.metrics.ctr).toBe(0.02);
        expect(detail.metrics.costPerResultMinor).toBe(4286);
        expect(detail.daily.length).toBe(1);
        expect(detail.sample).toEqual({
            n: 3000,
            denominator: 3000,
            eligible: true,
            gate: "≥ 3.000 tayangan",
        });
        expect(detail.video.hookRate).toBeNull();
        expect(detail.note).toContain("Metrik video belum tersedia");

        await expect(service.getCreativeDetail(tenantId, otherCreative, range))
            .rejects.toThrow(new NotFoundError("Kreatif tidak ditemukan"));
    });

    it("detects fatigue only with a complete window and no confounder", async () => {
        const response = await service.getFatigue(tenantId, range);

        const row = response.creatives.find((entry) => entry.creativeId === crf);
        expect(row).toMatchObject({
            status: "Jenuh",
            drop: 0.2963,
            frequency: {base: 2, now: 2.5},
            consecutiveDays: 5,
            complete: true,
            confounded: false,
            nextCheck: "2026-03-13",
        });

        const thin = response.creatives.find((entry) => entry.creativeId === cr1);
        expect(thin?.status).toBe("Belum cukup data");
        expect(thin?.note).toBe("Rentang pengamatan belum lengkap sehingga kejenuhan belum bisa dinilai.");
    });

    it("tests tag patterns with Mann-Whitney and Benjamini-Hochberg", async () => {
        const response = await service.getPatterns(tenantId, range);

        const hook = response.attributes.find((row) => row.tagType === "hook_type" && row.tagValue === "question");
        expect(hook).toMatchObject({state: "insufficient_sample", withCount: 2, pValue: null});

        const format = response.attributes.find((row) => row.tagType === "format" && row.tagValue === "video");
        expect(format?.state).not.toBe("insufficient_sample");
        expect(format?.withCount).toBe(4);
        expect(format?.withoutCount).toBe(4);
        expect(format?.pValue).not.toBeNull();

        expect(response.sample).toEqual({n: 8, denominator: 8, eligible: true, gate: "≥ 8 kreatif"});
        expect(response.tested).toBeGreaterThanOrEqual(1);
        expect(response.note).toBeUndefined();
    });

    it("reads lead quality and content completeness per creative", async () => {
        const response = await service.getLeadQuality(tenantId, range);

        const row = response.rows.find((entry) => entry.creativeId === cr1);
        expect(row).toMatchObject({
            costPerConversationMinor: 4286,
            hotLeads: 3,
            assessedMatureLeads: 12,
            hotRate: 0.25,
            completeness: 0.5714,
            messageEvidence: {present: 4, assessed: 7, expected: 7},
        });
        expect(row?.contentElements.cta).toBe("hadir");
        expect(row?.contentElements.target).toBe("absen");
        expect(row?.sample).toEqual({n: 12, denominator: 10, eligible: true, gate: "≥ 10 lead matang"});

        const blank = response.rows.find((entry) => entry.creativeId === cr5);
        expect(blank?.completeness).toBeNull();
        expect(blank?.messageEvidence).toEqual({present: 0, assessed: 0, expected: 7});
        expect(blank?.note).toBe("Elemen konten kreatif tidak teramati.");

        const thin = response.rows.find((entry) => entry.creativeId === cr3);
        expect(thin?.hotRate).toBeNull();
        expect(thin?.note).toBe("Lead matang belum mencapai 10 sehingga hot rate belum diukur.");
    });

    it("compares creatives from one snapshot per goal", async () => {
        const tabs = await service.compareCreatives(tenantId, {accountId, snapshotId, creativeIds: [cr1, crw]});

        expect(tabs.map((tab) => tab.goal)).toEqual(["wa", "web"]);
        expect(tabs[0].items.length).toBe(1);
        expect(tabs[0].canCompare).toBe(false);
        expect(tabs[1].items.length).toBe(1);
        expect(tabs[1].canCompare).toBe(false);
        expect(tabs[0].evidenceType).toBe("observational");
        expect(tabs[0].snapshotId).toBe(snapshotId);

        const sameGoal = await service.compareCreatives(tenantId, {accountId, snapshotId, creativeIds: [cr1, cr3]});
        expect(sameGoal.length).toBe(1);
        expect(sameGoal[0].goal).toBe("wa");
        expect(sameGoal[0].items.length).toBe(2);
        expect(sameGoal[0].canCompare).toBe(true);
    });

    it("rejects a snapshot of another account or a creative without insights", async () => {
        await expect(service.compareCreatives(tenantId, {
            accountId,
            snapshotId: otherSnapshotId,
            creativeIds: [cr1],
        })).rejects.toThrow(new BadRequestError("Pilihan kreatif tidak tersedia pada snapshot ini"));

        await expect(service.compareCreatives(tenantId, {
            accountId,
            snapshotId,
            creativeIds: [cr1, `missing_${u}`],
        })).rejects.toThrow(new BadRequestError("Pilihan kreatif tidak tersedia pada snapshot ini"));
    });

    it("reports Meta A/B study availability per state", async () => {
        const missing = await service.getExperiments(tenantId, {accountId});
        expect(missing).toMatchObject({
            state: "permission_missing",
            hasAccess: false,
            studyCount: 0,
            note: "Koneksi Meta belum tersedia.",
        });

        const withStudies = new CreativeService(
            undefined,
            undefined,
            undefined,
            {
                findByTenantId: async () => ({accessToken: "token", metaUserId: "meta-user"}),
            } as never,
            {
                getAdStudies: async () => ({
                    hasAccess: true,
                    studies: [{
                        id: "study-1",
                        name: "Studi A",
                        type: "SPLIT_TEST",
                        startTime: null,
                        endTime: null,
                        resultsFirstAvailableDate: "2026-03-09",
                    }],
                }),
            } as IMetaAdStudiesAdapter,
            undefined
        );

        const available = await withStudies.getExperiments(tenantId, {accountId});
        expect(available.state).toBe("results_available");
        expect(available.studies[0].hasResult).toBe(true);
        expect(available.note).toBeUndefined();

        const denied = new CreativeService(
            undefined,
            undefined,
            undefined,
            {
                findByTenantId: async () => ({accessToken: "token", metaUserId: "meta-user"}),
            } as never,
            {
                getAdStudies: async () => ({hasAccess: false, studies: []}),
            } as IMetaAdStudiesAdapter,
            undefined
        );

        const blocked = await denied.getExperiments(tenantId, {accountId});
        expect(blocked.state).toBe("permission_missing");
        expect(blocked.note).toBe("Izin Meta belum mencakup ad studies.");
    });

    it("adds, removes, and queues tags with tenant scoping", async () => {
        const created = await service.addTag(tenantId, cr7, {tagType: "tone", tagValue: "santai"});
        expect(created).toEqual({
            creativeId: cr7,
            tagType: "tone",
            tagValue: "santai",
            source: "manual",
            confidence: null,
        });

        const [tag] = await db.select()
            .from(CreativeTagEntity)
            .where(and(eq(CreativeTagEntity.creativeId, cr7), eq(CreativeTagEntity.tagValue, "santai")));
        expect(tag.source).toBe("manual");

        expect(await service.removeTag(tenantId, cr7, tag.id)).toEqual({deleted: true});
        await expect(service.removeTag(tenantId, cr7, tag.id))
            .rejects.toThrow(new NotFoundError("Tag tidak ditemukan"));

        await expect(service.addTag(tenantId, otherCreative, {tagType: "tone", tagValue: "santai"}))
            .rejects.toThrow(new NotFoundError("Kreatif tidak ditemukan"));

        expect(await service.queueAiTags(tenantId, cr7)).toEqual({jobId: `tag:${cr7}:ai`, queued: true});
    });

    it("serves every creative route and keeps static paths ahead of the id path", async () => {
        const jwt = new JwtUtil();
        const token = await jwt.register({id: "user-creative", tenant: tenantId, role: "ADMIN"});
        const headers = {authorization: `Bearer ${token.key}`};
        const query = `accountId=${accountId}&since=${SINCE}&until=${UNTIL}`;

        for (const path of [
            `/api/analytics/creatives?${query}`,
            `/api/analytics/creatives/fatigue?${query}`,
            `/api/analytics/creatives/patterns?${query}`,
            `/api/analytics/creatives/lead-quality?${query}`,
            `/api/analytics/creatives/experiments?accountId=${accountId}`,
            `/api/analytics/creatives/${cr1}?${query}`,
        ]) {
            const response = await app.handle(new Request(`http://localhost${path}`, {headers}));
            expect(response.status).toBe(200);
        }

        const fatigue = await app.handle(new Request(
            `http://localhost/api/analytics/creatives/fatigue?${query}`,
            {headers}
        ));
        expect(Object.keys(await fatigue.json() as object).sort()).toEqual(["creatives", "period", "sample"]);

        const comparison = await app.handle(new Request(
            "http://localhost/api/analytics/creatives/comparisons",
            {
                method: "POST",
                headers: {...headers, "content-type": "application/json"},
                body: JSON.stringify({accountId, snapshotId, creativeIds: [cr1, crw]}),
            }
        ));
        expect(comparison.status).toBe(200);

        const tagged = await app.handle(new Request(
            `http://localhost/api/analytics/creatives/${cr7}/tags`,
            {
                method: "POST",
                headers: {...headers, "content-type": "application/json"},
                body: JSON.stringify({tagType: "format", tagValue: "image"}),
            }
        ));
        expect(tagged.status).toBe(200);

        const queued = await app.handle(new Request(
            `http://localhost/api/analytics/creatives/${cr7}/tags/ai`,
            {method: "POST", headers}
        ));
        expect(queued.status).toBe(200);

        const [createdTag] = await db.select()
            .from(CreativeTagEntity)
            .where(and(eq(CreativeTagEntity.creativeId, cr7), eq(CreativeTagEntity.tagValue, "image")));

        const removed = await app.handle(new Request(
            `http://localhost/api/analytics/creatives/${cr7}/tags/${createdTag.id}`,
            {method: "DELETE", headers}
        ));
        expect(removed.status).toBe(200);
    });

    it("keeps another tenant's account out of scope", async () => {
        const jwt = new JwtUtil();
        const token = await jwt.register({id: "user-creative", tenant: tenantId, role: "ADMIN"});

        const response = await app.handle(new Request(
            `http://localhost/api/analytics/creatives?accountId=${otherAccountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({status: false, message: "Akun iklan tidak ditemukan"});
    });
});
