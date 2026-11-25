/**
 * One vocabulary for "can this source be trusted right now", shared by `/api/settings` and
 * `/api/sources`. Two implementations would drift: the settings page and the sources panel must never
 * disagree about whether Meta is connected.
 *
 * `expired` is a fifth value on top of the four the checklist names: task 22 already ships it to the
 * settings page, and folding a lapsed token into `disconnected` would hide the one detail that tells a
 * user to reconnect instead of re-authorising from scratch.
 */
export type SourceStatus = "connected" | "simulation" | "disconnected" | "expired" | "out_of_scope";

export interface SourceStatusInput {
    /** A credential row exists (Meta connection, WhatsApp session). */
    configured: boolean;
    /** That credential has expired; irrelevant when `configured` is false. */
    expired?: boolean;
    /** At least one sync/ingest completed successfully. */
    synced?: boolean;
    /** The workspace's ad sets target this channel at all. */
    inScope?: boolean;
}

/**
 * Order of the checks is the contract:
 * - `out_of_scope` wins: a channel the workspace does not run has no status to report.
 * - `disconnected` when nothing is configured, `expired` when the credential died.
 * - `simulation` when configured but never synced: the connection is real, the data is not yet.
 */
export function sourceStatusOf(input: SourceStatusInput): SourceStatus {
    if (input.inScope === false) return "out_of_scope";
    if (!input.configured) return "disconnected";
    if (input.expired === true) return "expired";
    if (input.synced !== true) return "simulation";

    return "connected";
}
