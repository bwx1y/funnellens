import {t, type UnwrapSchema} from "elysia";

const since = t.Optional(t.String({
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Start date (YYYY-MM-DD), defaults to 29 days before until",
}));

const until = t.Optional(t.String({
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "End date (YYYY-MM-DD), defaults to today in the account timezone",
}));

const days = t.Optional(t.Union([t.Literal(7), t.Literal(14), t.Literal(30)], {
    description: "Period duration in days (7, 14, 30)",
}));

const accountId = t.String({
    description: "Meta Ad Account ID",
});

const temperature = t.Union([t.Literal("COLD"), t.Literal("WARM"), t.Literal("HOT")]);

const stage = t.Union([
    t.Literal("CHAT_STARTED"),
    t.Literal("REPLIED"),
    t.Literal("QUALIFIED"),
    t.Literal("CLOSING"),
    t.Literal("CLOSED"),
]);

export const AudienceSchema = {
    audience: t.Object({
        accountId,
        since,
        until,
        days,
        campaignId: t.Optional(t.String({
            description: "Optional campaign filter",
        })),
    }),
    speed: t.Object({
        accountId,
        since,
        until,
        days,
    }),
    segments: t.Object({
        accountId,
        since,
        until,
        days,
    }),
    pipeline: t.Object({
        accountId,
        since,
        until,
        days,
    }),
    conversations: t.Object({
        accountId,
        since,
        until,
        days,
    }),
    leadList: t.Object({
        accountId,
        temperature: t.Optional(temperature),
        stage: t.Optional(stage),
        search: t.Optional(t.String({
            description: "Case-insensitive match on name or masked phone",
        })),
        page: t.Optional(t.String({
            pattern: "^[1-9]\\d*$",
            description: "1-based page number, defaults to 1",
        })),
        limit: t.Optional(t.String({
            pattern: "^[1-9]\\d*$",
            description: "Page size, defaults to 20 (max 100)",
        })),
        sortBy: t.Optional(t.Union([t.Literal("createdAt"), t.Literal("firstSeenAt")])),
    }),
    leadUpdate: t.Object({
        stage: t.Optional(stage),
        temperature: t.Optional(temperature),
        dealValueMinor: t.Optional(t.Integer({minimum: 0})),
    }),
    leadParams: t.Object({
        id: t.String({pattern: "^\\d+$", description: "Lead ID"}),
    }),
}

export type AudienceSchema = {
    [k in keyof typeof AudienceSchema]: UnwrapSchema<typeof AudienceSchema[k]>
}
