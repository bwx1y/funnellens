import {beforeAll, describe, expect, it} from "bun:test";
import {app} from "@/index";
import {JwtUtil} from "@shared/jwt";
import {seedDemo} from "../../scripts/seed-demo";
import {Config} from "@/config";
import postgres from "postgres";
import {readData} from "../helpers";

const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_ACCOUNT_ID = "act_demo_funnellens";

async function isDbAvailable(): Promise<boolean> {
    try {
        const testSql = postgres({
            host: Config.database.host,
            port: Config.database.port,
            user: Config.database.user,
            password: Config.database.password,
            database: Config.database.name,
            max: 1,
            connect_timeout: 2,
        });
        await testSql`select 1`;
        await testSql.end();
        return true;
    } catch {
        return false;
    }
}

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)("Seed parity golden test", () => {
    let headers: {authorization: string};

    beforeAll(async () => {
        // Run seed script to guarantee clean parity state
        await seedDemo();

        const token = await new JwtUtil().register({
            id: "00000000-0000-4000-8000-000000000002",
            tenant: DEMO_TENANT_ID,
            role: "ADMIN",
        });
        headers = {authorization: `Bearer ${token.key}`};
    });

    it("locks summary KPIs and campaigns", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/summary?accountId=${DEMO_ACCOUNT_ID}&since=2026-10-27&until=2026-11-25`,
            {headers}
        ));
        expect(response.status).toBe(200);

        const data = await readData<any>(response);
        // 8 WA ads * 2 messaging_started per day * 30 days = 480 messaging started
        expect(data.cards.leads.value).toBe(480);
        expect(data.campaigns.length).toBe(3);
    });

    it("locks funnel stages for WhatsApp channel", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/funnel?accountId=${DEMO_ACCOUNT_ID}&since=2026-10-27&until=2026-11-25&objectiveGroup=wa`,
            {headers}
        ));
        expect(response.status).toBe(200);

        const data = await readData<any>(response);
        expect(data.stages.length).toBe(7);
        expect(data.stages[0].key).toBe("impressions");
    });

    it("locks creative count", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/creatives?accountId=${DEMO_ACCOUNT_ID}&since=2026-10-27&until=2026-11-25`,
            {headers}
        ));
        expect(response.status).toBe(200);

        const data = await readData<any>(response);
        expect(data.creatives.length).toBe(11);
    });

    it("locks audience lead count and temperature distribution", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/audience?accountId=${DEMO_ACCOUNT_ID}&since=2026-10-27&until=2026-11-25`,
            {headers}
        ));
        expect(response.status).toBe(200);

        const data = await readData<any>(response);
        expect(data.total).toBe(8);
        const hot = data.distribution.find((d: any) => d.temperature === "hot")?.count;
        const warm = data.distribution.find((d: any) => d.temperature === "warm")?.count;
        const cold = data.distribution.find((d: any) => d.temperature === "cold")?.count;
        expect([hot, warm, cold]).toEqual([3, 3, 2]);
    });

    it("locks conversation reply types and median reply time", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/analytics/audience/conversations?accountId=${DEMO_ACCOUNT_ID}&since=2026-10-27&until=2026-11-25`,
            {headers}
        ));
        expect(response.status).toBe(200);

        const data = await readData<any>(response);
        expect(data.counts.length).toBe(7);
        expect(data.timed.medianSeconds).toBe(1440);
    });

    it("locks active alerts and badge count", async () => {
        const response = await app.handle(new Request(
            `http://localhost/api/alerts?accountId=${DEMO_ACCOUNT_ID}&status=active`,
            {headers}
        ));
        expect(response.status).toBe(200);

        const data = await readData<any>(response);
        expect(data.alerts.length).toBe(3);

        const badgeRes = await app.handle(new Request(
            `http://localhost/api/alerts/badge?accountId=${DEMO_ACCOUNT_ID}`,
            {headers}
        ));
        expect(badgeRes.status).toBe(200);
        const badgeData = await readData<any>(badgeRes);
        expect(badgeData.count).toBe(3);
    });
});
