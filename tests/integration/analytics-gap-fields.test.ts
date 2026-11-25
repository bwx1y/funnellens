import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {InsightAlertRepository} from "@db/repositories/insight-alert.repository";
import {LeadRepository, type Lead} from "@db/repositories/lead.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {CreativeTagEntity} from "@db/schema/ads/creative-tag.entity";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";
import {LeadAssessmentEntity} from "@db/schema/wa/lead-assessment.entity";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import {JwtUtil} from "@shared/jwt";
import type {AIMessage} from "@infra/ai/types";
import {LeadAssessmentService, type AssessmentModel} from "@/modules/audience/assess.service";
import type {LeadAssessmentQueue} from "@/modules/audience/queue";
import {DECISION_SCHEMA, SIGNAL_SCHEMA, type Decision, type Signal} from "@/modules/audience/constants";
import {AlertEvaluateService} from "@/modules/alerts/evaluate.service";
import {CreativeService} from "@/modules/creative/service";
import {ExplanationService} from "@/modules/explanations/service";
import {resolvePeriod, type ResolvedPeriod} from "@shared/period";
import {and, eq} from "drizzle-orm";
import {readData} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

interface KpiCard {
    value: number | null;
    applicable: boolean;
    note?: string;
}

interface SummaryResponse {
    cards: {spend: KpiCard; leads: KpiCard; clicks: KpiCard; cplQualified: KpiCard; roas: KpiCard};
}

interface TrackingHealthResponse {
    dataFreshness: {eventName: string; lastSeenAt: string | null; hoursOld: number | null; stale: boolean}[];
    warnings: {code: string; level: string; message: string; route: string | null}[];
}

const u = Date.now().toString();
const SINCE = "2026-06-01";
const UNTIL = "2026-06-07";
const CLIENTS = "onsite_conversion.messaging_conversation_started_7d";

const cleanupRepo = new TestCleanupRepository();
const tenantRepo = new TenantRepository();
const insightRepo = new AdInsightDailyRepository();

function insight(values: {
    accountId: string;
    campaignId: string;
    adsetId: string;
    adId: string;
    date?: string;
    spendMinor: number;
    impressions?: number;
    clicks?: number;
    reach?: number;
    actionType: string;
    count: number;
    valueMinor?: number;
}) {
    return {
        accountId: values.accountId,
        level: "ad" as const,
        entityId: values.adId,
        campaignId: values.campaignId,
        adsetId: values.adsetId,
        adId: values.adId,
        date: values.date ?? SINCE,
        attributionWindow: "7d_click",
        currency: "IDR",
        currencyOffset: 100,
        spendMinor: values.spendMinor,
        impressions: values.impressions ?? 1000,
        clicks: values.clicks ?? 50,
        inlineLinkClicks: values.clicks ?? 50,
        reach: values.reach ?? 800,
        actions: [{
            actionType: values.actionType,
            count: String(values.count),
            valueMinor: values.valueMinor ?? null,
            costPerActionMinor: null,
        }],
    };
}

