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
        page: t.Optional(t.String({
            description: "1-based page number, defaults to 1 and clamped to the last page",
        })),
        page_size: t.Optional(t.String({
            description: "Page size: 5, 10, 15, 20, 50, or 100 (default 10); any other value returns 400 INVALID_PAGE_SIZE",
        })),
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
