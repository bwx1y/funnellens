import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {PixelSourceRepository} from "@db/repositories/pixel-source.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {TrackingHealthRepository} from "@db/repositories/tracking-health.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {InsightAlertEntity} from "@db/schema/ads/insight-alert.entity";
import type {IMetaPixelAdapter} from "@infra/meta/base.meta";
import type {MetaPixelStatsRowDto} from "@infra/meta/types";
import {PixelStatsSyncService} from "@/modules/meta/pixel-stats.service";
import {TrackingHealthService} from "@/modules/tracking-health/service";
import {JwtUtil} from "@shared/jwt";
import {todayInZone} from "@shared/dates";
import {and, eq} from "drizzle-orm";
import {readData, readError} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

const STAT_ROWS: MetaPixelStatsRowDto[] = [
    {eventName: "Lead", browserCount: 100, serverCount: 80, duplicateCount: 60, matchQuality: 5.8, raw: {}},
    {eventName: "PageView", browserCount: 200, serverCount: 180, duplicateCount: 20, matchQuality: 7.5, raw: {}},
];

/** `pixel_sources.raw` is jsonb (`unknown`); narrow before reading the stored match keys. */
function matchFields(raw: unknown): unknown {
    if (raw === null || typeof raw !== "object" || !("automaticMatchingFields" in raw)) return null;
    return raw.automaticMatchingFields;
}