describe("Channel-aware summary cards", () => {
    const accountId = `act_chan_${u}`;
    const webCampaignId = `camp_web_${u}`;
    const waCampaignId = `camp_wa_${u}`;
    const webCreativeId = `cr_web_${u}`;
    const waCreativeId = `cr_wa_${u}`;
    const webAdId = `ad_web_${u}`;
    const waAdId = `ad_wa_${u}`;

    let tenantId: string;
    let token: {key: string};

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `channel-${u}`});
        tenantId = tenant.id;
        const [user] = await db.insert(UserEntity).values({
            fullName: "Channel Admin",
            email: `channel-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        }).returning({id: UserEntity.id});

        token = await new JwtUtil().register({id: user.id, tenant: tenantId, role: "ADMIN"});

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Channel Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
        await db.insert(CampaignEntity).values([
            {id: webCampaignId, accountId, name: `Web Campaign ${u}`, status: "ACTIVE"},
            {id: waCampaignId, accountId, name: `Wa Campaign ${u}`, status: "ACTIVE"},
        ]);
        await db.insert(AdSetEntity).values([
            {id: `adset_web_${u}`, accountId, campaignId: webCampaignId, name: "Web Set", objectiveGroup: "web"},
            {id: `adset_wa_${u}`, accountId, campaignId: waCampaignId, name: "Wa Set", objectiveGroup: "wa"},
        ]);
        await db.insert(AdCreativeEntity).values([
            {id: webCreativeId, accountId, name: `Web Creative ${u}`},
            {id: waCreativeId, accountId, name: `Wa Creative ${u}`},
        ]);
        await db.insert(AdEntity).values([
            {id: webAdId, accountId, campaignId: webCampaignId, adsetId: `adset_web_${u}`, creativeId: webCreativeId, name: "Web Ad"},
            {id: waAdId, accountId, campaignId: waCampaignId, adsetId: `adset_wa_${u}`, creativeId: waCreativeId, name: "Wa Ad"},
        ]);

        await insightRepo.upsertBatch([
            insight({
                accountId, campaignId: webCampaignId, adsetId: `adset_web_${u}`, adId: webAdId,
                spendMinor: 100_000, actionType: "purchase", count: 10, valueMinor: 400_000,
            }),
            insight({
                accountId, campaignId: waCampaignId, adsetId: `adset_wa_${u}`, adId: waAdId,
                spendMinor: 50_000, actionType: CLIENTS, count: 20,
            }),
        ]);
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    const summary = async (campaignId?: string): Promise<SummaryResponse> => {
        const query = campaignId === undefined ? "" : `&campaignId=${campaignId}`;
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/summary?accountId=${accountId}&since=${SINCE}&until=${UNTIL}${query}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));
        expect(response.status).toBe(200);

        return await readData<SummaryResponse>(response);
    };

    it("marks the conversation card inapplicable on a web-only campaign", async () => {
        const body = await summary(webCampaignId);

        expect(body.cards.leads.applicable).toBe(false);
        expect(body.cards.leads.value).toBeNull();
        expect(body.cards.roas.applicable).toBe(true);
        expect(body.cards.roas.value).toBe(4);
    });

    it("refuses to compare cost per result across two channels", async () => {
        const body = await summary();

        expect(body.cards.cplQualified.applicable).toBe(false);
        expect(body.cards.cplQualified.value).toBeNull();
        expect(body.cards.cplQualified.note).toBe("Biaya per hasil tidak sebanding lintas channel.");
        expect(body.cards.leads.applicable).toBe(true);
        expect(body.cards.spend.applicable).toBe(true);
    });
});

describe("Tracking warnings and data freshness", () => {
    const accountId = `act_fresh_${u}`;
    let tenantId: string;
    let token: {key: string};

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `fresh-${u}`});
        tenantId = tenant.id;
        const inserted = await db.insert(UserEntity).values({
            fullName: "Fresh Admin",
            email: `fresh-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        }).returning({id: UserEntity.id});
        token = await new JwtUtil().register({id: inserted[0].id, tenant: tenantId, role: "ADMIN"});

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Fresh Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("names every missing key event and marks fresh data stale", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/tracking-health?accountId=${accountId}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));
        expect(response.status).toBe(200);

        const body = await readData<TrackingHealthResponse>(response);
        expect(Array.isArray(body.warnings)).toBe(true);
        expect(body.warnings.some((warning) => warning.code === "PIXEL_EVENT_MISSING")).toBe(true);
        expect(body.warnings.some((warning) => warning.code === "ATTRIBUTION_FRESHNESS")).toBe(true);

        const lead = body.dataFreshness.find((entry) => entry.eventName === "Lead");
        expect(lead).toEqual({eventName: "Lead", lastSeenAt: null, hoursOld: null, stale: true});
    });
});

