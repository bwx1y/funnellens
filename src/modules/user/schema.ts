import {t, type UnwrapSchema} from "elysia";

export const UserSchema = {
    create: t.Object({
        fullName: t.String({
            minLength: 1,
            maxLength: 150,
            error: "full name maximum 150 characters"
        }),
        email: t.String({
            pattern: "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$",
            error: "email type must be email address"
        }),
        password: t.String({
            minLength: 6,
            error: "password minimum 6 characters"
        }),
        role: t.Optional(t.Union([
            t.Literal("ADMIN"),
            t.Literal("MANAGER")
        ]))
    }),
    update: t.Object({
        fullName: t.Optional(t.String({
            minLength: 1,
            maxLength: 150,
            error: "full name maximum 150 characters"
        })),
        email: t.Optional(t.String({
            pattern: "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$",
            error: "email type must be email address"
        })),
        password: t.Optional(t.String({
            minLength: 6,
            error: "password minimum 6 characters"
        })),
        role: t.Optional(t.Union([
            t.Literal("ADMIN"),
            t.Literal("MANAGER")
        ]))
    }),
    params: t.Object({
        id: t.String({
            format: "uuid",
            error: "id must be valid uuid"
        })
    })
} as const;

export type UserSchema = {
    [k in keyof typeof UserSchema]: UnwrapSchema<typeof UserSchema[k]>
};
