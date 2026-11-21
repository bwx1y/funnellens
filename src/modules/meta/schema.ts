import {t, type UnwrapSchema} from "elysia";

export const MetaSchema = {
    oauthCallback: t.Object({
        state: t.String(),
        code: t.Optional(t.String()),
        error: t.Optional(t.String()),
        error_description: t.Optional(t.String()),
    }),
    selectAccount: t.Object({
        accountId: t.String({
            description: "Meta Ad Account ID (e.g. act_123456789 or 123456789)",
        }),
    }),
    syncMaster: t.Optional(t.Object({
        accountId: t.Optional(t.String({
            description: "Optional Ad Account ID to sync (defaults to account from database)",
        })),
    })),
    syncInsights: t.Optional(t.Object({
        accountId: t.Optional(t.String({
            description: "Optional Ad Account ID to sync (defaults to selected/active account)",
        })),
        since: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Start date (YYYY-MM-DD), defaults to 30 days ago",
        })),
        until: t.Optional(t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "End date (YYYY-MM-DD), defaults to today",
        })),
        includeBreakdowns: t.Optional(t.Boolean({
            default: true,
            description: "Whether to sync publisher platform / placement / device breakdowns",
        })),
    })),
    nonAdditiveMetrics: t.Object({
        accountId: t.Optional(t.String({
            description: "Optional Ad Account ID (defaults to active account in database)",
        })),
        level: t.Optional(t.Union([
            t.Literal("account"),
            t.Literal("campaign"),
            t.Literal("adset"),
            t.Literal("ad"),
        ], {default: "account", description: "Aggregation level"})),
        entityId: t.Optional(t.String({
            description: "Target entity ID (required if level is campaign/adset/ad)",
        })),
        since: t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Start date (YYYY-MM-DD)",
        }),
        until: t.String({
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "End date (YYYY-MM-DD)",
        }),
    }),
    queueDailySync: t.Optional(t.Object({
        accountId: t.Optional(t.String()),
    })),
    queueTrailingSync: t.Optional(t.Object({
        accountId: t.Optional(t.String()),
    })),
    queuePixelStatsSync: t.Optional(t.Object({
        accountId: t.Optional(t.String()),
    })),
}

export type MetaSchema = {
    [k in keyof typeof MetaSchema]: UnwrapSchema<typeof MetaSchema[k]>
}