describe("Tracking health", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const pixelRepo = new PixelSourceRepository();
    const trackingRepo = new TrackingHealthRepository();
    const service = new TrackingHealthService();

    const u = Date.now().toString();
    const accountId = `act_th_${u}`;
    const emptyAccountId = `act_th_empty_${u}`;
    const deniedAccountId = `act_th_denied_${u}`;
    const otherAccountId = `act_th_other_${u}`;
    const pixelId = `px_${u}`;
    const deniedPixelId = `px_denied_${u}`;

    let tenantId: string;
    let otherTenantId: string;
    let date: string;

    const pixelAdapter = (options: {
        pixelId: string;
        rows: MetaPixelStatsRowDto[];
        hasAccess: boolean;
    }): IMetaPixelAdapter => ({
        getAdPixels: async () => ({
            hasAccess: true,
            pixels: [{
                id: options.pixelId,
                name: "Pixel Utama",
                code: "px",
                lastFiredTime: new Date("2026-03-02T10:00:00.000Z"),
                automaticMatchingFields: ["em"],
            }],
        }),
        getPixelStats: async () => ({hasAccess: options.hasAccess, rows: options.rows}),
    });

    const syncService = (adapter: IMetaPixelAdapter) => new PixelStatsSyncService(
        undefined,
        {
            findByTenantId: async () => ({accessToken: "token", metaUserId: "meta-1", expiresAt: null}),
        } as never,
        undefined,
        adapter
    );

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `tracking-test-${u}`});
        tenantId = tenant.id;
        const otherTenant = await tenantRepo.create({name: `tracking-other-${u}`});
        otherTenantId = otherTenant.id;

        await db.insert(AdAccountEntity).values([
            {
                id: accountId,
                tenantId,
                name: `Tracking Account ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: emptyAccountId,
                tenantId,
                name: `Tracking Empty ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: deniedAccountId,
                tenantId,
                name: `Tracking Denied ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
            {
                id: otherAccountId,
                tenantId: otherTenantId,
                name: `Tracking Other ${u}`,
                currency: "IDR",
                currencyOffset: 100,
                timezoneName: "Asia/Jakarta",
            },
        ]);

        date = todayInZone("Asia/Jakarta");
        await syncService(pixelAdapter({pixelId, rows: STAT_ROWS, hasAccess: true})).sync(tenantId, accountId);
        await syncService(pixelAdapter({pixelId: deniedPixelId, rows: [], hasAccess: false}))
            .sync(tenantId, deniedAccountId);
    });

    afterAll(async () => {
        await cleanupRepo.cleanup(tenantId);
        await cleanupRepo.cleanup(otherTenantId);
    });

    it("writes pixel, event, and alert rows from one sync run", async () => {
        const result = await syncService(pixelAdapter({pixelId, rows: STAT_ROWS, hasAccess: true}))
            .sync(tenantId, accountId);

        expect(result).toMatchObject({accountId, date, pixelCount: 1, eventCount: 2});

        const pixels = await pixelRepo.findByAccountId(accountId);
        expect(pixels.length).toBe(1);
        expect(pixels[0]).toMatchObject({pixelId, capiConfigured: true, emqAvg: "5.80"});
        expect(matchFields(pixels[0].raw)).toEqual(["em"]);

        const summary = await trackingRepo.getLatestStatus(accountId);
        const lead = summary.events.find((event) => event.eventName === "Lead");
        expect(lead?.dedupRate).toBe("0.666700");
        expect(lead?.status).toBe("Bermasalah");

        const alerts = await db.select()
            .from(InsightAlertEntity)
            .where(and(
                eq(InsightAlertEntity.accountId, accountId),
                eq(InsightAlertEntity.ruleKey, "tracking_emq")
            ));
        expect(alerts.length).toBe(1);
        expect(alerts[0]).toMatchObject({level: "WARNING", status: "ACTIVE", entityId: ""});
    });

    it("reports pixel, CAPI, EMQ, and the ordered event table", async () => {
        const response = await service.getTrackingHealth(tenantId, {accountId});

        expect(response.date).toBe(date);
        expect(response.pixel).toMatchObject({
            connected: true,
            pixelId,
            name: "Pixel Utama",
            lastSeenAt: "2026-03-02T10:00:00.000Z",
            browserShare: 0.5357,
        });
        expect(response.pixel.note).toBeUndefined();

        expect(response.capi.connected).toBe(true);
        expect(response.capi.dedupRate).toBeCloseTo(0.807, 3);
        expect(response.capi.target).toBe(0.9);
        expect(response.capi.note).toBeUndefined();

        expect(response.emq.average).toBe(5.8);
        expect(response.emq.status).toBe("Perlu optimalisasi");
        expect(response.emq.scale).toBe(10);
        expect(response.emq.threshold).toBe(6);
        expect(response.emq.keyEvents).toEqual([
            {eventName: "Lead", matchQuality: 5.8},
            {eventName: "Purchase", matchQuality: null},
        ]);

        expect(response.events[0].eventName).toBe("PageView");
        const lead = response.events.find((event) => event.eventName === "Lead");
        expect(lead).toMatchObject({
            dedupRate: 0.6667,
            matchQuality: 5.8,
            status: "Bermasalah",
            nextCheck: "Lengkapi parameter ph pada event Lead.",
        });
        expect(response.events.find((event) => event.eventName === "PageView")?.nextCheck).toBeNull();

        expect(response.sample).toEqual({n: 560, denominator: 100, eligible: true, gate: "≥ 100 event"});
        expect(response.note).toBeUndefined();
    });

    it("keeps every metric null for an account that was never synced", async () => {
        const response = await service.getTrackingHealth(tenantId, {accountId: emptyAccountId});

        expect(response.date).toBeNull();
        expect(response.pixel).toEqual({
            connected: null,
            pixelId: null,
            name: null,
            lastSeenAt: null,
            browserShare: null,
            note: "Pixel Meta belum tersinkron untuk akun ini.",
        });
        expect(response.capi.connected).toBeNull();
        expect(response.capi.dedupRate).toBeNull();
        expect(response.capi.note).toBe("Status CAPI belum tersedia karena pixel belum tersinkron.");
        expect(response.emq.average).toBeNull();
        expect(response.emq.status).toBeNull();
        expect(response.emq.note).toBe("Event Match Quality belum tersedia untuk Lead dan Purchase.");
        expect(response.events).toEqual([]);
        expect(response.sample).toEqual({n: 0, denominator: 100, eligible: false, gate: "≥ 100 event"});
        expect(response.note).toBe("Statistik event tidak tersedia untuk akun ini.");
    });

    it("stores a denied pixel without inventing event numbers", async () => {
        const pixels = await pixelRepo.findByAccountId(deniedAccountId);
        expect(pixels.length).toBe(1);
        expect(pixels[0]).toMatchObject({pixelId: deniedPixelId, capiConfigured: false, emqAvg: null});

        const summary = await trackingRepo.getLatestStatus(deniedAccountId);
        expect(summary.date).toBeNull();
        expect(summary.events).toEqual([]);

        const response = await service.getTrackingHealth(tenantId, {accountId: deniedAccountId});
        expect(response.pixel.connected).toBe(true);
        expect(response.capi.connected).toBe(false);
        expect(response.capi.dedupRate).toBeNull();
        expect(response.capi.note).toBe("Rasio deduplikasi tidak tersedia karena hitungan duplikat tidak dilaporkan.");
        expect(response.events).toEqual([]);
        expect(response.note).toBe("Statistik event tidak tersedia untuk akun ini.");
    });

    it("serves the route and keeps another tenant's account out of scope", async () => {
        const jwt = new JwtUtil();
        const token = await jwt.register({id: "user-tracking", tenant: tenantId, role: "ADMIN"});
        const headers = {authorization: `Bearer ${token.key}`};

        const response = await app.handle(new Request(
            `http://localhost/api/tracking-health?accountId=${accountId}`,
            {headers}
        ));
        expect(response.status).toBe(200);
        const body = await readData<{events: unknown[]}>(response);
        expect(body.events.length).toBe(2);

        const forbidden = await app.handle(new Request(
            `http://localhost/api/tracking-health?accountId=${otherAccountId}`,
            {headers}
        ));
        expect(forbidden.status).toBe(404);
        expect(await readError(forbidden)).toEqual({
            code: "NOT_FOUND",
            message: "Akun iklan tidak ditemukan",
            details: null,
        });
    });
});
