import postgres from "postgres";
import {Config} from "@/config";
import {PasswordUtil} from "@shared/password";
import {addDays} from "@shared/dates";
import {REPLY_TYPES} from "@shared/audience";

const sql = postgres({
    host: Config.database.host,
    port: Config.database.port,
    user: Config.database.user,
    password: Config.database.password,
    database: Config.database.name,
    max: 1,
});

const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_ACCOUNT_ID = "act_demo_funnellens";
const DEMO_USER_EMAIL = "demo@funnellens.test";

export async function seedDemo(client = sql): Promise<void> {
    console.log(`[db:seed] Seeding demo dataset into tenant "${DEMO_TENANT_ID}" and account "${DEMO_ACCOUNT_ID}"...`);

    // 1. Ensure demo tenant
    await client`
        insert into tenants (id, name, address)
        values (${DEMO_TENANT_ID}, 'FunnelLens Demo Workspace', 'Jakarta, Indonesia')
        on conflict (id) do nothing
    `;

    // 2. Ensure demo admin user
    const hash = await PasswordUtil.hash("demo123456");
    await client`
        insert into users (id, full_name, email, hash_password, role, verified_at, tenant_id)
        values (
            '00000000-0000-4000-8000-000000000002',
            'Demo Admin',
            ${DEMO_USER_EMAIL},
            ${hash},
            'ADMIN',
            now(),
            ${DEMO_TENANT_ID}
        )
        on conflict (email) do nothing
    `;

    // 3. Ensure demo ad account
    await client`
        insert into ad_accounts (
            id, tenant_id, name, currency, currency_offset, timezone_name, is_selected, created_at, updated_at
        )
        values (
            ${DEMO_ACCOUNT_ID},
            ${DEMO_TENANT_ID},
            'Demo Ad Account',
            'IDR',
            100,
            'Asia/Jakarta',
            true,
            now(),
            now()
        )
        on conflict (id) do update set
            currency = 'IDR',
            currency_offset = 100,
            timezone_name = 'Asia/Jakarta',
            is_selected = true,
            tenant_id = ${DEMO_TENANT_ID}
    `;

    // 4. Clean up existing rows for act_demo_funnellens in FK order
    await client`
        delete from ad_insight_actions where insight_daily_id in (
            select id from ad_insights_daily where account_id = ${DEMO_ACCOUNT_ID}
        )
    `;
    await client`delete from ad_insights_breakdown_daily where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`delete from ad_insights_daily where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`
        delete from conversation_messages where lead_id in (
            select id from leads where account_id = ${DEMO_ACCOUNT_ID}
        )
    `;
    await client`
        delete from lead_milestones where lead_id in (
            select id from leads where account_id = ${DEMO_ACCOUNT_ID}
        )
    `;
    await client`
        delete from lead_assessments where lead_id in (
            select id from leads where account_id = ${DEMO_ACCOUNT_ID}
        )
    `;
    await client`delete from leads where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`delete from tracking_health_daily where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`delete from pixel_sources where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`delete from insight_alerts where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`delete from explanations where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`delete from ads where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`delete from ad_sets where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`delete from campaigns where account_id = ${DEMO_ACCOUNT_ID}`;
    await client`delete from ad_creatives where account_id = ${DEMO_ACCOUNT_ID}`;

    // 5. Campaigns (3 campaigns: Prospecting (wa), Retargeting (wa), Website Checkout (web))
    const campProspecting = "camp_demo_prospecting";
    const campRetargeting = "camp_demo_retargeting";
    const campWeb = "camp_demo_web";

    await client`
        insert into campaigns (id, account_id, name, objective, status)
        values
            (${campProspecting}, ${DEMO_ACCOUNT_ID}, 'Prospecting', 'OUTCOME_LEADS', 'ACTIVE'),
            (${campRetargeting}, ${DEMO_ACCOUNT_ID}, 'Retargeting', 'OUTCOME_LEADS', 'ACTIVE'),
            (${campWeb}, ${DEMO_ACCOUNT_ID}, 'Website Checkout', 'OUTCOME_SALES', 'ACTIVE')
    `;

    // Ad sets
    const adsetProspecting = "adset_demo_prospecting";
    const adsetRetargeting = "adset_demo_retargeting";
    const adsetWeb = "adset_demo_web";

    await client`
        insert into ad_sets (id, account_id, campaign_id, name, status, objective_group)
        values
            (${adsetProspecting}, ${DEMO_ACCOUNT_ID}, ${campProspecting}, 'Prospecting AdSet', 'ACTIVE', 'wa'),
            (${adsetRetargeting}, ${DEMO_ACCOUNT_ID}, ${campRetargeting}, 'Retargeting AdSet', 'ACTIVE', 'wa'),
            (${adsetWeb}, ${DEMO_ACCOUNT_ID}, ${campWeb}, 'Website Checkout AdSet', 'ACTIVE', 'web')
    `;

    // 11 Creatives & 11 Ads (1-to-1)
    // 5 in Prospecting (cr_demo_01..05), 3 in Retargeting (cr_demo_06..08), 3 in Website (cr_demo_09..11)
    // cr_demo_01 is cr_price_c / fatigue creative with dropping CTR
    const creatives = [
        {id: "cr_demo_01", name: "cr_price_c", type: "VIDEO", len: 30, adset: adsetProspecting, camp: campProspecting},
        {id: "cr_demo_02", name: "cr_benefit_hook", type: "VIDEO", len: 15, adset: adsetProspecting, camp: campProspecting},
        {id: "cr_demo_03", name: "cr_social_proof", type: "IMAGE", len: null, adset: adsetProspecting, camp: campProspecting},
        {id: "cr_demo_04", name: "cr_ugc_review", type: "VIDEO", len: 45, adset: adsetProspecting, camp: campProspecting},
        {id: "cr_demo_05", name: "cr_promo_banner", type: "IMAGE", len: null, adset: adsetProspecting, camp: campProspecting},
        {id: "cr_demo_06", name: "cr_retarget_reminder", type: "IMAGE", len: null, adset: adsetRetargeting, camp: campRetargeting},
        {id: "cr_demo_07", name: "cr_retarget_discount", type: "IMAGE", len: null, adset: adsetRetargeting, camp: campRetargeting},
        {id: "cr_demo_08", name: "cr_retarget_testimonial", type: "VIDEO", len: 20, adset: adsetRetargeting, camp: campRetargeting},
        {id: "cr_demo_09", name: "cr_web_catalog", type: "IMAGE", len: null, adset: adsetWeb, camp: campWeb},
        {id: "cr_demo_10", name: "cr_web_showcase", type: "VIDEO", len: 25, adset: adsetWeb, camp: campWeb},
        {id: "cr_demo_11", name: "cr_web_offer", type: "IMAGE", len: null, adset: adsetWeb, camp: campWeb},
    ];

    for (const cr of creatives) {
        await client`
            insert into ad_creatives (id, account_id, name, object_type, video_length_seconds)
            values (${cr.id}, ${DEMO_ACCOUNT_ID}, ${cr.name}, ${cr.type}, ${cr.len})
        `;
        const adId = `ad_${cr.id}`;
        await client`
            insert into ads (id, account_id, campaign_id, adset_id, creative_id, name, status)
            values (${adId}, ${DEMO_ACCOUNT_ID}, ${cr.camp}, ${cr.adset}, ${cr.id}, ${'Ad ' + cr.name}, 'ACTIVE')
        `;
    }

    // 6. 63 days ad_insights_daily (ending 2026-11-25)
    // 63 days: from 2026-09-24 to 2026-11-25.
    // 11 ads * 63 days = 693 rows.
    const dates: string[] = [];
    for (let i = 62; i >= 0; i--) {
        dates.push(addDays("2026-11-25", -i));
    }

    // Build batch insertions
    interface DailyInsightRow {
        adId: string;
        campId: string;
        adsetId: string;
        date: string;
        spendMinor: number;
        impressions: number;
        clicks: number;
        inlineLinkClicks: number;
        ctr: number;
        reach: number;
        frequency: number;
        actions: {action_type: string; count: number; value_minor?: number}[];
    }

    const dailyRows: DailyInsightRow[] = [];

    dates.forEach((date, dayIdx) => {
        creatives.forEach((cr) => {
            const adId = `ad_${cr.id}`;
            const isWa = cr.camp === campProspecting || cr.camp === campRetargeting;
            
            let impressions = 1000;
            let clicks = 50;
            let inlineLinkClicks = 40;
            let spendMinor = 50000;
            let reach = 800;

            if (cr.id === "cr_demo_01") {
                // cr_price_c: decaying CTR from ~0.06 down to ~0.02
                // dayIdx 0 -> 60 clicks, dayIdx 62 -> 15 clicks
                clicks = Math.max(15, Math.round(60 - (dayIdx * 45) / 62));
                inlineLinkClicks = Math.round(clicks * 0.8);
            }

            const ctr = clicks / impressions;
            const frequency = impressions / reach;

            const actions: {action_type: string; count: number; value_minor?: number}[] = [];
            if (isWa) {
                // ~2 conversations per ad per day
                actions.push({
                    action_type: "onsite_conversion.messaging_conversation_started_7d",
                    count: 2,
                });
            } else {
                // Web campaign
                actions.push(
                    {action_type: "landing_page_view", count: 30},
                    {action_type: "view_content", count: 25},
                    {action_type: "add_to_cart", count: 10},
                    {action_type: "purchase", count: 3, value_minor: 300000}
                );
            }

            dailyRows.push({
                adId,
                campId: cr.camp,
                adsetId: cr.adset,
                date,
                spendMinor,
                impressions,
                clicks,
                inlineLinkClicks,
                ctr,
                reach,
                frequency,
                actions,
            });
        });
    });

    // Insert ad_insights_daily in chunks
    const CHUNK_SIZE = 200;
    for (let i = 0; i < dailyRows.length; i += CHUNK_SIZE) {
        const slice = dailyRows.slice(i, i + CHUNK_SIZE);
        const inserted = await client`
            insert into ad_insights_daily ${client(
                slice.map((r) => ({
                    account_id: DEMO_ACCOUNT_ID,
                    level: "ad",
                    entity_id: r.adId,
                    campaign_id: r.campId,
                    adset_id: r.adsetId,
                    ad_id: r.adId,
                    date: r.date,
                    attribution_window: "7d_click",
                    currency: "IDR",
                    currency_offset: 100,
                    spend_minor: r.spendMinor,
                    impressions: r.impressions,
                    reach: r.reach,
                    frequency: r.frequency,
                    clicks: r.clicks,
                    inline_link_clicks: r.inlineLinkClicks,
                    ctr: r.ctr,
                }))
            )}
            returning id, ad_id, date
        `;

        // Map inserted id with actions
        const actionRows: {insight_daily_id: number; action_type: string; count: number; value_minor?: number}[] = [];
        inserted.forEach((ins) => {
            const insDateStr = ins.date instanceof Date ? ins.date.toISOString().slice(0, 10) : String(ins.date).slice(0, 10);
            const original = slice.find((r) => r.adId === ins.ad_id && r.date === insDateStr);
            if (original) {
                original.actions.forEach((act) => {
                    actionRows.push({
                        insight_daily_id: Number(ins.id),
                        action_type: act.action_type,
                        count: act.count,
                        value_minor: act.value_minor,
                    });
                });
            }
        });

        if (actionRows.length > 0) {
            await client`
                insert into ad_insight_actions ${client(
                    actionRows.map((a) => ({
                        insight_daily_id: a.insight_daily_id,
                        action_type: a.action_type,
                        count: a.count,
                        value_minor: a.value_minor ?? null,
                    }))
                )}
            `;
        }
    }

    // 7. 8 Leads in leads: 3 HOT, 3 WARM, 2 COLD
    // 4 leads with first_replied_at, 4 without (first_replied_at null).
    // The 4 leads with reply should produce median reply interval of exactly 24 minutes (1440 seconds).
    // Delays: 18 min (1080s), 22 min (1320s), 26 min (1560s), 30 min (1800s).
    // Median of [1080, 1320, 1560, 1800] in Postgres percentile_cont(0.5) is (1320 + 1560)/2 = 1440 seconds!
    const replyDelaysSeconds = [1080, 1320, 1560, 1800]; // 4 leads with reply

    const leadsData = [
        // 3 HOT
        {name: "Lead Demo 1 (Hot)", temp: "HOT", stage: "QUALIFIED", hasReply: true, delay: replyDelaysSeconds[0]},
        {name: "Lead Demo 2 (Hot)", temp: "HOT", stage: "CLOSING", hasReply: true, delay: replyDelaysSeconds[1]},
        {name: "Lead Demo 3 (Hot)", temp: "HOT", stage: "CHAT_STARTED", hasReply: false, delay: 0},
        // 3 WARM
        {name: "Lead Demo 4 (Warm)", temp: "WARM", stage: "REPLIED", hasReply: true, delay: replyDelaysSeconds[2]},
        {name: "Lead Demo 5 (Warm)", temp: "WARM", stage: "REPLIED", hasReply: true, delay: replyDelaysSeconds[3]},
        {name: "Lead Demo 6 (Warm)", temp: "WARM", stage: "CHAT_STARTED", hasReply: false, delay: 0},
        // 2 COLD
        {name: "Lead Demo 7 (Cold)", temp: "COLD", stage: "CHAT_STARTED", hasReply: false, delay: 0},
        {name: "Lead Demo 8 (Cold)", temp: "COLD", stage: "CHAT_STARTED", hasReply: false, delay: 0},
    ];

    const insertedLeads: {id: number; temp: string; name: string; hasReply: boolean; delay: number; seenAt: Date; repliedAt: Date | null}[] = [];

    for (let i = 0; i < leadsData.length; i++) {
        const item = leadsData[i];
        const seenAt = new Date("2026-11-20T10:00:00.000Z");
        seenAt.setHours(seenAt.getHours() + i);
        const repliedAt = item.hasReply ? new Date(seenAt.getTime() + item.delay * 1000) : null;
        const phone = `62812000000${i + 1}`;
        const phoneMasked = `62812****00${i + 1}`;
        const adId = `ad_${creatives[i % 5].id}`;
        const crId = creatives[i % 5].id;

        const [lead] = await client`
            insert into leads (
                account_id, external_id, name, phone_masked, campaign_id, adset_id, ad_id, creative_id,
                temperature, stage, first_seen_at, first_replied_at, qualified_at, created_at, updated_at
            )
            values (
                ${DEMO_ACCOUNT_ID},
                ${'ext_lead_' + (i + 1)},
                ${item.name},
                ${phoneMasked},
                ${campProspecting},
                ${adsetProspecting},
                ${adId},
                ${crId},
                ${item.temp},
                ${item.stage},
                ${seenAt},
                ${repliedAt},
                ${item.stage === "QUALIFIED" || item.stage === "CLOSING" ? seenAt : null},
                ${seenAt},
                now()
            )
            returning id
        `;

        insertedLeads.push({
            id: lead.id,
            temp: item.temp,
            name: item.name,
            hasReply: item.hasReply,
            delay: item.delay,
            seenAt,
            repliedAt,
        });
    }

    // 8. Lead Assessments (1 per lead, applied = true, rule_version = 'seed-v1') & Milestones for WARM/HOT
    for (const lead of insertedLeads) {
        await client`
            insert into lead_assessments (
                lead_id, level, confidence, reason, event_at, applied, rule_version, created_at
            )
            values (
                ${lead.id},
                ${lead.temp},
                'tinggi',
                'Seed assessment rule match',
                ${lead.seenAt},
                true,
                'seed-v1',
                ${lead.seenAt}
            )
        `;

        if (lead.temp === "WARM") {
            await client`
                insert into lead_milestones (lead_id, level, first_at)
                values (${lead.id}, 'WARM', ${lead.seenAt})
            `;
        } else if (lead.temp === "HOT") {
            await client`
                insert into lead_milestones (lead_id, level, first_at)
                values
                    (${lead.id}, 'WARM', ${lead.seenAt}),
                    (${lead.id}, 'HOT', ${lead.seenAt})
            `;
        }
    }

    // 9. Conversation messages (INBOUND + OUTBOUND pairs per lead)
    // Must cover all 7 REPLY_TYPES:
    // "Komitmen", "Tanya lanjut", "Keberatan", "Menunda", "Menolak", "Pengakuan netral", "Di luar topik"
    // And for timed responses, the response_seconds for the first measured response should match lead delay (median 1440s).
    for (let i = 0; i < insertedLeads.length; i++) {
        const lead = insertedLeads[i];
        const replyType = REPLY_TYPES[i % REPLY_TYPES.length];
        const wamidIn = `wamid_in_demo_${lead.id}`;
        const wamidOut = `wamid_out_demo_${lead.id}`;

        const inboundTime = lead.seenAt;
        const outboundTime = lead.repliedAt ?? new Date(lead.seenAt.getTime() + 3600 * 1000);
        const respSec = lead.hasReply ? lead.delay : null;

        await client`
            insert into conversation_messages (
                lead_id, wamid, direction, sender_role, body, sent_at,
                replied_at, pair_method, response_seconds, response_type, sentiment
            )
            values (
                ${lead.id},
                ${wamidIn},
                'INBOUND',
                'LEAD',
                ${'Halo ' + replyType},
                ${inboundTime},
                ${lead.hasReply ? outboundTime : null},
                ${lead.hasReply ? 'reply' : null},
                ${respSec},
                ${replyType},
                'positif'
            )
        `;

        if (lead.hasReply) {
            await client`
                insert into conversation_messages (
                    lead_id, wamid, context_wamid, direction, sender_role, body, sent_at
                )
                values (
                    ${lead.id},
                    ${wamidOut},
                    ${wamidIn},
                    'OUTBOUND',
                    'CS',
                    'Halo, ada yang bisa kami bantu?',
                    ${outboundTime}
                )
            `;
        }
    }

    // 10. Breakdown daily: 14 last days for 3 combinations of publisher_platform / platform_position / impression_device
    // Combinations:
    // 1: facebook / feed / all
    // 2: instagram / feed / all
    // 3: instagram / story / all
    const last14Days = dates.slice(-14);
    const breakdownCombos = [
        {platform: "facebook", pos: "feed", dev: "all", hash: "fb_feed_all"},
        {platform: "instagram", pos: "feed", dev: "all", hash: "ig_feed_all"},
        {platform: "instagram", pos: "story", dev: "all", hash: "ig_story_all"},
    ];

    const breakdownRows: any[] = [];
    last14Days.forEach((date) => {
        creatives.slice(0, 5).forEach((cr) => {
            const adId = `ad_${cr.id}`;
            breakdownCombos.forEach((combo) => {
                breakdownRows.push({
                    account_id: DEMO_ACCOUNT_ID,
                    level: "ad",
                    entity_id: adId,
                    campaign_id: cr.camp,
                    adset_id: cr.adset,
                    ad_id: adId,
                    date,
                    attribution_window: "7d_click",
                    publisher_platform: combo.platform,
                    platform_position: combo.pos,
                    impression_device: combo.dev,
                    breakdown_hash: combo.hash,
                    spend_minor: 10000,
                    impressions: 200,
                    clicks: 10,
                    inline_link_clicks: 8,
                });
            });
        });
    });

    for (let i = 0; i < breakdownRows.length; i += CHUNK_SIZE) {
        await client`
            insert into ad_insights_breakdown_daily ${client(breakdownRows.slice(i, i + CHUNK_SIZE))}
        `;
    }

    // 11. Pixel source + tracking_health_daily (4 events on 2026-11-25)
    await client`
        insert into pixel_sources (id, account_id, pixel_id, name, capi_configured, emq_avg, last_synced_at)
        values (
            'pix_demo_source',
            ${DEMO_ACCOUNT_ID},
            '123456789012345',
            'Demo Website Pixel',
            true,
            8.50,
            '2026-11-25T12:00:00.000Z'
        )
    `;

    const trackingEvents = ["PageView", "ViewContent", "AddToCart", "Purchase"];
    for (const eventName of trackingEvents) {
        await client`
            insert into tracking_health_daily (
                account_id, date, event_name, browser_count, server_count, dedup_rate, match_quality, status
            )
            values (
                ${DEMO_ACCOUNT_ID},
                '2026-11-25',
                ${eventName},
                100,
                98,
                0.98,
                8.50,
                'NORMAL'
            )
        `;
    }

    // 12. Insight Alerts: 5 rows (3 ACTIVE - one CRITICAL, 1 DONE, 1 SNOOZED)
    await client`
        insert into insight_alerts (
            account_id, rule_key, level, title, entity_type, entity_id, status, confidence, detected_at, updated_at
        )
        values
            (
                ${DEMO_ACCOUNT_ID},
                'critical_drop_conversion',
                'CRITICAL',
                'Konversi Mengalami Penurunan Signifikan',
                'account',
                '',
                'ACTIVE',
                'tinggi',
                now(),
                now()
            ),
            (
                ${DEMO_ACCOUNT_ID},
                'creative_fatigue',
                'WARNING',
                'Kreatif cr_price_c Terindikasi Fatigue',
                'ad',
                'ad_cr_demo_01',
                'ACTIVE',
                'sedang',
                now(),
                now()
            ),
            (
                ${DEMO_ACCOUNT_ID},
                'tracking_emq',
                'WARNING',
                'EMQ Pixel Perlu Perhatian',
                'account',
                '',
                'ACTIVE',
                'sedang',
                now(),
                now()
            ),
            (
                ${DEMO_ACCOUNT_ID},
                'resolved_warning',
                'WARNING',
                'Peringatan Telah Diselesaikan',
                'account',
                '',
                'DONE',
                'sedang',
                now(),
                now()
            ),
            (
                ${DEMO_ACCOUNT_ID},
                'snoozed_alert',
                'INFO',
                'Alert Ditunda Sementara',
                'account',
                '',
                'SNOOZED',
                'rendah',
                now(),
                now()
            )
    `;

    // Mark resolved_at for DONE and snoozed_until for SNOOZED
    await client`
        update insight_alerts
        set resolved_at = now()
        where account_id = ${DEMO_ACCOUNT_ID} and status = 'DONE'
    `;
    await client`
        update insight_alerts
        set snoozed_until = now() + interval '24 hours'
        where account_id = ${DEMO_ACCOUNT_ID} and status = 'SNOOZED'
    `;

    console.log("[db:seed] ✓ Dataset parity demo berhasil dibuat.");
}

async function run() {
    try {
        await seedDemo();
    } catch (error) {
        console.error("[db:seed] Gagal melakukan seed data demo:", error);
        process.exit(1);
    } finally {
        await sql.end();
    }
}

// When invoked directly from CLI
if (import.meta.main) {
    run();
}
