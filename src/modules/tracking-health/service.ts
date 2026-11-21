import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {PixelSourceRepository, type PixelSource} from "@db/repositories/pixel-source.repository";
import {TrackingHealthRepository, type TrackingHealthEvent} from "@db/repositories/tracking-health.repository";
import {round4} from "@shared/numbers";
import {
    DEDUP_TARGET,
    EMQ_KEY_EVENTS,
    EMQ_SCALE,
    EMQ_THRESHOLD,
    EVENT_GATE,
    EVENT_SAMPLE_DENOMINATOR,
    browserShare,
    emqStatus,
    eventStatus,
    missingMatchKeys,
    orderEventNames,
    type TrackingStatus,
} from "@shared/tracking";

export interface TrackingHealthQuery {
    accountId: string;
}

export interface SampleBlock {
    n: number;
    denominator: number;
    eligible: boolean;
    gate: string;
}

export interface TrackingHealthResponse {
    date: string | null;
    pixel: {
        connected: boolean | null;
        pixelId: string | null;
        name: string | null;
        lastSeenAt: string | null;
        browserShare: number | null;
        note?: string;
    };
    capi: {
        connected: boolean | null;
        dedupRate: number | null;
        target: number;
        note?: string;
    };
    emq: {
        average: number | null;
        scale: number;
        threshold: number;
        status: TrackingStatus | null;
        keyEvents: {eventName: string; matchQuality: number | null}[];
        note?: string;
    };
    events: {
        eventName: string;
        browserCount: number | null;
        serverCount: number | null;
        dedupRate: number | null;
        matchQuality: number | null;
        status: TrackingStatus | null;
        nextCheck: string | null;
        note?: string;
    }[];
    sample: SampleBlock;
    note?: string;
}

/** Newest pixel first; a tie falls back to the ascending pixel id so the pick is deterministic. */
function pickPrimaryPixel(pixels: PixelSource[]): PixelSource | null {
    let primary: PixelSource | null = null;

    for (const pixel of pixels) {
        if (primary === null) {
            primary = pixel;
            continue;
        }

        const current = primary.lastEventAt?.getTime() ?? null;
        const candidate = pixel.lastEventAt?.getTime() ?? null;

        if (candidate === null) continue;
        if (current === null || candidate > current) {
            primary = pixel;
            continue;
        }

        if (candidate === current && pixel.pixelId < primary.pixelId) primary = pixel;
    }

    return primary;
}

function mean(values: number[]): number | null {
    if (values.length === 0) return null;

    return round4(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Reads the match keys the sync job stored on the pixel row; an absent list claims nothing. */
function readMatchKeys(pixel: PixelSource | null): string[] | null {
    const raw = pixel?.raw as {automaticMatchingFields?: unknown} | null | undefined;
    if (raw == null || !Array.isArray(raw.automaticMatchingFields)) return null;

    return raw.automaticMatchingFields.map(String);
}

export class TrackingHealthService {
    constructor(
        private readonly pixelSourceRepo = new PixelSourceRepository(),
        private readonly trackingHealthRepo = new TrackingHealthRepository()
    ) {}

    async getTrackingHealth(tenantId: string, query: TrackingHealthQuery): Promise<TrackingHealthResponse> {
        const account = await requireAccountScope(tenantId, query.accountId);

        const [pixels, summary] = await Promise.all([
            this.pixelSourceRepo.findByAccountId(account.id),
            this.trackingHealthRepo.getLatestStatus(account.id),
        ]);

        const pixelRow = pickPrimaryPixel(pixels);
        const share = summary.date === null ? null : browserShare(summary.browserCount, summary.serverCount);

        const pixelNote = pixelRow === null
            ? "Pixel Meta belum tersinkron untuk akun ini."
            : share === null
                ? "Porsi event browser tidak tersedia."
                : undefined;

        const capiDedup = summary.dedupRate === null ? null : round4(summary.dedupRate);
        const capiNote = pixelRow === null
            ? "Status CAPI belum tersedia karena pixel belum tersinkron."
            : capiDedup === null
                ? "Rasio deduplikasi tidak tersedia karena hitungan duplikat tidak dilaporkan."
                : undefined;

        const matchKeys = readMatchKeys(pixelRow);
        const missing = missingMatchKeys(matchKeys);
        const rows = new Map(summary.events.map((event) => [event.eventName, event]));

        const events = orderEventNames(summary.events.map((event) => event.eventName))
            .map((eventName) => {
                const event = rows.get(eventName) as TrackingHealthEvent;
                const rate = event.dedupRate === null ? null : Number(event.dedupRate);
                const matchQuality = event.matchQuality === null ? null : Number(event.matchQuality);
                const note = eventNote(rate, matchQuality);

                return {
                    eventName,
                    browserCount: event.browserCount,
                    serverCount: event.serverCount,
                    dedupRate: rate,
                    matchQuality,
                    status: eventStatus({dedupRate: rate, matchQuality}),
                    nextCheck: eventName === "Lead" && missing.length > 0
                        ? `Lengkapi parameter ${missing.join(" dan ")} pada event Lead.`
                        : null,
                    ...(note === undefined ? {} : {note}),
                };
            });

        const keyEvents = EMQ_KEY_EVENTS.map((eventName) => ({
            eventName,
            matchQuality: events.find((event) => event.eventName === eventName)?.matchQuality ?? null,
        }));
        const average = mean(
            keyEvents
                .map((event) => event.matchQuality)
                .filter((value): value is number => value !== null)
        );

        const n = summary.date === null ? 0 : summary.browserCount + summary.serverCount;

        return {
            date: summary.date,
            pixel: {
                connected: pixelRow === null ? null : true,
                pixelId: pixelRow?.pixelId ?? null,
                name: pixelRow?.name ?? null,
                lastSeenAt: pixelRow?.lastEventAt?.toISOString() ?? null,
                browserShare: share,
                ...(pixelNote === undefined ? {} : {note: pixelNote}),
            },
            capi: {
                connected: pixelRow?.capiConfigured ?? null,
                dedupRate: capiDedup,
                target: DEDUP_TARGET,
                ...(capiNote === undefined ? {} : {note: capiNote}),
            },
            emq: {
                average,
                scale: EMQ_SCALE,
                threshold: EMQ_THRESHOLD,
                status: emqStatus(average),
                keyEvents,
                ...(average === null
                    ? {note: "Event Match Quality belum tersedia untuk Lead dan Purchase."}
                    : {}),
            },
            events,
            sample: {
                n,
                denominator: EVENT_SAMPLE_DENOMINATOR,
                eligible: n >= EVENT_SAMPLE_DENOMINATOR,
                gate: EVENT_GATE,
            },
            ...(events.length === 0 ? {note: "Statistik event tidak tersedia untuk akun ini."} : {}),
        };
    }
}

/** Names what is missing without claiming a cause. */
function eventNote(dedupRate: number | null, matchQuality: number | null): string | undefined {
    if (dedupRate === null && matchQuality === null) {
        return "Rasio deduplikasi tidak tersedia. Event Match Quality tidak tersedia.";
    }
    if (dedupRate === null) return "Rasio deduplikasi tidak tersedia.";
    if (matchQuality === null) return "Event Match Quality tidak tersedia.";

    return undefined;
}
