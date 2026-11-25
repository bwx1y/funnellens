import {sql} from "drizzle-orm";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {redisConnection} from "@infra/redis";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";

/** A sync older than this means the pipeline has stopped delivering fresh numbers. */
export const SYNC_OVERDUE_HOURS = 36;
const PROBE_TIMEOUT_MS = 2000;

export interface ReadinessCheck {
    database: boolean;
    redis: boolean;
    sync: {lastSuccessAt: string | null; overdue: boolean};
}

export interface ReadinessResponse {
    status: boolean;
    checks: ReadinessCheck;
    /** Present only when a check failed; one line per failing dependency. */
    message?: string;
}

class ProbeRepository extends DatabaseRepository {
    async ping(): Promise<void> {
        await this.database.execute(sql`select 1`);
    }
}

/** Rejects after `ms`, so a hung dependency cannot hold the probe open until the orchestrator gives up. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    const {promise, reject} = Promise.withResolvers<never>();
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);

    try {
        return await Promise.race([work, promise]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Two probes with different jobs: liveness answers "is this process alive" and never touches a
 * dependency, readiness answers "should traffic reach it". Readiness never throws — a dependency that
 * is down is a `false` field, because a 500 from the probe tells the orchestrator nothing.
 */
export class HealthService {
    constructor(
        private readonly probeRepo = new ProbeRepository(),
        private readonly syncRunRepo = new SyncRunRepository()
    ) {}

    liveness(): {status: true} {
        return {status: true};
    }

    async readiness(): Promise<ReadinessResponse> {
        const [database, redis, lastSuccessAt] = await Promise.all([
            withTimeout(this.probeRepo.ping(), PROBE_TIMEOUT_MS)
                .then(() => true)
                .catch(() => false),
            withTimeout(redisConnection.ping(), PROBE_TIMEOUT_MS)
                .then(() => true)
                .catch(() => false),
            this.syncRunRepo.findLatestSuccessAnyAccount().catch(() => null),
        ]);

        const overdue = lastSuccessAt === null
            || Date.now() - lastSuccessAt.getTime() > SYNC_OVERDUE_HOURS * 3_600_000;

        const checks: ReadinessCheck = {
            database,
            redis,
            sync: {lastSuccessAt: lastSuccessAt?.toISOString() ?? null, overdue},
        };

        const failures: string[] = [];
        if (!database) failures.push("database tidak merespons dalam 2 detik");
        if (!redis) failures.push("redis tidak merespons dalam 2 detik");
        if (overdue) failures.push(`sync terakhir lebih tua dari ${SYNC_OVERDUE_HOURS} jam`);

        if (failures.length === 0) return {status: true, checks};

        return {status: false, checks, message: failures.join("; ")};
    }
}
