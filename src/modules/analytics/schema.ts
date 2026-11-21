import {t, type UnwrapSchema} from "elysia";

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
        campaignId: t.Optional(t.String({
            description: "Optional campaign filter",
        })),
    }),
}

export type AnalyticsSchema = {
    [k in keyof typeof AnalyticsSchema]: UnwrapSchema<typeof AnalyticsSchema[k]>
}
