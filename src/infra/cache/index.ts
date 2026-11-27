import {redisConnection} from "@infra/redis";
import {logger} from "@shared/logger";
import {addDays} from "@shared/dates";
import {DEFAULT_SNAPSHOT_END} from "@shared/period";

export const AGGREGATION_CACHE_PREFIX = "agg:v1";
export const AGGREGATION_CACHE_TTL_SECONDS = 300;

/** One cached aggregation: which endpoint, which workspace, which account, which window. */
export interface AggregationScope {
    endpoint: string;
    tenantId: string;
    accountId: string;
    campaignId?: string;
    since?: string;
    until?: string;
    days?: number;
    objectiveGroup?: string;
}

/**
 * Read-through cache for the heavy aggregation endpoints. Redis is an optimisation, never a
 * dependency: every failure is logged and the request proceeds against the database.
 *
 * The key starts with the account so one `SCAN ... agg:v1:{accountId}:*` invalidates an account, and
 * carries the tenant plus the endpoint so (a) the lookup can happen before the account scope check
 * without leaking another workspace's report, and (b) `summary` and `funnel` of the same window can
 * never share an entry.
 */
export class AggregationCache {
    /**
     * `days` is expanded to concrete dates with the same arithmetic `resolvePeriod` uses (no timezone
     * needed), so `days=7` and `days=30` can never collide. A window left fully open depends on
     * "today" in the account timezone, which this layer cannot know, so the key is pinned to the UTC
     * date and the entry expires with the TTL.
     */
    key(scope: AggregationScope): string {
        let since = scope.since;
        let until = scope.until;

        if (scope.days !== undefined) {
            until = scope.until ?? DEFAULT_SNAPSHOT_END;
            since = addDays(until, -(scope.days - 1));
        }

        const open = new Date().toISOString().slice(0, 10);

        return [
            AGGREGATION_CACHE_PREFIX,
            scope.accountId,
            scope.endpoint,
            scope.tenantId,
            scope.campaignId ?? "all",
            since ?? `open-${open}`,
            until ?? `open-${open}`,
            scope.objectiveGroup ?? "all",
        ].join(":");
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const raw = await redisConnection.get(key);
            return raw === null ? null : JSON.parse(raw) as T;
        } catch (error) {
            logger.warn({err: error, key}, "aggregation cache read failed");
            return null;
        }
    }

    async set(key: string, value: unknown, ttlSeconds: number = AGGREGATION_CACHE_TTL_SECONDS): Promise<void> {
        try {
            await redisConnection.set(key, JSON.stringify(value), "EX", ttlSeconds);
        } catch (error) {
            logger.warn({err: error, key}, "aggregation cache write failed");
        }
    }

    /**
     * Drops every entry of one account after a sync. `SCAN` walks the keyspace in small batches; `KEYS`
     * would block Redis for the whole match.
     */
    async invalidateAccount(accountId: string): Promise<number> {
        const pattern = `${AGGREGATION_CACHE_PREFIX}:${accountId}:*`;
        let cursor = "0";
        let deleted = 0;

        try {
            do {
                const [next, keys] = await redisConnection.scan(cursor, "MATCH", pattern, "COUNT", 500);
                cursor = next;
                if (keys.length > 0) deleted += await redisConnection.del(...keys);
            } while (cursor !== "0");
        } catch (error) {
            logger.warn({err: error, accountId}, "aggregation cache invalidation failed");
        }

        return deleted;
    }
}
