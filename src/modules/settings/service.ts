import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {AdSetRepository} from "@db/repositories/ad-set.repository";
import {ConversationMessageRepository} from "@db/repositories/conversation-message.repository";
import {MetaConnectionRepository} from "@db/repositories/meta-connection.repository";
import {SyncRunRepository} from "@db/repositories/sync-run.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {WaSessionRepository} from "@db/repositories/wa-session.repository";
import {UnauthorizedError} from "@shared/errors";
import {MIN_COMPARATORS} from "@shared/creative";
import {DEFAULT_PAGE_SIZE} from "@shared/audience";
import {PERIOD_DAYS} from "@shared/period";
import {MAX_SEARCH_RESULTS} from "@/modules/search/service";
import type {SettingsResponse, SettingsSource, SettingsSourceStatus} from "@/modules/settings/schema";

/**
 * The backend reads Meta and WhatsApp data and never writes to either platform, so the workspace is
 * read-only by construction. The reason string is what the client shows next to a disabled control.
 */
const READ_ONLY_REASON = "analytics-only";

const META_DETAIL_ROUTE = "/api/meta/connection";
const WHATSAPP_DETAIL_ROUTE = "/api/wa/session";

/**
 * One call that answers "what is this workspace and which sources actually work". Each source is
 * assembled from its own repository, so no status here is guessed: Meta needs a stored connection,
 * WhatsApp needs a `ready` session inside a `wa` scope, and both report the newest stored evidence of
 * a completed run.
 */
export class SettingsService {
    constructor(
        private readonly tenantRepo = new TenantRepository(),
        private readonly adAccountRepo = new AdAccountRepository(),
        private readonly adSetRepo = new AdSetRepository(),
        private readonly metaConnectionRepo = new MetaConnectionRepository(),
        private readonly waSessionRepo = new WaSessionRepository(),
        private readonly syncRunRepo = new SyncRunRepository(),
        private readonly conversationRepo = new ConversationMessageRepository()
    ) {}

    async get(tenantId: string): Promise<SettingsResponse> {
        const tenant = await this.tenantRepo.findOneById(tenantId);
        if (tenant === null) throw new UnauthorizedError("Workspace tidak ditemukan");

        const [accounts, selected] = await Promise.all([
            this.adAccountRepo.findByTenantId(tenantId),
            this.adAccountRepo.findSelectedByTenantId(tenantId),
        ]);
        const accountIds = accounts.map((account) => account.id);

        const [meta, whatsapp] = await Promise.all([
            this.metaSource(tenantId, selected?.id ?? null),
            this.whatsappSource(tenantId, accountIds),
        ]);

        return {
            workspace: {
                id: tenant.id,
                name: tenant.name,
                address: tenant.address,
                // A tenant without a selected account has no timezone or currency yet; guessing
                // "Asia/Jakarta" would let the client format numbers in the wrong zone.
                timezone: selected?.timezoneName ?? null,
                currency: selected?.currency ?? null,
                currencyOffset: selected?.currencyOffset ?? null,
            },
            mode: {readOnly: true, reason: READ_ONLY_REASON},
            sources: [meta, whatsapp],
            limits: {
                maxComparisonCreatives: MIN_COMPARATORS,
                maxSearchResults: MAX_SEARCH_RESULTS,
                defaultPageSize: DEFAULT_PAGE_SIZE,
                periodDays: [...PERIOD_DAYS],
            },
            exportAuditEnabled: true,
        };
    }

    private async metaSource(tenantId: string, accountId: string | null): Promise<SettingsSource> {
        const connection = await this.metaConnectionRepo.findByTenantId(tenantId);
        const [lastSyncAt, failure] = accountId === null
            ? [null, null]
            : await Promise.all([
                this.syncRunRepo.findLatestSuccessAt(accountId),
                this.syncRunRepo.findLatestFailure(accountId),
            ]);

        return {
            key: "meta",
            label: "Meta Ads",
            status: connection === null
                ? "disconnected"
                : connection.expiresAt !== null && connection.expiresAt.getTime() <= Date.now()
                    ? "expired"
                    : "connected",
            lastSyncAt: lastSyncAt?.toISOString() ?? null,
            // A failed run that a later success already superseded is history, not a current problem.
            lastError: failure === null
                ? null
                : failure.finishedAt !== null && lastSyncAt !== null && failure.finishedAt <= lastSyncAt
                    ? null
                    : failure.error,
            detailRoute: META_DETAIL_ROUTE,
        };
    }

    /**
     * WhatsApp ingestion is webhook driven, so there is no sync run to read: the newest ingested
     * message is the stored proof that the source is alive. Scope comes first — a tenant whose ad sets
     * all target the website has no WhatsApp funnel, whatever its sessions say.
     */
    private async whatsappSource(tenantId: string, accountIds: string[]): Promise<SettingsSource> {
        const [sessions, hasWa, hasWeb, lastSyncAt] = await Promise.all([
            this.waSessionRepo.findAllByTenantId(tenantId),
            this.adSetRepo.hasObjectiveGroup(accountIds, "wa"),
            this.adSetRepo.hasObjectiveGroup(accountIds, "web"),
            this.conversationRepo.getLatestSentAt(accountIds),
        ]);

        const status: SettingsSourceStatus = !hasWa && hasWeb
            ? "out_of_scope"
            : sessions.some((session) => session.status === "ready") ? "connected" : "disconnected";

        return {
            key: "whatsapp",
            label: "WhatsApp",
            status,
            lastSyncAt: lastSyncAt?.toISOString() ?? null,
            lastError: null,
            detailRoute: WHATSAPP_DETAIL_ROUTE,
        };
    }
}
