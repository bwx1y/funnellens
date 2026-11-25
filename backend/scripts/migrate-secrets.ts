import {sql} from "drizzle-orm";
import {createHash} from "node:crypto";
import {db} from "@db/index";
import {encrypt, isEncrypted} from "@shared/crypto";

/**
 * One-off backfill for the secrets and identifiers introduced by task 24. Idempotent: a value that is
 * already `v1:` is skipped, so a re-run after a partial failure costs nothing.
 *
 * Run with `bun run db:migrate-secrets` after `0020` has been applied. Kept as a script rather than SQL
 * because AES-256-GCM needs the application key, which the database never holds.
 */
async function backfillTokens(): Promise<number> {
    const rows = await db.execute(sql`
        select id, access_token, refresh_token
        from meta_connection
    `) as unknown as {id: string; access_token: string; refresh_token: string | null}[];

    let updated = 0;
    for (const row of rows) {
        if (isEncrypted(row.access_token)) continue;

        const refresh = row.refresh_token === null || isEncrypted(row.refresh_token)
            ? row.refresh_token
            : encrypt(row.refresh_token);

        await db.execute(sql`
            update meta_connection
            set access_token  = ${encrypt(row.access_token)},
                refresh_token = ${refresh},
                token_refreshed_at = coalesce(token_refreshed_at, now())
            where id = ${row.id}::uuid
        `);
        updated += 1;
    }

    return updated;
}

/**
 * Moves plaintext bodies into `body_encrypted` and clears `body`. The row keeps its timing and
 * classification columns, so response-time and lead-quality statistics survive the rewrite.
 */
async function backfillBodies(): Promise<number> {
    const rows = await db.execute(sql`
        select id, lead_id, sent_at, body
        from conversation_messages
        where body is not null
    `) as unknown as {id: number; lead_id: number; sent_at: string | Date; body: string}[];

    let updated = 0;
    for (const row of rows) {
        const sentAt = new Date(row.sent_at);

        await db.execute(sql`
            update conversation_messages
            set body_encrypted  = ${encrypt(row.body)},
                body            = null,
                conversation_id = coalesce(conversation_id, ${conversationIdFor(Number(row.lead_id), sentAt, null)}::uuid)
            where id = ${row.id}
        `);
        updated += 1;
    }

    return updated;
}

/** Messages that never had a body still need a conversation, so the trail groups correctly. */
async function backfillConversations(): Promise<number> {
    const rows = await db.execute(sql`
        select id, lead_id, sent_at
        from conversation_messages
        where conversation_id is null
    `) as unknown as {id: number; lead_id: number; sent_at: string | Date}[];

    for (const row of rows) {
        await db.execute(sql`
            update conversation_messages
            set conversation_id = ${conversationIdFor(Number(row.lead_id), new Date(row.sent_at), null)}::uuid
            where id = ${row.id}
        `);
    }

    return rows.length;
}

/**
 * Existing leads predate the attribution columns. A lead with a campaign came from an ad but carries no
 * click id, which is exactly "unknown method, low confidence"; a lead without one is the same. Guessing
 * `ctwa_referral` for old rows would claim evidence the database never stored.
 */
async function backfillAttribution(): Promise<number> {
    const result = await db.execute(sql`
        update leads
        set attribution_method     = coalesce(attribution_method, 'unknown'),
            attribution_confidence = coalesce(attribution_confidence, 'rendah')
        where attribution_method is null or attribution_confidence is null
        returning id
    `) as unknown as {id: number}[];

    return result.length;
}

/** Same derivation the ingest repository uses, so backfilled rows match new ones. */
function conversationIdFor(leadId: number, sentAt: Date, provided: string | null): string {
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

if (import.meta.main) {
    const tokens = await backfillTokens();
    const bodies = await backfillBodies();
    const conversations = await backfillConversations();
    const attribution = await backfillAttribution();

    console.log(`[migrate-secrets] token dienkripsi: ${tokens}`);
    console.log(`[migrate-secrets] body dipindah ke body_encrypted: ${bodies}`);
    console.log(`[migrate-secrets] conversation_id diisi: ${conversations}`);
    console.log(`[migrate-secrets] atribusi default diisi: ${attribution}`);

    process.exit(0);
}
