import {and, eq, sql} from "drizzle-orm";
import {createHash} from "node:crypto";
import {encrypt} from "@shared/crypto";
import {DatabaseRepository, type DatabaseTransaction} from "./base.repository";
import {LeadEntity} from "@db/schema/wa/lead.entity";
import {ConversationMessageEntity} from "@db/schema/wa/conversation-message.entity";

export interface IngestAttribution {
    campaignId: string | null;
    adsetId: string | null;
    adId: string | null;
    creativeId: string | null;
    /** The click id from the CTWA referral: the proof the chat came from an ad. */
    ctwaClid: string | null;
    method: "ctwa_referral" | "form" | "manual" | "unknown";
    confidence: "rendah" | "sedang" | "tinggi";
}

export interface IngestConversation {
    /** Cloud API conversation id when the payload has one, else a stable 24-hour bucket per lead. */
    conversationId: string | null;
}

export interface IngestInboundInput {
    accountId: string;
    waPhoneId: string;
    externalId: string;
    phoneHash: string;
    phoneMasked: string;
    name: string | null;
    body: string | null;
    wamid: string;
    contextWamid: string | null;
    sentAt: Date;
    attribution: IngestAttribution | null;
    attributionNote: string | null;
    /** Cloud API conversation id; the repository derives a daily bucket when it is absent. */
    conversationId?: string | null;
}

export interface IngestOutboundInput {
    accountId: string;
    waPhoneId: string;
    externalId: string;
    phoneHash: string;
    phoneMasked: string;
    name: string | null;
    body: string | null;
    wamid: string;
    contextWamid: string | null;
    sentAt: Date;
    /** Cloud API conversation id; the repository derives a daily bucket when it is absent. */
    conversationId?: string | null;
}

/** `messageId` is `null` when the `(lead_id, wamid)` row already existed. */
export interface IngestResult {
    leadId: number;
    messageId: number | null;
}

/**
 * The single writer of `leads` + `conversation_messages`. Both channel paths (Cloud API and OpenWA)
 * funnel here so one `wamid` can never produce two message rows, and attribution is only ever written
 * by the insert that creates the lead.
 */
export class ConversationIngestRepository extends DatabaseRepository {
    async ingestInbound(input: IngestInboundInput): Promise<IngestResult> {
        return this.database.transaction(async (tx) => {
            const [created] = await tx.insert(LeadEntity)
                .values({
                    accountId: input.accountId,
                    waPhoneId: input.waPhoneId,
                    externalId: input.externalId,
                    phoneHash: input.phoneHash,
                    phoneMasked: input.phoneMasked,
                    name: input.name,
                    firstMessage: input.body,
                    firstSeenAt: input.sentAt,
                    campaignId: input.attribution?.campaignId ?? null,
                    adsetId: input.attribution?.adsetId ?? null,
                    adId: input.attribution?.adId ?? null,
                    creativeId: input.attribution?.creativeId ?? null,
                    attributionNote: input.attributionNote,
                    ctwaClid: input.attribution?.ctwaClid ?? null,
                    attributionMethod: input.attribution?.method ?? "unknown",
                    attributionConfidence: input.attribution?.confidence ?? "rendah",
                })
                .onConflictDoNothing({
                    target: [LeadEntity.accountId, LeadEntity.externalId],
                })
                .returning({id: LeadEntity.id});

            const leadId = created?.id ?? await findLeadId(tx, input.accountId, input.externalId);

            const [message] = await tx.insert(ConversationMessageEntity)
                .values({
                    leadId,
                    wamid: input.wamid,
                    contextWamid: input.contextWamid,
                    direction: "INBOUND",
                    senderRole: "LEAD",
                    body: null,
                    bodyEncrypted: input.body === null ? null : encrypt(input.body),
                    conversationId: conversationIdFor(leadId, input.sentAt, input.conversationId),
                    sentAt: input.sentAt,
                })
                .onConflictDoNothing({
                    target: [ConversationMessageEntity.leadId, ConversationMessageEntity.wamid],
                })
                .returning({id: ConversationMessageEntity.id});

            return {leadId, messageId: message?.id ?? null};
        });
    }

