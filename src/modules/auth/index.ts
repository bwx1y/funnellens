import {Elysia} from "elysia";
import {AuthSchema} from "@/modules/auth/schema";
import {BadRequestError} from "@shared/errors";
import {AuthService} from "@/modules/auth/service";

export const AuthController = new Elysia({
    prefix: "/auth",
    detail: {
        tags: ["Authentication"]
    }
})
    .decorate("authService", new AuthService())
    .post("/login",
        async ({body, authService}) => authService.login(body),
        {
            body: AuthSchema.login,
            detail: {
                summary: "Login to your account"
            }
        }
    ).post("/register",
        async ({body, authService}) => authService.register(body),
        {
            body: AuthSchema.register,
            detail: {
                summary: "Register to create account"
            },
            beforeHandle({body}) {
                if (body.password !== body.confirmPassword) {
                    throw new BadRequestError("Passwords do not match");
                }
            }
        })
    .post("/forgot-password",
        async ({body, authService}) => authService.forgotPassword(body),
        {
            body: AuthSchema.forgotPassword,
            detail: {
                summary: "Request reset password code"
            }
        }
    )
    .post("/reset-password",
        async ({body, authService}) => authService.resetPassword(body),
        {
            body: AuthSchema.resetPassword,
            detail: {
                summary: "Reset password with code"
            },
            beforeHandle({body}) {
                if (body.newPassword !== body.confirmPassword) {
                    throw new BadRequestError("Passwords do not match");
                }
            }
        }
    )
    .post("/verify-email",
        async ({body, authService}) => authService.verifyEmail(body),
        {
            body: AuthSchema.verifyEmail,
            detail: {
                summary: "Verify user email"
            }
        }
    )
    .post("/resend-verification",
        async ({body, authService}) => authService.resendVerification(body),
        {
            body: AuthSchema.resendVerification,
            detail: {
                summary: "Resend email verification code"
            }
        }
    )
    .post("/refresh",
        async ({body, authService}) => authService.refresh(body),
        {
            body: AuthSchema.refresh,
            detail: {
                summary: "Refresh access token using refresh token"
            }
        }
    )
    .post("/logout",
        async ({body, authService}) => authService.logout(body),
        {
            body: AuthSchema.logout,
            detail: {
                summary: "Revoke refresh token on logout"
            }
        }
    )