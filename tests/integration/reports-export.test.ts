import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {db} from "@db/index";
import {DatabaseRepository} from "@db/repositories/base.repository";
import {AdInsightDailyRepository} from "@db/repositories/ad-insight-daily.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {UserRepository} from "@db/repositories/user.repository";
import {TenantEntity} from "@db/schema/core/tenant.entity";
import {UserEntity} from "@db/schema/core/user.entity";
import {ExportAuditEntity} from "@db/schema/ads/export-audit.entity";
import {AdAccountEntity} from "@db/schema/ads/ad-account.entity";
import {CampaignEntity} from "@db/schema/ads/campaign.entity";
import {AdSetEntity} from "@db/schema/ads/ad-set.entity";
import {AdEntity} from "@db/schema/ads/ad.entity";
import {AdCreativeEntity} from "@db/schema/ads/ad-creative.entity";
import {JwtUtil} from "@shared/jwt";
import {eq} from "drizzle-orm";
import {CreativeService} from "@/modules/creative/service";
import {AnalyticsService} from "@/modules/analytics/service";
import {readData, readError} from "../helpers";

class TestCleanupRepository extends DatabaseRepository {
    /**
     * `export_audit` pins both the tenant and the user and `users.tenant_id` has no cascade, so the
     * rows go first, then the user, then the tenant.
     */
    async cleanup(tenantId: string): Promise<void> {
        await this.database.delete(ExportAuditEntity).where(eq(ExportAuditEntity.tenantId, tenantId));
        await this.database.delete(UserEntity).where(eq(UserEntity.tenantId, tenantId));
        await this.database.delete(TenantEntity).where(eq(TenantEntity.id, tenantId));
    }
}

const SINCE = "2026-03-01";
const UNTIL = "2026-03-07";

/** Splits a CSV body into raw lines, dropping the BOM and the trailing empty line. */
function lines(body: string): string[] {
    const withoutBom = body.startsWith("\uFEFF") ? body.slice(1) : body;
    return withoutBom.split("\r\n").slice(0, -1);
}

function cells(line: string): string[] {
    return line.slice(1, -1).split('","');
}

