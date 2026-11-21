/** Two-decimal rounding for percentage points and money-adjacent ratios. */
export function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Four-decimal rounding for rates and shares. */
export function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}

/** Mean of the two middle values for an even count; `null` for an empty input. Not rounded. */
export function median(values: number[]): number | null {
    if (values.length === 0) return null;

    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];

    return (sorted[middle - 1] + sorted[middle]) / 2;
}
