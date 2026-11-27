import {t, type UnwrapSchema} from "elysia";

export const SearchSchema = {
    search: t.Object({
        q: t.Optional(t.String({
            description: "Query; fewer than 2 characters returns the page list only",
        })),
        accountId: t.Optional(t.String({
            description: "Meta Ad Account ID; leads are searched only inside this account",
        })),
    }),
}

export type SearchSchema = {
    [k in keyof typeof SearchSchema]: UnwrapSchema<typeof SearchSchema[k]>
}
