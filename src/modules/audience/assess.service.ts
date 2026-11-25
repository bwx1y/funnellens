import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {
    ConversationMessageRepository,
    type ConversationMessage,
    type PairInput,
    type ReplyCandidate,
} from "@db/repositories/conversation-message.repository";
import {LeadAssessmentRepository} from "@db/repositories/lead-assessment.repository";
import {LeadRepository, type Lead} from "@db/repositories/lead.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {GeminiAdapter} from "@infra/ai/adapters/gemini.adapter";
import type {AIGenerateOptions, AIMessage, AIResponse} from "@infra/ai/types";
import {Config} from "@/config";
import {CONFIDENCE_LEVELS, REPLY_TYPES, SENTIMENTS, TEMPERATURE_LEVELS, type ReplyType, type Sentiment} from "@shared/audience";
import {logger} from "@shared/logger";
import {maskText} from "@shared/phone";
import {
    ASSESS_MESSAGE_LIMIT,
    ASSESS_PROMPT_VERSION,
    ASSESS_RETRIES,
    DECISION_INSTRUCTION,
    DECISION_SCHEMA,
    SIGNAL_INSTRUCTION,
    SIGNAL_SCHEMA,
    UNAVAILABLE_RULE_VERSION,
    rubricFor,
    type Decision,
    type Signal,
} from "@/modules/audience/constants";
import {
    LeadAssessmentQueue,
    reassessJobId,
    type AssessJobData,
    type ReassessJobData,
} from "@/modules/audience/queue";

/** The AI surface the pipeline needs; a plain double is enough to test it without a network. */
export interface AssessmentModel {
    generateObject<T>(
        messages: AIMessage[],
        schema?: Record<string, any>,
        options?: AIGenerateOptions
    ): Promise<AIResponse<T>>;
}

type TenantContext = {name: string; address: string | null} | null;

/**
 * The five persisted assessment fields. Only `topic` and `quote` are asked from the model;
 * `responseType`/`mood` come from the decision vocabulary and `replyMinutes` is measured here.
 */
interface AssessmentFields {
    responseType: ReplyType | null;
    mood: Sentiment | null;
    topic: string | null;
    quote: string | null;
}

/** Free-text model output: empty or blank means "not said", so it is stored as `null`, never `""`. */
function textOrNull(value: string | null | undefined): string | null {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
}

/** Closed vocabulary: a value outside the list is logged and stored as `null`, never guessed. */
function vocabularyOrNull<const T extends readonly string[]>(
    values: T,
    value: string | null | undefined,
    context: {leadId: number; field: string}
): T[number] | null {
    const trimmed = (value ?? "").trim();
    if (trimmed === "") return null;
    if ((values as readonly string[]).includes(trimmed)) return trimmed as T[number];

    logger.warn(
        {leadId: context.leadId, field: context.field, value: trimmed},
        "Lead assessment value outside its vocabulary: stored as null"
    );
    return null;
}

function mapDecisionFields(decision: Decision, leadId: number): AssessmentFields {
    return {
        responseType: vocabularyOrNull(REPLY_TYPES, decision.responseType, {leadId, field: "responseType"}),
        mood: vocabularyOrNull(SENTIMENTS, decision.sentiment, {leadId, field: "sentiment"}),
        topic: textOrNull(decision.topic),
        quote: textOrNull(decision.quote),
    };
}

/**
 * Returns the reason the decision is unusable, or `null` when it passes every check. The nullable
 * vocabulary fields only reject values they can still read: `null` means "unavailable, store it".
 */
export function validateEvidence(
    decision: {
        evidenceWamid: string;
        level: string;
        confidence: string;
        responseType: string | null;
        sentiment: string | null;
        reason: string;
    },
    messages: {wamid: string | null}[]
): string | null {
    const evidenceWamid = (decision.evidenceWamid ?? "").trim();
    if (evidenceWamid === "") return "evidenceWamid kosong";
    if (!messages.some((message) => message.wamid === evidenceWamid)) {
        return `evidenceWamid ${evidenceWamid} tidak ada di input`;
    }
    if (!(TEMPERATURE_LEVELS as readonly string[]).includes(decision.level)) {
        return `level ${decision.level} tidak dikenal`;
    }
    if (!(CONFIDENCE_LEVELS as readonly string[]).includes(decision.confidence)) {
        return `confidence ${decision.confidence} tidak dikenal`;
    }
    if (decision.responseType !== null && !(REPLY_TYPES as readonly string[]).includes(decision.responseType)) {
        return `responseType ${decision.responseType} tidak dikenal`;
    }
    if (decision.sentiment !== null && !(SENTIMENTS as readonly string[]).includes(decision.sentiment)) {
        return `sentiment ${decision.sentiment} tidak dikenal`;
    }
    if ((decision.reason ?? "").trim() === "") return "reason kosong";

    return null;
}

