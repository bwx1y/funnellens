import {Elysia} from "elysia";
import {redisConnection} from "@infra/redis";
import {logger} from "@shared/logger";
import {ConflictError} from "@shared/errors";
import {actorOf} from "@/plugins/actor";

export const IDEMPOTENCY_HEADER = "idempotency-key";
const TTL_SECONDS = 24 * 60 * 60;

/** Webhooks are delivered by Meta/OpenWA, which retry on their own schedule and never send the header. */
const EXEMPT_PATHS = new Set([
    "/api/wa/cloud/webhook",
    "/api/wa/webhook",
]);

interface StoredResponse {
    bodyHash: string;
    status: number;
    body: unknown;
}

interface RequestState {
    redisKey: string;
    bodyHash: string;
}

const state = new WeakMap<Request, RequestState>();

/**
 * Replays a stored response when the same `Idempotency-Key` arrives again with the same body, so a
 * retried write cannot create a second row. A different body under the same key is a client bug and
 * answers 409 rather than silently replaying the first result.
 *
 * Only `POST` and `PATCH` participate, and only when the client sends the header.
 */
export const idempotency = new Elysia({name: "idempotency"})
    .onBeforeHandle({as: "global"}, async (context) => {
        const {request, body} = context;
        if (request.method !== "POST" && request.method !== "PATCH") return;
        // Elysia registers `/wa/webhook/` for the `"/"` route; compare without the trailing slash.
        if (EXEMPT_PATHS.has(new URL(request.url).pathname.replace(/\/$/, ""))) return;

        const actor = actorOf(context);
        if (actor === undefined) return;

        const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
        if (key === undefined || key === "") return;

        // Bodies are compared as serialised JSON: the parsed value has already lost key-order noise
        // from the transport, and hashing the raw text would make every retry look different.
        const bodyHash = JSON.stringify(body ?? null);
        const redisKey = `idem:${actor.userId}:${key}`;
        state.set(request, {redisKey, bodyHash});

        let raw: string | null;
        try {
            raw = await redisConnection.get(redisKey);
        } catch (error) {
            logger.warn({err: error, key}, "idempotency lookup failed, proceeding without replay");
            return;
        }

        if (raw === null) return;

        const stored = JSON.parse(raw) as StoredResponse;
        if (stored.bodyHash !== bodyHash) {
            throw new ConflictError("Idempotency-Key dipakai dengan body berbeda", "IDEMPOTENCY_CONFLICT");
        }

        return new Response(JSON.stringify(stored.body), {
            status: stored.status,
            headers: {"content-type": "application/json;charset=utf-8"},
        });
    })
    .onAfterResponse({as: "global"}, async ({request, responseValue, set}) => {
        const entry = state.get(request);
        if (entry === undefined) return;
        state.delete(request);

        const status = typeof set.status === "number" ? set.status : 200;
        // A 5xx is not a durable answer: the next attempt must be allowed to do the work again.
        if (status >= 500) return;

        try {
            await redisConnection.set(
                entry.redisKey,
                JSON.stringify({bodyHash: entry.bodyHash, status, body: responseValue} satisfies StoredResponse),
                "EX",
                TTL_SECONDS
            );
        } catch (error) {
            logger.warn({err: error}, "idempotency store failed");
        }
    });