describe("Conversation reconciliation alert", () => {
    const accountId = `act_recon_${u}`;
    const campaignId = `camp_recon_${u}`;
    const adsetId = `adset_recon_${u}`;
    const creativeId = `cr_recon_${u}`;
    const adId = `ad_recon_${u}`;

    let tenantId: string;

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `recon-${u}`});
        tenantId = tenant.id;

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Recon Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
        await db.insert(CampaignEntity).values({id: campaignId, accountId, name: `Recon Campaign ${u}`, status: "ACTIVE"});
        await db.insert(AdSetEntity).values({id: adsetId, accountId, campaignId, name: "Recon Set", objectiveGroup: "wa"});
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: `Recon Creative ${u}`});
        await db.insert(AdEntity).values({id: adId, accountId, campaignId, adsetId, creativeId, name: "Recon Ad"});

        // Meta counted 100 conversations on the day.
        await insightRepo.upsertBatch([insight({
            accountId, campaignId, adsetId, adId,
            spendMinor: 200_000, actionType: CLIENTS, count: 100,
        })]);

        // Our inbox only ever recorded 70 of them.
        const [lead] = await db.insert(LeadEntity).values({
            accountId,
            externalId: `recon-lead-${u}`,
            name: "Recon Lead",
            stage: "CHAT_STARTED",
            firstSeenAt: new Date(`${SINCE}T02:00:00.000Z`),
        }).returning();

        // One Cloud API conversation id per chat: 70 chats, all from the same lead row.
        await db.insert(ConversationMessageEntity).values(
            Array.from({length: 70}, (_, index) => ({
                leadId: lead.id,
                conversationId: crypto.randomUUID(),
                wamid: `wamid_recon_${index}_${u}`,
                direction: "INBOUND" as const,
                senderRole: "LEAD",
                sentAt: new Date(`${SINCE}T03:00:00.000Z`),
            }))
        );
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("raises a WARNING carrying both counts and the gap", async () => {
        const service = new AlertEvaluateService();
        const period: ResolvedPeriod = resolvePeriod({timezoneName: "Asia/Jakarta"}, {since: SINCE, until: UNTIL});
        await service.run(tenantId, accountId, period);

        const [alert] = await db.select()
            .from(InsightAlertEntity)
            .where(and(
                eq(InsightAlertEntity.accountId, accountId),
                eq(InsightAlertEntity.ruleKey, "conversation_reconciliation")
            ));

        expect(alert).toBeDefined();
        expect(alert.level).toBe("WARNING");
        expect(alert.status).toBe("ACTIVE");
        expect(alert.evidence).toMatchObject({metaConversations: 100, observedConversations: 70, difference: 30});
        expect(alert.impactCaption).toContain("30");

        // The same rule closes itself once the condition is gone (the next run keeps nothing).
        const closed = await new InsightAlertRepository().resolveByRuleKey(
            accountId,
            "conversation_reconciliation",
            ["tidak-ada"]
        );
        expect(closed).toBe(1);
    });
});

