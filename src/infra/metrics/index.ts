/**
 * In-process Prometheus text exposition. Counters and histograms live in memory: one process, no
 * scrape-side aggregation, and a restart resets them — which is exactly what a counter is.
 *
 * Labels stay bounded because the caller passes the *route pattern* (`/api/leads/:id`), never the
 * concrete path.
 */

export const DURATION_BUCKETS_MS = [5, 25, 50, 100, 250, 500, 1000, 2500] as const;

/** Enough samples for stable p95/p99 without letting one route grow unbounded. */
const SAMPLE_RESERVOIR = 1024;

function labelKey(labels: Record<string, string>): string {
    return Object.entries(labels)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([name, value]) => `${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",");
}

export class Counter {
    private readonly values = new Map<string, number>();

    inc(labels: Record<string, string>, value: number = 1): void {
        const key = labelKey(labels);
        this.values.set(key, (this.values.get(key) ?? 0) + value);
    }

    render(name: string, help: string, lines: string[]): void {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
        for (const [labels, value] of [...this.values.entries()].sort()) {
            lines.push(`${name}{${labels}} ${value}`);
        }
    }
}

export class Histogram {
    private readonly bucketCounts = new Map<string, number[]>();
    private readonly counts = new Map<string, number>();
    private readonly sums = new Map<string, number>();
    private readonly samples = new Map<string, number[]>();

    /** `valueMs` is milliseconds; the exposition converts to seconds. */
    observe(labels: Record<string, string>, valueMs: number): void {
        const key = labelKey(labels);
        const buckets = this.bucketCounts.get(key) ?? new Array(DURATION_BUCKETS_MS.length).fill(0);

        for (let index = 0; index < DURATION_BUCKETS_MS.length; index += 1) {
            if (valueMs <= DURATION_BUCKETS_MS[index]) {
                buckets[index] += 1;
                break;
            }
        }

        this.bucketCounts.set(key, buckets);
        this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
        this.sums.set(key, (this.sums.get(key) ?? 0) + valueMs);

        const reservoir = this.samples.get(key) ?? [];
        if (reservoir.length < SAMPLE_RESERVOIR) reservoir.push(valueMs);
        this.samples.set(key, reservoir);
    }

    private quantile(sorted: number[], q: number): number {
        if (sorted.length === 0) return 0;
        const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
        return sorted[index];
    }

    render(name: string, help: string, lines: string[]): void {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} histogram`);

        for (const key of [...this.counts.keys()].sort()) {
            const buckets = this.bucketCounts.get(key) ?? [];
            const count = this.counts.get(key) ?? 0;

            // Prometheus buckets are cumulative, so each le value carries every smaller observation.
            let cumulative = 0;
            for (let index = 0; index < DURATION_BUCKETS_MS.length; index += 1) {
                cumulative += buckets[index] ?? 0;
                lines.push(`${name}_bucket{${key},le="${(DURATION_BUCKETS_MS[index] / 1000).toFixed(3)}"} ${cumulative}`);
            }
            lines.push(`${name}_bucket{${key},le="+Inf"} ${count}`);
            lines.push(`${name}_count{${key}} ${count}`);
            lines.push(`${name}_sum{${key}} ${((this.sums.get(key) ?? 0) / 1000).toFixed(6)}`);

            const sorted = [...(this.samples.get(key) ?? [])].sort((left, right) => left - right);
            for (const q of [0.5, 0.95, 0.99]) {
                lines.push(`${name}{${key},quantile="${q}"} ${(this.quantile(sorted, q) / 1000).toFixed(6)}`);
            }
        }
    }
}

export const httpRequestsTotal = new Counter();
export const httpRequestDuration = new Histogram();

/** Prometheus text for `GET /api/metrics`. */
export function renderMetrics(): string {
    const lines: string[] = [];
    httpRequestsTotal.render(
        "http_requests_total",
        "Total HTTP requests by route pattern, method, and status.",
        lines
    );
    httpRequestDuration.render(
        "http_request_duration_seconds",
        "HTTP request duration by route pattern.",
        lines
    );

    return `${lines.join("\n")}\n`;
}
