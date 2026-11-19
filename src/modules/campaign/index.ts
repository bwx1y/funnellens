import {Elysia} from "elysia";
import {JwtUtil} from "@/utils/jwt";
import * as facebookSdk from "facebook-nodejs-business-sdk"

export const CampaignController = new Elysia({
    prefix: "campaign",
})
    .use(JwtUtil.isAuthenticated)
    .get("/", () => {
        const entity = facebookSdk.FacebookAdsApi.init("")
    })