describe("Assessment fields", () => {
    const accountId = `act_fields_${u}`;
    const campaignId = `camp_fields_${u}`;
    const adsetId = `adset_fields_${u}`;
    const creativeId = `cr_fields_${u}`;
    const adId = `ad_fields_${u}`;
    const inboundWamid = `wamid_fields_${u}`;
    const secondWamid = `wamid_fields_two_${u}`;

    const leadRepo = new LeadRepository();
    let tenantId: string;
    let lead: Lead;
    let inboundId: number;

    /** Level 1 answers signals, level 2 pops the next scripted decision. */
    const fakeModel = (decisions: Decision[]): AssessmentModel => {
        let index = 0;
        return {
            async generateObject<T>(_messages: AIMessage[], schema?: Record<string, any>) {
                if (schema === SIGNAL_SCHEMA) {
                    const signals: Signal[] = [];
                    return {data: {signals} as T, provider: "fake", model: "fake-gemini"};
                }
                expect(schema).toBe(DECISION_SCHEMA);
                const next = decisions[index++];
                if (next === undefined) throw new Error("scripted decision missing");

                return {data: next as T, provider: "fake", model: "fake-gemini"};
            },
        };
    };

    const serviceFor = (model: AssessmentModel) => {
        const queue = {add: async () => ({})} as unknown as LeadAssessmentQueue;
        return new LeadAssessmentService(
            undefined, undefined, undefined, undefined, undefined, queue,
            {model, apiKeys: ["test-key"]}
        );
    };

    const decision = (overrides: Partial<Decision>): Decision => ({
        level: "WARM",
        confidence: "sedang",
        reason: "Menanyakan harga dan stok",
        evidenceWamid: inboundWamid,
        responseType: "Tanya lanjut",
        sentiment: "positif",
        topic: "harga dan stok",
        quote: "masih ada stok?",
        ...overrides,
    });

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `fields-${u}`});
        tenantId = tenant.id;

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Fields Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
        await db.insert(CampaignEntity).values({id: campaignId, accountId, name: "Fields Campaign"});
        await db.insert(AdSetEntity).values({id: adsetId, accountId, campaignId, name: "Fields Set", objectiveGroup: "wa"});
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: "Fields Creative"});
        await db.insert(AdEntity).values({id: adId, accountId, campaignId, adsetId, creativeId, name: "Fields Ad"});

        lead = await leadRepo.upsert({
            accountId,
            externalId: `fields-lead-${u}`,
            name: "Lead Fields",
            stage: "CHAT_STARTED",
            firstSeenAt: new Date("2026-07-01T02:00:00.000Z"),
        });

        const [inbound] = await db.insert(ConversationMessageEntity).values({
            leadId: lead.id,
            wamid: inboundWamid,
            direction: "INBOUND",
            senderRole: "LEAD",
            body: "Halo, masih ada stok? harganya berapa?",
            sentAt: new Date("2026-07-01T02:00:00.000Z"),
        }).returning({id: ConversationMessageEntity.id});
        inboundId = inbound.id;

        // The CS reply five minutes later is what `reply_minutes` measures.
        await db.insert(ConversationMessageEntity).values({
            leadId: lead.id,
            wamid: `wamid_fields_reply_${u}`,
            direction: "OUTBOUND",
            senderRole: "CS",
            body: "Masih ada kak",
            sentAt: new Date("2026-07-01T02:05:00.000Z"),
            contextWamid: inboundWamid,
        });
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("stores topic, response type, mood, quote, reply minutes, and no prior level", async () => {
        const service = serviceFor(fakeModel([decision({})]));
        await service.assess({leadId: lead.id, messageId: inboundId});

        const [stored] = await db.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, lead.id));

        expect(stored).toMatchObject({
            topic: "harga dan stok",
            responseType: "Tanya lanjut",
            mood: "positif",
            quote: "masih ada stok?",
            replyMinutes: 5,
            priorLevel: null,
            applied: true,
        });
    });

    it("records the previous applied level as prior_level on the next assessment", async () => {
        const [second] = await db.insert(ConversationMessageEntity).values({
            leadId: lead.id,
            wamid: secondWamid,
            direction: "INBOUND",
            senderRole: "LEAD",
            body: "Oke saya ambil 10 pcs, kirim invoice",
            sentAt: new Date("2026-07-01T03:00:00.000Z"),
        }).returning({id: ConversationMessageEntity.id});

        // No reply after this message, so `reply_minutes` stays null instead of guessing.
        const service = serviceFor(fakeModel([decision({
            level: "HOT",
            confidence: "tinggi",
            evidenceWamid: secondWamid,
            responseType: "Komitmen",
            topic: "pemesanan",
            quote: "saya ambil 10 pcs",
        })]));
        await service.assess({leadId: lead.id, messageId: second.id});

        const rows = await db.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, lead.id));

        const second_ = rows.find((row) => row.eventAt.getTime() === new Date("2026-07-01T03:00:00.000Z").getTime());
        expect(second_).toMatchObject({priorLevel: "WARM", level: "HOT", replyMinutes: null, topic: "pemesanan"});
    });

    it("stores null for mood outside enum and still saves assessment", async () => {
        const thirdWamid = `wamid_fields_three_${u}`;
        const [third] = await db.insert(ConversationMessageEntity).values({
            leadId: lead.id,
            wamid: thirdWamid,
            direction: "INBOUND",
            senderRole: "LEAD",
            body: "Baik kak ditunggu",
            sentAt: new Date("2026-07-01T04:00:00.000Z"),
        }).returning({id: ConversationMessageEntity.id});

        const service = serviceFor(fakeModel([decision({
            level: "HOT",
            confidence: "tinggi",
            evidenceWamid: thirdWamid,
            sentiment: "marah" as any,
            topic: "followup",
        })]));
        await service.assess({leadId: lead.id, messageId: third.id});

        const rows = await db.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, lead.id));

        const third_ = rows.find((row) => row.eventAt.getTime() === new Date("2026-07-01T04:00:00.000Z").getTime());
        expect(third_).toBeDefined();
        expect(third_?.mood).toBeNull();
        expect(third_?.topic).toBe("followup");
    });
});

