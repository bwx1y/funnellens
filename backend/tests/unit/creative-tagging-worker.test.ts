import {describe, expect, it, mock} from "bun:test";
import type {AdCreativeRepository} from "@db/repositories/ad-creative.repository";
import {
    CreativeTaggingWorkerProcessor,
    type TaggingModel,
    type TaggingResult,
} from "@/modules/creative/worker";

type UpsertedTag = {tagType: string; tagValue: string; source: string; confidence: string | null};

function fakeRepo(creative: Record<string, unknown> | null) {
    const upserted: UpsertedTag[][] = [];
    const repo = {
        findById: mock(async () => creative),
        upsertTags: mock(async (_creativeId: string, tags: UpsertedTag[]) => {
            upserted.push(tags);
        }),
    };

    return {repo: repo as unknown as AdCreativeRepository, upserted, calls: repo};
}

function fakeModel(data: TaggingResult | Error) {
    const generateObject = mock(async () => {
        if (data instanceof Error) throw data;
        return {data, provider: "fake", model: "fake", usage: {inputTokens: 0, outputTokens: 0}};
    });

    return {model: {generateObject} as unknown as TaggingModel, generateObject};
}

const CREATIVE = {
    id: "cr_ai_1",
    title: "Promo",
    body: "Promo harga Rp 50.000",
    callToActionType: "WHATSAPP_MESSAGE",
    objectType: "VIDEO",
};

describe("CreativeTaggingWorkerProcessor", () => {
    it("writes only the four AI tags that carry a value", async () => {
        const {repo, upserted, calls} = fakeRepo(CREATIVE);
        const {model} = fakeModel({
            hook_type: {value: "question", confidence: 0.9},
            format: {value: "video", confidence: 0.8},
            tone: {value: "", confidence: 0.5},
            product_theme: {value: "skincare", confidence: 1.2},
        });

        const processor = new CreativeTaggingWorkerProcessor(model, repo);
        await processor.process({data: {creativeId: "cr_ai_1"}});

        expect(calls.findById).toHaveBeenCalledTimes(1);
        expect(upserted.length).toBe(1);
        expect(upserted[0]).toEqual([
            {tagType: "hook_type", tagValue: "question", source: "ai", confidence: "0.9000"},
            {tagType: "format", tagValue: "video", source: "ai", confidence: "0.8000"},
            {tagType: "product_theme", tagValue: "skincare", source: "ai", confidence: "1.0000"},
        ]);
    });

    it("skips a creative that no longer exists", async () => {
        const {repo, upserted, calls} = fakeRepo(null);
        const {model} = fakeModel({hook_type: {value: "question", confidence: 0.9}});

        const processor = new CreativeTaggingWorkerProcessor(model, repo);
        await processor.process({data: {creativeId: "cr_missing"}});

        expect(calls.upsertTags).not.toHaveBeenCalled();
        expect(upserted).toEqual([]);
    });

    it("propagates a model failure so the queue retries the job", async () => {
        const {repo} = fakeRepo(CREATIVE);
        const {model} = fakeModel(new Error("model down"));

        const processor = new CreativeTaggingWorkerProcessor(model, repo);

        await expect(processor.process({data: {creativeId: "cr_ai_1"}})).rejects.toThrow("model down");
    });
});
