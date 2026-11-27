import {t, type UnwrapSchema} from "elysia";

const accountId = t.String({
    description: "Meta Ad Account ID",
});

const tab = t.Optional(t.Union([
    t.Literal("active"),
    t.Literal("done"),
], {default: "active"}));

const reviewStatus = t.Union([
    t.Literal("read"),
    t.Literal("done"),
    t.Literal("active"),
], {
    description: "read keeps the insight in the active tab, done moves it out, active brings it back",
});

export const InsightSchema = {
    list: t.Object({
        accountId,
        tab,
    }),
    unread: t.Object({
        accountId,
    }),
    review: t.Object({
        status: reviewStatus,
        reason: t.Optional(t.String({
            description: "Why the user closed or reopened the insight; stored in the history trail",
        })),
    }),
    params: t.Object({
        key: t.String({
            description: "Insight key (`ruleKey:entityId`), never the database row id",
        }),
    }),
};

export type InsightSchema = {
    [k in keyof typeof InsightSchema]: UnwrapSchema<typeof InsightSchema[k]>
}