describe("Creative KPI block and pattern support", () => {
    const accountId = `act_ckpi_${u}`;
    const campaignOne = `camp_kpi_a_${u}`;
    const campaignTwo = `camp_kpi_b_${u}`;
    const service = new CreativeService();

    let tenantId: string;

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `creative-kpi-${u}`});
        tenantId = tenant.id;

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Creative KPI Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
        await db.insert(CampaignEntity).values([
            {id: campaignOne, accountId, name: `KPI One ${u}`, status: "ACTIVE"},
            {id: campaignTwo, accountId, name: `KPI Two ${u}`, status: "ACTIVE"},
        ]);
        await db.insert(AdSetEntity).values([
            {id: `adset_kpi_a_${u}`, accountId, campaignId: campaignOne, name: "A", objectiveGroup: "wa"},
            {id: `adset_kpi_b_${u}`, accountId, campaignId: campaignTwo, name: "B", objectiveGroup: "wa"},
        ]);

        const creatives = [
            {id: `cr1_${u}`, campaign: campaignOne, adset: `adset_kpi_a_${u}`, spend: 40_000, count: 4},
            {id: `cr2_${u}`, campaign: campaignOne, adset: `adset_kpi_a_${u}`, spend: 20_000, count: 2},
            {id: `cr3_${u}`, campaign: campaignTwo, adset: `adset_kpi_b_${u}`, spend: 30_000, count: 3},
            {id: `cr4_${u}`, campaign: campaignTwo, adset: `adset_kpi_b_${u}`, spend: 10_000, count: 1},
        ];

        await db.insert(AdCreativeEntity).values(creatives.map((creative) => ({
            id: creative.id,
            accountId,
            name: creative.id,
            body: "Promo hari ini, chat sekarang",
        })));

        const ads = creatives.map((creative, index) => ({
            id: `ad_kpi_${index}_${u}`,
            accountId,
            campaignId: creative.campaign,
            adsetId: creative.adset,
            creativeId: creative.id,
        }));
        await db.insert(AdEntity).values(ads.map((ad) => ({...ad, name: ad.id})));

        await insightRepo.upsertBatch(creatives.map((creative, index) => insight({
            accountId,
            campaignId: creative.campaign,
            adsetId: creative.adset,
            adId: ads[index].id,
            spendMinor: creative.spend,
            actionType: CLIENTS,
            count: creative.count,
        })));

        // Two creatives on one side only: below PATTERN_MIN_PER_SIDE.
        await db.insert(CreativeTagEntity).values([
            {creativeId: creatives[0].id, tagType: "hook_type", tagValue: "question", source: "manual"},
            {creativeId: creatives[1].id, tagType: "hook_type", tagValue: "question", source: "manual"},
            {creativeId: creatives[2].id, tagType: "format", tagValue: "video", source: "manual"},
            {creativeId: creatives[3].id, tagType: "format", tagValue: "video", source: "manual"},
        ]);
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("sums the cohort into a KPI block, campaign shares, and a capped trend", async () => {
        const body = await service.listCreatives(tenantId, {accountId, since: SINCE, until: UNTIL});

        expect(body.kpi.count).toBe(4);
        expect(body.kpi.spendMinor).toBe(100_000);
        expect(body.kpi.conversations).toBe(10);
        expect(body.kpi.purchases).toBeNull();

        const shareSum = body.campaignSummary.reduce((sum, row) => sum + (row.spendShare ?? 0), 0);
        expect(Math.abs(shareSum - 1)).toBeLessThan(0.001);
        expect(body.campaignSummary.length).toBe(2);

        expect(body.trend.length).toBeLessThanOrEqual(30);
        expect(body.trend.every((point) => typeof point.spendMinor === "number")).toBe(true);
    });

    it("refuses to call a two-per-side pattern eligible", async () => {
        const body = await service.getPatterns(tenantId, {accountId, since: SINCE, until: UNTIL});
        const question = body.attributes.find((row) => row.tagValue === "question");

        expect(question?.withCount).toBe(2);
        expect(question?.supported).toBe(false);
        expect(question?.state).toBe("insufficient_sample");
        expect(question?.medianYesMinor).toBe(question?.withMedianCostPerResultMinor ?? null);

        for (const row of body.attributes) {
            expect(row.clear).toBe(row.supported && row.consistent);
            if (row.state === "eligible_for_test") expect(row.clear).toBe(true);
        }
    });
});

describe("Simulated narration", () => {
    const accountId = `act_sim_${u}`;
    const explanations = new ExplanationService();
    let tenantId: string;

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `simulated-${u}`});
        tenantId = tenant.id;
        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Sim Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("flags narration as simulated and exposes its cache age", async () => {
        const ref = await explanations.ensure({
            tenantId,
            accountId,
            context: "summary",
            entityType: "account",
            entityId: accountId,
            filter: {since: SINCE, until: UNTIL},
            snapshotId: `${SINCE}..${UNTIL}-${u}`,
            facts: {spend: "1.000", leads: "10", roas: "4,00"},
            evidenceIds: [],
        });

        expect(ref.simulated).toBe(true);

        const detail = await explanations.get(ref.id, tenantId);
        expect(detail.simulated).toBe(true);
        expect(detail.cachedAt).toBe(detail.createdAt);
        expect(new Date(detail.cachedAt).toString()).not.toBe("Invalid Date");
    });
});
