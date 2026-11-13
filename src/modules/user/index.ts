import {Elysia} from "elysia";
import {JwtUtil} from "@/utils/jwt";
import {ForbiddenError} from "@/utils/error";
import {UserService} from "@/modules/user/service";
import {UserSchema} from "@/modules/user/schema";

export const UserController = new Elysia({
    prefix: "/users",
    detail: {
        tags: ["Users"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("userService", new UserService())
    .use(JwtUtil.isAuthenticated)
    .onBeforeHandle(({user}) => {
        if (user.role !== "ADMIN") {
            throw new ForbiddenError("Only ADMIN can access this resource");
        }
    })
    .get("/",
        async ({user, userService}) => userService.findAll(user.tenantId),
        {
            detail: {
                summary: "List all users in same tenant"
            }
        })
    .get("/:id",
        async ({user, params: {id}, userService}) => userService.findById(id, user.tenantId),
        {
            params: UserSchema.params,
            detail: {
                summary: "Detail user in same tenant"
            }
        })
    .post("/",
        async ({user, body, userService, set}) => {
            const result = await userService.create(user.tenantId, body);
            set.status = 201;
            return result;
        },
        {
            body: UserSchema.create,
            detail: {
                summary: "Create user in same tenant"
            }
        })
    .put("/:id",
        async ({user, params: {id}, body, userService}) => userService.update(id, user.tenantId, body),
        {
            params: UserSchema.params,
            body: UserSchema.update,
            detail: {
                summary: "Update user in same tenant"
            }
        })
    .delete("/:id",
        async ({user, params: {id}, userService}) => userService.delete(id, user.iss, user.tenantId),
        {
            params: UserSchema.params,
            detail: {
                summary: "Delete user in same tenant"
            }
        });
