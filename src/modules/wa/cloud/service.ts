import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {Config} from "@/config";
import {logger} from "@shared/logger";
import {maskPhone, maskText, normalizePhone, phoneHash} from "@shared/phone";
import {WaPhoneRepository} from "@db/repositories/wa-phone.repository";
import {AdRepository} from "@db/repositories/ad.repository";
import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {ConversationIngestRepository, type IngestAttribution} from "@db/repositories/conversation-ingest.repository";
import {LeadAssessmentQueue, assessJobId} from "@/modules/audience/queue";
import {WaCloudQueue} from "@/modules/wa/cloud/queue";
import type {CloudChangeValue, CloudMessage, CloudReferral, CloudWebhookPayload} from "@/modules/wa/cloud/types";
import type {MessageReceived} from "@/modules/wa/webhook/schema";

/** The channel-neutral message the two webhook shapes collapse into. */
interface MessageToWrite {
    accountId: string;
    waPhoneId: string;
    rawPhone: string | undefined;
    name: string | null;
    body: string | null;
    wamid: string | undefined;
    contextWamid: string | null;
    sentAt: Date;
    outbound: boolean;
    referral: CloudReferral | null;
}

/**
 * Single ingestion path for WhatsApp traffic: Cloud API deliveries arrive here through the queue
 * worker, OpenWA deliveries are handed over by `ingestOpenWa`. Both end in
 * `ConversationIngestRepository`, so one `wamid` yields at most one message row.
 */
export class CloudIngestService {
    constructor(
        private readonly phoneRepo = new WaPhoneRepository(),
        private readonly adRepo = new AdRepository(),
        private readonly adAccountRepo = new AdAccountRepository(),
        private readonly ingestRepo = new ConversationIngestRepository(),
        private readonly assessmentQueue = new LeadAssessmentQueue(),
        private readonly cloudQueue = new WaCloudQueue(),
        private readonly appSecret: string = Config.meta.appSecret
    ) {}

    /** A missing or placeholder app secret would make every signature trivially forgeable. */
    get signatureConfigured(): boolean {
        return this.appSecret !== "" && this.appSecret !== "APP_SECRET";
    }

    isValidSignature(raw: string, header: string | null | undefined): boolean {
        if (!this.signatureConfigured) return false;
        if (header === null || header === undefined || !header.startsWith("sha256=")) return false;

        const expected = Buffer.from(
            createHmac("sha256", this.appSecret).update(raw).digest("hex"),
            "hex"
        );
        const provided = Buffer.from(header.slice("sha256=".length), "hex");

        // A non-hex header truncates to a shorter buffer; timingSafeEqual throws on a length mismatch.
        if (provided.length !== expected.length) return false;

        return timingSafeEqual(provided, expected);
    }

    /** Answers the POST before any parsing happens; the same body is deduplicated by its hash. */
    async enqueue(raw: string, receivedAt: Date): Promise<void> {
        await this.cloudQueue.add("ingest", {raw, receivedAt: receivedAt.toISOString()}, {
            jobId: createHash("sha256").update(raw).digest("hex").slice(0, 32),
        });
    }

    async ingest(raw: string, receivedAt: Date): Promise<void> {
        let payload: CloudWebhookPayload;
        try {
            payload = JSON.parse(raw) as CloudWebhookPayload;
        } catch {
            logger.warn({raw: raw.slice(0, 500)}, "WA cloud webhook: invalid JSON body");
            return;
        }

        for (const entry of payload.entry ?? []) {
            for (const change of entry.changes ?? []) {
                await this.ingestChange(change.value, receivedAt);
            }
        }
    }

    async ingestOpenWa(input: {sessionId: string; message: MessageReceived}): Promise<void> {
        const {sessionId, message} = input;
        const businessNumber = message.fromMe ? message.from : message.to;
        const customerNumber = message.fromMe ? message.to : message.from;

        let binding = await this.phoneRepo.findBySessionId(sessionId);
        if (binding === null) {
            binding = await this.phoneRepo.upsert({
                sessionId,
                phone: normalizePhone(businessNumber) || businessNumber,
                phoneName: message.contact?.pushName ?? null,
            });
        }

        const accountId = await this.resolveAccountId(binding.tenantId, binding.accountId);
        if (accountId === null) {
            logger.warn({sessionId}, "WA ingest skipped: account not resolved");
            return;
        }

        await this.writeMessage({
            accountId,
            waPhoneId: binding.id,
            rawPhone: customerNumber,
            name: message.contact?.pushName ?? null,
            body: message.body,
            wamid: message.id,
            contextWamid: null,
            sentAt: eventTime(message.timestamp, new Date()),
            outbound: message.fromMe,
            referral: null,
        });
    }

    private async ingestChange(value: CloudChangeValue | undefined, receivedAt: Date): Promise<void> {
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) return;

