import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {readData} from "../helpers";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {LeadRepository, type Lead} from "@db/repositories/lead.repository";
import {ConversationMessageRepository} from "@db/repositories/conversation-message.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {JwtUtil} from "@shared/jwt";
import type {AIMessage} from "@infra/ai/types";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";
import {LeadAssessmentEntity} from "@db/schema/wa/lead-assessment.entity";
import {LeadMilestoneEntity} from "@db/schema/wa/lead-milestone.entity";
import {LeadAssessmentService, type AssessmentModel} from "@/modules/audience/assess.service";
import {
    ASSESS_PROMPT_VERSION,
    DECISION_SCHEMA,
    SIGNAL_SCHEMA,
    UNAVAILABLE_RULE_VERSION,
    type Decision,
    type Signal,
} from "@/modules/audience/constants";
import type {LeadAssessmentQueue} from "@/modules/audience/queue";
import {eq} from "drizzle-orm";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

interface CapturedJob {
    name: string;
    data: unknown;
    options?: {jobId?: string};
}

/** Level 1 always answers with `signals`; level 2 pops the next scripted decision. */
function fakeModel(decisions: (Decision | Error)[], signals: Signal[] = []) {
    const calls: {schema: unknown; messages: AIMessage[]}[] = [];
    let index = 0;

    const model: AssessmentModel = {
        async generateObject<T>(messages: AIMessage[], schema?: Record<string, any>) {
            calls.push({schema, messages});
            if (schema === SIGNAL_SCHEMA) {
                return {data: {signals} as T, provider: "fake", model: "fake-gemini"};
            }

            expect(schema).toBe(DECISION_SCHEMA);
            const next = decisions[index++];
            if (next === undefined) throw new Error("scripted decision missing");
            if (next instanceof Error) throw next;

            return {data: next as T, provider: "fake", model: "fake-gemini"};
        },
    };

    return {model, calls};
}

function serviceFor(model: AssessmentModel, apiKeys: string[] = ["test-key"]) {
    const jobs: CapturedJob[] = [];
    const queue = {
        add: async (name: string, data: unknown, options?: {jobId?: string}) => {
            jobs.push({name, data, options});
            return {};
        },
    } as unknown as LeadAssessmentQueue;

    return {
        service: new LeadAssessmentService(
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            queue,
            {model, apiKeys}
        ),
        jobs,
    };
}

function decision(overrides: Partial<Decision>): Decision {
    return {
        level: "COLD",
        confidence: "rendah",
        reason: "Percakapan belum menunjukkan minat",
        evidenceWamid: "",
        responseType: "Pengakuan netral",
        sentiment: "netral",
        ...overrides,
    };
}

const SINCE = "2026-04-01";
const UNTIL = "2026-04-01";

