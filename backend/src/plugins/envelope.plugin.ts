import {Elysia} from "elysia";
import {requestIdOf} from "@/plugins/logger.plugin";
import {isCacheHit} from "@shared/request-context";

/**
 * Paths whose responses are consumed by something other than our own client: Meta/OpenWA verify their
 * webhooks by reading the body verbatim, and probes must answer with a bare status payload.
 */
const SKIP_PREFIXES = [
    "/api/wa/cloud/webhook",
    "/api/wa/webhook",
    // Both probes are read by an orchestrator that only understands a bare status payload.
    "/api/healthz",
    "/api/readyz",
];

export interface EnvelopeMeta {
    requestId: string;
    cached?: boolean;
}

/**
 * A paginated payload carries its own `data` and `meta` keys, so the shape alone is not proof: only a
 * `meta.requestId` marks a body this plugin already wrapped.
 */
function alreadyEnveloped(value: unknown): boolean {
    if (value === null || typeof value !== "object" || value instanceof Response) return false;
    if (!("data" in value) || !("meta" in value)) return false;

    const {meta} = value;
    return meta !== null
        && typeof meta === "object"
        && "requestId" in meta
        && typeof meta.requestId === "string";
}

function isRawBody(set: {headers: Record<string, string | number | undefined>}): boolean {
    const contentType = set.headers["content-type"];

    // The metrics route, for instance, writes Prometheus text with its own content type.
    return typeof contentType === "string" && !contentType.includes("application/json");
}

/**
 * Wraps every successful JSON payload in `{data, meta}`. Mounted after `routes` so it sees their
 * handlers; responses already shaped as an envelope, `Response` instances (CSV, plain-text
 * `hub.challenge`), and the webhook/health paths pass through untouched.
 */
export const envelope = new Elysia({name: "envelope"})
    .onAfterHandle({as: "global"}, ({request, responseValue, set}) => {
        if (responseValue instanceof Response || alreadyEnveloped(responseValue) || isRawBody(set)) return;

        const pathname = new URL(request.url).pathname;
        if (SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return;

        const meta: EnvelopeMeta = {requestId: requestIdOf(request) ?? crypto.randomUUID()};
        if (isCacheHit(request)) meta.cached = true;

        return {data: responseValue, meta};
    });
