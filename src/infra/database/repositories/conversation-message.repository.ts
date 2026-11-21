import {DatabaseRepository} from "./base.repository";
import {sql} from "drizzle-orm";

/**
 * Read side of `conversation_messages`. Every method scopes to the period's messages by `sent_at` and
 * to the tenant's leads by `account_id`; the "first measured response" is the earliest row per lead
 * with a non-null, non-negative `response_seconds`.
 */
export class ConversationMessageRepository extends DatabaseRepository {
    /** Last classified answer per lead in the period, aggregated per `(response_type, sentiment)`. */
    async getLastClassifiedCounts(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{responseType: string; sentiment: string | null; total: number}[]> {
        const rows = await this.database.execute(sql`
            with last as (
                select distinct on (m.lead_id) m.lead_id, m.response_type, m.sentiment
                from conversation_messages m
                join leads l on l.id = m.lead_id
                where l.account_id = ${accountId}
                  and m.sent_at >= ${since.toISOString()}::timestamptz
                  and m.sent_at <= ${until.toISOString()}::timestamptz
                  and m.response_type is not null
                order by m.lead_id asc, m.sent_at desc, m.id desc
            )
            select response_type, sentiment, count(*) as total
            from last
            group by 1, 2
            order by 1 asc, 2 asc
        `) as unknown as {response_type: string; sentiment: string | null; total: string}[];

        return rows.map((row) => ({
            responseType: row.response_type,
            sentiment: row.sentiment,
            total: Number(row.total),
        }));
    }

    /** Median of the first measured response per lead; `observedLeads` counts leads with any message. */
    async getTimedInsights(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{medianSeconds: number | null; measuredLeads: number; observedLeads: number}> {
        const rows = await this.database.execute(sql`
            with first as (
                select distinct on (m.lead_id) m.lead_id, m.response_seconds
                from conversation_messages m
                join leads l on l.id = m.lead_id
                where l.account_id = ${accountId}
                  and m.sent_at >= ${since.toISOString()}::timestamptz
                  and m.sent_at <= ${until.toISOString()}::timestamptz
                  and m.response_seconds is not null
                  and m.response_seconds >= 0
                order by m.lead_id asc, m.sent_at asc, m.id asc
            )
            select percentile_cont(0.5) within group (order by response_seconds) as median_seconds,
                   count(*)                                                  as measured_leads,
                   (select count(distinct m2.lead_id)
                    from conversation_messages m2
                    join leads l2 on l2.id = m2.lead_id
                    where l2.account_id = ${accountId}
                      and m2.sent_at >= ${since.toISOString()}::timestamptz
                      and m2.sent_at <= ${until.toISOString()}::timestamptz) as observed_leads
            from first
        `) as unknown as {median_seconds: string | number | null; measured_leads: string; observed_leads: string}[];

        const [row] = rows;
        return {
            medianSeconds: row.median_seconds === null ? null : Number(row.median_seconds),
            measuredLeads: Number(row.measured_leads),
            observedLeads: Number(row.observed_leads),
        };
    }

    /** First measured response per lead, with its current temperature (for the cohort heatmap). */
    async getLeadFirstResponses(
        accountId: string,
        since: Date,
        until: Date
    ): Promise<{leadId: number; temperature: "COLD" | "WARM" | "HOT" | null; responseSeconds: number}[]> {
        const rows = await this.database.execute(sql`
            select distinct on (m.lead_id) m.lead_id, l.temperature, m.response_seconds
            from conversation_messages m
            join leads l on l.id = m.lead_id
            where l.account_id = ${accountId}
              and m.sent_at >= ${since.toISOString()}::timestamptz
              and m.sent_at <= ${until.toISOString()}::timestamptz
              and m.response_seconds is not null
              and m.response_seconds >= 0
            order by m.lead_id asc, m.sent_at asc, m.id asc
        `) as unknown as {
            lead_id: string;
            temperature: "COLD" | "WARM" | "HOT" | null;
            response_seconds: number;
        }[];

        return rows.map((row) => ({
            leadId: Number(row.lead_id),
            temperature: row.temperature,
            responseSeconds: Number(row.response_seconds),
        }));
    }
}