/**
 * `replied_at` on the inbound row is the CS send time and `response_seconds` is the lead's wait, the
 * convention every reader of `conversation_messages` already uses. A reply that quotes the message
 * (`context_wamid`) beats the first reply inside the 24-hour window.
 */
export function pairReply(input: {
    sentAt: Date;
    contextReply: ReplyCandidate | null;
    sequenceReply: ReplyCandidate | null;
}): PairInput | null {
    const reply = input.contextReply ?? input.sequenceReply;
    if (reply === null) return null;

    const responseSeconds = Math.round((reply.sentAt.getTime() - input.sentAt.getTime()) / 1000);
    if (responseSeconds < 0) return null;

    return {
        pairMethod: input.contextReply === null ? "sequence" : "reply",
        csAt: reply.sentAt,
        responseSeconds,
    };
}

/**
 * Two-level lead assessment: level 1 extracts per-message signals, level 2 decides the level and the
 * reply type. The decision is written once, in a transaction with the WARM/HOT milestone and
 * `leads.temperature`; a decision older than the stored ones is persisted but not applied, and the
 * lead is replayed from that point instead.
 */
export class LeadAssessmentService {
    constructor(
        private readonly leadRepo = new LeadRepository(),
        private readonly messageRepo = new ConversationMessageRepository(),
        private readonly assessmentRepo = new LeadAssessmentRepository(),
        private readonly accountRepo = new AdAccountRepository(),
        private readonly tenantRepo = new TenantRepository(),
        private readonly queue = new LeadAssessmentQueue(),
        private readonly ai: {model: AssessmentModel; apiKeys: string[]} = {
            model: new GeminiAdapter(),
            apiKeys: Config.ai.gemini.apiKeys,
        }
    ) {}

    async assess(job: AssessJobData): Promise<void> {
        const lead = await this.leadRepo.findById(job.leadId);
        if (lead === null) {
            logger.warn({leadId: job.leadId}, "Lead assessment skipped: lead not found");
            return;
        }

        const message = await this.messageRepo.findById(job.messageId);
        if (message === null || message.leadId !== lead.id || message.direction !== "INBOUND") {
            logger.warn({leadId: lead.id, messageId: job.messageId}, "Lead assessment skipped: inbound message not found");
            return;
        }

        await this.evaluate({lead, message, enqueueReplay: true});
    }

    async reassess(job: ReassessJobData): Promise<void> {
        const lead = await this.leadRepo.findById(job.leadId);
        if (lead === null) {
            logger.warn({leadId: job.leadId}, "Lead reassess skipped: lead not found");
            return;
        }

        const from = new Date(job.from);
        if (Number.isNaN(from.getTime())) {
            logger.warn({leadId: lead.id, from: job.from}, "Lead reassess skipped: invalid `from`");
            return;
        }

        const messages = await this.messageRepo.findInboundFrom(lead.id, from);
        for (const message of messages) {
            // The replay moves `leads.temperature`, so each step reads the level the previous one left.
            const current = await this.leadRepo.findById(lead.id) ?? lead;
            await this.evaluate({lead: current, message, enqueueReplay: false});
        }
    }

