import {Elysia} from "elysia";
import {AuthController} from "@/modules/auth";
import {ProfileController} from "@/modules/profile";
import {UserController} from "@/modules/user";
import {WaSessionController} from "@/modules/wa/session";
import {WaWebhookController} from "@/modules/wa/webhook";

export const routes = new Elysia({
    prefix: "/api"
})
    .use(AuthController)
    .use(ProfileController)
    .use(UserController)
    .use(WaSessionController)
    .use(WaWebhookController);