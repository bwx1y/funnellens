/**
 * Run against a disposable local PostgreSQL and Redis after bun run db:push.
 * The real Gemini adapter talks only to the local fixture server.
 */
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {eq} from "drizzle-orm";

const loopback = ["127.0.0.1", "localhost"];
assert.equal(Bun.env.DATABASE_NAME, "funnellens_qa", "Use a disposable database named funnellens_qa");
assert.ok(loopback.includes(Bun.env.DATABASE_HOST ?? ""), "DATABASE_HOST must be loopback");
assert.ok(loopback.includes(Bun.env.REDIS_HOST ?? ""), "REDIS_HOST must be loopback");

const cases = [
    {level: "HOT", type: "Komitmen", text: "Saya ambil 500 pasang. Tolong kirim invoice.", sentiment: "positif"},
    {level: "WARM", type: "Tanya lanjut", text: "Apakah ada stok dan berapa harga per pasang?", sentiment: "netral"},
    {level: "COLD", type: "Pengakuan netral", text: "Halo, selamat pagi.", sentiment: "netral"},
] as const;
const runId = crypto.randomUUID();
const firstLevel = new Set<string>();
const secondLevel = new Set<string>();
const invalidLeakTemplates: string[] = [];

const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
        try {
            assert.match(new URL(request.url).pathname, /\/models\/[^/]+:generateContent$/);
            const {generationConfig, contents, systemInstruction} = await request.json();
            assert.equal(generationConfig.responseMimeType, "application/json");
            const properties = generationConfig.responseSchema.properties;
            const input = JSON.parse(contents[0].parts[0].text);
            const prompt = systemInstruction.parts.map((part: {text: string}) => part.text).join("\n");
            let result;
            if (properties.signals || properties.evidenceWamid) {
                const message = input.messages.at(-1);
                const fixture = cases.find(item => item.text === message.text);
                assert.ok(fixture, "The model must receive the dummy conversation");
                if (properties.signals) {
                    firstLevel.add(message.wamid);
                    result = {signals: [{
                        wamid: message.wamid, intent: fixture.type, product: "", budget: "",
                        urgency: "rendah", objection: "", sentiment: fixture.sentiment,
                    }]};
                } else {
                    assert.ok(firstLevel.has(message.wamid), "Signal extraction must run first");
                    assert.equal(input.signals[0].wamid, message.wamid);
                    secondLevel.add(message.wamid);
                    result = {
                        level: fixture.level, responseType: fixture.type, sentiment: fixture.sentiment,
                        confidence: "tinggi", reason: "Keputusan fixture berdasarkan pesan uji.",
                        evidenceWamid: message.wamid,
                    };
                }
            } else if (prompt.includes('blok "Ringkasan akun"')) {
                result = {template: "Belanja {spend} mencatat {leads} lead.", nextCheck: "campaign"};
            } else {
                assert.ok(prompt.includes('blok "Kebocoran funnel"'), "Unexpected explanation context");
                invalidLeakTemplates.push(prompt);
                result = {template: "Konversi naik 25%", nextCheck: "campaign"};
            }
            return Response.json({
                candidates: [{content: {role: "model", parts: [{text: JSON.stringify(result)}]}, finishReason: "STOP"}],
            });
        } catch (error) {
            console.error("Fixture Gemini:", error);
            return Response.json({error: {message: String(error)}}, {status: 400});
        }
    },
});
Bun.env.NODE_ENV = "test";
Bun.env.REDIS_DB ??= "15";
Bun.env.GEMINI_API_KEYS = "funnellens-dummy-provider-key";
Bun.env.GOOGLE_GEMINI_BASE_URL = provider.url.origin;
Bun.env.META_APP_SECRET = "funnellens-dummy-webhook-secret";
Bun.env.SECRET = "funnellens-dummy-jwt-secret";