        const binding = await this.phoneRepo.findByPhoneNumberId(phoneNumberId);
        if (binding === null) {
            logger.warn({phoneNumberId}, "WA cloud ingest skipped: phone number not bound");
            return;
        }

        const accountId = await this.resolveAccountId(binding.tenantId, binding.accountId);
        if (accountId === null) {
            logger.warn({phoneNumberId}, "WA cloud ingest skipped: account not resolved");
            return;
        }

        const contacts = new Map((value?.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name ?? null]));

        for (const message of value?.messages ?? []) {
            await this.writeCloudMessage({accountId, waPhoneId: binding.id, message, contacts, receivedAt, outbound: false});
        }

        for (const echo of value?.message_echoes ?? []) {
            await this.writeCloudMessage({
                accountId,
                waPhoneId: binding.id,
                message: echo,
                contacts,
                receivedAt,
                outbound: true,
            });
        }
    }

    private async writeCloudMessage(input: {
        accountId: string;
        waPhoneId: string;
        message: CloudMessage;
        contacts: Map<string | undefined, string | null>;
        receivedAt: Date;
        outbound: boolean;
    }): Promise<void> {
        const {message} = input;
        const rawPhone = input.outbound ? message.to ?? message.from : message.from;

        await this.writeMessage({
            accountId: input.accountId,
            waPhoneId: input.waPhoneId,
            rawPhone,
            name: contactName(input.contacts, rawPhone),
            body: message.text?.body ?? message.button?.text ?? null,
            wamid: message.id,
            contextWamid: message.context?.id ?? null,
            sentAt: eventTime(Number(message.timestamp), input.receivedAt),
            outbound: input.outbound,
            referral: input.outbound ? null : message.referral ?? null,
        });
    }

    /** Identity, masking, attribution, then the transactional write shared by every channel. */
    private async writeMessage(input: MessageToWrite): Promise<void> {
        const phoneE164 = normalizePhone(input.rawPhone ?? "");
        if (phoneE164 === "") {
            logger.warn({wamid: input.wamid}, "WA ingest skipped: sender number is empty");
            return;
        }

        const wamid = (input.wamid ?? "").trim();
        if (wamid === "") {
            logger.warn({phone: maskPhone(phoneE164)}, "WA ingest skipped: message has no wamid");
            return;
        }

        const hash = phoneHash(phoneE164);
        const identity = {
            accountId: input.accountId,
            waPhoneId: input.waPhoneId,
            externalId: hash,
            phoneHash: hash,
            phoneMasked: maskPhone(phoneE164),
            name: input.name,
            body: input.body === null ? null : maskText(input.body),
            wamid,
            contextWamid: input.contextWamid,
            sentAt: input.sentAt,
        };

        if (input.outbound) {
            await this.ingestRepo.ingestOutbound(identity);
            return;
        }

        const {attribution, attributionNote} = await this.resolveAttribution(input.accountId, input.referral, input.sentAt);
        const result = await this.ingestRepo.ingestInbound({...identity, attribution, attributionNote});

        if (result.messageId !== null) {
            await this.assessmentQueue.add("assess", {leadId: result.leadId, messageId: result.messageId}, {
                jobId: assessJobId(wamid),
            });
        }
    }

    /**
     * `wa_phone.account_id` is never written by the current code, so the tenant's selected ad account
     * is the binding. The referral only counts when the ad belongs to that account.
     */
    private async resolveAttribution(
        accountId: string,
        referral: CloudReferral | null,
        sentAt: Date
    ): Promise<{attribution: IngestAttribution | null; attributionNote: string | null}> {
        if (referral?.source_type !== "ad" || !referral.source_id) {
            return {attribution: null, attributionNote: null};
        }

        const found = await this.adRepo.findAtTime(accountId, referral.source_id, sentAt);
        if (found === null) return {attribution: null, attributionNote: null};

        return {
            attribution: {
                campaignId: found.ad.campaignId,
                adsetId: found.ad.adsetId,
                adId: found.ad.id,
                creativeId: found.ad.creativeId,
            },
            attributionNote: found.timeMatched ? null : "attribution_after_change",
        };
    }

    private async resolveAccountId(tenantId: string, boundAccountId: string | null): Promise<string | null> {
        if (boundAccountId !== null) return boundAccountId;
        const account = await this.adAccountRepo.findSelectedByTenantId(tenantId);
        return account?.id ?? null;
    }
}

/** `wa_id` is a bare number while the message may carry the `@s.whatsapp.net` suffix. */
function contactName(contacts: Map<string | undefined, string | null>, rawPhone: string | undefined): string | null {
    if (rawPhone === undefined) return null;
    return contacts.get(rawPhone) ?? contacts.get(normalizePhone(rawPhone).slice(1)) ?? null;
}

/** WhatsApp timestamps are epoch seconds; values past 1e12 are already milliseconds. */
function eventTime(value: number, fallback: Date): Date {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return new Date(value > 1e12 ? value : value * 1000);
}
