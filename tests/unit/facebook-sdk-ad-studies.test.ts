import {afterEach, describe, expect, it, mock} from "bun:test";
import bizSdk from "facebook-nodejs-business-sdk";
import {FacebookSdkAdapter} from "@/infra/meta/adapters/facebook-sdk.adapter";
import type {IMetaAdStudiesAdapter} from "@/infra/meta/base.meta";

interface FakeCursor extends Array<Record<string, unknown>> {
    hasNext(): boolean;
}

function fakeCursor(rows: Record<string, unknown>[]): FakeCursor {
    return Object.assign([...rows], {hasNext: () => false});
}

const originalGetAdStudies = bizSdk.User.prototype.getAdStudies;

function stubStudies(rows: Record<string, unknown>[]) {
    const calls: [fields: string[], params: Record<string, unknown>][] = [];
    bizSdk.User.prototype.getAdStudies = mock(async function (
        this: unknown,
        fields: string[],
        params: Record<string, unknown>
    ) {
        calls.push([fields, params]);
        return fakeCursor(rows);
    }) as unknown as typeof originalGetAdStudies;

    return calls;
}

function stubFailure(error: unknown) {
    bizSdk.User.prototype.getAdStudies = mock(async () => {
        throw error;
    }) as unknown as typeof originalGetAdStudies;
}

afterEach(() => {
    bizSdk.User.prototype.getAdStudies = originalGetAdStudies;
});

describe("FacebookSdkAdapter.getAdStudies", () => {
    it("maps ad studies and asks for the result date", async () => {
        const calls = stubStudies([
            {
                id: "123",
                name: "Studi A",
                type: "SPLIT_TEST",
                start_time: "2026-03-01T00:00:00+0000",
                end_time: "2026-03-08T00:00:00+0000",
                results_first_available_date: "2026-03-09",
            },
            {id: "456"},
        ]);

        const adapter: IMetaAdStudiesAdapter = new FacebookSdkAdapter();
        const result = await adapter.getAdStudies("token", "meta-user-1");

        expect(result.hasAccess).toBe(true);
        expect(result.studies.length).toBe(2);
        expect(result.studies[0]).toEqual({
            id: "123",
            name: "Studi A",
            type: "SPLIT_TEST",
            startTime: "2026-03-01T00:00:00+0000",
            endTime: "2026-03-08T00:00:00+0000",
            resultsFirstAvailableDate: "2026-03-09",
        });
        expect(result.studies[1]).toEqual({
            id: "456",
            name: null,
            type: null,
            startTime: null,
            endTime: null,
            resultsFirstAvailableDate: null,
        });
        expect(calls[0][0]).toContain("results_first_available_date");
    });

    it("turns a permission failure into hasAccess false", async () => {
        stubFailure({code: 10, message: "Application does not have permission"});

        const adapter = new FacebookSdkAdapter();
        expect(await adapter.getAdStudies("token", "meta-user-1")).toEqual({hasAccess: false, studies: []});
    });

    it("rethrows any other Graph failure", async () => {
        stubFailure({code: 1, message: "Unknown error"});

        const adapter = new FacebookSdkAdapter();
        await expect(adapter.getAdStudies("token", "meta-user-1")).rejects.toBeDefined();
    });
});