const {db, queryClient} = await import("@db/index");
const {TenantEntity, AdAccountEntity, CampaignEntity, AdSetEntity, AdCreativeEntity, AdEntity, WaPhoneEntity} =
    await import("@db/schema/index");
const {app} = await import("@/index");
const {JwtUtil} = await import("@shared/jwt");
const {WorkerManager} = await import("@infra/queue");
const {redisConnection} = await import("@infra/redis");
const {AdInsightDailyRepository} = await import("@db/repositories/ad-insight-daily.repository");
const {SyncRunRepository} = await import("@db/repositories/sync-run.repository");

async function eventually<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string): Promise<T> {
    const end = Date.now() + 12_000;
    do {
        const value = await read();
        if (ready(value)) return value;
        await Bun.sleep(80);
    } while (Date.now() < end);
    throw new Error(`Timed out: ${label}`);
}

let tenantId: string | undefined;
const accountId = `act_qa_${runId}`;
const phoneNumberId = `qa_${runId}`;
try {
    const [tenant] = await db.insert(TenantEntity).values({name: `QA ${runId}`}).returning();
    tenantId = tenant.id;
    await db.insert(AdAccountEntity).values({
        id: accountId, tenantId, name: "Akun dummy QA", currency: "IDR", currencyOffset: 100,
        timezoneName: "Asia/Jakarta", isSelected: true,
    });
    const adIds = {wa: `wa_${runId}`, web: `web_${runId}`};
    const since = "2026-03-01";
    const until = "2026-03-02";
    const insights = new AdInsightDailyRepository();
    for (const goal of ["wa", "web"] as const) {
        const adId = adIds[goal], campaignId = `camp_${adId}`, adsetId = `set_${adId}`, creativeId = `cr_${adId}`;
        await db.insert(CampaignEntity).values({id: campaignId, accountId, name: `Campaign dummy ${goal}`, status: "ACTIVE"});
        await db.insert(AdSetEntity).values({id: adsetId, accountId, campaignId, name: goal, objectiveGroup: goal});
        await db.insert(AdCreativeEntity).values({id: creativeId, accountId, name: `Kreatif dummy ${goal}`});
        await db.insert(AdEntity).values({id: adId, accountId, campaignId, adsetId, creativeId, name: goal});
        await insights.upsertBatch(["2026-02-27", since].map((date, index) => ({
            accountId, level: "ad", entityId: adId, campaignId, adsetId, adId, date, currency: "IDR",
            currencyOffset: 100, spendMinor: 100000, impressions: 10000, clicks: 1000, inlineLinkClicks: 1000,
            actions: goal === "wa"
                ? [{actionType: "lead", count: index === 0 ? "250" : "200"}]
                : [{actionType: "landing_page_view", count: "800"}, {actionType: "purchase", count: "36", valueMinor: 300000}],
        })));
    }
    const syncRuns = new SyncRunRepository();
    const sync = await syncRuns.create({accountId, resource: "insights"});
    await syncRuns.complete(sync.id, 4);
    await db.insert(WaPhoneEntity).values({
        tenantId, accountId, channel: "CLOUD", phoneNumberId, phone: "+6280000000000",
    });

    const timestamp = String(Date.parse(`${since}T10:00:00Z`) / 1000);
    const raw = JSON.stringify({entry: [{changes: [{value: {
        metadata: {phone_number_id: phoneNumberId},
        messages: cases.map((item, index) => ({
            id: `wamid.${runId}.${index}`, from: `628000000000${index + 1}`, timestamp,
            type: "text", text: {body: item.text}, referral: {source_type: "ad", source_id: adIds.wa},
        })),
    }}]}]});
    const signature = createHmac("sha256", Bun.env.META_APP_SECRET).update(raw).digest("hex");
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await app.handle(new Request("http://localhost/api/wa/cloud/webhook", {
            method: "POST", body: raw, headers: {"x-hub-signature-256": `sha256=${signature}`},
        }));
        assert.equal(response.status, 200);
    }

    const assessment = await eventually(
        () => queryClient<{level: string; wamid: string; response_type: string}[]>`
            select a.level, a.evidence->>'wamid' as wamid, m.response_type
            from lead_assessments a
            join leads l on l.id = a.lead_id
            join conversation_messages m on m.wamid = a.evidence->>'wamid'
            where l.account_id = ${accountId} and a.applied
            order by wamid
        `,
        rows => rows.length === cases.length && rows.every(row => row.response_type !== null),
        "WhatsApp ingestion, two model calls per lead, and persisted classification",
    );
    assert.deepEqual(assessment.map(row => row.level), cases.map(item => item.level));
    assert.deepEqual(assessment.map(row => row.response_type), cases.map(item => item.type));
    assert.equal(firstLevel.size, cases.length);
    assert.equal(secondLevel.size, cases.length);
    const milestones = await queryClient<{level: string}[]>`
        select m.level from lead_milestones m join leads l on l.id = m.lead_id
        where l.account_id = ${accountId}
    `;
    assert.deepEqual(milestones.map(row => row.level).sort(), ["HOT", "WARM"]);
    const [messageCount] = await queryClient<{total: number}[]>`
        select count(*)::int as total from conversation_messages m
        join leads l on l.id = m.lead_id where l.account_id = ${accountId}
    `;
    assert.equal(messageCount.total, cases.length);
    console.log("Lead pipeline: HOT, WARM, COLD; duplicate webhook kept exactly three messages.");

    const auth = new JwtUtil();
    const token = await auth.register({id: "qa", tenant: tenant.id, role: "ADMIN"});
    const scope = new URLSearchParams({accountId, since, until});
    async function get<T>(path: string): Promise<T> {
        const response = await app.handle(new Request(`http://localhost/api/${path}`, {
            headers: {authorization: `Bearer ${token.key}`},
        }));
        const body = await response.json();
        assert.equal(response.status, 200, `GET ${path}: ${JSON.stringify(body)}`);
        return body as T;
    }
    type Ref = {id: string; state: string; source: string; text: string};
    const summary = await get<{cards: {spend: {value: number}}; explanation: Ref}>(`analytics/summary?${scope}`);
    assert.equal(summary.cards.spend.value, 200000);
    const pollExplanation = (ref: Ref) => eventually(
        () => get<Ref>(`insights/explanations/${ref.id}`), row => row.state !== "PENDING", ref.id,
    );
    const ready = await pollExplanation(summary.explanation);
    assert.equal(ready.state, "READY");
    assert.equal(ready.source, "model");
    assert.match(ready.text, /Belanja .+ mencatat .+ lead\./);

    const funnel = await get<{objectiveGroup: string; stages: {key: string; value: number}[]}>(
        `analytics/funnel?${scope}&objectiveGroup=web`,
    );
    assert.equal(funnel.objectiveGroup, "web");
    assert.equal(funnel.stages.find(stage => stage.key === "purchase")?.value, 36);
    const leak = await get<{deltaPp: number; explanation: Ref}>(`analytics/leakage?${scope}`);
    assert.equal(leak.deltaPp, -5);
    const fallback = await pollExplanation(leak.explanation);
    assert.equal(fallback.state, "FALLBACK");
    assert.equal(fallback.source, "template");
    assert.equal(invalidLeakTemplates.length, 2);
    assert.match(fallback.text, /turun dari 25% ke 20%/);
    assert.equal((await get<{explanation: Ref}>(`analytics/summary?${scope}`)).explanation.id, ready.id);
    console.log("Analytics: summary READY, website funnel available, WhatsApp leakage −5 pp, invalid narrative retried then FALLBACK.");
} finally {
    await WorkerManager.closeAll();
    provider.stop(true);
    if (tenantId !== undefined) await db.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    await redisConnection.quit();
    await queryClient.end();
}
