import {requireAccountScope} from "@db/repositories/ad-account.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {ExportAuditRepository, type ExportAuditRow} from "@db/repositories/export-audit.repository";
import {resolvePeriod} from "@shared/period";
import {csvDecimal, toCsv} from "@shared/csv";
import {logger} from "@shared/logger";
import {CreativeService, type CreativeTrendQuery, type CreativeTrendSeries} from "@/modules/creative/service";

export interface CreativeTrendCsvQuery {
    accountId: string;
    since?: string;
    until?: string;
    days?: number;
    creativeId?: string;
}

export interface CampaignsCsvQuery {
    accountId: string;
    campaignId?: string;
    since?: string;
    until?: string;
    days?: number;
}

export interface ExportsQuery {
    accountId?: string;
}

export interface CsvReport {
    filename: string;
    body: string;
    /** Data rows only, header excluded: what the audit row stores. */
    rowCount: number;
    filter: Record<string, unknown>;
}

const CREATIVE_TREND_HEADERS = [
    "Periode",
    "Tanggal",
    "Tayangan",
    "Klik link",
    "CTR link (%)",
    "Belanja (IDR)",
];

const CAMPAIGNS_HEADERS = [
    "Campaign",
    "Jalur",
    "Belanja IDR",
    "Tayangan",
    "Klik link",
    "Jenis hasil",
    "Jumlah hasil",
];

const REPORT_CREATIVE_TREND = "creative-trend";
const REPORT_CAMPAIGNS = "campaigns";

/**
 * CSV exports plus their audit trail. Each file is built from the exact reader the JSON endpoint
 * uses, so a downloaded cell and the on-screen number can never disagree.
 */
export class ReportsService {
    constructor(
        private readonly creativeService = new CreativeService(),
        private readonly insightDailyRepo = new AdInsightDailyRepository(),
        private readonly auditRepo = new ExportAuditRepository()
    ) {}

    async creativeTrendCsv(tenantId: string, query: CreativeTrendCsvQuery): Promise<CsvReport> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const trendQuery: CreativeTrendQuery = {
            accountId: query.accountId,
            metric: "impressions",
            since: query.since,
            until: query.until,
            days: query.days,
            creativeId: query.creativeId,
        };
        const series = await this.creativeService.getTrendSeries(tenantId, trendQuery);

        const toRows = (period: "current" | "previous", days: CreativeTrendSeries["current"]) =>
            days.map((day) => [
                period,
                day.date,
                day.impressions,
                day.clicks,
                csvDecimal(day.ctr, 4),
                day.spendMinor === null ? null : Math.round(day.spendMinor / account.currencyOffset),
            ]);

        const rows = [...toRows("current", series.current), ...toRows("previous", series.previous)];

        return {
            filename: "creative-trend.csv",
            body: toCsv(CREATIVE_TREND_HEADERS, rows),
            rowCount: rows.length,
            filter: this.filterOf(query),
        };
    }

    async campaignsCsv(tenantId: string, query: CampaignsCsvQuery): Promise<CsvReport> {
        const account = await requireAccountScope(tenantId, query.accountId);
        const period = resolvePeriod(account, query);

        const rows = await this.insightDailyRepo.getCampaignChannelPerformance(
            query.accountId,
            period.start,
            period.end,
            query.campaignId
        );

        const data = rows.map((row) => [
            row.campaignName,
            row.objectiveGroup === "wa" ? "WhatsApp" : "Website",
            Math.round(row.spendMinor / account.currencyOffset),
            row.impressions,
            row.linkClicks,
            row.objectiveGroup === "wa" ? "Percakapan" : "Pembelian",
            row.objectiveGroup === "wa" ? row.leads : row.purchases,
        ]);

        return {
            filename: "campaigns.csv",
            body: toCsv(CAMPAIGNS_HEADERS, data),
            rowCount: data.length,
            filter: this.filterOf(query),
        };
    }

    /** Best effort by design: a failed audit insert must never cost the user their download. */
    async recordExport(input: {
        tenantId: string;
        userId: string;
        report: string;
        filter: Record<string, unknown>;
        rowCount: number;
    }): Promise<void> {
        try {
            await this.auditRepo.record(input);
        } catch (error) {
            logger.warn({err: error, report: input.report}, "export audit insert failed");
        }
    }

    async listExports(tenantId: string, query: ExportsQuery): Promise<ExportAuditRow[]> {
        return this.auditRepo.findRecent(tenantId, query.accountId);
    }

    /** Only the parameters the client actually sent, so an audit row never invents a default. */
    private filterOf(query: object): Record<string, unknown> {
        const filter: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) filter[key] = value;
        }

        return filter;
    }
}

export const CREATIVE_TREND_REPORT = REPORT_CREATIVE_TREND;
export const CAMPAIGNS_REPORT = REPORT_CAMPAIGNS;
