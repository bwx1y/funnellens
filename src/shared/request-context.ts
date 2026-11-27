/**
 * Per-request flags the response layer reads back after the handler returns. Keyed by the `Request`
 * object itself, so concurrent requests can never see each other's flags and nothing needs cleaning up.
 */
const cacheHits = new WeakSet<Request>();

/** Called by a handler that served its payload from the aggregation cache. */
export function markCacheHit(request: Request): void {
    cacheHits.add(request);
}

export function isCacheHit(request: Request): boolean {
    return cacheHits.has(request);
}
