import {bigint, date, numeric, pgView, text} from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
import {insightLevelEnum} from "@db/schema/enums";

/**
 * Satu baris per `ad_insights_daily` dengan angka aksi hasil precedence: Meta mengembalikan beberapa
 * alias untuk satu konversi di baris yang sama, jadi `max(...) filter (...)` mengambil satu representasi
 * per aksi. `results` adalah konversi sesuai objektif: percakapan untuk `wa`, pembelian untuk `web`.
 *
 * View ini sengaja tidak di-join ke `ads`: `ad_insights_daily.ad_id` nullable, jadi join ke `ads` akan
 * membuang baris tanpa `ad_id`. Query yang butuh `creative_id` melakukan join sendiri.
 */
export const AD_INSIGHT_METRICS_SQL = sql`
    select i.id                                  as id,
           i.account_id                          as account_id,
           i.campaign_id                         as campaign_id,
           i.adset_id                            as adset_id,
           i.ad_id                               as ad_id,
           i.date                                as date,
           i.level                               as level,
           i.attribution_window                  as attribution_window,
           i.spend_minor                         as spend_minor,
           i.impressions                         as impressions,
           i.reach                               as reach,
           i.clicks                              as clicks,
           i.inline_link_clicks                  as inline_link_clicks,
           coalesce(s.objective_group, 'web')    as objective_group,
           coalesce(per.leads, 0)                as leads,
           coalesce(per.purchases, 0)            as purchases,
           coalesce(per.purchase_value_minor, 0) as purchase_value_minor,
           coalesce(per.lpv, 0)                  as lpv,
           coalesce(per.view_content, 0)         as view_content,
           coalesce(per.add_to_cart, 0)          as add_to_cart,
           coalesce(case when coalesce(s.objective_group, 'web') = 'wa'
                         then per.leads
                         else per.purchases
                    end, 0)                       as results
    from ad_insights_daily i
    left join ad_sets s on s.id = i.adset_id
    left join (
        select a.insight_daily_id,
               coalesce(max(a.count) filter (where a.action_type = 'onsite_conversion.messaging_conversation_started_7d'),
                        max(a.count) filter (where a.action_type = 'lead'),
                        max(a.count) filter (where a.action_type = 'onsite_conversion.lead_grouped'),
                        max(a.count) filter (where a.action_type = 'offsite_conversion.fb_pixel_lead'),
                        0) as leads,
               coalesce(max(a.count) filter (where a.action_type = 'purchase'),
                        max(a.count) filter (where a.action_type = 'omni_purchase'),
                        max(a.count) filter (where a.action_type = 'offsite_conversion.fb_pixel_purchase'),
                        0) as purchases,
               coalesce(max(a.value_minor) filter (where a.action_type = 'purchase'),
                        max(a.value_minor) filter (where a.action_type = 'omni_purchase'),
                        max(a.value_minor) filter (where a.action_type = 'offsite_conversion.fb_pixel_purchase'),
                        0) as purchase_value_minor,
               coalesce(max(a.count) filter (where a.action_type = 'landing_page_view'), 0) as lpv,
               coalesce(max(a.count) filter (where a.action_type = 'view_content'),
                        max(a.count) filter (where a.action_type = 'offsite_conversion.fb_pixel_view_content'),
                        0) as view_content,
               coalesce(max(a.count) filter (where a.action_type = 'add_to_cart'),
                        max(a.count) filter (where a.action_type = 'offsite_conversion.fb_pixel_add_to_cart'),
                        0) as add_to_cart
        from ad_insight_actions a
        group by a.insight_daily_id
    ) per on per.insight_daily_id = i.id
`;

export const AdInsightMetricsView = pgView("ad_insight_metrics", {
    id: bigint("id", {mode: "number"}),
    accountId: text("account_id"),
    campaignId: text("campaign_id"),
    adsetId: text("adset_id"),
    adId: text("ad_id"),
    date: date("date"),
    level: insightLevelEnum("level"),
    attributionWindow: text("attribution_window"),
    spendMinor: bigint("spend_minor", {mode: "number"}),
    impressions: bigint("impressions", {mode: "number"}),
    reach: bigint("reach", {mode: "number"}),
    clicks: bigint("clicks", {mode: "number"}),
    inlineLinkClicks: bigint("inline_link_clicks", {mode: "number"}),
    objectiveGroup: text("objective_group"),
    leads: numeric("leads", {precision: 20, scale: 4}),
    purchases: numeric("purchases", {precision: 20, scale: 4}),
    purchaseValueMinor: bigint("purchase_value_minor", {mode: "number"}),
    lpv: numeric("lpv", {precision: 20, scale: 4}),
    viewContent: numeric("view_content", {precision: 20, scale: 4}),
    addToCart: numeric("add_to_cart", {precision: 20, scale: 4}),
    results: numeric("results", {precision: 20, scale: 4}),
}).as(AD_INSIGHT_METRICS_SQL);
