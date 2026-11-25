import {Elysia} from "elysia";
import {JwtUtil} from "@shared/jwt";
import {csvResponse} from "@shared/csv";
import {
    CAMPAIGNS_REPORT,
    CREATIVE_TREND_REPORT,
    ReportsService,
    type CsvReport,
} from "@/modules/reports/service";
import {ReportsSchema} from "@/modules/reports/schema";
import {PurchaseReconciliationService} from "@/modules/reports/reconciliation.service";

/**
 * Both CSV routes write their audit row after the body is built and before the response is sent; the
 * audit write is best-effort, so a failed insert still returns the file.
 */
export const ReportsController = new Elysia({
    prefix: "/reports",
    detail: {
        tags: ["Reports"],
        security: [
            {bearerAuth: []}
        ]
    }
})
    .decorate("reportsService", new ReportsService())
    .decorate("reconciliationService", new PurchaseReconciliationService())
    .use(JwtUtil.isAuthenticated)
    .get("/creative-trend.csv",
        async ({user, query, reportsService}) => {
            const report: CsvReport = await reportsService.creativeTrendCsv(user.tenantId, query);
            await reportsService.recordExport({
                tenantId: user.tenantId,
                userId: user.iss,
                report: CREATIVE_TREND_REPORT,
                filter: report.filter,
                rowCount: report.rowCount,
            });

            return csvResponse(report.filename, report.body);
        },
        {
            query: ReportsSchema.creativeTrend,
            detail: {
                summary: "Download the daily creative trend as CSV"
            }
        })
    .get("/campaigns.csv",
        async ({user, query, reportsService}) => {
            const report: CsvReport = await reportsService.campaignsCsv(user.tenantId, query);
            await reportsService.recordExport({
                tenantId: user.tenantId,
                userId: user.iss,
                report: CAMPAIGNS_REPORT,
                filter: report.filter,
                rowCount: report.rowCount,
            });

            return csvResponse(report.filename, report.body);
        },
        {
            query: ReportsSchema.campaigns,
            detail: {
                summary: "Download per-campaign spend and results as CSV"
            }
        })
    .post("/recorded-orders",
        async ({user, query, body, reconciliationService}) =>
            reconciliationService.recordOrders(user.tenantId, query.accountId, body),
        {
            query: ReportsSchema.recordedOrdersQuery,
            body: ReportsSchema.recordedOrders,
            detail: {
                summary: "Record the orders the business actually booked for one day"
            }
        })
    .get("/exports",
        async ({user, query, reportsService}) => reportsService.listExports(user.tenantId, query),
        {
            query: ReportsSchema.exports,
            detail: {
                summary: "List the tenant's last 50 CSV exports"
            }
        });
