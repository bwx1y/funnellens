import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {LeadRepository} from "@db/repositories/lead.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";
import {JwtUtil} from "@shared/jwt";
import {eq} from "drizzle-orm";
import {AudienceService} from "@/modules/audience/service";
import {SearchService} from "@/modules/search/service";
import {readData, readError} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

describe("Lead detail and global search", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const leadRepo = new LeadRepository();
    const assessmentRepo = new LeadAssessmentRepository();
    const audienceService = new AudienceService();
    const searchService = new SearchService();

    const u = Date.now().toString();
    const accountId = `act_detail_${u}`;
    const otherAccountId = `act_detail_other_${u}`;
    const campaignId = `camp_detail_${u}`;
    const adsetId = `adset_detail_${u}`;
    const creativeId = `cr_detail_${u}`;
    const adId = `ad_detail_${u}`;

    let tenantId: string;
    let otherTenantId: string;
    let leadId: number;
    let chattyLeadId: number;
    let otherLeadId: number;

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `detail-test-${u}`});
        tenantId = tenant.id;
        const otherTenant = await tenantRepo.create({name: `detail-other-${u}`});
        otherTenantId = otherTenant.id;

        await db.insert(AdAccountEntity).values([
            {
                id: accountId,
                tenantId,
                name: `Detail Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: otherAccountId,
                tenantId: otherTenantId,
                name: `Detail Other Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
        ]);
        await db.insert(CampaignEntity).values({
            id: campaignId,
            accountId,
            name: `Detail Campaign ${u}`,
            status: "ACTIVE",
        });
        await db.insert(AdSetEntity).values({
            id: adsetId,
            accountId,
            campaignId,
            name: `Detail AdSet ${u}`,
            objectiveGroup: "wa",
        });
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: `Detail Creative ${u}`});
        await db.insert(AdEntity).values({
            id: adId,
            accountId,
            campaignId,
            adsetId,
            creativeId,
            name: `Detail Ad ${u}`,
        });

        const lead = await leadRepo.upsert({
            accountId,
            externalId: "rani-utama",
            name: "Rani Utami",
            phoneMasked: "+62811****001",
            campaignId,
            adsetId,
            adId,
            creativeId,
            sourcePlatform: "ctwa",
            attributionNote: "Klik iklan 7d_click",
            temperature: "HOT",
            stage: "QUALIFIED",
            sentiment: "positif",
            dealValueMinor: 500000,
            currency: "IDR",
            firstSeenAt: new Date("2026-03-01T10:00:00.000Z"),
            firstRepliedAt: new Date("2026-03-01T10:02:00.000Z"),
        });
        leadId = lead.id;

        await assessmentRepo.applyAssessment({
            leadId,
            level: "WARM",
            confidence: "sedang",
            reason: "Membalas cepat",
            eventAt: new Date("2026-03-01T10:01:00.000Z"),
            ruleVersion: "a2-v1",
        });
        await assessmentRepo.applyAssessment({
            leadId,
            level: "HOT",
            confidence: "tinggi",
            reason: "Tanya harga dan stok",
            eventAt: new Date("2026-03-01T10:05:00.000Z"),
            ruleVersion: "a2-v1",
        });

        await db.insert(ConversationMessageEntity).values([
            {
                leadId,
                wamid: `w-${u}-1`,
                direction: "INBOUND",
                body: "Halo kak",
                sentAt: new Date("2026-03-01T10:00:00.000Z"),
            },
            {
                leadId,
                wamid: `w-${u}-2`,
                direction: "OUTBOUND",
                body: "Hai, ada yang bisa dibantu?",
                sentAt: new Date("2026-03-01T10:01:00.000Z"),
            },
            {
                leadId,
                wamid: `w-${u}-3`,
                contextWamid: `w-${u}-2`,
                direction: "INBOUND",
                body: "Masih ada stok?",
                sentAt: new Date("2026-03-01T10:03:00.000Z"),
                topic: "Harga",
                responseType: "Tanya lanjut",
            },
        ]);

        // Nine matching leads so the search cap of 8 is observable.
        const matching = await Promise.all(
            Array.from({length: 8}, (_, index) => leadRepo.upsert({
                accountId,
                externalId: `rani-${index + 2}`,
                name: `Rani ${index + 2}`,
                phoneMasked: `+62811****00${index + 2}`,
                stage: "CHAT_STARTED",
                firstSeenAt: new Date(`2026-03-02T0${index}:00:00.000Z`),
            }))
        );

        const chatty = await leadRepo.upsert({
            accountId,
            externalId: "chatty",
            name: "Budi Chatty",
            stage: "REPLIED",
            firstSeenAt: new Date("2026-03-03T00:00:00.000Z"),
        });
        chattyLeadId = chatty.id;
        await db.insert(ConversationMessageEntity).values(
            Array.from({length: 51}, (_, index) => ({
                leadId: chattyLeadId,
                wamid: `wc-${u}-${index}`,
                direction: index % 2 === 0 ? "INBOUND" as const : "OUTBOUND" as const,
                body: `Pesan ${index}`,
                sentAt: new Date(Date.UTC(2026, 2, 3, 0, index)),
            }))
        );

        const otherLead = await leadRepo.upsert({
            accountId: otherAccountId,
            externalId: "rani-other",
            name: "Rani Lain",
            stage: "CHAT_STARTED",
            firstSeenAt: new Date("2026-03-01T10:00:00.000Z"),
        });
        otherLeadId = otherLead.id;

        expect(matching.length).toBe(8);
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
        if (otherTenantId !== undefined) await cleanupRepo.cleanup(otherTenantId);
    });

    it("returns the lead detail with attribution, metrics, movement, and trail", async () => {
        const detail = await audienceService.getLeadDetail(tenantId, leadId);

        expect(detail).toMatchObject({
            id: leadId,
            name: "Rani Utami",
            phoneMasked: "+62811****001",
            emailMasked: null,
            campaignName: `Detail Campaign ${u}`,
            adName: `Detail Ad ${u}`,
            creativeName: `Detail Creative ${u}`,
            temperature: "HOT",
            stage: "QUALIFIED",
            sentiment: "positif",
            dealValueMinor: 500000,
            currency: "IDR",
            attribution: {
                method: "ctwa",
                note: "Klik iklan 7d_click",
                confidence: "tinggi",
            },
            metrics: {
                waitingMinutes: null,
                firstReplySeconds: 120,
                messagesInbound: 2,
                messagesOutbound: 1,
                daysInPipeline: expect.any(Number),
            },
        });

        expect(detail.movement.map((point) => [point.level, point.at, point.confidence])).toEqual([
            ["WARM", "2026-03-01T10:01:00.000Z", "sedang"],
            ["WARM", "2026-03-01T10:01:00.000Z", "teramati"],
            ["HOT", "2026-03-01T10:05:00.000Z", "tinggi"],
            ["HOT", "2026-03-01T10:05:00.000Z", "teramati"],
        ]);
        expect(detail.movement.every((point) => point.applied)).toBe(true);

        expect(detail.trail).toEqual([
            {
                at: "2026-03-01T10:00:00.000Z",
                direction: "INBOUND",
                body: "Halo kak",
                responseType: null,
                gapSeconds: null,
                isQuote: false,
            },
            {
                at: "2026-03-01T10:01:00.000Z",
                direction: "OUTBOUND",
                body: "Hai, ada yang bisa dibantu?",
                responseType: null,
                gapSeconds: null,
                isQuote: false,
            },
            {
                at: "2026-03-01T10:03:00.000Z",
                direction: "INBOUND",
                body: "Masih ada stok?",
                responseType: "Tanya lanjut",
                gapSeconds: null,
                isQuote: true,
            },
        ]);

        expect(detail.explanation).toEqual({
            id: expect.any(String),
            context: "lead_detail",
            state: "PENDING",
            source: null,
            text: null,
            evidenceIds: [],
            snapshotId: expect.any(String),
        });
    });

    it("keeps only the newest 50 messages in the trail, oldest first", async () => {
        const detail = await audienceService.getLeadDetail(tenantId, chattyLeadId);

        expect(detail.trail.length).toBe(50);
        expect(detail.trail[0].body).toBe("Pesan 1");
        expect(detail.trail[49].body).toBe("Pesan 50");
        expect(detail.movement).toEqual([]);
        expect(detail.attribution.confidence).toBeNull();
    });

    it("hides a lead of another tenant behind a 404", async () => {
        const token = await new JwtUtil().register({id: "user-detail", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/leads/${otherLeadId}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(404);
        expect(await readError(response)).toEqual({
            code: "NOT_FOUND",
            message: "Lead tidak ditemukan",
            details: null,
        });
    });

    it("serves the lead detail route for the authenticated tenant", async () => {
        const token = await new JwtUtil().register({id: "user-detail", tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/leads/${leadId}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const body = await readData<{id: number; trail: unknown[]; movement: unknown[]}>(response);
        expect(body.id).toBe(leadId);
        expect(body.trail.length).toBe(3);
        expect(body.movement.length).toBe(4);
    });

    it("returns the page registry and no leads for an empty query", async () => {
        const result = await searchService.search(tenantId, {q: "", accountId});

        expect(result.leads).toEqual([]);
        expect(result.pages.length).toBe(8);
        expect(result.meta).toEqual({q: "", truncated: false});
    });

    it("caps both result sets at 8 and stays inside the account", async () => {
        const result = await searchService.search(tenantId, {q: "rani", accountId});

        expect(result.pages.length).toBeLessThanOrEqual(8);
        expect(result.leads.length).toBe(8);
        expect(result.meta.truncated).toBe(true);
        expect(result.leads.some((lead) => lead.id === otherLeadId)).toBe(false);
        expect(result.leads.every((lead) => lead.alias?.startsWith("Rani"))).toBe(true);
    });

    it("returns the newest topic of a matching lead", async () => {
        const result = await searchService.search(tenantId, {q: "rani utami", accountId});

        expect(result.leads).toEqual([
            {
                id: leadId,
                alias: "Rani Utami",
                topic: "Harga",
                phoneMasked: "+62811****001",
            },
        ]);
        expect(result.meta.truncated).toBe(false);
    });

    it("ranks a page whose label matches above keyword-only matches", async () => {
        const result = await searchService.search(tenantId, {q: "funnel"});

        expect(result.pages[0].route).toBe("/app/funnel");
        expect(result.leads).toEqual([]);
        expect(result.meta.truncated).toBe(false);
    });

    it("never searches leads without an account", async () => {
        const result = await searchService.search(tenantId, {q: "rani"});

        expect(result.leads).toEqual([]);
        expect(result.pages).toEqual([]);
    });

    it("serves the search route and hides accounts of another tenant", async () => {
        const token = await new JwtUtil().register({id: "user-search", tenant: tenantId, role: "ADMIN"});
        const headers = {authorization: `Bearer ${token.key}`};

        const ok = await app.handle(new Request(
            `http://localhost/api/search?q=rani&accountId=${accountId}`,
            {headers}
        ));
        expect(ok.status).toBe(200);
        const body = await readData<{leads: unknown[]; meta: {truncated: boolean}}>(ok);
        expect(body.leads.length).toBe(8);
        expect(body.meta.truncated).toBe(true);

        const foreign = await app.handle(new Request(
            `http://localhost/api/search?q=rani&accountId=${otherAccountId}`,
            {headers}
        ));
        expect(foreign.status).toBe(404);
        expect(await readError(foreign)).toEqual({
            code: "NOT_FOUND",
            message: "Akun iklan tidak ditemukan",
            details: null,
        });
    });
});
