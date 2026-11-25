import {t, type UnwrapSchema} from "elysia";

export const WaSessionSchema = {
    create: t.Object({
        name: t.String({
            minLength: 1,
            pattern: "^\\S+$",
            error: "Name cannot contain spaces",
            required: true
        })
    }),
    update: t.Object({
        name: t.Optional(t.String({
            minLength: 1,
            maxLength: 150,
            pattern: "^\\S+$",
            error: "Name cannot contain spaces"
        })),
    }),
    params: t.Object({
        id: t.String({
            format: "uuid",
            error: "id must be valid uuid"
        })
    })
}

export type WaSessionSchema = {
    [k in keyof typeof WaSessionSchema]: UnwrapSchema<typeof WaSessionSchema[k]>
}