import {Elysia} from "elysia";
import {JwtUtil} from "@/utils/jwt";
import {ProfileService} from "@/modules/profile/service";
import {ProfileSchema} from "@/modules/profile/schema";
import {BadRequestError} from "@/utils/error";
export const ProfileController = new Elysia({
    prefix: "/profile",
    detail: {
        tags: ["Profile"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("profileService", new ProfileService())
    .use(JwtUtil.isAuthenticated)
    .get("/",
        async ({user, profileService}) => profileService.get(user.iss),
        {
            detail: {
                summary: "Detail user login"
            }
        })
    .put("/",
        async ({user, body, profileService}) => profileService.update(user.iss, body),
        {
            body: ProfileSchema.update,
            detail: {
                summary: "Update user profile"
            }
        })
    .put("/password",
        async ({user, body, profileService}) => profileService.updatePassword(user.iss, body),
        {
            body: ProfileSchema.updatePassword,
            detail: {
                summary: "Update user password"
            },
            beforeHandle({body}) {
                if (body.newPassword !== body.confirmPassword) {
                    throw new BadRequestError("Passwords do not match");
                }
            }
        })