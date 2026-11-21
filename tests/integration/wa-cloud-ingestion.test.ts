import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {createHash, createHmac} from "node:crypto";
import {app} from "@/index";
import {Config} from "@/config";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {WaPhoneRepository} from "@db/repositories/wa-phone.repository";
import {QueueManager} from "@infra/queue";
import {JwtUtil} from "@shared/jwt";
import {phoneHash} from "@shared/phone";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {WaSessionEntity} from "@db/schema/wa/wa-session.entity";
import {WaPhoneEntity} from "@db/schema/wa/wa-phone.entity";
import {CloudIngestService} from "@/modules/wa/cloud/service";
import type {LeadAssessmentQueue} from "@/modules/audience/queue";
import type {WaCloudQueue} from "@/modules/wa/cloud/queue";
import type {MessageReceived} from "@/modules/wa/webhook/schema";
import {eq, sql} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

interface CapturedJob {
    name: string;
    data: unknown;
    options: {jobId?: string} | undefined;
}

/** The queue is never touched: `add` records the job and returns a placeholder. */
function fakeQueue(jobs: CapturedJob[]): {assessment: LeadAssessmentQueue; cloud: WaCloudQueue} {
    const add = (async (name: string, data: unknown, options?: {jobId?: string}) => {
        jobs.push({name, data, options});
        return {};
    }) as unknown as LeadAssessmentQueue["add"];

    return {
        assessment: {add} as unknown as LeadAssessmentQueue,
        cloud: {add} as unknown as WaCloudQueue,
    };
}

function sign(raw: string): string {
    return "sha256=" + createHmac("sha256", Config.meta.appSecret).update(raw).digest("hex");
}

function cloudPayload(input: {
    phoneNumberId: string;
    contacts?: {wa_id: string; name?: string}[];
    messages?: unknown[];
    echoes?: unknown[];
}): string {
    return JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{
            id: "waba-1",
            changes: [{
                value: {
                    metadata: {phone_number_id: input.phoneNumberId, display_phone_number: "628999000111"},
                    contacts: (input.contacts ?? []).map((contact) => ({
                        wa_id: contact.wa_id,
                        profile: {name: contact.name ?? null},
                    })),
                    messages: input.messages ?? [],
                    ...(input.echoes === undefined ? {} : {message_echoes: input.echoes}),
                },
            }],
        }],
    });
}

