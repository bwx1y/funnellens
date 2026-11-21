import {t, type UnwrapSchema} from "elysia";

const accountId = t.String({
    description: "Meta Ad Account ID",
});

const statusFilter = t.Optional(t.Union([
    t.Literal("active"),
    t.Literal("snoozed"),
    t.Literal("resolved"),
], {default: "active"}));

export const AlertsSchema = {
    list: t.Object({
        accountId,
        status: statusFilter,
    }),
    badge: t.Object({
        accountId,
    }),
    snooze: t.Object({
        hours: t.Union([t.Literal(24), t.Literal(168)], {
            description: "Snooze window: 24 hours or 168 hours (one week)",
        }),
    }),
    params: t.Object({
        id: t.String({
            pattern: "^\\d+$",
            description: "Alert ID",
        }),
    }),
};

export type AlertsSchema = {
    [k in keyof typeof AlertsSchema]: UnwrapSchema<typeof AlertsSchema[k]>
}
