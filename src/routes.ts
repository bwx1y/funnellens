import {Elysia} from "elysia";
import {AuthController} from "@/modules/auth";
import {ProfileController} from "@/modules/profile";
import {UserController} from "@/modules/user";
import {WaSessionController} from "@/modules/wa/session";
import {WaWebhookController} from "@/modules/wa/webhook";
import {WaContactController} from "@/modules/wa/contact";
import {MetaController, MetaOAuthController} from "@/modules/meta";
import {AnalyticsController} from "@/modules/analytics";
import {AudienceController, LeadController} from "@/modules/audience";
import {CreativeController} from "@/modules/creative";
import {TrackingHealthController} from "@/modules/tracking-health";
import {AlertsController} from "@/modules/alerts";

export const routes = new Elysia({
    prefix: "/api"
})
    .use(AuthController)
    .use(ProfileController)
    .use(UserController)
    .use(WaSessionController)
    .use(WaWebhookController)
    .use(WaContactController)
    .use(MetaOAuthController)
    .use(MetaController)
    .use(AnalyticsController)
    .use(AudienceController)
    .use(LeadController)
    .use(CreativeController)
    .use(TrackingHealthController)
    .use(AlertsController);