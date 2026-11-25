import {t, type UnwrapSchema} from "elysia";

const since = t.Optional(t.String({
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Start date (YYYY-MM-DD), defaults to 29 days before until",
}));

const until = t.Optional(t.String({
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "End date (YYYY-MM-DD), defaults to today in the account timezone",
}));

const days = t.Optional(t.Numeric({
    description: "Period duration in days (7, 14, 30)",
}));

const accountId = t.String({
    description: "Meta Ad Account ID",
});

export const ReportsSchema = {
    creativeTrend: t.Object({
        accountId,
        since,
        until,
        days,
        creativeId: t.Optional(t.String({
            description: "Optional creative filter; without it every creative of the account is summed",
        })),
    }),
    campaigns: t.Object({
        accountId,
        since,
        until,
        days,
        campaignId: t.Optional(t.String({
            description: "Optional campaign filter",
        })),
    }),
    exports: t.Object({
        accountId: t.Optional(t.String({
            description: "Optional account filter on the recorded export parameters",
        })),
    }),
}

export type ReportsSchema = {
    [k in keyof typeof ReportsSchema]: UnwrapSchema<typeof ReportsSchema[k]>
}