    /** Decide, persist, and classify. Never enqueues itself, so a replay cannot loop. */
    private async evaluate(input: {
        lead: Lead;
        message: ConversationMessage;
        enqueueReplay: boolean;
    }): Promise<void> {
        const {lead, message} = input;
        const window = await this.messageRepo.findWindow(lead.id, message.sentAt, ASSESS_MESSAGE_LIMIT);
        const tenant = await this.loadTenant(lead.accountId);
        const outcome = await this.decide(lead, window, tenant);

        if (!outcome.ok) {
            await this.assessmentRepo.appendUnavailable({
                leadId: lead.id,
                level: lead.temperature ?? "COLD",
                reason: `Penilaian tidak tersedia: ${outcome.error}`,
                error: outcome.error,
                eventAt: message.sentAt,
                ruleVersion: UNAVAILABLE_RULE_VERSION,
                model: null,
            });
            logger.warn(
                {leadId: lead.id, messageId: message.id, error: outcome.error},
                "Lead assessment unavailable: level unchanged"
            );
            return;
        }

        const {decision, fields, signals, model} = outcome;
        const pair = pairReply({
            sentAt: message.sentAt,
            ...(await this.messageRepo.findReplyCandidates(lead.id, message.wamid ?? "", message.sentAt)),
        });
        // Server-side measurement from the paired CS reply; the model is never asked for it.
        const replyMinutes = pair === null
            ? null
            : Math.max(0, Math.round(pair.responseSeconds / 60));

        const stored = await this.assessmentRepo.applyAssessment({
            leadId: lead.id,
            level: decision.level,
            confidence: decision.confidence,
            reason: decision.reason,
            topic: fields.topic,
            responseType: fields.responseType,
            mood: fields.mood,
            quote: fields.quote,
            replyMinutes,
            evidence: {
                wamid: decision.evidenceWamid,
                responseType: fields.responseType,
                sentiment: fields.mood,
                signals,
            },
            eventAt: message.sentAt,
            ruleVersion: ASSESS_PROMPT_VERSION,
            model,
        });

        if (fields.responseType === null || fields.mood === null) {
            logger.warn(
                {leadId: lead.id, messageId: message.id, responseType: fields.responseType, mood: fields.mood},
                "Lead message left unclassified: vocabulary outside the enum stored as null"
            );
        } else {
            await this.messageRepo.applyClassification({
                messageId: message.id,
                responseType: fields.responseType,
                sentiment: fields.mood,
                pair,
            });
        }

        if (input.enqueueReplay && !stored.applied) {
            await this.queue.add("reassess", {leadId: lead.id, from: message.sentAt.toISOString()}, {
                jobId: reassessJobId(lead.id, message.sentAt),
            });
        }
    }

    private async decide(
        lead: Lead,
        window: ConversationMessage[],
        tenant: TenantContext
    ): Promise<
        | {ok: true; decision: Decision; fields: AssessmentFields; signals: Signal[]; model: string}
        | {ok: false; error: string}
    > {
        if (this.ai.apiKeys.length === 0) {
            return {ok: false, error: "GEMINI_API_KEYS belum diisi"};
        }

        const rubric = rubricFor(tenant);
        const transcript = window.map((message) => ({
            wamid: message.wamid,
            sender: message.direction === "INBOUND" ? "LEAD" : "CS",
            at: message.sentAt.toISOString(),
            text: maskText(message.body ?? ""),
        }));

        let error = "Penilaian gagal tanpa alasan yang tercatat";
        for (let attempt = 0; attempt <= ASSESS_RETRIES; attempt++) {
            try {
                const level1 = await this.ai.model.generateObject<{signals: Signal[]}>([
                    {role: "system", content: `${rubric}\n\n${SIGNAL_INSTRUCTION}`},
                    {role: "user", content: JSON.stringify({messages: transcript})},
                ], SIGNAL_SCHEMA, {temperature: 0});

                const level2 = await this.ai.model.generateObject<Decision>([
                    {role: "system", content: `${rubric}\n\n${DECISION_INSTRUCTION}`},
                    {
                        role: "user",
                        content: JSON.stringify({
                            previous: lead.temperature,
                            signals: level1.data.signals,
                            messages: transcript,
                        }),
                    },
                ], DECISION_SCHEMA, {temperature: 0});

                const fields = mapDecisionFields(level2.data, lead.id);
                const problem = validateEvidence({
                    ...level2.data,
                    responseType: fields.responseType,
                    sentiment: fields.mood,
                }, window);
                if (problem === null) {
                    return {
                        ok: true,
                        decision: level2.data,
                        fields,
                        signals: level1.data.signals ?? [],
                        model: level2.model,
                    };
                }
                error = problem;
            } catch (cause) {
                error = cause instanceof Error ? cause.message : String(cause);
            }
        }

        return {ok: false, error};
    }

    private async loadTenant(accountId: string): Promise<TenantContext> {
        const account = await this.accountRepo.findById(accountId);
        if (account === null) return null;

        const tenant = await this.tenantRepo.findOneById(account.tenantId);
        return tenant === null ? null : {name: tenant.name, address: tenant.address};
    }
}
