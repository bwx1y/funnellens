import {describe, expect, it, mock, type Mock} from "bun:test";
import {PixelStatsSyncService} from "@/modules/meta/pixel-stats.service";
import type {IMetaPixelAdapter} from "@/infra/meta/base.meta";
import type {MetaPixelStatsRowDto} from "@/infra/meta/types";
import {NotFoundError, UnauthorizedError} from "@shared/errors";

const ACCOUNT = {id: "act_x", timezoneName: "Asia/Jakarta"};

interface Harness {
    service: PixelStatsSyncService;
    upsertDaily: Mock<(...args: unknown[]) => Promise<undefined>>;
    upsertPixel: Mock<(...args: unknown[]) => Promise<unknown>>;
    upsertAlert: Mock<(...args: unknown[]) => Promise<unknown>>;
    resolveRule: Mock<(...args: unknown[]) => Promise<number>>;
    complete: Mock<(...args: unknown[]) => Promise<undefined>>;
    fail: Mock<(...args: unknown[]) => Promise<undefined>>;
}

function harness(options: {
    account?: typeof ACCOUNT | null;
    connection?: {accessToken: string; expiresAt: Date | null} | null;
    adapter: IMetaPixelAdapter;
}): Harness {
    const upsertDaily = mock(async () => undefined);
    const upsertPixel = mock(async (row: unknown) => row);
    const upsertAlert = mock(async (row: unknown) => row);
    const resolveRule = mock(async () => 0);
    const complete = mock(async () => undefined);
    const fail = mock(async () => undefined);
    const account = options.account === undefined ? ACCOUNT : options.account;

    const service = new PixelStatsSyncService(
        {findById: async () => account} as never,
        {findByTenantId: async () => options.connection ?? null} as never,
        {create: async () => ({id: 7}), complete, fail} as never,
        options.adapter,
        {upsert: upsertPixel} as never,
        {upsertDaily} as never,
        {upsert: upsertAlert, resolveByRuleKey: resolveRule} as never
    );

    return {service, upsertDaily, upsertPixel, upsertAlert, resolveRule, complete, fail};
}

const pixelAdapter = (rows: MetaPixelStatsRowDto[]): IMetaPixelAdapter => ({
    getAdPixels: async () => ({
        hasAccess: true,
        pixels: [{
            id: "px1",
            name: "Pixel Utama",
            code: "px",
            lastFiredTime: new Date("2026-03-02T10:00:00.000Z"),
            automaticMatchingFields: ["em"],
        }],
    }),
    getPixelStats: async () => ({hasAccess: true, rows}),
});

const deniedAdapter: IMetaPixelAdapter = {
    getAdPixels: async () => ({
        hasAccess: true,
        pixels: [{
            id: "px1",
            name: "Pixel Utama",
            code: "px",
            lastFiredTime: null,
            automaticMatchingFields: [],
        }],
    }),
    getPixelStats: async () => ({hasAccess: false, rows: []}),
};

const CONNECTION = {accessToken: "token", expiresAt: null};

describe("PixelStatsSyncService", () => {
    it("writes pixel, event, and alert rows from the Meta payload", async () => {
        const h = harness({
            adapter: pixelAdapter([{
                eventName: "Lead",
                browserCount: 100,
                serverCount: 80,
                duplicateCount: 60,
                matchQuality: 5.8,
                raw: {},
            }]),
            connection: CONNECTION,
        });

        const result = await h.service.sync("tenant-1", "act_x");

        expect(result.pixelCount).toBe(1);
        expect(result.eventCount).toBe(1);
        expect(h.upsertDaily).toHaveBeenCalledWith(expect.objectContaining({
            accountId: "act_x",
            eventName: "Lead",
            browserCount: 100,
            serverCount: 80,
            dedupRate: "0.666700",
            matchQuality: "5.80",
            status: "Bermasalah",
        }));
        expect(h.upsertPixel).toHaveBeenCalledWith(expect.objectContaining({
            id: "act_x:px1",
            capiConfigured: true,
            emqAvg: "5.80",
            raw: {automaticMatchingFields: ["em"]},
        }));
        expect(h.upsertAlert).toHaveBeenCalledWith(expect.objectContaining({
            accountId: "act_x",
            ruleKey: "tracking_emq",
            level: "WARNING",
        }));
        expect(h.resolveRule).not.toHaveBeenCalled();
        expect(h.complete).toHaveBeenCalledWith(7, 1);
    });

    it("records a pixel without CAPI traffic and closes the alert", async () => {
        const h = harness({adapter: deniedAdapter, connection: CONNECTION});

        const result = await h.service.sync("tenant-1", "act_x");

        expect(result.eventCount).toBe(0);
        expect(h.upsertDaily).not.toHaveBeenCalled();
        expect(h.upsertPixel).toHaveBeenCalledWith(expect.objectContaining({
            capiConfigured: false,
            emqAvg: null,
        }));
        expect(h.upsertAlert).not.toHaveBeenCalled();
        expect(h.resolveRule).toHaveBeenCalledWith("act_x", "tracking_emq");
    });

    it("leaves a healthy account without an alert", async () => {
        const h = harness({
            adapter: pixelAdapter([{
                eventName: "Lead",
                browserCount: 100,
                serverCount: 90,
                duplicateCount: 0,
                matchQuality: 8,
                raw: {},
            }]),
            connection: CONNECTION,
        });

        await h.service.sync("tenant-1", "act_x");

        expect(h.upsertAlert).not.toHaveBeenCalled();
        expect(h.resolveRule).toHaveBeenCalledWith("act_x", "tracking_emq");
    });

    it("rejects a missing account or a missing Meta connection", async () => {
        const missingAccount = harness({account: null, adapter: deniedAdapter, connection: CONNECTION});
        await expect(missingAccount.service.sync("tenant-1", "act_x"))
            .rejects.toThrow(new NotFoundError("Akun iklan tidak ditemukan"));

        const missingConnection = harness({adapter: deniedAdapter, connection: null});
        await expect(missingConnection.service.sync("tenant-1", "act_x"))
            .rejects.toThrow(new UnauthorizedError(
                "Meta connection not found. Please connect your Meta account first."
            ));
        expect(missingConnection.fail).not.toHaveBeenCalled();
    });
});
