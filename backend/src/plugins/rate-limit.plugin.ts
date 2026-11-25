import {Elysia} from "elysia";
import {redisConnection} from "@infra/redis";
import {logger} from "@shared/logger";
import {RateLimitError} from "@shared/errors";
import {actorOf} from "@/plugins/actor";

export const RATE_LIMIT_PER_MINUTE = 120;

/** Paths that must never be throttled: probes are polled by the orchestrator, and a webhook answered
 * with 429 makes Meta or OpenWA drop the delivery instead of retrying it. */
const EXEMPT_PATHS = new Set([
    "/api/healthz",
    "/api/readyz",
    "/api/wa/cloud/webhook",
    "/api/wa/webhook",
]);

/**
 * Fixed-window counter per user. The window lives in the key (`rl:{userId}:{minute}`), so no cleanup
 * job is needed: the key expires on its own and the next minute starts a fresh bucket.
 *
 * Redis failures fail open — a cache outage must not become an API outage.
 */
export const rateLimit = new Elysia({name: "rate-limit"})
    .onBeforeHandle({as: "global"}, async (context) => {
        const {request, set} = context;
        // Elysia registers `/wa/webhook/` for the `"/"` route; compare without the trailing slash.
        if (EXEMPT_PATHS.has(new URL(request.url).pathname.replace(/\/$/, ""))) return;

        const actor = actorOf(context);
        if (actor === undefined) return;

        const minute = Math.floor(Date.now() / 60_000);
        const key = `rl:${actor.userId}:${minute}`;

        let count: number;
        try {
            count = await redisConnection.incr(key);
            if (count === 1) await redisConnection.expire(key, 60);
        } catch (error) {
            logger.warn({err: error, userId: actor.userId}, "rate limit check failed, allowing request");
            return;
        }

        if (count > RATE_LIMIT_PER_MINUTE) {
            set.headers["retry-after"] = String(60 - Math.floor((Date.now() % 60_000) / 1000));
            throw new RateLimitError(
                `Batas ${RATE_LIMIT_PER_MINUTE} permintaan per menit terlampaui`,
                "RATE_LIMITED"
            );
        }
    });
