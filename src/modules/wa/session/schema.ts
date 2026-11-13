import {t, type UnwrapSchema} from "elysia";

export const WaSessionSchema = {
    create: t.Object({
        name: t.String({
            minLength: 1,
            error: "Name is required",
            required: true
        })
    }),
    update: t.Object({
        name: t.Optional(t.String({
            minLength: 1,
            maxLength: 150,
            error: "name maximum 150 characters"
        })),
        phoneNumber: t.Optional(t.String({
            maxLength: 32,
            error: "phone number maximum 32 characters"
        })),
        phoneName: t.Optional(t.String({
            maxLength: 150,
            error: "phone name maximum 150 characters"
        }))
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