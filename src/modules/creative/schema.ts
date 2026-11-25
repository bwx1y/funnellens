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

const tagType = t.Union([
    t.Literal("hook_type"),
    t.Literal("format"),
    t.Literal("tone"),
    t.Literal("product_theme"),
]);

const tagSource = t.Union([t.Literal("manual"), t.Literal("ai")]);

export const CreativeSchema = {
    list: t.Object({
        accountId,
        since,
        until,
        days,
        campaignId: t.Optional(t.String({
            description: "Optional campaign filter; percentiles stay account-wide",
        })),
        sortBy: t.Optional(t.Union([
            t.Literal("spend"),
            t.Literal("results"),
            t.Literal("costPerResult"),
            t.Literal("ctr"),
            t.Literal("roas"),
            t.Literal("firstSeen"),
        ])),
    }),
    range: t.Object({
        accountId,
        since,
        until,
        days,
    }),
    experiments: t.Object({
        accountId,
        days,
    }),
    comparison: t.Object({
        accountId,
        snapshotId: t.Integer({minimum: 1}),
        creativeIds: t.Array(t.String({minLength: 1}), {minItems: 1, maxItems: 10}),
    }),
    tagCreate: t.Object({
        tagType,
        tagValue: t.String({minLength: 1, maxLength: 100}),
        source: t.Optional(tagSource),
        confidence: t.Optional(t.Number({minimum: 0, maximum: 1})),
    }),
    creativeParams: t.Object({
        id: t.String({minLength: 1, description: "Creative ID"}),
    }),
    tagParams: t.Object({
        id: t.String({minLength: 1}),
        tagId: t.String({pattern: "^\\d+$", description: "Tag ID"}),
    }),
}

export type CreativeSchema = {
    [k in keyof typeof CreativeSchema]: UnwrapSchema<typeof CreativeSchema[k]>
}
