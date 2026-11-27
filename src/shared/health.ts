export type HealthBadge = "Prima" | "Perlu perhatian" | "Kritis";
export type HealthComponentKey = "conversion" | "reply" | "tracking";

export interface FunnelHealthInput {
    /** `results / inline_link_clicks` for the current period. */
    conversion: number | null;
    /** The same ratio for the previous period. */
    baseline: number | null;
    /** 0..1 share of leads answered within 15 minutes. */
    onTimeReplyShare: number | null;
    /** Event match quality, 0..10. */
    emq: number | null;
    /** Deduplication rate, 0..1. */
    dedup: number | null;
}

export interface FunnelHealthComponent {
    key: HealthComponentKey;
    label: string;
    weight: number;
    /** 0..100, 2 decimals; `null` when the inputs are missing. */
    score: number | null;
}

export interface FunnelHealthResult {
    /** Integer 0..100; `null` when fewer than two components are measurable. */
    score: number | null;
    badge: HealthBadge | null;
    /** Always 3 entries, in order: conversion, reply, tracking. */
    components: FunnelHealthComponent[];
    note?: string;
}

const INSUFFICIENT_NOTE = "Komponen pengukuran belum cukup";

/**
 * Weighted 40/30/30 funnel health. Pure: the caller resolves the inputs from repositories and
 * decides how to present a `null` score.
 */
export function funnelHealth(input: FunnelHealthInput): FunnelHealthResult {
    const conversionScore = input.conversion !== null && input.baseline !== null && input.baseline > 0
        ? clamp(100 * input.conversion / input.baseline, 0, 100)
        : null;
    const replyScore = input.onTimeReplyShare === null
        ? null
        : clamp(input.onTimeReplyShare * 100, 0, 100);

    const emqScore = input.emq === null ? null : clamp(input.emq * 10, 0, 100);
    const dedupScore = input.dedup === null ? null : clamp(input.dedup * 100, 0, 100);
    const trackingScore = emqScore === null && dedupScore === null
        ? null
        : emqScore === null
            ? dedupScore
            : dedupScore === null
                ? emqScore
                : (emqScore + dedupScore) / 2;

    const components: FunnelHealthComponent[] = [
        {key: "conversion", label: "Konversi funnel", weight: 40, score: round2OrNull(conversionScore)},
        {key: "reply", label: "Kecepatan balas", weight: 30, score: round2OrNull(replyScore)},
        {key: "tracking", label: "Kualitas tracking", weight: 30, score: round2OrNull(trackingScore)},
    ];

    const measured = components.filter(
        (component): component is FunnelHealthComponent & {score: number} => component.score !== null
    );
    if (measured.length < 2) {
        return {score: null, badge: null, note: INSUFFICIENT_NOTE, components};
    }

    const weightSum = measured.reduce((sum, component) => sum + component.weight, 0);
    const weighted = measured.reduce((sum, component) => sum + component.weight * component.score, 0);
    const score = Math.round(weighted / weightSum);

    return {
        score,
        badge: score >= 80 ? "Prima" : score >= 60 ? "Perlu perhatian" : "Kritis",
        components,
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function round2OrNull(value: number | null): number | null {
    return value === null ? null : Math.round(value * 100) / 100;
}
