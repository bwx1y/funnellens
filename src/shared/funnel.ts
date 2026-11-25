import {direction, round2, round4, type DeltaDirection} from "@shared/numbers";

export type FunnelObjectiveGroup = "wa" | "web";

export type FunnelStageKey =
    | "impressions"
    | "link_clicks"
    | "messaging_started"
    | "observed"
    | "replied"
    | "qualified"
    | "closed"
    | "lpv"
    | "view_content"
    | "add_to_cart"
    | "purchase";

/** `meta` stages come from `ad_insight_metrics`; `cross` stages come from FunnelLens leads. */
export type FunnelStageSource = "meta" | "cross";

export type FunnelPairStatus = "normal" | "perlu_perhatian" | "kritis";

export type TrackingState = "up_to_date" | "stale" | "unknown";

/**
 * `null` means Meta never reported that event for the period — not that the count was zero. The view
 * keeps `NULL` for the web event stages precisely so a missing pixel event cannot masquerade as a real
 * zero and drag every downstream ratio with it.
 */
export interface FunnelCountsLike {
    impressions: number;
    linkClicks: number;
    messagingStarted: number;
    lpv: number | null;
    viewContent: number | null;
    addToCart: number | null;
    purchase: number | null;
    observed: number;
    replied: number;
    qualified: number;
    closed: number;
}

export interface StageDefinition {
    key: FunnelStageKey;
    label: string;
    source: FunnelStageSource;
    /** The stage counts leads FunnelLens observed, not a number Meta reported. */
    estimated?: true;
    read: (counts: FunnelCountsLike) => number | null;
}

/**
 * The stage order is the contract: `wa` has 7 stages, `web` has 6. `observed` stays in `wa` because
 * `replied` and `qualified` are measured against the leads FunnelLens saw, not against a Meta number;
 * removing it would silently change every downstream conversion ratio.
 */
export const FUNNEL_STAGES: Record<FunnelObjectiveGroup, StageDefinition[]> = {
    wa: [
        {key: "impressions", label: "Tayangan", source: "meta", read: (counts) => counts.impressions},
        {key: "link_clicks", label: "Klik tautan", source: "meta", read: (counts) => counts.linkClicks},
        {key: "messaging_started", label: "Chat dimulai", source: "meta", read: (counts) => counts.messagingStarted},
        {key: "observed", label: "Lead tercatat", source: "cross", estimated: true, read: (counts) => counts.observed},
        {key: "replied", label: "Dibalas", source: "cross", read: (counts) => counts.replied},
        {key: "qualified", label: "Qualified", source: "cross", read: (counts) => counts.qualified},
        {key: "closed", label: "Closing", source: "cross", read: (counts) => counts.closed},
    ],
    web: [
        {key: "impressions", label: "Tayangan", source: "meta", read: (counts) => counts.impressions},
        {key: "link_clicks", label: "Klik tautan", source: "meta", read: (counts) => counts.linkClicks},
        {key: "lpv", label: "Landing page view", source: "meta", read: (counts) => counts.lpv},
        {key: "view_content", label: "View content", source: "meta", read: (counts) => counts.viewContent},
        {key: "add_to_cart", label: "Tambah ke keranjang", source: "meta", read: (counts) => counts.addToCart},
        {key: "purchase", label: "Pembelian", source: "meta", read: (counts) => counts.purchase},
    ],
};

export interface SampleBlock {
    n: number;
    denominator: number;
    eligible: boolean;
    gate: string;
}

export interface FunnelPair {
    from: FunnelStageKey;
    to: FunnelStageKey;
    rate: number | null;
    baseline: number | null;
    deltaPp: number | null;
    direction: DeltaDirection | null;
    estimatedGap: number | null;
    status: FunnelPairStatus | null;
    eligible: boolean;
    sample: SampleBlock;
    note?: string;
}

const RATIO_NOTE = "Rasio tidak tersedia karena salah satu periode tidak memiliki angka pada tahap sebelumnya.";
const GATE_NOTE = "Gerbang sampel belum terpenuhi sehingga perbandingan belum dapat diandalkan.";

/** Shown on a stage whose event Meta never reported: a gap, not a zero. */
export function missingEventNote(key: FunnelStageKey): string {
    return `Event ${key} tidak tersedia pada periode ini.`;
}

/** Meta volumes need a larger gate than the small lead cohorts that follow the click. */
const HIGH_VOLUME_STAGES: FunnelStageKey[] = ["impressions", "link_clicks"];
const HIGH_VOLUME_GATE = 100;
const LEAD_GATE = 30;

function gateFor(from: FunnelStageKey): {threshold: number; gate: string} {
    return HIGH_VOLUME_STAGES.includes(from)
        ? {threshold: HIGH_VOLUME_GATE, gate: `≥ ${HIGH_VOLUME_GATE} per periode`}
        : {threshold: LEAD_GATE, gate: `≥ ${LEAD_GATE} per periode`};
}

/**
 * One transition of the funnel, current period against the previous one. `estimatedGap` is the
 * number of events lost at the baseline rate, never money; `null` values carry a `note` instead of
 * a fabricated zero.
 */