describe("Reports and export", () => {
    const cleanupRepo = new TestCleanupRepository();
    const tenantRepo = new TenantRepository();
    const userRepo = new UserRepository();
    const insightDailyRepo = new AdInsightDailyRepository();
    const creativeService = new CreativeService();
    const analyticsService = new AnalyticsService();

    const u = Date.now().toString();
    const accountId = `act_report_${u}`;
    const campaignId = `camp_report_${u}`;
    const adsetId = `adset_report_${u}`;
    const creativeId = `cr_report_${u}`;
    const adId = `ad_report_${u}`;
    const webCampaignId = `camp_web_${u}`;
    const webAdsetId = `adset_web_${u}`;
    const webCreativeId = `cr_web_${u}`;
    const webAdId = `ad_web_${u}`;

    let tenantId: string;
    let userId: string;
    let token: {key: string};

    beforeAll(async () => {
        const tenant = await tenantRepo.create({name: `report-test-${u}`});
        tenantId = tenant.id;

        const user = await userRepo.create({
            fullName: "Rina Admin",
            email: `report-${u}@funnellens.test`,
            hashPassword: "hash",
            role: "ADMIN",
            tenantId,
        });
        userId = user.id;
        token = await new JwtUtil().register({id: userId, tenant: tenantId, role: "ADMIN"});

        await db.insert(AdAccountEntity).values({
            id: accountId,
            tenantId,
            name: `Report Account ${u}`,
            currency: "IDR",
            currencyOffset: 100,
            timezoneName: "Asia/Jakarta",
        });
        await db.insert(CampaignEntity).values([
            {id: campaignId, accountId, name: `Report Campaign ${u}`, status: "ACTIVE"},
            {id: webCampaignId, accountId, name: `A Web Campaign ${u}`, status: "ACTIVE"},
        ]);
        await db.insert(AdSetEntity).values([
            {id: adsetId, accountId, campaignId, name: `Report AdSet ${u}`, objectiveGroup: "wa"},
            {id: webAdsetId, accountId, campaignId: webCampaignId, name: `Web AdSet ${u}`, objectiveGroup: "web"},
        ]);
        await db.insert(AdCreativeEntity).values([
            {id: creativeId, accountId, name: `Report Creative ${u}`},
            {id: webCreativeId, accountId, name: `Web Creative ${u}`},
        ]);
        await db.insert(AdEntity).values([
            {id: adId, accountId, campaignId, adsetId, creativeId, name: `Report Ad ${u}`},
            {id: webAdId, accountId, campaignId: webCampaignId, adsetId: webAdsetId, creativeId: webCreativeId, name: `Web Ad ${u}`},
        ]);

        const row = (date: string, values: {
            impressions: number;
            clicks: number;
            inlineLinkClicks: number;
            spendMinor: number;
            leads: number;
            web?: {purchases: number; valueMinor: number};
        }) => ({
            accountId,
            level: "ad" as const,
            entityId: values.web === undefined ? adId : webAdId,
            campaignId: values.web === undefined ? campaignId : webCampaignId,
            adsetId: values.web === undefined ? adsetId : webAdsetId,
            adId: values.web === undefined ? adId : webAdId,
            date,
            currency: "IDR",
            currencyOffset: 100,
            spendMinor: values.spendMinor,
            impressions: values.impressions,
            clicks: values.clicks,
            inlineLinkClicks: values.inlineLinkClicks,
            actions: values.web === undefined
                ? [{actionType: "lead", count: String(values.leads), valueMinor: null, costPerActionMinor: null}]
                : [{
                    actionType: "purchase",
                    count: String(values.web.purchases),
                    valueMinor: values.web.valueMinor,
                    costPerActionMinor: null,
                }],
        });

        await insightDailyRepo.upsertBatch([
            row("2026-03-01", {impressions: 1000, clicks: 30, inlineLinkClicks: 20, spendMinor: 50000, leads: 4}),
            // Present but with zero impressions: CTR is unmeasurable that day, not zero.
            row("2026-03-03", {impressions: 0, clicks: 0, inlineLinkClicks: 0, spendMinor: 0, leads: 0}),
            row("2026-02-25", {impressions: 800, clicks: 40, inlineLinkClicks: 30, spendMinor: 40000, leads: 3}),
            row("2026-03-02", {
                impressions: 2000,
                clicks: 60,
                inlineLinkClicks: 50,
                spendMinor: 90000,
                leads: 0,
                web: {purchases: 3, valueMinor: 750000},
            }),
        ]);
    });

    afterAll(async () => {
        if (tenantId !== undefined) await cleanupRepo.cleanup(tenantId);
    });

    it("returns a daily trend with a null value on days without rows", async () => {
        const result = await creativeService.getTrend(tenantId, {
            accountId,
            metric: "ctr",
            since: SINCE,
            until: UNTIL,
        });

        expect(result.metric).toBe("ctr");
        expect(result.current.length).toBe(7);
        expect(result.previous.length).toBe(7);
        // 2026-03-02 belongs to the web creative: without a creativeId every creative of the account counts.
        expect(result.current.map((point) => point.value)).toEqual([
            0.03, 0.03, null, null, null, null, null,
        ]);
        expect(result.previous.map((point) => point.value)).toEqual([
            null, null, null, 0.05, null, null, null,
        ]);
        expect(result.total).toEqual({current: 0.03, previous: 0.05, deltaPct: -40});
        expect(result.note).toBe("Sebagian hari tanpa tayangan sehingga CTR hari itu tidak terukur.");
    });

    it("serves the trend over HTTP with a day count and never resolves it as an id", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/creatives/trend?accountId=${accountId}&metric=ctr&days=7`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const body = await readData<{
            metric: string;
            current: {date: string; value: number | null}[];
            previous: {date: string; value: number | null}[];
        }>(response);
        expect(body.metric).toBe("ctr");
        expect(body.current.length).toBe(7);
        expect(body.previous.length).toBe(7);

        // Query strings are coerced, so the 7/14/30 gate is the service's documented 400, not a 422 union.
        const invalid = await app.handle(new Request(
            `http://localhost/api/analytics/creatives/trend?accountId=${accountId}&metric=ctr&days=9`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));
        expect(invalid.status).toBe(400);
        expect(await readError(invalid)).toEqual({
            code: "INVALID_DAYS",
            message: "days harus 7, 14, atau 30",
            details: null,
        });
    });

    it("sums spend as minor units and reports null for an empty previous period", async () => {
        const result = await creativeService.getTrend(tenantId, {
            accountId,
            metric: "spend",
            since: SINCE,
            until: UNTIL,
            creativeId,
        });

        expect(result.creativeId).toBe(creativeId);
        expect(result.current[0]).toEqual({date: "2026-03-01", value: 50000});
        expect(result.current[2]).toEqual({date: "2026-03-03", value: 0});
        expect(result.total).toEqual({current: 50000, previous: 40000, deltaPct: 25});
    });

    it("writes the creative-trend CSV with a BOM, CRLF, and machine-readable numbers", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/reports/creative-trend.csv?accountId=${accountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
        expect(response.headers.get("content-disposition")).toBe('attachment; filename="creative-trend.csv"');

        const bytes = new Uint8Array(await response.arrayBuffer());
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

        const body = new TextDecoder().decode(bytes);
        const rows = lines(body);
        expect(rows.length).toBe(15);
        expect(rows[0]).toBe('"Periode","Tanggal","Tayangan","Klik link","CTR link (%)","Belanja (IDR)"');
        expect(cells(rows[1])).toEqual(["current", "2026-03-01", "1000", "30", "0.0300", "500"]);
        expect(cells(rows[2])).toEqual(["current", "2026-03-02", "2000", "60", "0.0300", "900"]);
        // A day with a row but zero impressions: counters are real zeros, CTR is unmeasurable.
        expect(cells(rows[3])).toEqual(["current", "2026-03-03", "0", "0", "", "0"]);
        // A day without rows: every counter empty, never a zero.
        expect(cells(rows[4])).toEqual(["current", "2026-03-04", "", "", "", ""]);
        expect(cells(rows[8])).toEqual(["previous", "2026-02-22", "", "", "", ""]);
        expect(cells(rows[11])).toEqual(["previous", "2026-02-25", "800", "40", "0.0500", "400"]);
    });

    it("honours days=7 on the CSV route and still emits both periods", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/reports/creative-trend.csv?accountId=${accountId}&days=7`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const rows = lines(await response.text());
        expect(rows.length).toBe(15);
        expect(cells(rows[1])).toEqual(["current", "2026-11-13", "", "", "", ""]);
        expect(cells(rows[8])).toEqual(["previous", "2026-11-06", "", "", "", ""]);
    });

    it("keeps the CSV cells equal to the JSON trend for the same parameters", async () => {
        const trend = await creativeService.getTrendSeries(tenantId, {
            accountId,
            metric: "impressions",
            since: SINCE,
            until: UNTIL,
        });
        const response = await app.handle(new Request(
            `http://localhost/api/reports/creative-trend.csv?accountId=${accountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));
        const rows = lines(await response.text()).slice(1).map(cells);

        expect(rows.length).toBe(trend.current.length + trend.previous.length);
        trend.current.forEach((day, index) => {
            const row = rows[index];
            expect(row[1]).toBe(day.date);
            expect(row[2]).toBe(day.impressions === null ? "" : String(day.impressions));
            expect(row[3]).toBe(day.clicks === null ? "" : String(day.clicks));
            expect(row[4]).toBe(day.ctr === null ? "" : day.ctr.toFixed(4));
            expect(row[5]).toBe(day.spendMinor === null ? "" : String(Math.round(day.spendMinor / 100)));
        });
    });

    it("writes the campaigns CSV with the exact header and matching summary numbers", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/reports/campaigns.csv?accountId=${accountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(200);
        const rows = lines(await response.text());
        expect(rows[0]).toBe('"Campaign","Jalur","Belanja IDR","Tayangan","Klik link","Jenis hasil","Jumlah hasil"');
        expect(rows.length).toBe(3);
        // Ordered by campaign name: the web campaign sorts first.
        expect(cells(rows[1])).toEqual([
            `A Web Campaign ${u}`,
            "Website",
            "900",
            "2000",
            "50",
            "Pembelian",
            "3",
        ]);
        expect(cells(rows[2])).toEqual([
            `Report Campaign ${u}`,
            "WhatsApp",
            "500",
            "1000",
            "20",
            "Percakapan",
            "4",
        ]);

        const summary = await analyticsService.getSummary(tenantId, {accountId, since: SINCE, until: UNTIL});
        const csvRow = cells(rows[2]);
        const summaryRow = summary.campaigns.find((row) => row.campaignId === campaignId);
        if (summaryRow === undefined) throw new Error("campaign row missing from the summary");

        expect(Number(csvRow[2])).toBe(summaryRow.spendMinor / 100);
        expect(Number(csvRow[6])).toBe(summaryRow.leads);

        const webSummaryRow = summary.campaigns.find((row) => row.campaignId === webCampaignId);
        if (webSummaryRow === undefined) throw new Error("web campaign row missing from the summary");
        expect(Number(cells(rows[1])[2])).toBe(webSummaryRow.spendMinor / 100);
    });

    it("records both downloads and lists them newest first", async () => {
        const exportsResponse = await app.handle(new Request(
            `http://localhost/api/reports/exports`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(exportsResponse.status).toBe(200);
        const listing = await readData<{
            items: {
                id: number;
                report: string;
                filter: Record<string, unknown>;
                rowCount: number;
                userName: string | null;
                createdAt: string;
            }[];
            meta: {page: number; page_size: number; total: number; pages: number};
        }>(exportsResponse);
        const body = listing.items;

        expect(body.length).toBe(4);
        expect(listing.meta).toEqual({page: 1, page_size: 10, total: 4, pages: 1});
        expect([...new Set(body.map((row) => row.report))].sort()).toEqual(["campaigns", "creative-trend"]);
        expect(body.every((row) => row.userName === "Rina Admin")).toBe(true);
        for (const row of body.filter((entry) => entry.filter.days === undefined)) {
            expect(row.filter).toEqual({accountId, since: SINCE, until: UNTIL});
        }
        // Only the parameters the client sent: the `days` download records `days`, not a resolved window.
        expect(body.filter((row) => row.filter.days !== undefined).map((row) => row.filter))
            .toEqual([{accountId, days: 7}]);

        expect(body.filter((row) => row.report === "campaigns").map((row) => row.rowCount)).toEqual([2]);
        expect(body.filter((row) => row.report === "creative-trend").map((row) => row.rowCount))
            .toEqual([14, 14, 14]);
    });

    it("still returns the file when the audit insert cannot be written", async () => {
        // The token carries an id with no `users` row, so the audit insert hits the foreign key.
        const ghost = await new JwtUtil().register({
            id: "00000000-0000-4000-8000-000000000000",
            tenant: tenantId,
            role: "ADMIN",
        });
        const response = await app.handle(new Request(
            `http://localhost/api/reports/campaigns.csv?accountId=${accountId}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${ghost.key}`}}
        ));

        expect(response.status).toBe(200);
        expect(lines(await response.text()).length).toBe(3);

        const listed = await app.handle(new Request(
            `http://localhost/api/reports/exports`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));
        const listedBody = await readData<{
            items: unknown[];
            meta: {page: number; page_size: number; total: number; pages: number};
        }>(listed);
        expect(listedBody.items.length).toBe(4);
        expect(listedBody.meta).toEqual({page: 1, page_size: 10, total: 4, pages: 1});
    });

    it("hides accounts owned by another tenant", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/reports/campaigns.csv?accountId=act_missing_${u}&since=${SINCE}&until=${UNTIL}`,
            {headers: {authorization: `Bearer ${token.key}`}}
        ));

        expect(response.status).toBe(404);
        expect(await readError(response)).toEqual({
            code: "NOT_FOUND",
            message: "Akun iklan tidak ditemukan",
            details: null,
        });
    });
});