describe("Lead assessment pipeline", () => {
    const cleanupRepo = new TestCleanupRepository();
    const leadRepo = new LeadRepository();
    const messageRepo = new ConversationMessageRepository();
    const tenantRepo = new TenantRepository();

    const u = Date.now().toString();
    const accountId = `act_assess_${u}`;
    const medianAccountId = `act_assess_median_${u}`;
    const campaignId = `camp_assess_${u}`;
    const adsetId = `adset_assess_${u}`;
    const creativeId = `cr_assess_${u}`;
    const adId = `ad_assess_${u}`;

    let tenantId: string;

    const hotWamid = `wamid_hot_${u}`;
    const replayOlderWamid = `wamid_replay_old_${u}`;
    const replayNewerWamid = `wamid_replay_new_${u}`;
    const unavailableWamid = `wamid_unavail_${u}`;
    const noKeysWamid = `wamid_nokeys_${u}`;
    const pairContextWamid = `wamid_pair_ctx_${u}`;
    const pairSequenceWamid = `wamid_pair_seq_${u}`;
    const pairMissingWamid = `wamid_pair_none_${u}`;
    const lastQuestionWamid = `wamid_last_q_${u}`;
    const lastRejectWamid = `wamid_last_r_${u}`;

    const at = (hour: number, minute = 0): Date =>
        new Date(`2026-04-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);

    const createLead = (values: {
        externalId: string;
        name: string;
        account?: string;
        adId?: string;
        firstSeenAt: Date;
    }): Promise<Lead> => leadRepo.upsert({
        accountId: values.account ?? accountId,
        externalId: values.externalId,
        name: values.name,
        phoneMasked: `+62812****${values.externalId.slice(-4)}`,
        adId: values.adId,
        campaignId: values.adId === undefined ? undefined : campaignId,
        adsetId: values.adId === undefined ? undefined : adsetId,
        creativeId: values.adId === undefined ? undefined : creativeId,
        stage: "CHAT_STARTED",
        firstSeenAt: values.firstSeenAt,
    });

    const createMessage = async (values: {
        leadId: number;
        wamid: string;
        direction: "INBOUND" | "OUTBOUND";
        sentAt: Date;
        body: string;
        contextWamid?: string;
    }): Promise<number> => {
        const [row] = await db.insert(ConversationMessageEntity)
            .values({
                leadId: values.leadId,
                wamid: values.wamid,
                direction: values.direction,
                senderRole: values.direction === "INBOUND" ? "LEAD" : "CS",
                body: values.body,
                sentAt: values.sentAt,
                contextWamid: values.contextWamid,
            })
            .returning({id: ConversationMessageEntity.id});

        return row.id;
    };

    let hotLeadId: number;
    let hotMessageId: number;
    let replayLeadId: number;
    let replayOlderId: number;
    let unavailableLeadId: number;
    let unavailableMessageId: number;
    let noKeysLeadId: number;
    let noKeysMessageId: number;
    let pairLeadId: number;
    let pairContextMessageId: number;
    let pairSequenceMessageId: number;
    let pairMissingMessageId: number;
    let lastAnswerLeadId: number;
    let lastQuestionMessageId: number;
    let lastRejectMessageId: number;

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `Toko Bulpoint ${u}`, address: "Bandung"});
        tenantId = tenant.id;
        await db.insert(AdAccountEntity).values([
            {
                id: accountId,
                tenantId,
                name: `Assess Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
                isSelected: true,
            },
            {
                id: medianAccountId,
                tenantId,
                name: `Assess Median Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
                isSelected: true,
            },
        ]);
        await db.insert(CampaignEntity).values({id: campaignId, accountId, name: "Assess Campaign"});
        await db.insert(AdSetEntity).values({id: adsetId, accountId, campaignId, name: "Assess AdSet"});
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: "Assess Creative"});
        await db.insert(AdEntity).values({id: adId, accountId, campaignId, adsetId, creativeId, name: "Assess Ad"});

        const hot = await createLead({externalId: "hot", name: "Lead Hot", adId, firstSeenAt: at(1, 55)});
        hotLeadId = hot.id;
        hotMessageId = await createMessage({
            leadId: hot.id,
            wamid: hotWamid,
            direction: "INBOUND",
            sentAt: at(2),
            body: "Saya ambil 500 lusin, bisa kirim invoice?",
        });

        const replay = await createLead({externalId: "replay", name: "Lead Replay", firstSeenAt: at(2, 55)});
        replayLeadId = replay.id;
        replayOlderId = await createMessage({
            leadId: replay.id,
            wamid: replayOlderWamid,
            direction: "INBOUND",
            sentAt: at(3),
            body: "Halo kak",
        });
        await createMessage({
            leadId: replay.id,
            wamid: replayNewerWamid,
            direction: "INBOUND",
            sentAt: at(4),
            body: "Saya ambil 100 lusin, kirim invoice ya",
        });

        const unavailable = await createLead({externalId: "unavail", name: "Lead Unavailable", firstSeenAt: at(3, 55)});
        unavailableLeadId = unavailable.id;
        unavailableMessageId = await createMessage({
            leadId: unavailable.id,
            wamid: unavailableWamid,
            direction: "INBOUND",
            sentAt: at(4),
            body: "Ini harganya berapa?",
        });

        const noKeys = await createLead({externalId: "nokeys", name: "Lead No Keys", firstSeenAt: at(4, 25)});
        noKeysLeadId = noKeys.id;
        noKeysMessageId = await createMessage({
            leadId: noKeys.id,
            wamid: noKeysWamid,
            direction: "INBOUND",
            sentAt: at(4, 30),
            body: "Halo",
        });

        const pair = await createLead({externalId: "pair", name: "Lead Pair", firstSeenAt: at(4, 55)});
        pairLeadId = pair.id;
        pairContextMessageId = await createMessage({
            leadId: pair.id,
            wamid: pairContextWamid,
            direction: "INBOUND",
            sentAt: at(5),
            body: "Bisa kirim ke Surabaya?",
        });
        await createMessage({
            leadId: pair.id,
            wamid: `wamid_pair_ctx_reply_${u}`,
            direction: "OUTBOUND",
            sentAt: at(5, 2),
            body: "Bisa kak",
            contextWamid: pairContextWamid,
        });
        pairSequenceMessageId = await createMessage({
            leadId: pair.id,
            wamid: pairSequenceWamid,
            direction: "INBOUND",
            sentAt: at(6),
            body: "Berapa ongkirnya?",
        });
        await createMessage({
            leadId: pair.id,
            wamid: `wamid_pair_seq_reply_${u}`,
            direction: "OUTBOUND",
            sentAt: at(6, 5),
            body: "Ongkir 20 ribu",
        });
        pairMissingMessageId = await createMessage({
            leadId: pair.id,
            wamid: pairMissingWamid,
            direction: "INBOUND",
            sentAt: at(7),
            body: "Oke saya pikir dulu",
        });

        const lastAnswer = await createLead({externalId: "last", name: "Lead Last", firstSeenAt: at(7, 55)});
        lastAnswerLeadId = lastAnswer.id;
        lastQuestionMessageId = await createMessage({
            leadId: lastAnswer.id,
            wamid: lastQuestionWamid,
            direction: "INBOUND",
            sentAt: at(8),
            body: "Masih ada stok?",
        });
        lastRejectMessageId = await createMessage({
            leadId: lastAnswer.id,
            wamid: lastRejectWamid,
            direction: "INBOUND",
            sentAt: at(8, 10),
            body: "Tidak jadi, makasih",
        });
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("records a HOT decision with its evidence and a single milestone", async () => {
        const {model, calls} = fakeModel([decision({
            level: "HOT",
            confidence: "tinggi",
            reason: "Menyebut 500 lusin dan meminta invoice",
            evidenceWamid: hotWamid,
            responseType: "Komitmen",
            sentiment: "positif",
        })]);
        const {service, jobs} = serviceFor(model);

        await service.assess({leadId: hotLeadId, messageId: hotMessageId});

        // Level 1 receives the masked transcript, level 2 receives the previous level plus the signals.
        expect(calls.map((call) => call.schema)).toEqual([SIGNAL_SCHEMA, DECISION_SCHEMA]);
        const level2 = JSON.parse(calls[1].messages[1].content) as {previous: unknown; messages: {text: string}[]};
        expect(level2.previous).toBeNull();
        expect(level2.messages.some((message) => message.text.includes("500 lusin"))).toBe(true);

        const [assessment] = await db.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, hotLeadId));
        expect(assessment.level).toBe("HOT");
        expect(assessment.confidence).toBe("tinggi");
        expect(assessment.applied).toBe(true);
        expect(assessment.ruleVersion).toBe(ASSESS_PROMPT_VERSION);
        expect((assessment.evidence as {wamid: string}).wamid).toBe(hotWamid);
        expect((assessment.evidence as {responseType: string}).responseType).toBe("Komitmen");

        const milestones = await db.select()
            .from(LeadMilestoneEntity)
            .where(eq(LeadMilestoneEntity.leadId, hotLeadId));
        expect(milestones.length).toBe(1);
        expect(milestones[0].level).toBe("HOT");

        expect((await leadRepo.findById(hotLeadId))?.temperature).toBe("HOT");

        const message = await messageRepo.findById(hotMessageId);
        expect(message?.responseType).toBe("Komitmen");
        expect(message?.sentiment).toBe("positif");
        expect(message?.senderRole).toBe("LEAD");

        expect(jobs).toEqual([]);
    });

    it("keeps a replayed older decision unapplied and queues a reassess", async () => {
        const newer = fakeModel([decision({
            level: "HOT",
            confidence: "tinggi",
            reason: "Menyebut 100 lusin dan meminta invoice",
            evidenceWamid: replayNewerWamid,
            responseType: "Komitmen",
            sentiment: "positif",
        })]);
        await serviceFor(newer.model).service.assess({leadId: replayLeadId, messageId: await messageIdOf(replayNewerWamid)});

        expect((await leadRepo.findById(replayLeadId))?.temperature).toBe("HOT");

        const older = fakeModel([decision({
            level: "COLD",
            confidence: "rendah",
            reason: "Hanya menyapa",
            evidenceWamid: replayOlderWamid,
            responseType: "Pengakuan netral",
        })]);
        const {service, jobs} = serviceFor(older.model);
        await service.assess({leadId: replayLeadId, messageId: replayOlderId});

        const assessments = await db.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, replayLeadId));
        expect(assessments.length).toBe(2);
        const replayed = assessments.find((row) => row.ruleVersion === ASSESS_PROMPT_VERSION && row.level === "COLD");
        expect(replayed?.applied).toBe(false);

        // The level and the milestone stay on the newest decision.
        expect((await leadRepo.findById(replayLeadId))?.temperature).toBe("HOT");
        const milestones = await db.select()
            .from(LeadMilestoneEntity)
            .where(eq(LeadMilestoneEntity.leadId, replayLeadId));
        expect(milestones.filter((row) => row.level === "HOT").length).toBe(1);

        expect(jobs.length).toBe(1);
        expect(jobs[0].name).toBe("reassess");
        expect(jobs[0].data).toEqual({
            leadId: replayLeadId,
            from: at(3).toISOString(),
        });
        expect(jobs[0].options?.jobId).toBe(`reassess-${replayLeadId}-${at(3).getTime()}`);
    });

    it("replays a lead chronologically without writing a second milestone", async () => {
        const {model, calls} = fakeModel([
            decision({
                level: "COLD",
                confidence: "rendah",
                reason: "Hanya menyapa",
                evidenceWamid: replayOlderWamid,
                responseType: "Pengakuan netral",
            }),
            decision({
                level: "HOT",
                confidence: "tinggi",
                reason: "Menyebut 100 lusin dan meminta invoice",
                evidenceWamid: replayNewerWamid,
                responseType: "Komitmen",
                sentiment: "positif",
            }),
        ]);
        const {service, jobs} = serviceFor(model);

        await service.reassess({leadId: replayLeadId, from: at(3).toISOString()});

        // One decision per replayed inbound message, and no reassess job from inside the replay.
        expect(calls.filter((call) => call.schema === DECISION_SCHEMA).length).toBe(2);
        expect(jobs).toEqual([]);

        expect((await leadRepo.findById(replayLeadId))?.temperature).toBe("HOT");

        const milestones = await db.select()
            .from(LeadMilestoneEntity)
            .where(eq(LeadMilestoneEntity.leadId, replayLeadId));
        expect(milestones.length).toBe(1);

        const assessments = await db.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, replayLeadId));
        expect(assessments.length).toBe(2);
    });

    it("stores an unavailable marker after two retries and never moves the level", async () => {
        const invalid = decision({evidenceWamid: `wamid_missing_${u}`});
        const {model, calls} = fakeModel([invalid, invalid, invalid]);
        const {service} = serviceFor(model);

        await service.assess({leadId: unavailableLeadId, messageId: unavailableMessageId});

        // Three attempts, each running both levels.
        expect(calls.length).toBe(6);

        const rows = await db.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, unavailableLeadId));
        expect(rows.length).toBe(1);
        expect(rows[0].ruleVersion).toBe(UNAVAILABLE_RULE_VERSION);
        expect(rows[0].applied).toBe(false);
        expect(rows[0].confidence).toBe("tidak tersedia");
        expect((rows[0].evidence as {status: string}).status).toBe("UNAVAILABLE");
        expect(rows[0].reason).toContain(`wamid_missing_${u}`);

        expect((await leadRepo.findById(unavailableLeadId))?.temperature).toBeNull();
        expect(await db.select()
            .from(LeadMilestoneEntity)
            .where(eq(LeadMilestoneEntity.leadId, unavailableLeadId))).toEqual([]);
    });

    it("marks the assessment unavailable without calling the model when no API key is set", async () => {
        const {model, calls} = fakeModel([]);
        const {service} = serviceFor(model, []);

        await service.assess({leadId: noKeysLeadId, messageId: noKeysMessageId});

        expect(calls.length).toBe(0);

        const rows = await db.select()
            .from(LeadAssessmentEntity)
            .where(eq(LeadAssessmentEntity.leadId, noKeysLeadId));
        expect(rows.length).toBe(1);
        expect(rows[0].ruleVersion).toBe(UNAVAILABLE_RULE_VERSION);
        expect(rows[0].reason).toContain("GEMINI_API_KEYS");
        expect((await leadRepo.findById(noKeysLeadId))?.temperature).toBeNull();
    });

    it("pairs the lead message with the CS reply and measures the wait", async () => {
        const {model} = fakeModel([
            decision({evidenceWamid: pairContextWamid, responseType: "Tanya lanjut"}),
            decision({evidenceWamid: pairSequenceWamid, responseType: "Tanya lanjut"}),
            decision({evidenceWamid: pairMissingWamid, responseType: "Menunda"}),
        ]);
        const {service} = serviceFor(model);

        await service.assess({leadId: pairLeadId, messageId: pairContextMessageId});
        await service.assess({leadId: pairLeadId, messageId: pairSequenceMessageId});
        await service.assess({leadId: pairLeadId, messageId: pairMissingMessageId});

        const context = await messageRepo.findById(pairContextMessageId);
        expect(context?.pairMethod).toBe("reply");
        expect(context?.responseSeconds).toBe(120);
        expect(context?.repliedAt?.toISOString()).toBe(at(5, 2).toISOString());

        const sequence = await messageRepo.findById(pairSequenceMessageId);
        expect(sequence?.pairMethod).toBe("sequence");
        expect(sequence?.responseSeconds).toBe(300);

        const missing = await messageRepo.findById(pairMissingMessageId);
        expect(missing?.pairMethod).toBeNull();
        expect(missing?.responseSeconds).toBeNull();
        expect(missing?.responseType).toBe("Menunda");
    });

    it("counts only the last classified answer per lead", async () => {
        const {model} = fakeModel([
            decision({evidenceWamid: lastQuestionWamid, responseType: "Tanya lanjut"}),
            decision({
                evidenceWamid: lastRejectWamid,
                responseType: "Menolak",
                sentiment: "negatif",
            }),
        ]);
        const {service} = serviceFor(model);

        await service.assess({leadId: lastAnswerLeadId, messageId: lastQuestionMessageId});
        await service.assess({leadId: lastAnswerLeadId, messageId: lastRejectMessageId});

        const token = await new JwtUtil().register({id: `user-assess-${u}`, tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/audience/conversations?accountId=${accountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const body = await readData<{
            counts: {responseType: string; count: number}[];
            classifiedLeads: number;
            sentiment: {negatif: number};
        }>(response);
        const countOf = (responseType: string) =>
            body.counts.find((row) => row.responseType === responseType)?.count;

        expect(countOf("Menolak")).toBe(1);
        expect(countOf("Tanya lanjut")).toBe(0);
        expect(body.sentiment.negatif).toBe(1);
    });

    it("feeds the reply-latency median with the pipeline's measured rows", async () => {
        const cohort = [
            {externalId: "m1", sentAt: at(9), replyAt: at(9, 10), seconds: 600},
            {externalId: "m2", sentAt: at(10), replyAt: at(10, 30), seconds: 1800},
            {externalId: "m3", sentAt: at(11), replyAt: null, seconds: null},
            {externalId: "m4", sentAt: at(12), replyAt: null, seconds: null},
        ] as const;

        const decisions: Decision[] = [];
        const calls: {leadId: number; messageId: number}[] = [];

        for (const row of cohort) {
            const lead = await createLead({
                externalId: `median-${row.externalId}`,
                name: `Median ${row.externalId}`,
                account: medianAccountId,
                firstSeenAt: row.sentAt,
            });
            const messageId = await createMessage({
                leadId: lead.id,
                wamid: `wamid_${row.externalId}_${u}`,
                direction: "INBOUND",
                sentAt: row.sentAt,
                body: "Halo kak, mau tanya",
            });
            if (row.replyAt !== null) {
                await createMessage({
                    leadId: lead.id,
                    wamid: `wamid_${row.externalId}_reply_${u}`,
                    direction: "OUTBOUND",
                    sentAt: row.replyAt,
                    body: "Siap kak",
                });
            }

            decisions.push(decision({evidenceWamid: `wamid_${row.externalId}_${u}`, responseType: "Komitmen"}));
            calls.push({leadId: lead.id, messageId});
        }

        const {model} = fakeModel(decisions);
        const {service} = serviceFor(model);
        for (const call of calls) await service.assess(call);

        const token = await new JwtUtil().register({id: `user-assess-${u}`, tenant: tenantId, role: "ADMIN"});
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/audience/conversations?accountId=${medianAccountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const body = await readData<{
            timed: {medianSeconds: number | null; measuredLeads: number; observedLeads: number};
            sample: {gate: string};
        }>(response);

        expect(body.timed).toEqual({medianSeconds: 1200, measuredLeads: 2, observedLeads: 4});
        expect(body.sample.gate).toBe("≥ 30 chat");
    });

    async function messageIdOf(wamid: string): Promise<number> {
        const [row] = await db.select({id: ConversationMessageEntity.id})
            .from(ConversationMessageEntity)
            .where(eq(ConversationMessageEntity.wamid, wamid));

        return row.id;
    }
});
