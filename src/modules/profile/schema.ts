import {t, type UnwrapSchema} from "elysia";

export const ProfileSchema = {
    update: t.Object({
        fullName: t.String({
            minLength: 1,
            maxLength: 150,
            error: "full name maximum 150 characters"
        })
    }),
    updatePassword: t.Object({
        oldPassword: t.String({
            minLength: 6,
            error: "old password minimum 6 characters"
        }),
        newPassword: t.String({
            minLength: 6,
            error: "new password minimum 6 characters"
        }),
        confirmPassword: t.String({
            minLength: 6,
            error: "confirm password minimum 6 characters"
        })
    })
} as const;

export type ProfileSchema = {
    [k in keyof typeof ProfileSchema]: UnwrapSchema<typeof ProfileSchema[k]>
};
