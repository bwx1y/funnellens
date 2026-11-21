import {t, type UnwrapSchema} from "elysia";

export const TrackingHealthSchema = {
    health: t.Object({
        accountId: t.String({
            description: "Meta Ad Account ID",
        }),
    }),
};

export type TrackingHealthSchema = {
    [k in keyof typeof TrackingHealthSchema]: UnwrapSchema<typeof TrackingHealthSchema[k]>
}
