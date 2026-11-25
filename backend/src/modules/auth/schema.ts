import {t, type UnwrapSchema} from "elysia";

export const AuthSchema = {
    login: t.Object({
        email: t.String({
            pattern: "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$",
            error: "email type must be email address"
        }),
        password: t.String({
            minLength: 6,
            error: "password minimum 6 characters"
        })
    }),
    register: t.Object({
        fullName: t.String({
            maxLength: 150,
            error: "full name max characters 150"
        }),
        email: t.String({
            maxLength: 150,
            pattern: "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$",
            error: "email type must be email address and maximum 150 characters"
        }),
        password: t.String({
            minLength: 6,
            error: "password minimum 6 characters"
        }),
        confirmPassword: t.String({
            minLength: 6,
            error: "confirm password minimum 6 characters"
        }),
        tenant: t.Object({
            name: t.String({
                maxLength: 200,
                error: "tenant name maximum 200 characters"
            }),
            address: t.Nullable(
                t.String({
                    error: "address must be string or null",
                })
            )
        })
    }),
    forgotPassword: t.Object({
        email: t.String({
            pattern: "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$",
            error: "email type must be email address"
        })
    }),
    resetPassword: t.Object({
        email: t.String({
            pattern: "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$",
            error: "email type must be email address"
        }),
        code: t.String({
            minLength: 6,
            maxLength: 6,
            error: "code must be 6 characters"
        }),
        newPassword: t.String({
            minLength: 6,
            error: "new password minimum 6 characters"
        }),
        confirmPassword: t.String({
            minLength: 6,
            error: "confirm password minimum 6 characters"
        })
    }),
    verifyEmail: t.Object({
        email: t.String({
            pattern: "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$",
            error: "email type must be email address"
        }),
        code: t.String({
            minLength: 6,
            maxLength: 6,
            error: "code must be 6 characters"
        })
    }),
    resendVerification: t.Object({
        email: t.String({
            pattern: "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$",
            error: "email type must be email address"
        })
    })
} as const

export type AuthSchema = {
    [k in keyof typeof AuthSchema]: UnwrapSchema<typeof AuthSchema[k]>
}