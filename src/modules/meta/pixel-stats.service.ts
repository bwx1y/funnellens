import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {InsightAlertRepository} from "@db/repositories/insight-alert.repository";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {PixelSourceRepository} from "@db/repositories/pixel-source.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {TrackingHealthRepository} from "@db/repositories/tracking-health.repository";
import type {IMetaPixelAdapter} from "@infra/meta/base.meta";
import {FacebookSdkAdapter} from "@infra/meta/adapters/facebook-sdk.adapter";
import {NotFoundError, UnauthorizedError} from "@shared/errors";
import {logger} from "@shared/logger";
import {todayInZone} from "@shared/dates";
import {round4} from "@shared/numbers";
import {
    EMQ_KEY_EVENTS,
    dedupRate,
    eventStatus,
    trackingAlertNeeded,
} from "@shared/tracking";

/**
 * The single writer of `pixel_sources`, `tracking_health_daily`, and the `tracking_emq` alert.
 * Lives in the `meta` module because it is the only place that owns a Graph adapter.
 */

interface EventAccumulator {
    browser: number | null;
    server: number | null;
    duplicates: number | null;
    emq: number[];
    raw: Record<string, unknown>;
}

export interface PixelStatsSyncResult {
    accountId: string;
    date: string;
    pixelCount: number;
    eventCount: number;
}

/** `null + number = number`; `null + null = null` so an unreported side never turns into a zero. */
function addNullable(left: number | null, right: number | null): number | null {
    if (left === null) return right;
    if (right === null) return left;

    return left + right;
}

/** Mean with 4 decimals; `null` for an empty input. */
function mean(values: number[]): number | null {
    if (values.length === 0) return null;

    return round4(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export class PixelStatsSyncService {
    constructor(
        private readonly adAccountRepo = new AdAccountRepository(),
        private readonly metaConnectionRepo = new MetaConnectionRepository(),
        private readonly syncRunRepo = new SyncRunRepository(),
        private readonly pixelAdapter: IMetaPixelAdapter = new FacebookSdkAdapter(),
        private readonly pixelSourceRepo = new PixelSourceRepository(),
        private readonly trackingHealthRepo = new TrackingHealthRepository(),
        private readonly alertRepo = new InsightAlertRepository()
    ) {}

    async sync(tenantId: string, accountId: string): Promise<PixelStatsSyncResult> {
        const account = await this.adAccountRepo.findById(accountId, tenantId);
        if (account === null) throw new NotFoundError("Akun iklan tidak ditemukan");

        const connection = await this.metaConnectionRepo.findByTenantId(tenantId);
        if (connection === null) {
            throw new UnauthorizedError("Meta connection not found. Please connect your Meta account first.");
        }

        if (connection.expiresAt !== null && connection.expiresAt.getTime() <= Date.now()) {
            throw new UnauthorizedError("Meta access token has expired. Please reconnect.");
        }

        const date = todayInZone(account.timezoneName);
        const syncRun = await this.syncRunRepo.create({accountId, resource: "pixels"});

        try {
            const {hasAccess, pixels} = await this.pixelAdapter.getAdPixels(connection.accessToken, accountId);

            if (!hasAccess) {
                logger.warn({accountId}, "Pixel stats sync skipped: permission missing");
                await this.syncRunRepo.complete(syncRun.id, 0);
                return {accountId, date, pixelCount: 0, eventCount: 0};
            }

            // `tracking_health_daily` has no pixel column, so pixels reporting the same event are summed.
            const events = new Map<string, EventAccumulator>();
            const emqValues: number[] = [];

            for (const pixel of pixels) {
                const stats = await this.pixelAdapter.getPixelStats(connection.accessToken, pixel.id, {
                    since: date,
                    until: date,
                });
                const available = stats.hasAccess && stats.rows.length > 0;

                if (available) {
                    for (const row of stats.rows) {
                        const accumulator = events.get(row.eventName) ?? {
                            browser: null,
                            server: null,
                            duplicates: null,
                            emq: [],
                            raw: row.raw,
                        };

                        accumulator.browser = addNullable(accumulator.browser, row.browserCount);
                        accumulator.server = addNullable(accumulator.server, row.serverCount);
                        accumulator.duplicates = addNullable(accumulator.duplicates, row.duplicateCount);
                        if (row.matchQuality !== null) accumulator.emq.push(row.matchQuality);

                        events.set(row.eventName, accumulator);
                    }
                }

                const keyEmq = available
                    ? stats.rows
                        .filter((row) => (EMQ_KEY_EVENTS as readonly string[]).includes(row.eventName))
                        .map((row) => row.matchQuality)
                        .filter((value): value is number => value !== null)
                    : [];
                const pixelEmq = mean(keyEmq);
                if (pixelEmq !== null) emqValues.push(pixelEmq);

                await this.pixelSourceRepo.upsert({
                    id: `${accountId}:${pixel.id}`,
                    accountId,
                    pixelId: pixel.id,
                    name: pixel.name,
                    capiConfigured: available && stats.rows.some((row) => (row.serverCount ?? 0) > 0),
                    lastEventAt: pixel.lastFiredTime,
                    emqAvg: pixelEmq === null ? null : pixelEmq.toFixed(2),
                    lastSyncedAt: new Date(),
                    raw: {automaticMatchingFields: pixel.automaticMatchingFields},
                });
            }

            const rates: number[] = [];
            for (const [eventName, accumulator] of events) {
                const rate = dedupRate(accumulator.browser, accumulator.server, accumulator.duplicates);
                const matchQuality = mean(accumulator.emq);
                if (rate !== null) rates.push(rate);

                await this.trackingHealthRepo.upsertDaily({
                    accountId,
                    date,
                    eventName,
                    browserCount: accumulator.browser,
                    serverCount: accumulator.server,
                    dedupRate: rate === null ? null : rate.toFixed(6),
                    matchQuality: matchQuality === null ? null : matchQuality.toFixed(2),
                    status: eventStatus({dedupRate: rate, matchQuality}),
                    raw: accumulator.raw,
                });
            }

            await this.applyAlert(accountId, date, mean(emqValues), mean(rates));

            const eventCount = events.size;
            await this.syncRunRepo.complete(syncRun.id, eventCount);
            return {accountId, date, pixelCount: pixels.length, eventCount};
        } catch (error) {
            await this.syncRunRepo.fail(syncRun.id, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    private async applyAlert(
        accountId: string,
        date: string,
        emqOverall: number | null,
        dedupOverall: number | null
    ): Promise<void> {
        if (!trackingAlertNeeded(emqOverall, dedupOverall)) {
            await this.alertRepo.resolveByRuleKey(accountId, "tracking_emq");
            return;
        }

        await this.alertRepo.upsert({
            accountId,
            ruleKey: "tracking_emq",
            level: "WARNING",
            title: "Event Match Quality perlu perhatian",
            body: `EMQ rata-rata ${emqOverall === null ? "tidak tersedia" : emqOverall.toFixed(2)} dari 10; ` +
                `rasio deduplikasi ${dedupOverall === null ? "tidak tersedia" : dedupOverall.toFixed(2)}.`,
            metric: "emq",
            entityType: "account",
            entityId: "",
            impactMinor: null,
            impactCaption: null,
            confidence: "sedang",
            sampleSize: null,
            route: "/tracking-health",
            evidence: {emqAvg: emqOverall, dedupRate: dedupOverall, date},
            status: "ACTIVE",
        });
    }
}