describe("WhatsApp Cloud API ingestion", () => {
    const cleanupRepo = new TestCleanupRepository();
    const phoneRepo = new WaPhoneRepository();

    const u = Date.now().toString();
    const accountId = `act_wacloud_${u}`;
    const campaignId = `camp_wacloud_${u}`;
    const adsetId = `adset_wacloud_${u}`;
    const creativeId = `cr_wacloud_${u}`;
    const adId = `ad_wacloud_${u}`;
    const staleCreativeId = `cr_wacloud_stale_${u}`;
    const staleAdId = `ad_wacloud_stale_${u}`;
    const phoneNumberId = `pnid_${u}`;
    const sessionId = crypto.randomUUID();

    const sentAt = new Date("2026-05-01T10:00:00.000Z");
    const echoAt = new Date("2026-05-01T10:02:00.000Z");

    let tenantId: string;
    let otherTenantId: string;

    const originalAdd = QueueManager.prototype.add;

    beforeAll(async () => {
        // The HTTP route reads `Config.meta.appSecret`; a placeholder secret rejects every delivery
        // with the "cannot verify" message instead of the "invalid" one asserted below.
        expect(new CloudIngestService().signatureConfigured).toBe(true);

        const [tenant] = await db.insert(TenantEntity).values({name: `wacloud-${u}`}).returning();
        tenantId = tenant.id;
        const [otherTenant] = await db.insert(TenantEntity).values({name: `wacloud-other-${u}`}).returning();
        otherTenantId = otherTenant.id;

        await db.insert(AdAccountEntity).values([
            {
                id: accountId,
                tenantId,
                name: `Cloud Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
                isSelected: true,
            },
            {
                id: `act_wacloud_other_${u}`,
                tenantId: otherTenantId,
                name: `Other Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
                isSelected: true,
            },
        ]);
        await db.insert(CampaignEntity).values({id: campaignId, accountId, name: "Cloud Campaign"});
        await db.insert(AdSetEntity).values({id: adsetId, accountId, campaignId, name: "Cloud AdSet"});
        await db.insert(AdCreativeEntity).values([
            {
                id: creativeId,
                accountId,
                name: "Cloud Creative",
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                updatedTime: null,
            },
            {
                id: staleCreativeId,
                accountId,
                name: "Stale Creative",
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                updatedTime: new Date("2026-02-01T00:00:00.000Z"),
            },
        ]);
        await db.insert(AdEntity).values([
            {id: adId, accountId, campaignId, adsetId, creativeId, name: "Cloud Ad"},
            {id: staleAdId, accountId, campaignId, adsetId, creativeId: staleCreativeId, name: "Stale Ad"},
        ]);
        await db.insert(WaPhoneEntity).values({
            tenantId,
            accountId,
            phoneNumberId,
            phone: `+62812${u.slice(-7)}`,
        });
        await db.insert(WaSessionEntity).values({id: sessionId, tenantId, name: `Cloud Session ${u}`});
    });

    afterAll(async () => {
        QueueManager.prototype.add = originalAdd;
        await cleanupRepo.cleanup(tenantId);
        await cleanupRepo.cleanup(otherTenantId);
    });

    it("rejects a payload whose signature does not match", async () => {
        const raw = cloudPayload({
            phoneNumberId,
            messages: [{id: `wamid_bad_${u}`, from: "6281234567890", timestamp: String(sentAt.getTime() / 1000)}],
        });

        const response = await app.handle(new Request("http://localhost/api/wa/cloud/webhook", {
            method: "POST",
            headers: {"x-hub-signature-256": sign("other body")},
            body: raw,
        }));

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({status: false, message: "Webhook signature tidak valid"});

        const [row] = await db.execute(sql`
            select count(*)::int as total from conversation_messages where wamid = ${`wamid_bad_${u}`}
        `) as unknown as {total: number}[];
        expect(row.total).toBe(0);
    });

    it("queues the verified raw body under its content hash", async () => {
        const raw = cloudPayload({phoneNumberId, messages: []});
        const jobs: CapturedJob[] = [];
        // Reason: only `queue.add` is exercised; the fake never touches BullMQ's Job wrapper.
        QueueManager.prototype.add = (async (name: string, data: unknown, options?: {jobId?: string}) => {
            jobs.push({name, data, options});
            return {};
        }) as unknown as typeof QueueManager.prototype.add;

        const response = await app.handle(new Request("http://localhost/api/wa/cloud/webhook", {
            method: "POST",
            headers: {"x-hub-signature-256": sign(raw)},
            body: raw,
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({status: true});
        expect(jobs.length).toBe(1);
        expect(jobs[0].name).toBe("ingest");
        expect(jobs[0].options?.jobId).toBe(createHash("sha256").update(raw).digest("hex").slice(0, 32));
        expect((jobs[0].data as {raw: string}).raw).toBe(raw);
    });

    it("writes one message row and one assessment job per wamid", async () => {
        const jobs: CapturedJob[] = [];
        const queues = fakeQueue(jobs);
        const service = new CloudIngestService(
            undefined,
            undefined,
            undefined,
            undefined,
            queues.assessment,
            queues.cloud,
            Config.meta.appSecret
        );
        const wamid = `wamid_dedupe_${u}`;
        const raw = cloudPayload({
            phoneNumberId,
            contacts: [{wa_id: "628129990000", name: "Dewi"}],
            messages: [{id: wamid, from: "628129990000", timestamp: String(sentAt.getTime() / 1000), type: "text", text: {body: "halo"}}],
        });

        await service.ingest(raw, sentAt);
        await service.ingest(raw, sentAt);

        const [row] = await db.execute(sql`
            select count(*)::int as total from conversation_messages where wamid = ${wamid}
        `) as unknown as {total: number}[];
        expect(row.total).toBe(1);

        expect(jobs.length).toBe(1);
        expect(jobs[0].name).toBe("assess");
        expect(jobs[0].options?.jobId).toBe(`assess:${wamid}`);
    });

    it("stores an unattributed lead with a masked phone and masked body", async () => {
        const jobs: CapturedJob[] = [];
        const queues = fakeQueue(jobs);
        const service = new CloudIngestService(
            undefined,
            undefined,
            undefined,
            undefined,
            queues.assessment,
            queues.cloud,
            Config.meta.appSecret
        );
        const raw = cloudPayload({
            phoneNumberId,
            contacts: [{wa_id: "6281234567890", name: "Budi"}],
            messages: [{
                id: `wamid_plain_${u}`,
                from: "6281234567890",
                timestamp: String(sentAt.getTime() / 1000),
                type: "text",
                text: {body: "Halo kak, transfer 1234567890 ya"},
            }],
        });

        await service.ingest(raw, sentAt);

        const [lead] = await db.execute(sql`
            select ad_id, attribution_note, phone_masked, external_id, first_message, name
            from leads
            where account_id = ${accountId} and external_id = ${phoneHash("+6281234567890")}
        `) as unknown as {
            ad_id: string | null;
            attribution_note: string | null;
            phone_masked: string;
            external_id: string;
            first_message: string;
            name: string;
        }[];

        expect(lead.ad_id).toBeNull();
        expect(lead.attribution_note).toBeNull();
        expect(lead.phone_masked).toBe("+628****7890");
        expect(lead.external_id).toBe(phoneHash("+6281234567890"));
        expect(lead.first_message).toBe("Halo kak, transfer #### ya");
        expect(lead.name).toBe("Budi");
    });

    it("attributes a click-to-WhatsApp lead to its ad chain", async () => {
        const jobs: CapturedJob[] = [];
        const queues = fakeQueue(jobs);
        const service = new CloudIngestService(
            undefined,
            undefined,
            undefined,
            undefined,
            queues.assessment,
            queues.cloud,
            Config.meta.appSecret
        );

        const raw = cloudPayload({
            phoneNumberId,
            contacts: [{wa_id: "628127770001", name: "Ani"}],
            messages: [{
                id: `wamid_ad_${u}`,
                from: "628127770001",
                timestamp: String(sentAt.getTime() / 1000),
                type: "text",
                text: {body: "mau tanya produk"},
                referral: {source_type: "ad", source_id: adId, ctwa_clid: "clid-1"},
            }],
        });
        await service.ingest(raw, sentAt);

        const [attributed] = await db.execute(sql`
            select campaign_id, adset_id, ad_id, creative_id, attribution_note
            from leads
            where account_id = ${accountId} and external_id = ${phoneHash("+628127770001")}
        `) as unknown as {
            campaign_id: string;
            adset_id: string;
            ad_id: string;
            creative_id: string;
            attribution_note: string | null;
        }[];

        expect(attributed.campaign_id).toBe(campaignId);
        expect(attributed.adset_id).toBe(adsetId);
        expect(attributed.ad_id).toBe(adId);
        expect(attributed.creative_id).toBe(creativeId);
        expect(attributed.attribution_note).toBeNull();

        const staleRaw = cloudPayload({
            phoneNumberId,
            contacts: [{wa_id: "628127770002", name: "Rudi"}],
            messages: [{
                id: `wamid_ad_stale_${u}`,
                from: "628127770002",
                timestamp: String(sentAt.getTime() / 1000),
                type: "text",
                text: {body: "mau tanya produk"},
                referral: {source_type: "ad", source_id: staleAdId},
            }],
        });
        await service.ingest(staleRaw, sentAt);

        const [stale] = await db.execute(sql`
            select ad_id, attribution_note
            from leads
            where account_id = ${accountId} and external_id = ${phoneHash("+628127770002")}
        `) as unknown as {ad_id: string; attribution_note: string | null}[];

        expect(stale.ad_id).toBe(staleAdId);
        expect(stale.attribution_note).toBe("attribution_after_change");
    });

    it("pairs a CS echo with the lead's message and makes it measurable", async () => {
        const jobs: CapturedJob[] = [];
        const queues = fakeQueue(jobs);
        const service = new CloudIngestService(
            undefined,
            undefined,
            undefined,
            undefined,
            queues.assessment,
            queues.cloud,
            Config.meta.appSecret
        );
        const customer = "628125550001";
        const inboundWamid = `wamid_echo_in_${u}`;

        await service.ingest(cloudPayload({
            phoneNumberId,
            contacts: [{wa_id: customer, name: "Sinta"}],
            messages: [{
                id: inboundWamid,
                from: customer,
                timestamp: String(sentAt.getTime() / 1000),
                type: "text",
                text: {body: "stok masih ada?"},
            }],
        }), sentAt);

        await service.ingest(cloudPayload({
            phoneNumberId,
            echoes: [{
                id: `wamid_echo_out_${u}`,
                from: "628999000111",
                to: customer,
                timestamp: String(echoAt.getTime() / 1000),
                type: "text",
                text: {body: "masih kak"},
            }],
        }), echoAt);

        const rows = await db.execute(sql`
            select m.direction, m.sender_role, m.replied_at, m.response_seconds, m.pair_method
            from conversation_messages m
            join leads l on l.id = m.lead_id
            where l.account_id = ${accountId} and l.external_id = ${phoneHash("+628125550001")}
            order by m.id
        `) as unknown as {
            direction: string;
            sender_role: string;
            replied_at: Date | null;
            response_seconds: number | null;
            pair_method: string | null;
        }[];

        expect(rows.length).toBe(2);
        expect(rows[0].direction).toBe("INBOUND");
        expect(rows[0].replied_at).not.toBeNull();
        expect(rows[0].response_seconds).toBe(120);
        expect(rows[0].pair_method).toBe("sequence");
        expect(rows[1].direction).toBe("OUTBOUND");
        expect(rows[1].sender_role).toBe("CS");

        const [lead] = await db.execute(sql`
            select first_replied_at from leads
            where account_id = ${accountId} and external_id = ${phoneHash("+628125550001")}
        `) as unknown as {first_replied_at: Date | null}[];
        expect(lead.first_replied_at).not.toBeNull();

        // The assessment job is queued for the inbound message only.
        expect(jobs.length).toBe(1);
        expect(jobs[0].options?.jobId).toBe(`assess:${inboundWamid}`);

        const token = await new JwtUtil().register({id: `user-${u}`, tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/audience/conversations?accountId=${accountId}&since=2026-05-01&until=2026-05-01`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const body = await response.json() as {timed: {measuredLeads: number}};
        expect(body.timed.measuredLeads).toBeGreaterThanOrEqual(1);
    });

    it("ingests OpenWA messages through the same writer", async () => {
        const jobs: CapturedJob[] = [];
        const queues = fakeQueue(jobs);
        const service = new CloudIngestService(
            undefined,
            undefined,
            undefined,
            undefined,
            queues.assessment,
            queues.cloud,
            Config.meta.appSecret
        );
        const customer = "628123000111";
        const base: MessageReceived = {
            id: `wa_open_in_${u}`,
            from: customer,
            to: "628999000111",
            chatId: `${customer}@s.whatsapp.net`,
            body: "halo dari openwa",
            type: "chat",
            timestamp: sentAt.getTime() / 1000,
            fromMe: false,
            isGroup: false,
            kind: "chat",
            isStatusBroadcast: false,
            isLidSender: false,
            contact: {pushName: "Sari", name: "Sari"},
        };

        await service.ingestOpenWa({sessionId, message: base});

        // `upsert` never writes `account_id`; the tenant's selected account is the binding.
        const binding = await phoneRepo.findBySessionId(sessionId);
        expect(binding?.phone).toBe("+628999000111");

        const [inbound] = await db.execute(sql`
            select m.direction, m.sender_role, m.body, m.wamid
            from conversation_messages m
            join leads l on l.id = m.lead_id
            where l.account_id = ${accountId} and l.external_id = ${phoneHash(`+${customer}`)}
        `) as unknown as {direction: string; sender_role: string; body: string; wamid: string}[];

        expect(inbound.direction).toBe("INBOUND");
        expect(inbound.sender_role).toBe("LEAD");
        expect(inbound.body).toBe("halo dari openwa");
        expect(inbound.wamid).toBe(base.id);

        await service.ingestOpenWa({
            sessionId,
            message: {
                ...base,
                id: `wa_open_out_${u}`,
                from: "628999000111",
                to: customer,
                body: "siap kak",
                fromMe: true,
                timestamp: echoAt.getTime() / 1000,
            },
        });

        const [outbound] = await db.execute(sql`
            select m.direction, m.sender_role, m.response_seconds
            from conversation_messages m
            join leads l on l.id = m.lead_id
            where l.account_id = ${accountId} and m.wamid = ${`wa_open_out_${u}`}
        `) as unknown as {direction: string; sender_role: string; response_seconds: number | null}[];

        expect(outbound.direction).toBe("OUTBOUND");
        expect(outbound.sender_role).toBe("CS");

        const [lead] = await db.execute(sql`
            select first_replied_at from leads
            where account_id = ${accountId} and external_id = ${phoneHash(`+${customer}`)}
        `) as unknown as {first_replied_at: Date | null}[];
        expect(lead.first_replied_at).not.toBeNull();
    });
});
