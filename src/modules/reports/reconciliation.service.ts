import {
    PurchaseReconciliationRepository,
    type RecordedOrderInput,
    type ReconciliationRow,
} from "@db/repositories/purchase-reconciliation.repository";
import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {addDays} from "@shared/dates";
import {logger} from "@shared/logger";

/** The window the nightly job and the tracking-health panel both look at. */
export const RECONCILIATION_WINDOW_DAYS = 7;

const ATTRIBUTION_GAP_REASON = "selisih atribusi";

export interface ReconciliationResult {
    accountId: string;
    rows: number;
    mismatched: number;
}

/**
 * Compares the purchases Meta attributed against the orders the business recorded. `difference` is
 * `recorded − meta`, so a positive number is demand Meta failed to attribute (a tracking gap) and a
 * negative one is Meta counting purchases the business never booked (double counting).
 */
export class PurchaseReconciliationService {
    constructor(private readonly repo = new PurchaseReconciliationRepository()) {}

    async recordOrders(tenantId: string, accountId: string, input: RecordedOrderInput) {
        await requireAccountScope(tenantId, accountId);
        const row = await this.repo.upsertRecordedOrders(accountId, input);

        return {date: row.date, orders: row.orders, revenueMinor: row.revenueMinor};
    }

    async recent(accountId: string): Promise<ReconciliationRow[]> {
        return this.repo.findRecent(accountId, RECONCILIATION_WINDOW_DAYS);
    }

    /** Reconciles every account that has recorded orders; a day with no Meta row counts as zero. */
    async reconcileAll(now: Date = new Date()): Promise<ReconciliationResult[]> {
        const accounts = await this.repo.findAccountsWithRecordedOrders();
        const results: ReconciliationResult[] = [];

        for (const accountId of accounts) {
            const until = now.toISOString().slice(0, 10);
            const since = addDays(until, -(RECONCILIATION_WINDOW_DAYS - 1));

            const [recorded, meta] = await Promise.all([
                this.repo.findRecordedOrdersBetween(accountId, since, until),
                this.repo.getMetaPurchasesByDate(accountId, since, until),
            ]);

            let mismatched = 0;
            for (const order of recorded) {
                const metaPurchases = meta.get(order.date) ?? 0;
                const difference = order.orders - metaPurchases;
                if (difference !== 0) mismatched += 1;

                await this.repo.upsertReconciliation({
                    accountId,
                    date: order.date,
                    metaPurchases,
                    recordedOrders: order.orders,
                    difference,
                    reason: difference === 0 ? null : ATTRIBUTION_GAP_REASON,
                });
            }

            results.push({accountId, rows: recorded.length, mismatched});
            logger.info({accountId, rows: recorded.length, mismatched}, "purchase reconciliation finished");
        }

        return results;
    }
}
