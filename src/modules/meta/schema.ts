import {t, type UnwrapSchema} from "elysia";

export const MetaSchema = {
    oauthCallback: t.Object({
        state: t.String(),
        code: t.Optional(t.String()),
        error: t.Optional(t.String()),
        error_description: t.Optional(t.String()),
    }),
}

export type MetaSchema = {
    [k in keyof typeof MetaSchema]: UnwrapSchema<typeof MetaSchema[k]>
}
