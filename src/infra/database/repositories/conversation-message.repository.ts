import {DatabaseRepository} from "./base.repository";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import type {ReplyType, Sentiment} from "@shared/audience";
import {and, desc, eq, gte, inArray, isNotNull, lte, sql} from "drizzle-orm";

export type ConversationMessage = typeof ConversationMessageEntity.$inferSelect;

/** A candidate CS reply: `sentAt` is when the CS sent it. */
export interface ReplyCandidate {
    wamid: string | null;
    sentAt: Date;
}

export interface PairInput {
    pairMethod: "reply" | "sequence";
    csAt: Date;
    responseSeconds: number;
}

/**
 * Read side of `conversation_messages` plus the writer used by the assessment pipeline. The analytics
 * methods scope to the period's messages by `sent_at` and to the tenant's leads by `account_id`; the
 * "first measured response" is the earliest row per lead with a non-null, non-negative
 * `response_seconds`.
 */
export class ConversationMessageRepository extends DatabaseRepository {
    async findById(id: number): Promise<ConversationMessage | null> {
        const [entity] = await this.database.select()
            .from(ConversationMessageEntity)
            .where(eq(ConversationMessageEntity.id, id))
            .limit(1);

        return entity ?? null;
    }

    /** Oldest-first context window ending at `until` (inclusive), capped at `limit` messages. */
    async findWindow(leadId: number, until: Date, limit: number): Promise<ConversationMessage[]> {
        const rows = await this.database.select()
            .from(ConversationMessageEntity)
            .where(and(
                eq(ConversationMessageEntity.leadId, leadId),
                lte(ConversationMessageEntity.sentAt, until)
            ))
            .orderBy(desc(ConversationMessageEntity.sentAt), desc(ConversationMessageEntity.id))
            .limit(limit);

        return rows.reverse();
    }

    /** The newest `limit` messages of one lead, still oldest-first for a transcript. */
    async findLatest(leadId: number, limit: number): Promise<ConversationMessage[]> {
        const rows = await this.database.select()
            .from(ConversationMessageEntity)
            .where(eq(ConversationMessageEntity.leadId, leadId))
            .orderBy(desc(ConversationMessageEntity.sentAt), desc(ConversationMessageEntity.id))
            .limit(limit);

        return rows.reverse();
    }

    /** Newest non-null topic per lead: the search result shows the last thing the lead talked about. */
    async getLatestTopics(leadIds: number[]): Promise<Map<number, string>> {
        const byLead = new Map<number, string>();
        if (leadIds.length === 0) return byLead;

        const rows = await this.database.select({
            leadId: ConversationMessageEntity.leadId,
            topic: ConversationMessageEntity.topic,
        })
            .from(ConversationMessageEntity)
            .where(and(
                inArray(ConversationMessageEntity.leadId, leadIds),
                isNotNull(ConversationMessageEntity.topic)
            ))
            .orderBy(ConversationMessageEntity.leadId, desc(ConversationMessageEntity.sentAt));

        for (const row of rows) {
            if (row.topic !== null && !byLead.has(row.leadId)) {
                byLead.set(row.leadId, row.topic);
            }
        }

        return byLead;
    }

    /** Inbound messages from `from` onward, oldest first: the replay range of a `reassess` job. */
    async findInboundFrom(leadId: number, from: Date): Promise<ConversationMessage[]> {
        return this.database.select()
            .from(ConversationMessageEntity)
            .where(and(
                eq(ConversationMessageEntity.leadId, leadId),
                eq(ConversationMessageEntity.direction, "INBOUND"),
                gte(ConversationMessageEntity.sentAt, from)
            ))
            .orderBy(ConversationMessageEntity.sentAt, ConversationMessageEntity.id);
    }

    /**
     * The two pairing sources for one inbound message: a CS reply that quotes it (`context_wamid`)
     * and the earliest CS reply after it within 24 hours.
     */
    async findReplyCandidates(
        leadId: number,
        wamid: string,
        sentAt: Date
    ): Promise<{contextReply: ReplyCandidate | null; sequenceReply: ReplyCandidate | null}> {
        const columns = {
            wamid: ConversationMessageEntity.wamid,
            sentAt: ConversationMessageEntity.sentAt,
        };
        const withinWindow = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);

        const [contextReply] = await this.database.select(columns)
            .from(ConversationMessageEntity)
            .where(and(
                eq(ConversationMessageEntity.leadId, leadId),
                eq(ConversationMessageEntity.direction, "OUTBOUND"),
                eq(ConversationMessageEntity.contextWamid, wamid)
            ))
            .orderBy(ConversationMessageEntity.sentAt, ConversationMessageEntity.id)
            .limit(1);

        const [sequenceReply] = await this.database.select(columns)
            .from(ConversationMessageEntity)
            .where(and(
                eq(ConversationMessageEntity.leadId, leadId),
                eq(ConversationMessageEntity.direction, "OUTBOUND"),
                gte(ConversationMessageEntity.sentAt, sentAt),
                lte(ConversationMessageEntity.sentAt, withinWindow)
            ))
            .orderBy(ConversationMessageEntity.sentAt, ConversationMessageEntity.id)
            .limit(1);

        return {
            contextReply: contextReply ?? null,
            sequenceReply: sequenceReply ?? null,
        };
    }

    /**
     * Writes the decision back onto the inbound row. An existing pairing is never overwritten: the
     * echo path may have paired the row first, and `coalesce` keeps the earlier measurement.
     */
    async applyClassification(input: {
        messageId: number;
        responseType: ReplyType;
        sentiment: Sentiment;
        pair: PairInput | null;
    }): Promise<void> {
        const pairing = input.pair === null ? {} : {
            repliedAt: sql`coalesce(${ConversationMessageEntity.repliedAt}, ${input.pair.csAt.toISOString()}::timestamptz)`,
            pairMethod: sql`coalesce(${ConversationMessageEntity.pairMethod}, ${input.pair.pairMethod})`,
            responseSeconds: sql`coalesce(${ConversationMessageEntity.responseSeconds}, ${input.pair.responseSeconds})`,
        };

        await this.database.update(ConversationMessageEntity)
            .set({
                responseType: input.responseType,
                sentiment: input.sentiment,
                senderRole: "LEAD",
                ...pairing,
            })
            .where(eq(ConversationMessageEntity.id, input.messageId));
    }

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

    /** Newest message among these accounts' leads: the stored evidence that WhatsApp ingestion ran. */
    async getLatestSentAt(accountIds: string[]): Promise<Date | null> {
        if (accountIds.length === 0) return null;

        const [row] = await this.database.select({sentAt: sql<string | Date | null>`max(${ConversationMessageEntity.sentAt})`})
            .from(ConversationMessageEntity)
            .innerJoin(LeadEntity, eq(LeadEntity.id, ConversationMessageEntity.leadId))
            .where(inArray(LeadEntity.accountId, accountIds));

        return row.sentAt === null ? null : new Date(row.sentAt);
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