    async ingestOutbound(input: IngestOutboundInput): Promise<IngestResult> {
        return this.database.transaction(async (tx) => {
            const [created] = await tx.insert(LeadEntity)
                .values({
                    accountId: input.accountId,
                    waPhoneId: input.waPhoneId,
                    externalId: input.externalId,
                    phoneHash: input.phoneHash,
                    phoneMasked: input.phoneMasked,
                    name: input.name,
                    firstMessage: null,
                    firstSeenAt: null,
                })
                .onConflictDoNothing({
                    target: [LeadEntity.accountId, LeadEntity.externalId],
                })
                .returning({id: LeadEntity.id});

            const leadId = created?.id ?? await findLeadId(tx, input.accountId, input.externalId);

            const [message] = await tx.insert(ConversationMessageEntity)
                .values({
                    leadId,
                    wamid: input.wamid,
                    contextWamid: input.contextWamid,
                    direction: "OUTBOUND",
                    senderRole: "CS",
                    body: null,
                    bodyEncrypted: input.body === null ? null : encrypt(input.body),
                    conversationId: conversationIdFor(leadId, input.sentAt, input.conversationId),
                    sentAt: input.sentAt,
                })
                .onConflictDoNothing({
                    target: [ConversationMessageEntity.leadId, ConversationMessageEntity.wamid],
                })
                .returning({id: ConversationMessageEntity.id});

            // A repeated echo must not re-pair or move `first_replied_at`.
            if (message === undefined) return {leadId, messageId: null};

            // Raw SQL binds through postgres.js, which serializes strings only.
            const sentAt = input.sentAt.toISOString();

            await tx.execute(sql`
                update conversation_messages
                set replied_at       = ${sentAt}::timestamptz,
                    pair_method      = 'sequence',
                    response_seconds = round(extract(epoch from (${sentAt}::timestamptz - sent_at)))::int
                where id = (
                    select id
                    from conversation_messages
                    where lead_id = ${leadId}
                      and direction = 'INBOUND'
                      and replied_at is null
                      and sent_at <= ${sentAt}::timestamptz
                      and sent_at >= ${sentAt}::timestamptz - interval '24 hours'
                    order by sent_at desc, id desc
                    limit 1
                )
            `);

            await tx.update(LeadEntity)
                .set({firstRepliedAt: input.sentAt, updatedAt: new Date()})
                .where(and(
                    eq(LeadEntity.id, leadId),
                    sql`${LeadEntity.firstRepliedAt} is null`,
                ));

            return {leadId, messageId: message.id};
        });
    }
}

/**
 * Cloud API conversation id when the payload carries one, otherwise a deterministic 24-hour bucket per
 * lead: the same day of chat groups together, and a returning customer next week starts a new one.
 * The value is a UUID so the column type and its index stay honest.
 */
function conversationIdFor(leadId: number, sentAt: Date, provided: string | null | undefined): string {
    const source = provided ?? `${leadId}:${Math.floor(sentAt.getTime() / 86_400_000)}`;
    const hex = createHash("sha256").update(source).digest("hex");

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        `5${hex.slice(13, 16)}`,
        `8${hex.slice(17, 20)}`,
        hex.slice(20, 32),
    ].join("-");
}

/** `onConflictDoNothing` returns no row for an existing lead; the id is then read back. */
async function findLeadId(tx: DatabaseTransaction, accountId: string, externalId: string): Promise<number> {
    const [existing] = await tx.select({id: LeadEntity.id})
        .from(LeadEntity)
        .where(and(
            eq(LeadEntity.accountId, accountId),
            eq(LeadEntity.externalId, externalId),
        ))
        .limit(1);

    if (existing === undefined) {
        throw new Error(`Lead ${accountId}/${externalId} vanished inside its own insert transaction`);
    }

    return existing.id;
}
