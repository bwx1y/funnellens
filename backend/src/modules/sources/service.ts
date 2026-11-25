import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {AdSetRepository} from "@db/repositories/ad-set.repository";
import {ConversationMessageRepository} from "@db/repositories/conversation-message.repository";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {WaSessionRepository} from "@db/repositories/wa-session.repository";
import {sourceStatusOf, type SourceStatus} from "@shared/sources";

export interface SourceView {
    key: "meta" | "whatsapp";
    label: string;
    status: SourceStatus;
    lastSyncAt: string | null;
    lastError: string | null;
    detailRoute: string;
    scopes?: string[];
    expiresAt?: string | null;
}

const META_DETAIL_ROUTE = "/api/meta/connection";
const WHATSAPP_DETAIL_ROUTE = "/api/wa/session";

/**
 * The single assembler of source status. `/api/sources` returns it as-is and `/api/settings` maps the
 * same views into its own shape, so the two pages can never disagree about whether a source works.
 *
 * Nothing here is guessed: Meta needs a stored connection plus a completed run, WhatsApp needs a
 * `ready` session inside a `wa` scope, and `lastSyncAt` is the newest stored evidence either produced.
 */
export class SourcesService {
    constructor(
        private readonly adAccountRepo = new AdAccountRepository(),
        private readonly adSetRepo = new AdSetRepository(),
        private readonly metaConnectionRepo = new MetaConnectionRepository(),
        private readonly waSessionRepo = new WaSessionRepository(),
        private readonly syncRunRepo = new SyncRunRepository(),
        private readonly conversationRepo = new ConversationMessageRepository()
    ) {}

    async snapshot(tenantId: string): Promise<SourceView[]> {
        const [accounts, selected] = await Promise.all([
            this.adAccountRepo.findByTenantId(tenantId),
            this.adAccountRepo.findSelectedByTenantId(tenantId),
        ]);
        const accountIds = accounts.map((account) => account.id);

        const [meta, whatsapp] = await Promise.all([
            this.metaSource(tenantId, selected?.id ?? null),
            this.whatsappSource(tenantId, accountIds),
        ]);

        return [meta, whatsapp];
    }

    private async metaSource(tenantId: string, accountId: string | null): Promise<SourceView> {
        const connection = await this.metaConnectionRepo.findByTenantId(tenantId);
        const [lastSyncAt, failure] = accountId === null
            ? [null, null]
            : await Promise.all([
                this.syncRunRepo.findLatestSuccessAt(accountId),
                this.syncRunRepo.findLatestFailure(accountId),
            ]);

        const expired = connection !== null
            && connection.expiresAt !== null
            && connection.expiresAt.getTime() <= Date.now();

        return {
            key: "meta",
            label: "Meta Ads",
            status: sourceStatusOf({
                configured: connection !== null,
                expired,
                synced: lastSyncAt !== null,
            }),
            lastSyncAt: lastSyncAt?.toISOString() ?? null,
            // A failed run that a later success already superseded is history, not a current problem.
            lastError: failure === null
                ? null
                : failure.finishedAt !== null && lastSyncAt !== null && failure.finishedAt <= lastSyncAt
                    ? null
                    : failure.error,
            detailRoute: META_DETAIL_ROUTE,
            scopes: connection?.scopes ?? [],
            expiresAt: connection?.expiresAt?.toISOString() ?? null,
        };
    }

    /**
     * WhatsApp ingestion is webhook driven, so there is no sync run to read: the newest ingested message
     * is the stored proof that the source is alive. Scope comes first — a tenant whose ad sets all target
     * the website has no WhatsApp funnel, whatever its sessions say.
     */
    private async whatsappSource(tenantId: string, accountIds: string[]): Promise<SourceView> {
        const [sessions, hasWa, hasWeb, lastSyncAt] = await Promise.all([
            this.waSessionRepo.findAllByTenantId(tenantId),
            this.adSetRepo.hasObjectiveGroup(accountIds, "wa"),
            this.adSetRepo.hasObjectiveGroup(accountIds, "web"),
            this.conversationRepo.getLatestSentAt(accountIds),
        ]);

        return {
            key: "whatsapp",
            label: "WhatsApp",
            status: sourceStatusOf({
                inScope: hasWa || !hasWeb,
                configured: sessions.some((session) => session.status === "ready"),
                synced: lastSyncAt !== null,
            }),
            lastSyncAt: lastSyncAt?.toISOString() ?? null,
            lastError: null,
            detailRoute: WHATSAPP_DETAIL_ROUTE,
        };
    }
}