export function computePair(args: {
    from: FunnelStageKey;
    to: FunnelStageKey;
    current: {before: number | null; after: number | null};
    previous: {before: number | null; after: number | null};
    trackingState: TrackingState;
}): FunnelPair {
    const {from, to, current, previous, trackingState} = args;
    const {threshold, gate} = gateFor(from);

    const before = current.before;
    const after = current.after;

    // A null side means the event was never reported, so no ratio exists at all: the pair keeps nulls,
    // fails the sample gate, and says which event is missing instead of implying a zero.
    if (before === null || after === null) {
        return {
            from,
            to,
            rate: null,
            baseline: null,
            deltaPp: null,
            direction: null,
            estimatedGap: null,
            status: null,
            eligible: false,
            sample: {n: after ?? 0, denominator: before ?? 0, eligible: false, gate},
            note: missingEventNote(before === null ? from : to),
        };
    }

    const eligible = previous.before !== null
        && previous.after !== null
        && before >= threshold
        && previous.before >= threshold
        && trackingState === "up_to_date";

    const rate = before > 0 ? round4(after / before) : null;
    const baseline = previous.before !== null && previous.after !== null && previous.before > 0
        ? round4(previous.after / previous.before)
        : null;
    const deltaPp = rate !== null && baseline !== null ? round2(100 * (rate - baseline)) : null;
    const estimatedGap = rate !== null && baseline !== null
        ? Math.max(0, Math.round(before * baseline - after))
        : null;

    const pair: FunnelPair = {
        from,
        to,
        rate,
        baseline,
        deltaPp,
        direction: direction(deltaPp),
        estimatedGap,
        status: pairStatus(deltaPp),
        eligible,
        sample: {n: after, denominator: before, eligible, gate},
    };

    if (deltaPp === null) {
        pair.note = RATIO_NOTE;
    } else if (!eligible) {
        pair.note = GATE_NOTE;
    }

    return pair;
}

/** Consecutive stages of one channel; `previous` is looked up by key, a missing stage counts as 0. */
export function buildFunnelPairs(
    current: {key: FunnelStageKey; value: number | null}[],
    previous: {key: FunnelStageKey; value: number | null}[],
    trackingState: TrackingState
): FunnelPair[] {
    const previousByKey = new Map(previous.map((stage) => [stage.key, stage.value]));

    const pairs: FunnelPair[] = [];
    for (let index = 0; index < current.length - 1; index += 1) {
        const before = current[index];
        const after = current[index + 1];
        pairs.push(computePair({
            from: before.key,
            to: after.key,
            current: {before: before.value, after: after.value},
            // A stage the previous period did not report stays `null`; only an absent key becomes 0.
            previous: {
                before: previousByKey.get(before.key) ?? 0,
                after: previousByKey.get(after.key) ?? 0,
            },
            trackingState,
        }));
    }

    return pairs;
}

/** Thresholds are in percentage points, not percent. */
export function pairStatus(deltaPp: number | null): FunnelPairStatus | null {
    if (deltaPp === null) return null;
    if (deltaPp <= -15) return "kritis";
    if (deltaPp <= -5) return "perlu_perhatian";
    return "normal";
}

/** The most negative eligible transition; `null` when nothing eligible dropped. */
export function pickLeakage(pairs: FunnelPair[]): FunnelPair | null {
    let worst: FunnelPair | null = null;

    for (const pair of pairs) {
        if (!pair.eligible || pair.deltaPp === null || pair.deltaPp >= 0) continue;
        if (worst === null || worst.deltaPp === null || pair.deltaPp < worst.deltaPp) {
            worst = pair;
        }
    }

    return worst;
}

export interface PriorityStage {
    from: FunnelStageKey;
    to: FunnelStageKey;
    deltaPp: number;
}

/** Index of `stage` inside its own channel; `-1` for an unknown key, so ties still resolve. */
function stageDepth(stage: FunnelStageKey): number {
    const channel = stageChannel(stage);
    if (channel === null) return -1;
    return FUNNEL_STAGES[channel].findIndex((definition) => definition.key === stage);
}

/**
 * The transition the funnel page should open first: the largest eligible drop, and on a tie the
 * deepest stage, because a drop closer to revenue costs more than the same drop near the top.
 */
export function pickPriorityStage(pairs: FunnelPair[]): PriorityStage | null {
    let best: FunnelPair | null = null;
    let bestDepth = -1;

    for (const pair of pairs) {
        if (!pair.eligible || pair.deltaPp === null || pair.deltaPp >= 0) continue;
        if (best === null || best.deltaPp === null) {
            best = pair;
            bestDepth = stageDepth(pair.to);
            continue;
        }
        if (pair.deltaPp < best.deltaPp) {
            best = pair;
            bestDepth = stageDepth(pair.to);
            continue;
        }
        if (pair.deltaPp === best.deltaPp) {
            const depth = stageDepth(pair.to);
            if (depth > bestDepth) {
                best = pair;
                bestDepth = depth;
            }
        }
    }

    return best === null || best.deltaPp === null
        ? null
        : {from: best.from, to: best.to, deltaPp: best.deltaPp};
}

export function leakageCaption(estimatedGap: number): string {
    return `≈${estimatedGap} chat hilang`;
}

export function stageChannel(stageKey: string): FunnelObjectiveGroup | null {
    if (stageKey === "lpv" || stageKey === "view_content" || stageKey === "add_to_cart" || stageKey === "purchase") {
        return "web";
    }
    if (stageKey === "impressions"
        || stageKey === "link_clicks"
        || stageKey === "messaging_started"
        || stageKey === "observed"
        || stageKey === "replied"
        || stageKey === "qualified"
        || stageKey === "closed") {
        return "wa";
    }
    return null;
}

/** A missing sync run is `unknown`, not stale: nothing was ever measured. */
export function trackingStateOf(summary: {lastSuccessAt: Date | null; overdue: boolean}): TrackingState {
    if (summary.lastSuccessAt === null) return "unknown";
    return summary.overdue ? "stale" : "up_to_date";
}
