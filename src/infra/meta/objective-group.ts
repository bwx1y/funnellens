export type ObjectiveGroup = "wa" | "web";

/**
 * WA conversations are optimized through the messaging destinations; everything else is treated as web.
 * `destination_type` is authoritative when present, `optimization_goal` is the fallback.
 */
export function deriveObjectiveGroup(
    optimizationGoal: string | null | undefined,
    destinationType: string | null | undefined
): ObjectiveGroup {
    const destination = (destinationType ?? "").toUpperCase();
    if (destination === "WHATSAPP" || destination === "MESSENGER") return "wa";
    if ((optimizationGoal ?? "").toUpperCase() === "CONVERSATIONS") return "wa";
    return "web";
}
