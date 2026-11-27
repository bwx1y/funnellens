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
    recordedOrders: t.Object({
        date: t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Business day (YYYY-MM-DD)",
        }),
        orders: t.Integer({
            minimum: 0,
            description: "Orders actually booked that day",
        }),
        revenueMinor: t.Integer({
            minimum: 0,
            description: "Revenue in minor units (sen)",
        }),
    }),
    recordedOrdersQuery: t.Object({
        accountId,
    }),
    exports: t.Object({
        accountId: t.Optional(t.String({
            description: "Optional account filter on the recorded export parameters",
        })),
        page: t.Optional(t.String({
            description: "1-based page number, defaults to 1 and clamped to the last page",
        })),
        page_size: t.Optional(t.String({
            description: "Page size: 5, 10, 15, 20, 50, or 100 (default 10); any other value returns 400 INVALID_PAGE_SIZE",
        })),
    }),
}

export type ReportsSchema = {
    [k in keyof typeof ReportsSchema]: UnwrapSchema<typeof ReportsSchema[k]>
}
