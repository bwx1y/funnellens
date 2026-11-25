import {t, type UnwrapSchema} from "elysia";

const daysParam = t.Optional(t.Union([t.Literal(7), t.Literal(14), t.Literal(30)], {
    description: "Period duration in days (7, 14, 30)",
}));

export const AnalyticsSchema = {
    summary: t.Object({
        accountId: t.String({
            description: "Meta Ad Account ID",
        }),
        since: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Start date (YYYY-MM-DD), defaults to 29 days before until",
        })),
        until: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "End date (YYYY-MM-DD), defaults to today in the account timezone",
        })),
        days: daysParam,
        campaignId: t.Optional(t.String({
            description: "Optional campaign filter",
        })),
    }),
    funnel: t.Object({
        accountId: t.String({
            description: "Meta Ad Account ID",
        }),
        since: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Start date (YYYY-MM-DD), defaults to 29 days before until",
        })),
        until: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "End date (YYYY-MM-DD), defaults to today in the account timezone",
        })),
        days: daysParam,
        campaignId: t.Optional(t.String({
            description: "Optional campaign filter",
        })),
        objectiveGroup: t.Optional(t.Union([t.Literal("wa"), t.Literal("web")], {
            default: "wa",
            description: "Funnel channel: WhatsApp or Website",
        })),
    }),
    leakage: t.Object({
        accountId: t.String({
            description: "Meta Ad Account ID",
        }),
        since: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Start date (YYYY-MM-DD), defaults to 29 days before until",
        })),
        until: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "End date (YYYY-MM-DD), defaults to today in the account timezone",
        })),
        days: daysParam,
    }),
    stageDetail: t.Object({
        accountId: t.String({
            description: "Meta Ad Account ID",
        }),
        stageKey: t.String({
            description: "Funnel stage key (impressions, link_clicks, messaging_started, observed, replied, qualified, closed, lpv, view_content, add_to_cart, purchase)",
        }),
        since: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Start date (YYYY-MM-DD), defaults to 29 days before until",
        })),
        until: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "End date (YYYY-MM-DD), defaults to today in the account timezone",
        })),
        days: daysParam,
    }),
}

export type AnalyticsSchema = {
    [k in keyof typeof AnalyticsSchema]: UnwrapSchema<typeof AnalyticsSchema[k]>
}
